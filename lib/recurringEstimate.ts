// 미기록 고정지출의 '이번 달 추정액' 단일 산출식 — 채택 근거(basis)와 금액·라벨을 한 곳에서 결정한다.

/** 추정에 필요한 필드만 — getRecurringExpensesWithStatus 의 RecurringExpenseWithStatus 가 그대로 대입된다. */
export type RecurringEstimateSource = {
  amount: number
  isVariable: boolean
  pendingAmount: number | null
  /** 작년 같은 달 실제 기록의 그 달 합계. 기록이 없으면 null. */
  priorYearActual: number | null
  /** 직전 3개월 중 기록이 있는 달의 '월 합계' 평균. 한 달도 없으면 null. */
  recentAvg: number | null
  /** 이 추정이 어느 달을 위한 것인지 'YYYY-MM'. 라벨의 '작년 8월'이 여기서 나온다. */
  estimateMonth: string
}

/** 금액이 어디서 왔는지 — 금액과 라벨이 서로 다른 항을 가리키지 않도록 한 값에서 갈라진다. */
export type RecurringEstimateBasis = 'pending' | 'contract' | 'priorYear' | 'recentAvg' | 'base'

/**
 * 우선순위: 예약금액 > 비변동 항목의 계약액 > 작년 같은 달 실적 > 최근 3개월 평균 > 기본액.
 *
 * 재무 탭·대시보드 예상지출·홈 알림·오늘 출금 알림·기록 모달 프리필이 모두 이 값을 쓴다.
 * 식이 갈라지면 같은 항목이 화면마다 다른 금액으로 보인다(2026-07-30 신고: 알림 660,380 vs 실제 1,040,980).
 *
 * 비변동 항목이 이력보다 기본액을 먼저 쓰는 이유 — 기본액은 추측이 아니라 운영자가 적어 둔 계약 금액이다.
 * 이력을 위에 두면 임대료를 올린 달에 작년 임대료가 표시되고(인상이 1년 늦게 반영), 개시 첫 달 일할
 * 청구가 그대로 다음 달 추정이 된다(2026-08-10 개시한 LG워시타워: 계약 92,400 · 첫 달 14,900).
 * '변동 금액' 체크가 곧 "이 항목은 매달 달라서 이력으로 가늠해야 한다"는 운영자의 선언이다.
 */
export function recurringEstimate(r: RecurringEstimateSource): { amount: number; basis: RecurringEstimateBasis } {
  if (r.pendingAmount != null)       return { amount: r.pendingAmount,   basis: 'pending' }
  if (!r.isVariable && r.amount > 0) return { amount: r.amount,          basis: 'contract' }
  if (r.priorYearActual != null)     return { amount: r.priorYearActual, basis: 'priorYear' }
  if (r.recentAvg != null)           return { amount: r.recentAvg,       basis: 'recentAvg' }
  return { amount: r.amount, basis: 'base' }
}

export function effectiveRecurringAmount(r: RecurringEstimateSource): number {
  return recurringEstimate(r).amount
}

/**
 * 금액 옆 부연 라벨 — 재무 탭·알림·기록 모달이 글자까지 같은 이 함수 하나를 쓴다.
 * 계약액(비변동 기본액)은 라벨이 없다 — 매달 같은 금액이라 상시 노이즈가 된다.
 * 변동인데 이력이 아직 없을 때만 '기본액'을 밝힌다 — 그 숫자가 실적이 아니라 설정값임을 알려야 한다.
 */
export function recurringAmountLabel(r: RecurringEstimateSource): string | null {
  switch (recurringEstimate(r).basis) {
    case 'pending':   return '예약금액'
    case 'priorYear': return `작년 ${Number(r.estimateMonth.slice(5, 7))}월`
    case 'recentAvg': return '3개월 평균'
    case 'base':      return r.isVariable ? '기본액' : null
    default:          return null
  }
}
