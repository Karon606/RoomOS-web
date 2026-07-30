// 미기록 고정지출의 '이번 달 추정액' 단일 산출식 — 예약금액 > 과거평균(변동) > 기본액 순.

/** 추정에 필요한 필드만 — getRecurringExpensesWithStatus 의 RecurringExpenseWithStatus 가 그대로 대입된다. */
export type RecurringEstimateSource = {
  pendingAmount: number | null
  historicalAvg: number | null
  amount: number
}

/**
 * 재무 탭·대시보드 예상지출·홈 알림이 모두 이 값을 쓴다.
 * 식이 갈라지면 같은 항목이 화면마다 다른 금액으로 보인다(2026-07-30 신고: 알림 660,380 vs 실제 1,040,980).
 */
export function effectiveRecurringAmount(r: RecurringEstimateSource): number {
  return r.pendingAmount ?? r.historicalAvg ?? r.amount
}

/** 금액 옆 부연 라벨 — 재무 탭 표기와 글자까지 동일. 기본액이 쓰인 경우는 라벨 없음(null). */
export function recurringAmountLabel(r: RecurringEstimateSource): '예약금액' | '예상치' | null {
  if (r.pendingAmount != null) return '예약금액'
  if (r.historicalAvg != null) return '예상치'
  return null
}
