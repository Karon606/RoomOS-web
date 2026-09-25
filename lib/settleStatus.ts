// 지출의 정산상태(미정산·정산완료)를 정하는 정본 한 벌.
//
// 규칙은 하나다. **'나중에 갚을 것'이면 미정산이다.** 지금 그 갈래는 신용카드뿐이다.
//
// 어려운 것은 새로 만들 때가 아니라 **고칠 때**다. 종전에는 두 수정 경로가 직전 상태를 안 보고
// 결제수단만으로 다시 계산했다(updateExpense·batchUpdateExpenses). 그래서 이미 정산까지 끝낸
// 신용카드 지출의 **카드만** 바꿔도 미정산으로 되살아났다. 이미 빠져나간 돈이 카드 정산 화면의
// 미정산 합계에 다시 올라가 이중 정산을 부르는 자리다.
//
// 운영자 신고 2026-09-25 의 후속이다. 롯데카드 한 장의 지출 20건을 다른 롯데카드로 옮기는
// 작업이었는데, 그 안에 정산완료 1건이 섞여 있었다. 앱의 일괄 편집을 쓰면 그 1건이 조용히
// 미정산으로 돌아갔을 것이라 그때는 스크립트로 우회했다. 운영자 승인 2026-09-25 로 규칙을 세운다.
//
//   **카드에서 카드로 옮기는 것은 갈래가 안 바뀌는 일이다. 그때는 지금 상태를 지킨다.**
//   신용카드에서 계좌이체처럼 갈래가 바뀔 때만 다시 계산한다.
//
// 만드는 경로(addExpense·배송비 생성·고정지출 기록·가져오기)는 직전 상태가 없으므로 그대로
// settleStatusForNew 를 쓴다. 고치는 경로만 settleStatusForEdit 를 쓴다.

export type SettleStatusValue = 'SETTLED' | 'UNSETTLED'

/** 이 결제수단이 '나중에 갚을 것'인가. 갈래가 늘면 여기만 고친다. */
export function isCreditPay(payMethod: string | null | undefined): boolean {
  return payMethod === '신용카드'
}

/** 새로 만드는 지출의 정산상태. */
export function settleStatusForNew(payMethod: string | null | undefined): SettleStatusValue {
  return isCreditPay(payMethod) ? 'UNSETTLED' : 'SETTLED'
}

/**
 * 고치는 지출의 정산상태. **갈래가 안 바뀌면 지금 상태를 지킨다.**
 *
 * 배송비 행은 결제구분(선불·착불·신용)으로 따로 관리되므로 부르는 쪽이 아예 이 함수를 건너뛰고
 * 제 값을 그대로 쓴다 — 그 판단은 호출부에 남긴다(여기서 isShipping 을 받으면 배송비 규칙이
 * 두 군데로 갈린다).
 */
export function settleStatusForEdit(opts: {
  prevPayMethod: string | null | undefined
  nextPayMethod: string | null | undefined
  current: SettleStatusValue
}): SettleStatusValue {
  if (isCreditPay(opts.prevPayMethod) === isCreditPay(opts.nextPayMethod)) return opts.current
  return settleStatusForNew(opts.nextPayMethod)
}
