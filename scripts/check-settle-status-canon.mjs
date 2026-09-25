// 정산상태 정본 배선 감지망 — 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-settle-status-canon.mjs
//
// 왜 필요한가. 정산상태를 정하는 자리가 일곱 곳인데 성격이 둘로 갈린다.
//   · **만드는 경로**(addExpense·배송비 생성·고정지출 기록·가져오기)는 직전 상태가 없다.
//     결제수단만 보고 정하는 것이 맞다. 여기는 그대로 둔다.
//   · **고치는 경로**(updateExpense·batchUpdateExpenses)는 직전 상태가 있다. 갈래가 안 바뀌면
//     그 상태를 지켜야 한다. 종전에는 둘 다 결제수단만 보고 덮어, 카드만 바꿔도 정산완료가
//     미정산으로 되살아났다(운영자 신고 2026-09-25, 이중 정산의 입구).
//
// 그물이 보는 축.
//   ⓐ lib/settleStatus 가 세 함수를 내보낸다.
//   ⓑ 고치는 두 함수의 **본문 안**에 settleStatusForEdit 호출이 있다.
//   ⓒ 고치는 두 함수의 본문에 날것 재계산(`'신용카드' ? 'UNSETTLED'`)이 없다.
//       만드는 경로의 같은 식은 건드리지 않는다 — 함수 본문으로 잘라서 보기 때문이다.
//   앵커(함수)를 못 찾으면 **침묵 통과가 아니라 위반**이다. 이름이 바뀌면 사람이 봐야 한다.
import { readFileSync } from 'node:fs'

const ACTIONS = 'app/(app)/finance/actions.ts'
const CANON = 'lib/settleStatus.ts'
const EDIT_FNS = ['updateExpense', 'batchUpdateExpenses']
const RAW = /'신용카드'\s*\?\s*'UNSETTLED'/

const fails = []

// 줄 주석과 블록 주석을 지운다(주석 속 예시가 위반으로 잡히지 않게). 줄 수는 보존한다.
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)

/**
 * 이름으로 그 함수의 **구획**을 잘라 온다. 선언 줄부터 다음 최상위 선언(`\nexport `) 직전까지다.
 *
 * 중괄호 깊이로 본문을 찾으려던 첫 판은 틀렸다. 시그니처가 먼저 중괄호를 연다 —
 * `updateExpense` 는 반환 타입 `Promise<{ ok: true ... }>` 가, `batchUpdateExpenses` 는
 * 매개변수 `data: { ... }` 가 그렇다. 그래서 본문 대신 타입을 잘라 놓고 "정본을 안 쓴다" 고
 * 답했다. 이 파일의 함수는 전부 최상위라 경계로 자르는 편이 정확하고 단순하다.
 */
function regionOf(src, name) {
  const at = src.search(new RegExp(`^export\\s+async\\s+function\\s+${name}\\b`, 'm'))
  if (at < 0) return null
  const next = src.indexOf('\nexport ', at + 1)
  return next < 0 ? src.slice(at) : src.slice(at, next)
}

const canon = readFileSync(CANON, 'utf8')
for (const fn of ['isCreditPay', 'settleStatusForNew', 'settleStatusForEdit']) {
  if (!new RegExp(`export function ${fn}\\b`).test(canon)) fails.push(`ⓐ ${CANON} 가 ${fn} 을 안 내보낸다`)
}

const src = strip(readFileSync(ACTIONS, 'utf8'))
for (const fn of EDIT_FNS) {
  const body = regionOf(src, fn)
  if (body == null) { fails.push(`ⓑ ${ACTIONS} 에서 ${fn} 구획을 못 찾았다 (이름이 바뀌었나 — 사람이 볼 것)`); continue }
  if (!body.includes('settleStatusForEdit')) fails.push(`ⓑ ${fn} 이 settleStatusForEdit 를 안 쓴다`)
  if (RAW.test(body)) fails.push(`ⓒ ${fn} 안에 날것 재계산('신용카드' ? 'UNSETTLED')이 남아 있다`)
}
if (!src.includes(`from '@/lib/settleStatus'`)) fails.push(`ⓑ ${ACTIONS} 가 정본을 import 하지 않는다`)

if (fails.length) {
  console.error('[정산상태 정본 배선] 위반 ' + fails.length + '건')
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`[정산상태 정본 배선] 위반 0건 (고치는 경로 ${EDIT_FNS.length}개 전부 정본 사용)`)
