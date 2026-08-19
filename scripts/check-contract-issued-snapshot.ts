// 발급본 박제(ContractFile.issuedSnapshot)가 빠지거나 사라지는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-11).
//
// 왜 있나
//   발급본은 증거인데 그 증거가 lease 의 서명 네 칸에 얹혀 있었다. 서명을 지우면 이미 발급한
//   계약서의 서명 기록까지 함께 사라진다 — 502호에서 8/6 서명 이미지가 실제로 소실됐다.
//   그래서 발급 시점의 인쇄 사실·서명·본문 출처를 발급본 자신이 들고 있게 했다.
//   박제는 발급 트랜잭션 한 번만 쓰므로, 지켜야 할 것은 두 가지뿐이다.
//
//   축 A — 배포 이후 새로 만들어진 앱 발급본에 박제가 없다.
//          = 발급 경로가 박제를 안 쓰고 있다(같은 update 문에서 떨어져 나갔다는 뜻).
//   축 B — 한 번 생긴 박제의 총량이 줄었다.
//          = 어딘가가 이 칸에 쓰고 있다. 박제는 절대 갱신되지 않는다(증거이기 때문).
//
// 왜 '총 건수 0' 이 기준이 아닌가 (축 A)
//   마이그레이션 이전에 발급된 42건은 박제가 없고, 앞으로도 없다. 그 값을 사람이 지어 넣으면
//   그것은 증거가 아니라 창작이다. 그래서 기준 시각을 두고 그 이후 것만 본다
//   (scripts/check-inquiry-drift.mjs 의 래칫 선례와 같은 방식).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// 마이그레이션 적용 시각 — prisma/migrate_contract_issued_snapshot.sql 을 DIRECT_URL 로 실행한 순간.
// 이 시각 이후에 만들어진 앱 발급본은 전부 박제 칸이 있는 코드로 만들어진 것이다.
const CUTOFF = new Date('2026-08-11T00:33:33+09:00')

// 축 B 의 래칫 기준선 — 2026-08-12 실측 2건(502호 영문명 재발급 + 409호 서종희 발급).
// 박제는 늘기만 하고 절대 줄지 않는다. 실측이 기준선보다 많아지면 아래 안내대로 값을 올려 잠근다
// (올려 두지 않으면 그 사이 사라진 박제를 이 축이 못 본다).
// 2026-08-18 실측 6건으로 상향 — 운영자 발급 증가분 4건(축 자체 안내에 따른 래칫 정비).
// 2026-08-19 실측 8건으로 상향 — 501호 발급 2부(#20260819-014·015, 신고 63cd1049 의 그 두 부).
// 버전 폐기는 이 값을 건드리지 않는다. 폐기는 issuedSnapshot 을 읽지도 쓰지도 않고 voidedAt 만
// 찍으므로, 폐기 뒤에도 박제 총량은 그대로여야 한다 — 줄면 그것이 곧 축 B 가 잡을 사고다.
// 2026-08-19 재상향: 운영자 발급 증가분 1건(축 자체 안내에 따른 래칫 정비).
const SNAPSHOT_BASELINE = 9

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  // 소프트삭제된 행도 함께 읽는다. 삭제는 목록에서 감추는 것일 뿐 박제를 지우지 않으므로,
  // deletedAt 을 걸러 버리면 '삭제로 줄어든 것'과 '지워져서 줄어든 것'을 축 B 가 구분 못 한다.
  const rows = await prisma.contractFile.findMany({
    select: {
      id: true, source: true, contractNo: true, createdAt: true, deletedAt: true,
      driveFileId: true, issuedSnapshot: true,
      tenant: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const hasSnapshot = (v: unknown) => v !== null && v !== undefined && typeof v === 'object'

  // ── 축 A — 기준 시각 이후 신규 앱 발급본인데 박제가 없다 ──────────────
  // 스캔본(UPLOADED)은 앱이 인쇄한 것이 아니라 박제할 사실이 없다. 파일이 안 붙은 예약 행
  // (driveFileId 빈 문자열)은 발급이 실패해 보상 삭제를 기다리는 자리라 대상이 아니다.
  const fresh = rows.filter(r => r.source === 'GENERATED' && r.driveFileId !== '' && r.createdAt >= CUTOFF)
  for (const r of fresh) {
    if (hasSnapshot(r.issuedSnapshot)) continue
    violations.push(`${r.tenant?.name ?? '?'} 의 발급본(${r.contractNo ?? '번호 없음'})에 발급 기록이 없다 — 발급 경로가 issuedSnapshot 을 같은 update 문에서 놓쳤다`)
  }

  // ── 축 B — 한 번 생긴 박제가 사라졌다(개수 래칫) ─────────────────────
  const kept = rows.filter(r => hasSnapshot(r.issuedSnapshot)).length
  const short = SNAPSHOT_BASELINE - kept
  if (short > 0) {
    violations.push(`발급 기록이 ${kept}건 — 기준선 ${SNAPSHOT_BASELINE} 보다 ${short}건 적다. 발급본 박제를 갱신·삭제하는 경로가 생겼다(쓰기는 발급 트랜잭션 한 번뿐이어야 한다)`)
  }

  await prisma.$disconnect()

  console.log(`[발급본 박제] 전체 ${rows.length}건 · 기준 시각 이후 앱 발급본 ${fresh.length}건 · 박제 ${kept}건(기준선 ${SNAPSHOT_BASELINE}) / 위반 ${violations.length}건`)
  if (kept > SNAPSHOT_BASELINE) {
    console.log(`  [축 B] 실측이 기준선보다 ${kept - SNAPSHOT_BASELINE}건 많다 — scripts/check-contract-issued-snapshot.ts 의 SNAPSHOT_BASELINE 을 ${kept} 로 올려라.`)
  }
  if (violations.length) {
    console.error(`\n[발급본 박제] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  발급본은 증거다. 박제는 발급할 때 한 번 쓰고 그 뒤로는 아무도 건드리지 않는다.')
    process.exit(1)
  }
}

main()
