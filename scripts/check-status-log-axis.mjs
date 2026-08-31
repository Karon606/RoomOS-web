// 상태 이력의 날짜 축이 흔들리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 축이 둘이다. 버튼을 누른 날(changedAt)과 실제로 그 일이 일어난 날(계약의 moveOutDate·moveInDate).
// 이력의 날짜는 **누른 날**이고 정렬도 그 축이다. 사건일은 다를 때만 아래 한 줄로 적는다
// (2026-08-31 운영자 지적 — 8/14 에 나간 사람을 8/15 에 처리하니 이력에 8/15 가 적혀 헷갈린다).
//
// **changedAt 에 사건일을 써 넣는 해법은 절대 금지다.** undoAutoCheckout 이 changedAt 을
// 자동 퇴실 시각과 비교해 "사람이 그 뒤에 손댔는가"를 판정한다. 소급하면 그 가드가 조용히 깨진다.
//
// 축은 둘이다.
//   ⓐ 이력 생성이 changedAt 을 직접 쓰지 않는다(기본값 now 유지).
//   ⓑ 사건일은 돈이 읽는 그 칸에서 온다 — 사본을 만들면 언젠가 갈린다.
//
// 실행: node scripts/check-status-log-axis.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const violations = []

// ⓐ 생성 시 changedAt 을 넣는 자리가 있는가.
{
  const hits = execSync(
    "grep -rn 'tenantStatusLog.create' app lib --include='*.ts' --include='*.tsx' -A 12 || true",
    { encoding: 'utf8' },
  )
  for (const line of hits.split('\n')) {
    if (/changedAt\s*:/.test(line) && !/^\s*[-\d]+[-:]\s*\/\//.test(line)) {
      violations.push(`${line.split('-')[0]} — 이력 생성이 changedAt 을 직접 쓴다. 자동 퇴실 적용취소 가드가 그 값을 시각 비교에 쓰므로 소급하면 조용히 깨진다.`)
    }
  }
}

// ⓑ 사건일 출처.
{
  const f = 'app/(app)/rooms/actions.ts'
  const src = readFileSync(f, 'utf8')
  const fn = src.match(/export async function getTenantStatusHistory[\s\S]*?\n\}\n/)
  if (!fn) {
    violations.push(`${f} — getTenantStatusHistory 를 못 찾았다.`)
  } else {
    if (!/eventYmd/.test(fn[0])) {
      violations.push(`${f} — 이력이 사건일을 안 내린다. 늦게 처리한 퇴실이 이력에서 처리일로만 보인다.`)
    }
    // 계산부에 이름이 나오는 것만으로는 성글다 — 조회 select 에서 실제로 읽어 오는지를 본다.
    if (!/leaseTerm:\s*\{\s*select:\s*\{[^}]*moveOutDate[^}]*moveInDate/.test(fn[0])) {
      violations.push(`${f} — 사건일을 계약의 실제 날짜 칸에서 안 읽는다. 사본을 만들면 돈과 이력이 갈린다.`)
    }
  }
  const w = readFileSync('components/entity-modal/widgets/TenantStatusHistory.tsx', 'utf8')
  if (!/item\.eventYmd/.test(w)) {
    violations.push('components/entity-modal/widgets/TenantStatusHistory.tsx — 부연 줄이 없다. 서버가 내려도 화면이 안 쓰면 아무도 못 본다.')
  }
  // 오른쪽 날짜는 여전히 처리일이어야 한다 — 축을 바꾸면 정렬과 표시가 어긋난다.
  // 존재 검사로는 성글다(두 자리가 있어 한쪽만 바꿔도 통과했다). 사건일로 갈아타는 형태를 잡는다.
  if (!/fmtDateDot\(item\.changedAt\)/.test(w) || /fmtDateDot\(item\.eventYmd\s*\?\?/.test(w)) {
    violations.push('components/entity-modal/widgets/TenantStatusHistory.tsx — 이력 날짜가 처리일 축을 벗어났다. 정렬은 그 축인데 표시만 바뀌면 목록이 뒤죽박죽으로 읽힌다.')
  }
}

console.log(`[상태 이력 날짜 축] 축 ⓐ 기록일 보존 · ⓑ 사건일 부연 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  이력의 날짜는 누른 날이다. 실제로 일어난 날은 다를 때만 아래 한 줄로 적는다.')
  process.exit(1)
}
