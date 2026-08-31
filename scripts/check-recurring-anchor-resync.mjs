// 고정지출 간격 주기의 기준 달이 '마지막 기록'에서 파생되는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 도래 판정은 달력 달 고정이다 — (월 − 기준달) mod interval == 0. 반기 항목을 8월에
// 걸어 두면 다음은 무조건 2월이라, 사정이 있어 3월에 하면 그 뒤로 계속 어긋난다. 운영자 요구는
// "6개월이라고 하더라도 정확히 6개월 후에 진행이 안 될 수 있으므로 부과일정이 좀 더 flexable하게"
// 였다(2026-08-31, 가스안전검사).
//
// 그래서 기준 달을 저장값으로 굳히지 않고 마지막 기록에서 파생시킨다. 그 형태를 고른 진짜 이유는
// **되돌림이 저절로 되기 때문이다** — 기록할 때 기준을 그냥 덮어쓰면 잘못 기록한 지출을 지워도
// 옮겨진 기준이 남아 주기가 조용히 밀린다. 파생값이면 지우는 순간 이전 기록이 다시 기준이 된다.
//
// 축은 셋이다.
//   ⓐ 파생 정본이 존재하고 마지막 기록을 조회한다(매월 항목은 건드리지 않는다).
//   ⓑ 지출의 기록·삭제·삭제취소·날짜 수정 넷이 그 정본을 지난다 — 하나만 빠져도 기준이 어긋난 채 남는다.
//   ⓒ 재무 액션 안에서 그 정본 밖으로 anchorMonth 를 직접 쓰지 않는다(두 벌이 되면 갈린다).
//     환경설정의 손 지정(normalizeCycle)은 기록이 하나도 없을 때의 출발점이라 대상이 아니다.
//
// 실행: node scripts/check-recurring-anchor-resync.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const FILE = 'app/(app)/finance/actions.ts'
const src = readFileSync(FILE, 'utf8')
const violations = []

// ⓐ 파생 정본.
const fn = src.match(/async function resyncRecurringAnchor[\s\S]*?\n\}\n/)
if (!fn) {
  violations.push(`${FILE} — resyncRecurringAnchor 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
} else {
  const body = fn[0]
  if (!/orderBy:\s*\{\s*date:\s*'desc'\s*\}/.test(body)) {
    violations.push(`${FILE} — 기준 달 파생이 '마지막 기록'을 안 본다. 어느 기록을 쥐는지가 이 규칙의 전부다.`)
  }
  if (!/intervalMonths\s*<=\s*1/.test(body)) {
    violations.push(`${FILE} — 매월 항목을 안 걸러낸다. interval 1 은 기준 달 개념이 없어 건드리면 거동이 바뀐다.`)
  }
  if (!/anchorMonth:\s*next/.test(body)) {
    violations.push(`${FILE} — 파생한 값을 안 쓴다.`)
  }
}

// ⓑ 세 경로가 정본을 지나는가.
const PATHS = [
  ['기록', /export async function recordRecurringExpense[\s\S]*?\n\}\n/],
  ['삭제', /export async function deleteExpense[\s\S]*?\n\}\n/],
  ['삭제취소', /export async function undoDeleteExpense[\s\S]*?\n\}\n/],
  // 네 번째 문 — 기록의 날짜를 고치는 것도 '기록이 다른 달로 옮겨지는' 일이다. 종전에는 이 경로만
  // 새서 8/25 기록을 9/2 로 고치면 실제 기록은 9월인데 기준은 8월에 남았다(2026-08-31 발견).
  ['날짜 수정', /export async function updateExpense[\s\S]*?\n\}\n/],
]
for (const [name, re] of PATHS) {
  const m = src.match(re)
  if (!m) { violations.push(`${FILE} — '${name}' 경로를 못 찾았다.`); continue }
  if (!/resyncRecurringAnchor\(/.test(m[0])) {
    violations.push(`${FILE} — '${name}' 경로가 기준 달을 다시 맞추지 않는다. 주기가 어긋난 채 남는다.`)
  }
}

// ⓒ 정본 밖 직접 쓰기.
{
  const at = src.indexOf('async function resyncRecurringAnchor')
  const end = at >= 0 ? src.indexOf('\n}\n', at) : -1
  let pos = 0
  for (const line of src.split('\n')) {
    const here = pos
    pos += line.length + 1
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    if (!/anchorMonth\s*:/.test(line)) continue
    // select 의 읽기는 대상이 아니다 — 이 축이 잡는 것은 기준 달을 '써 넣는' 자리다.
    if (/anchorMonth\s*:\s*true\b/.test(line)) continue
    if (at >= 0 && here > at && here < end) continue
    violations.push(`${FILE}:${src.slice(0, here).split('\n').length} — 정본 밖에서 anchorMonth 를 쓴다. resyncRecurringAnchor 를 쓴다.`)
  }
}

// ⓓ '이번만' 표시를 파생이 실제로 건너뛰는가 (2026-08-31).
//    이 필터가 빠지면 일회성으로 적은 한 번이 리듬의 기준이 되어 '이번만'이 영구 변경이 된다.
{
  const fn2 = src.match(/async function resyncRecurringAnchor[\s\S]*?\n\}\n/)
  if (fn2 && !/excludeFromAnchor:\s*false/.test(fn2[0])) {
    violations.push(`${FILE} — 파생이 '이번만' 기록을 안 걸러낸다. 일회성 진행이 리듬을 영구히 옮긴다.`)
  }
  const rec = src.match(/export async function recordRecurringExpense[\s\S]*?\n\}\n/)
  if (rec && !/excludeFromAnchor:\s*data\.keepCycle/.test(rec[0])) {
    violations.push(`${FILE} — 기록이 '이번만' 선택을 저장하지 않는다. 물어봐 놓고 답을 버린다.`)
  }
}

// ⓔ 회차 지정을 읽는 곳이 판정 정본 하나뿐인가.
//    소비처가 각자 지정을 해석하기 시작하면 화면마다 도래 달이 갈린다(주기 판정이 밟은 길이다).
{
  const readers = execSync(
    "grep -rln 'nextDueOverrideMonth' app lib components scripts --include='*.ts' --include='*.tsx' --include='*.mjs' || true",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  // 판정 정본과, 값을 실어 나르기만 하는 자리(현황·행 타입·두 폼·기록/삭제 액션)는 허용한다.
  const ALLOWED = new Set([
    'lib/recurringDueDate.ts',
    'app/(app)/finance/recurringStatus.ts',
    'app/(app)/finance/actions.ts',
    'app/(app)/finance/FinanceClient.tsx',
    'app/(app)/finance/RecurringExpenseRecordModal.tsx',
    'app/(app)/settings/actions.ts',
    'app/(app)/settings/SettingsForm.tsx',
    'scripts/check-recurring-anchor-resync.mjs',
    'scripts/test-recurring-due-date.ts',
  ])
  for (const f of readers) {
    if (!ALLOWED.has(f)) {
      violations.push(`${f} — 회차 지정을 새로 읽는다. 도래 판정은 lib/recurringDueDate 한 곳이 답해야 한다.`)
    }
  }
}

console.log(`[주기 기준 달] 축 ⓐ 마지막 기록 파생 · ⓑ 네 경로 경유 · ⓒ 정본 밖 직접 쓰기 금지 · ⓓ 이번만 표시 · ⓔ 지정 소비처 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  기준 달은 마지막 기록에서 나온다. 저장값으로 굳히면 잘못 기록한 것을 지워도 주기가 밀린 채 남는다.')
  process.exit(1)
}
