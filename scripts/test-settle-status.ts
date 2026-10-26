// 정산상태 회귀 — lib/settleStatus. 실행: npx tsx scripts/test-settle-status.ts
//
// 고정하는 것(운영자 신고 2026-09-25, 승인 같은 날). **카드에서 카드로 옮기는 것은 갈래가 안
// 바뀌는 일이고, 그때 정산완료는 살아남아야 한다.** 종전에는 두 수정 경로가 결제수단만 보고
// 다시 계산해 이미 빠져나간 돈이 미정산 합계에 되살아났다(이중 정산의 입구).
import { isCreditPay, isDeferredRow, settleStatusForNew, settleStatusForEdit } from '../lib/settleStatus'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  실패 ${name}\n    기대 ${want}\n    실제 ${got}`)
}

// 갈래 판정
eq('신용카드는 갚을 것', isCreditPay('신용카드'), true)
eq('체크카드는 즉시 빠진다', isCreditPay('체크카드'), false)
eq('계좌이체는 즉시 빠진다', isCreditPay('계좌이체'), false)
eq('빈 값', isCreditPay(null), false)

// 새로 만들 때 — 종전 규칙 그대로다(이 경로는 안 바뀐다)
eq('새 신용카드 지출은 미정산', settleStatusForNew('신용카드'), 'UNSETTLED')
eq('새 계좌이체 지출은 정산완료', settleStatusForNew('계좌이체'), 'SETTLED')

// **이 신고의 핵심** — 카드에서 카드로 옮겨도 정산완료는 지킨다
eq('카드→카드, 정산완료 유지', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '신용카드', current: 'SETTLED',
}), 'SETTLED')
eq('카드→카드, 미정산 유지', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '신용카드', current: 'UNSETTLED',
}), 'UNSETTLED')

// 갈래가 바뀔 때만 다시 계산한다
eq('신용카드→계좌이체는 정산완료로', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '계좌이체', current: 'UNSETTLED',
}), 'SETTLED')
eq('계좌이체→신용카드는 미정산으로', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '신용카드', current: 'SETTLED',
}), 'UNSETTLED')

// 갈래가 같으면 결제수단 글자가 달라도 지킨다(체크카드·계좌이체 둘 다 즉시 결제다)
eq('체크카드→계좌이체, 상태 유지', settleStatusForEdit({
  prevPayMethod: '체크카드', nextPayMethod: '계좌이체', current: 'SETTLED',
}), 'SETTLED')

// 직전 결제수단을 모를 때(옛 행) — 갈래가 다르면 다시 계산한다
eq('직전이 없고 새로 신용카드면 미정산', settleStatusForEdit({
  prevPayMethod: null, nextPayMethod: '신용카드', current: 'SETTLED',
}), 'UNSETTLED')
// 갚을 것이 아닌 행은 언제나 정산완료다(신고 2f0f9f4c, 운영자 승인 2026-10-26 'UNSETTLED iff 갚을 것').
// 종전 기대는 '지금 상태 유지(UNSETTLED)'였다. 그 틈으로 계좌이체 행이 미정산으로 남아 카드 정산에 떴다.
eq('직전이 없고 새로 계좌이체면 정산완료', settleStatusForEdit({
  prevPayMethod: null, nextPayMethod: '계좌이체', current: 'UNSETTLED',
}), 'SETTLED')
eq('계좌이체인데 미정산으로 남아 있던 행을 고치면 정산완료', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '계좌이체', current: 'UNSETTLED',
}), 'SETTLED')

// ── 배송비 행(신고 2f0f9f4c). 결제구분 '신용'(후불)이면 결제수단과 무관하게 갚을 것이다.
eq('배송비 신용(후불)은 갚을 것', isDeferredRow({ payMethod: '계좌이체', isShipping: true, shippingType: '신용' }), true)
eq('배송비 착불 계좌이체는 아니다', isDeferredRow({ payMethod: '계좌이체', isShipping: true, shippingType: '착불' }), false)
eq('배송비 착불 신용카드는 갚을 것', isDeferredRow({ payMethod: '신용카드', isShipping: true, shippingType: '착불' }), true)
eq('배송비가 아닌 행의 결제구분은 안 본다', isDeferredRow({ payMethod: '계좌이체', isShipping: false, shippingType: '신용' }), false)
eq('새 배송비 신용(후불) 계좌이체는 미정산', settleStatusForNew('계좌이체', { isShipping: true, shippingType: '신용' }), 'UNSETTLED')
eq('새 배송비 선불 계좌이체는 정산완료', settleStatusForNew('계좌이체', { isShipping: true, shippingType: '선불' }), 'SETTLED')
eq('새 배송비 선불 신용카드는 미정산', settleStatusForNew('신용카드', { isShipping: true, shippingType: '선불' }), 'UNSETTLED')
// 신고 원형: 신용카드 주문의 착불 배송비(미정산)를 계좌이체로 고쳤다. 종전에는 배송비라 상태를 지켜 미정산이 남았다.
eq('신고 원형: 착불 배송비 신용카드에서 계좌이체로 고치면 정산완료', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '계좌이체', current: 'UNSETTLED',
  isShipping: true, prevShippingType: '착불', nextShippingType: '착불',
}), 'SETTLED')
eq('후불 배송비는 계좌이체로 고쳐도 미정산 유지', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '계좌이체', current: 'UNSETTLED',
  isShipping: true, prevShippingType: '신용', nextShippingType: '신용',
}), 'UNSETTLED')
eq('후불 배송비 정산완료는 결제수단을 바꿔도 지킨다', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '신용카드', current: 'SETTLED',
  isShipping: true, prevShippingType: '신용', nextShippingType: '신용',
}), 'SETTLED')
eq('배송비 결제구분이 선불에서 신용으로 바뀌면 미정산', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '계좌이체', current: 'SETTLED',
  isShipping: true, prevShippingType: '선불', nextShippingType: '신용',
}), 'UNSETTLED')
eq('배송비 결제구분이 신용에서 선불로 바뀌면 정산완료', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '계좌이체', current: 'UNSETTLED',
  isShipping: true, prevShippingType: '신용', nextShippingType: '선불',
}), 'SETTLED')

console.log(`[정산상태] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
