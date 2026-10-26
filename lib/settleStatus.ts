// 지출의 정산상태(미정산·정산완료)를 정하는 정본 한 벌.
//
// 규칙은 하나다. **'나중에 갚을 것'이면 미정산이다.** 그 갈래는 둘이다(운영자 승인 2026-10-26, 신고 2f0f9f4c).
//   · 결제수단이 신용카드인 행.
//   · 배송비 행인데 그 주문의 배송비 결제구분(ExpenseOrder.shippingType)이 '신용'(후불)인 행.
// 이 둘이 아닌 행은 **언제나 정산완료**다. 미정산으로 남을 길이 없다.
//
// 신고 2f0f9f4c(2026-10-26). 카드 정산 화면에 저축예금 계좌로 낸 착불 배송비 한 줄이 '미지정 카드'처럼 떠 있었다.
// 신용카드 주문의 배송비 행으로 만들어져 미정산이었는데, 그 행만 계좌이체로 고친 뒤에도 미정산이 남았다.
// 수정 경로(updateExpense)가 배송비 행은 정산상태를 통째로 건너뛰어 지켰기 때문이다. 이제 배송비 행도 같은 규칙을 탄다.
//
// 어려운 것은 새로 만들 때가 아니라 **고칠 때**다. 종전에는 두 수정 경로가 직전 상태를 안 보고
// 결제수단만으로 다시 계산했다(updateExpense·batchUpdateExpenses). 그래서 이미 정산까지 끝낸
// 신용카드 지출의 **카드만** 바꿔도 미정산으로 되살아났다. 이미 빠져나간 돈이 카드 정산 화면의
// 미정산 합계에 다시 올라가 이중 정산을 부르는 자리다(운영자 신고·승인 2026-09-25).
//
//   **갚을 것에서 갚을 것으로 옮기는 것(카드에서 카드로)은 갈래가 안 바뀌는 일이다. 그때는 지금 상태를 지킨다.**
//   갚을 것이 아니게 되면 정산완료, 갚을 것이 새로 되면 미정산이다.
//
// 만드는 경로(addExpense·배송비 생성·고정지출 기록·가져오기·홈 승인)는 settleStatusForNew 를,
// 고치는 경로는 settleStatusForEdit 를 쓴다. 읽는 쪽(카드 정산 화면·데이터 그물)은 isDeferredRow 로 같은 판정을 본다.

export type SettleStatusValue = 'SETTLED' | 'UNSETTLED'

/** 정산 판정에 필요한 한 행의 모양. 배송비 행이면 그 주문의 배송비 결제구분을 함께 싣는다. */
export type SettleRow = {
  payMethod: string | null | undefined
  isShipping?: boolean | null
  shippingType?: string | null
}

/** 이 결제수단이 '나중에 갚을 것'인가. */
export function isCreditPay(payMethod: string | null | undefined): boolean {
  return payMethod === '신용카드'
}

/** 이 행이 '나중에 갚을 것'인가. 미정산이 될 수 있는 행은 이것뿐이다. 갈래가 늘면 여기만 고친다. */
export function isDeferredRow(row: SettleRow): boolean {
  return isCreditPay(row.payMethod) || (!!row.isShipping && row.shippingType === '신용')
}

/** 새로 만드는 지출의 정산상태. 배송비 행이면 둘째 인자에 { isShipping: true, shippingType } 을 싣는다. */
export function settleStatusForNew(
  payMethod: string | null | undefined,
  shipping?: { isShipping: boolean; shippingType: string | null | undefined },
): SettleStatusValue {
  return isDeferredRow({ payMethod, isShipping: shipping?.isShipping, shippingType: shipping?.shippingType }) ? 'UNSETTLED' : 'SETTLED'
}

/**
 * 고치는 지출의 정산상태.
 *   · 고친 뒤 갚을 것이 아니면 정산완료다(직전에 미정산이었어도 남기지 않는다).
 *   · 고치기 전에도 뒤에도 갚을 것이면 지금 상태를 지킨다(카드에서 카드로, 정산완료 보존).
 *   · 갚을 것이 새로 되면 미정산이다.
 * 배송비 행은 isShipping 과 고치기 전·뒤의 배송비 결제구분을 싣는다(바뀌지 않으면 같은 값을 둘 다).
 */
export function settleStatusForEdit(opts: {
  prevPayMethod: string | null | undefined
  nextPayMethod: string | null | undefined
  current: SettleStatusValue
  isShipping?: boolean | null
  prevShippingType?: string | null
  nextShippingType?: string | null
}): SettleStatusValue {
  const after = isDeferredRow({ payMethod: opts.nextPayMethod, isShipping: opts.isShipping, shippingType: opts.nextShippingType })
  if (!after) return 'SETTLED'
  const before = isDeferredRow({ payMethod: opts.prevPayMethod, isShipping: opts.isShipping, shippingType: opts.prevShippingType })
  return before ? opts.current : 'UNSETTLED'
}
