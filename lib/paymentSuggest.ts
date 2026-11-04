// 수납 등록 금액 칸의 기본값(추천 납입액) 정본 순수 함수. 화면(PaymentEntryForm)과 진리표(test-money)가 같이 부른다.
//
// 입력은 전부 서버 정본 값이다. 화면이 새로 계산하지 않는다.
//   - months   = getTargetMonthOptions(귀속월 목록). 달마다 billForLeaseMonth 청구(락·일할·예약 인상·할인), 그 달 수납 합,
//                기한 도래 여부(lib/roomMonth monthDuePassed, 수납 관리 목록과 같은 식). null 이면 아직 못 읽었다.
//   - expected = 조회월 청구(settlement.expected, 같은 billForLeaseMonth). 목록이 비었을 때만 쓴다.
// 계약 이용료(lease.rentAmount, 원가)도 조회월 잔액(settlement.balance, 조회월 한 달 몫)도 받지 않는다.
// 원가로 칸을 채우면 할인 달에 할인액이 다음 달 선납으로 적히고(404·514·509호, 2026-11-04), 조회월 잔액으로 채우면
// 지난달 미납분을 받는 자리에 이번 달 정가가 뜬다(404호 11/1, 운영자 원문 "10월 미납분이면 11월로 넘어와도 미리 표시되는
// 금액이 10월 기준이 뜨는게 맞는 것 같아"). 원가 직표시 금지(knowledge/money-display-feedback §1)의 입력 쪽이다.

export type SuggestMonth = { month: string; expectedAmount: number; paidAmount: number; duePassed: boolean }

/**
 * 추천 납입액.
 * - 귀속월을 직접 고르면 그 달 남은 청구(다 냈으면 그 달 청구).
 * - 자동(FIFO)이면 **기한이 도래한 미완납 달(조회월까지)의 그 달 남은 청구 합**이다. 달마다 그 달 청구(할인·일할·인상
 *   반영)라 다음 달 청구가 섞이지 않고, 기한 전인 이번 달은 합에 들지 않는다(수납 관리 목록의 미납 판정과 같은 식).
 *   savePayment 의 FIFO 가 가장 오래된 달부터 채우므로 이 값을 그대로 저장하면 밀린 달이 완납이고 넘치는 돈이 없다
 *   (운영자 승인 '추천대로' G1, 2026-11-04).
 * - 도래한 미납이 없으면 앞으로 낼 가장 이른 미완납 달의 남은 청구(선납, 인상 전 달 완납이면 인상가).
 * - 귀속월 목록을 아직 못 읽었으면 0(빈 칸, 저장 버튼이 막힌다). 원가나 조회월 잔액으로 먼저 채웠다가 바꾸지 않는다.
 * - 그것도 없으면(청구 달이 없거나 앞 석 달까지 다 냈다) 조회월 청구.
 */
export function suggestPayAmount(p: {
  forcedMonth: 'auto' | string
  months: readonly SuggestMonth[] | null
  viewMonth: string
  expected: number
}): number {
  if (p.months === null) return 0
  const left = (o: SuggestMonth) => o.expectedAmount - o.paidAmount
  if (p.forcedMonth !== 'auto') {
    const o = p.months.find(t => t.month === p.forcedMonth)
    if (o) return left(o) > 0 ? left(o) : o.expectedAmount
    return p.expected
  }
  const due = p.months
    .filter(o => o.month <= p.viewMonth && o.duePassed && left(o) > 0)
    .reduce((s, o) => s + left(o), 0)
  if (due > 0) return due
  const next = p.months.find(o => left(o) > 0)
  return next ? left(next) : p.expected
}
