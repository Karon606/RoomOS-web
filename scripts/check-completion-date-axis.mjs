// 완료 처리 날짜 축이 '클릭한 날'로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 넷째 형제가 필요한가 (운영자 지시 2026-09-17)
//   "뭔가를 완료처리하고 처리 날짜가 기록되는 건은 항상 날짜를 수동으로 입력할 수 있게 해줘."
//   기존 시간 감지망 셋은 **이 클래스를 안 본다.**
//     check-ssr-local-now        — '오늘'을 어떻게 만드나(서버·기기 하이드레이션)
//     check-naive-datetime       — 오프셋 없는 일시 문자열·로컬 시각 게터
//     check-local-midnight-boundary — 창(범위)의 양끝
//   셋 다 "값을 어떻게 만드나"를 보고, "운영자에게 물었나"는 안 본다. `resolvedAt: new Date()` 는
//   타임존이 완벽해도 **틀린 날**을 박는다 — 일어난 날이 아니라 누른 날이기 때문이다.
//
// 같은 병을 이미 두 번 앓았다. 현금영수증 발행일(2026-08-24)과 보증금 정산일(2026-09-03)이다.
// 세 번째라 케이스가 아니라 클래스로 막는다.
//
// 무엇을 보나
//   ⓐ 값 — 완료 계열 칸에 `new Date()` 를 직접(또는 '지금' 변수로) 박는 자리. 칸 이름은
//      **prisma/schema.prisma 에서 접미사로 뽑는다**(check-naive-datetime 이 @db.Date 명단을
//      스키마에서 읽는 그 관행). 명단을 손으로 들면 새 완료 칸이 생길 때마다 그물이 뒤처진다.
//      **새 완료 칸은 ALLOW 에 없으므로 fail closed 로 걸린다** — 그것이 이 축의 요점이다.
//   ⓑ 서버 — 완료 액션들이 미래 가드(assertNotFuture)와 값 결정 정본(resolveCompletionAt)을 지나는가.
//   ⓒ 화면 — 완료 버튼 옆에 완료일 칸이 서고 그 칸에 maxDate 가 걸려 있는가.
//   ⓓ 어휘 — 라벨이 '완료일'이다. '처리일'은 **클릭한 날로 읽힌다**(보증금 정산일 축 ⓒ 가 이미 막았다).
//
// 무엇을 안 보나 — 이미 도메인 그물이 보는 자리는 뺀다. 두 그물이 같은 줄을 울면 고치는 사람이
// 어느 규칙을 따를지 모른다.
//   · cashReceiptIssuedAt / CashReceipt.issuedAt — 현금영수증 축(규칙 20·20-b, [[cash-receipt-refund]])
//   · depositReturnDate — 보증금 정산일 축(check-deposit-return-date-axis)
//   이름 접미사에 issued·returned 를 **일부러 안 넣었다.** 넣으면 저 둘을 두 번 세게 된다.
//   · Expense.receivedAt(자재 수령) — 시점별 재고·평균 소모율·리드타임이 그 축에 얹혀 있어 별건이다.
//
// 실행: node scripts/check-completion-date-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
const violations = []

// ── 완료 계열 칸 이름 — 스키마에서 접미사로 뽑는다 ──────────────
const FAMILY = /(?:resolved|checked|done|completed|finished|settled)(?:At|Date)$/i
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const COMPLETION_COLUMNS = new Set(
  (SCHEMA.match(/^\s*(\w+)\s+DateTime\??/gm) ?? [])
    .map(l => l.trim().split(/\s+/)[0])
    .filter(n => FAMILY.test(n)),
)
if (COMPLETION_COLUMNS.size === 0) {
  violations.push('schema.prisma 에서 완료 계열 칸을 하나도 못 뽑았다 — 아무것도 안 보는 그물이 가장 나쁘다. 접미사 규칙을 고칠 것')
}

/**
 * '지금'을 박아도 되는 자리. **로그다** — 그 조작을 언제 눌렀는지가 기록의 뜻 자체인 칸.
 * 명단은 최소로 유지한다. 사실(언제 일어났나)을 적는 칸은 절대 여기 오면 안 된다.
 */
const ALLOW = [
  {
    file: 'app/(app)/tenants/actions.ts', column: 'undoneAt',
    why: '단기 연장 적용취소를 **누른 시각**이다. 일어난 날이 따로 있는 사실이 아니라 조작 로그라 지금이 맞다',
  },
  {
    file: 'app/(app)/finance/actions.ts', column: 'undoneAt',
    why: '품목명 병합 되돌리기를 **누른 시각**이다. 같은 이유로 로그다',
  },
]
const allowed = (file, column) => ALLOW.some(a => a.file === file && a.column === column)

// ── ⓐ 값 축 ──────────────────────────────────────────────────
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!/\.tsx?$/.test(name)) continue
    scan(relative(ROOT, p).split('\\').join('/'), readFileSync(p, 'utf8'))
  }
}

function scan(rel, src) {
  const lines = src.split('\n')
  // '지금'으로 만들어진 변수 이름. `const now = new Date()` 를 거쳐 칸에 실리면 직접 대입과 같다.
  const nowVars = new Set()
  lines.forEach((raw, i) => {
    // 주석은 걷는다 — 설명하려고 적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다.
    const line = raw.replace(/\/\/.*$/, '')
    const at = rule => violations.push(`${rel}:${i + 1} [${rule}]\n      ${raw.trim()}`)

    const nv = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)/)
    if (nv) nowVars.add(nv[1])

    for (const m of line.matchAll(/\b(\w+)\s*:\s*([^,{}]*)/g)) {
      const col = m[1]
      if (!COMPLETION_COLUMNS.has(col) || allowed(rel, col)) continue
      const val = m[2].trim()
      if (/^new Date\(\s*\)/.test(val)) {
        at(`완료 칸(${col})에 '지금'을 직접 박는다 — 클릭한 날이지 일어난 날이 아니다. lib/completionDate resolveCompletionAt 을 쓸 것`)
      } else if (nowVars.has(val)) {
        at(`완료 칸(${col})에 '지금' 변수(${val})를 박는다 — 같은 클래스다. lib/completionDate resolveCompletionAt 을 쓸 것`)
      }
    }
    // data: { checkedAt } 같은 축약 표기
    for (const m of line.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) {
      const col = m[1]
      if (COMPLETION_COLUMNS.has(col) && !allowed(rel, col) && nowVars.has(col)) {
        at(`완료 칸(${col})에 '지금' 변수를 축약으로 싣는다 — 같은 클래스다`)
      }
    }
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

// ── ⓑ 서버 축 — 완료 액션이 두 정본을 지나는가 ─────────────────
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

/** 파일에서 export 함수 하나의 몸통만 잘라 낸다 — 파일 어딘가의 가드가 대신 통과하지 않게. */
function fnBody(source, name) {
  const at = source.indexOf(`export async function ${name}(`)
  if (at < 0) return null
  const next = source.indexOf('\nexport ', at + 1)
  return source.slice(at, next < 0 ? source.length : next)
}

const SERVER = [
  { file: 'app/(app)/tenants/actions.ts', fn: 'resolveTenantRequest', what: '요청·컴플레인 완료' },
  { file: 'app/(app)/checklist/actions.ts', fn: 'markChecklistDone', what: '점검 완료' },
  { file: 'app/(app)/room-manage/workActions.ts', fn: 'completeRoomWork', what: '작업 완료', guardOnly: true },
  { file: 'app/(app)/room-manage/cleaningActions.ts', fn: 'completeCleaning', what: '청소 완료', guardOnly: true },
]
for (const s of SERVER) {
  const body = fnBody(strip(readFileSync(join(ROOT, s.file), 'utf8')), s.fn)
  if (body === null) {
    violations.push(`${s.file} — ${s.fn} 을 못 찾았다(${s.what}). 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다`)
    continue
  }
  if (!/assertNotFuture\(/.test(body)) {
    violations.push(`${s.file} — ${s.fn} 에 미래 가드가 없다(${s.what}). 화면 maxDate 가 전부여도 다섯째 경로가 뚫는다`)
  }
  // 값 결정을 정본에 맡기는가. 날짜만 받는 자리(작업·청소)는 ymdToDbDate 로 @db.Date 에 바로 앉힌다.
  if (!s.guardOnly && !/resolveCompletionAt\(/.test(body)) {
    violations.push(`${s.file} — ${s.fn} 이 값 결정 정본(resolveCompletionAt)을 안 지난다(${s.what})`)
  }
}

// 엑셀 임포트가 화면과 **같은 정본**을 지나는가 — 두 경로가 갈리면 임포트만 옛 규칙에 남는다.
{
  const imp = strip(readFileSync(join(ROOT, 'app/api/import/route.ts'), 'utf8'))
  if (!/resolveCompletionAt\(/.test(imp) || !/assertNotFuture\(/.test(imp)) {
    violations.push("app/api/import/route.ts — 요청 시트의 '해결일'이 완료 날짜 정본을 안 지난다")
  }
  if (/resolvedAt\s*=[\s\S]{0,80}\?\?\s*new Date\(\)/.test(imp)) {
    violations.push("app/api/import/route.ts — 임포트가 '해결일'이 비면 오늘을 박는 옛 문법으로 되돌아갔다")
  }
}

// ── ⓒⓓ 화면 축 — 완료 버튼 옆 날짜 칸·maxDate·라벨 ──────────────
const SCREENS = [
  { file: 'app/(app)/requests/RequestsClient.tsx', what: '/requests 완료 확인 줄' },
  { file: 'components/entity-modal/widgets/TenantRequestsTab.tsx', what: '입주자 정보 › 요청·컴플레인 탭' },
  { file: 'app/(app)/checklist/ChecklistClient.tsx', what: '체크리스트 카드·점검 모달' },
  { file: 'components/work/RoomWorkRowBody.tsx', what: '작업 행 완료 폼' },
  { file: 'components/cleaning/CleaningRowBody.tsx', what: '청소 행 완료 폼' },
]
for (const s of SCREENS) {
  const raw = readFileSync(join(ROOT, s.file), 'utf8')
  const src = strip(raw)
  if (!/(^|[>\s]) *완료일/m.test(src)) {
    violations.push(`${s.file} — 완료일 라벨이 없다(${s.what}). 완료 처리가 날짜를 안 묻는 상태로 되돌아갔다`)
  }
  // maxDate 가 kstYmdStr() 로 걸려 있는가. 상수로 빼도 되지만 그때는 이 그물을 같이 고친다.
  if (!/maxDate=\{[^}]*kstYmdStr\(\)/.test(src)) {
    violations.push(`${s.file} — 완료일 칸에 maxDate 가 없다(${s.what}). 아직 하지 않은 일을 완료로 고를 수 있다`)
  }
  // 어휘 — '처리일'은 클릭한 날로 읽힌다(보증금 정산일 축 ⓒ 와 같은 판정).
  // '목표 처리일'은 앞날을 적는 다른 칸이라 예외다.
  if (/(?<!목표 )처리일(?!\s*\(선택\))/.test(src.replace(/목표 처리일/g, ''))) {
    violations.push(`${s.file} — 라벨이 '처리일'이다(${s.what}). 축 이름은 '완료일' 하나다`)
  }
}

console.log(`[완료 처리 날짜 축] 완료 칸 ${COMPLETION_COLUMNS.size}종(${[...COMPLETION_COLUMNS].join('·')}) · 허용 ${ALLOW.length}곳 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
if (violations.length > 0) {
  console.error('\n  완료 처리 날짜는 운영자가 적는다(지시 2026-09-17). 값 결정은 lib/completionDate 하나,')
  console.error('  미래는 화면 maxDate 와 서버 assertNotFuture 두 겹으로 막는다. 자세히는 knowledge/domain-completion-date.md')
  process.exit(1)
}
