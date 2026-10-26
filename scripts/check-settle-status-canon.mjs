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
//   ⓓ 배송비 행도 정본을 탄다(신고 2f0f9f4c, 2026-10-26). updateExpense 가 배송비 행이면 지금 상태를 그대로 쓰던
//       갈래(`isShipping ? existing.settleStatus`)가 되살아나면 위반이다. 계좌이체로 고친 배송비가 미정산으로 남았던 자리다.
//   ⓔ 정산상태를 쓰는 파일 전부(재무 액션·가져오기·홈 승인)에 날것 판정(`'신용카드' ? 'UNSETTLED'`,
//       `=== '신용카드' ||`)이 없다. 만드는 경로도 settleStatusForNew 하나다. 홈 승인의 'SETTLED' 못박기는
//       check-receipt-card-relay (4)가 본다(조회 조건의 settleStatus: 'SETTLED' 와 글자로 못 가르기 때문이다).
//   ⓕ 읽는 쪽. 카드 정산 화면은 isDeferredRow 로 갚을 것만 묶고, 미정산 조회는 배송비 결제구분을 싣는다.
//   ⓖ 미정산으로 되돌리는 자리(독립 검수 2026-10-26). unsettleExpenses 는 갚을 것만 돌리고, 정산 완료 목록은 체크카드를 안 싣고,
//       지출 상세의 '정산 적용취소'는 갚을 것에만 선다. 주문 묶기가 배송비 행을 다른 결제구분 주문으로 옮기면 다시 판정하고
//       묶기 전 값(settleBefore)을 토큰에 실어 적용취소가 돌려놓는다. 배송비 줄이 둘인 주문에 배송비를 묶으면 멈춘다.
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
for (const fn of ['isCreditPay', 'isDeferredRow', 'settleStatusForNew', 'settleStatusForEdit']) {
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

{
  const body = regionOf(src, 'updateExpense') ?? ''
  if (/isShipping\s*\?\s*existing\??\.settleStatus/.test(body)) fails.push('ⓓ updateExpense 가 배송비 행의 정산상태를 판정 없이 지킨다(신고 2f0f9f4c)')
  if (!/isShipping:\s*existing\.isShipping/.test(body)) fails.push('ⓓ updateExpense 가 settleStatusForEdit 에 배송비 여부를 안 싣는다')
}

const WRITERS = [ACTIONS, 'app/api/import/route.ts', 'app/(app)/dashboard/pendingReceipt.ts']
const RAW_ANY = [
  [RAW, "'신용카드' ? 'UNSETTLED'"],
  [/===\s*'신용카드'\s*\|\|/, "=== '신용카드' ||"],
]
for (const f of WRITERS) {
  const s = strip(readFileSync(f, 'utf8'))
  for (const [re, label] of RAW_ANY) if (re.test(s)) fails.push(`ⓔ ${f} 에 날것 정산 판정(${label})이 있다. settleStatusForNew·settleStatusForEdit 를 쓸 것`)
}

{
  const client = strip(readFileSync('app/(app)/card-settlement/CardSettlementClient.tsx', 'utf8'))
  if (!/isDeferredRow\(/.test(client)) fails.push('ⓕ 카드 정산 화면이 isDeferredRow 로 갚을 것만 묶지 않는다')
  if (!/buildSettleGroups\(deferred\)/.test(client)) fails.push('ⓕ 카드 정산 화면이 미정산 전부를 카드 묶음에 넣는다')
  if (!/strays\.length/.test(client)) fails.push('ⓕ 정산 대상이 아닌 미정산 행을 알리는 줄이 사라졌다(숨기지 말 것)')
  const getter = regionOf(src, 'getUnsettledExpenses') ?? ''
  if (!/order:\s*\{\s*select:\s*\{\s*shippingType:\s*true/.test(getter)) fails.push('ⓕ getUnsettledExpenses 가 배송비 결제구분을 싣지 않는다')
}

{
  const un = regionOf(src, 'unsettleExpenses') ?? ''
  if (!/isDeferredRow\(/.test(un)) fails.push('ⓖ unsettleExpenses 가 갚을 것만 미정산으로 돌리지 않는다(체크카드가 미정산이 된다)')
  const settled = regionOf(src, 'getSettledCardExpenses') ?? ''
  if (/'체크카드'/.test(settled)) fails.push('ⓖ getSettledCardExpenses 가 체크카드를 정산 완료 목록에 싣는다(적용취소로 미정산이 된다)')
  const merge = regionOf(src, 'mergeExpensesIntoOrder') ?? ''
  if (!/settleStatusForEdit\(/.test(merge) || !/settleBefore/.test(merge)) fails.push('ⓖ mergeExpensesIntoOrder 가 옮긴 배송비 행의 정산상태를 다시 판정하지 않거나 묶기 전 값을 토큰에 안 싣는다')
  const undoMerge = regionOf(src, 'undoMergeExpensesIntoOrder') ?? ''
  if (!/m\.settleBefore/.test(undoMerge)) fails.push('ⓖ undoMergeExpensesIntoOrder 가 묶기 전 정산상태를 돌려놓지 않는다(왕복이 깨진다)')
  const attach = regionOf(src, 'attachShippingToOrder') ?? ''
  if (!/shipRows\.length > 1/.test(attach)) fails.push('ⓖ attachShippingToOrder 가 배송비 줄이 둘 이상인 주문에서 하나만 고친다')
  const fc = strip(readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8'))
  if (!/settleStatus === 'SETTLED' && isDeferredRow\(/.test(fc)) fails.push("ⓖ 지출 상세의 '정산 적용취소'가 갚을 것이 아닌 행에도 선다")
  if (!/const settledCardCount = selected\.filter\([^\n]*isDeferredRow\(/.test(fc)) fails.push('ⓖ 일괄 편집이 정산완료 체크카드까지 정산완료 카드 지출로 센다')
  const cs = strip(readFileSync('app/(app)/card-settlement/CardSettlementClient.tsx', 'utf8'))
  if ((cs.match(/res\.skipped > 0/g) ?? []).length < 2 || !/res\.skipped > 0/.test(fc)) fails.push('ⓖ 정산 적용취소가 건너뛴 건(정산 대상 아님)을 알리지 않는다')
}

if (fails.length) {
  console.error('[정산상태 정본 배선] 위반 ' + fails.length + '건')
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`[정산상태 정본 배선] 위반 0건 (고치는 경로 ${EDIT_FNS.length}개 전부 정본 사용)`)
