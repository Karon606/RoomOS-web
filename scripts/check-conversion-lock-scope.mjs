// 월 계약 전환의 락 되쓰기가 마커를 포함하는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 청구 락은 **마커(isBillingAdjust)를 포함한 최댓값**이다. prisma schema 가
// "청구 락(_max expectedAmount)에는 반드시 포함"이라고 못박고, 읽기 네 경로가 전부 그렇게 센다.
//
// 그런데 되쓰기 한쪽은 마커를 뺀다(paymentEngine.rewriteLockedExpectedForRentAmount 의
// `isBillingAdjust: false`). 그 경로만 타면 새 월세가 옛 단기 누적가보다 작을 때 마커가 옛 값을
// 쥔 채 남는다 — 470,000 을 받고 380,000 월 계약으로 전환하면 90,000 이 허수 미납으로 뜬다.
// 520호는 두 값이 같아 우연히 안 터졌을 뿐이다.
//
// 그래서 전환 액션(convertToMonthly)은 마커를 포함한 범위로 되쓴다. 그 범위가 좁아지는 것을
// 여기서 잡는다. 축은 셋이다.
//
//   ⓐ 되쓰기 조회에 isBillingAdjust 필터가 없다 — 있으면 마커가 안 내려간다.
//   ⓑ 과거 회계월을 지키는 가드(checkSettlementMonth)를 지난다 — 입주월 락을 고치는 것은
//     과거 달의 청구를 고치는 일이다.
//   ⓒ 되쓰기 전 원값을 스냅샷에 남긴다(lockRewrites) — 적용취소가 휴리스틱 없이 복원한다.
//
// 실행: node scripts/check-conversion-lock-scope.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/tenants/actions.ts'
const src = readFileSync(FILE, 'utf8')
const violations = []

const fn = src.match(/export async function convertToMonthly[\s\S]*?\n\}\n/)
if (!fn) {
  violations.push(`${FILE} — convertToMonthly 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
} else {
  const body = fn[0]

  // ⓐ 되쓰기 조회가 마커를 빼는가.
  const find = body.match(/findMany\(\{[\s\S]{0,400}?\}\)/)
  if (!find) {
    violations.push(`${FILE} — 전환의 되쓰기 조회를 못 찾았다.`)
  } else if (/isBillingAdjust\s*:\s*false/.test(find[0])) {
    violations.push(`${FILE} — 되쓰기가 마커를 뺀다. 락은 마커를 포함한 최댓값이라 옛 값이 남아 허수 미납이 된다.`)
  }
  if (!/lockRewritesFor\(/.test(body)) {
    violations.push(`${FILE} — 되쓰기 대상 판정이 lockRewritesFor 정본을 안 쓴다.`)
  }

  // ⓑ 과거 회계월 가드.
  if (!/checkSettlementMonth\(/.test(body)) {
    violations.push(`${FILE} — 전환이 checkSettlementMonth 를 안 지난다. 신고가 끝난 달의 청구를 고칠 수 있다.`)
  }

  // ⓒ 적용취소 근거.
  if (!/lockRewrites:/.test(body)) {
    violations.push(`${FILE} — 되쓰기 전 원값을 스냅샷에 안 남긴다. 적용취소가 정확히 복원하지 못한다.`)
  }
  if (!/kind: 'toMonthly'/.test(body)) {
    violations.push(`${FILE} — 전환 스냅샷에 kind 표시가 없다. 적용취소가 연장·감액과 구분하지 못한다.`)
  }
}

// 적용취소가 실재하고 전환 뒤 수납을 막는가 — 운영자 원칙상 undo 는 필수다.
const undo = src.match(/export async function undoMonthlyConversion[\s\S]*?\n\}\n/)
if (!undo) {
  violations.push(`${FILE} — undoMonthlyConversion 이 없다. 적용하는 기능에는 적용취소가 있어야 한다.`)
} else if (!/actualAmount:\s*\{\s*gt:\s*0\s*\}/.test(undo[0])) {
  violations.push(`${FILE} — 적용취소가 전환 뒤 수납을 안 본다. 월 조건으로 받은 돈이 단기 계약에 남는다.`)
}

console.log(`[전환 락 범위] 축 ⓐ 마커 포함 · ⓑ 회계월 가드 · ⓒ 적용취소 근거 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  락은 마커를 포함한 최댓값이다. 되쓰기가 그보다 좁으면 옛 값이 남아 허수 미납이 된다.')
  process.exit(1)
}
