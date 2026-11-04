// 수납 등록 금액 칸의 기본값(추천 납입액) 정본 순수 함수. 화면(PaymentEntryForm)과 진리표(test-money)가 같이 부른다.
//
// 입력은 전부 서버 정본 값이다. 화면이 새로 계산하지 않는다.
//   - months   = getTargetMonthOptions(귀속월 목록). 달마다 billForLeaseMonth 청구(락·일할·예약 인상·할인), 그 달 수납 합,
//                기한 상태(lib/dueState, 수납 관리 목록·홈과 같은 정본). null 이면 아직 못 읽었다.
//   - expected = 조회월 청구(settlement.expected, 같은 billForLeaseMonth). 목록이 비었을 때만 쓴다.
// 계약 이용료(lease.rentAmount, 원가)도 조회월 잔액(settlement.balance, 조회월 한 달 몫)도 받지 않는다.
// 원가로 칸을 채우면 할인 달에 할인액이 다음 달 선납으로 적히고(404·514·509호, 2026-11-04), 조회월 잔액으로 채우면
// 지난달 미납분을 받는 자리에 이번 달 정가가 뜬다(404호 11/1, 운영자 원문 "10월 미납분이면 11월로 넘어와도 미리 표시되는
// 금액이 10월 기준이 뜨는게 맞는 것 같아"). 원가 직표시 금지(knowledge/money-display-feedback §1)의 입력 쪽이다.

import type { DueState } from './dueState'
import { withParticle } from './koParticle'

export type SuggestMonth = { month: string; expectedAmount: number; paidAmount: number; dueState: DueState }

/** 추천 납입액과, 자동 합에서 뺀 납부일 당일 달(금액 칸 아래 안내 캡션용). */
export type PaySuggestion = { amount: number; excludedToday: { month: string; amount: number }[] }

/**
 * 추천 납입액.
 * - 귀속월을 직접 고르면 그 달 남은 청구(다 냈으면 그 달 청구).
 * - 자동(FIFO)이면 **기한이 지난 미완납 달(조회월까지)의 그 달 남은 청구 합**이다. 달마다 그 달 청구(할인·일할·인상
 *   반영)라 다음 달 청구가 섞이지 않고, 기한 전이거나 납부일 당일인 달은 합에 들지 않는다(수납 관리 목록의 미납 판정과 같은
 *   정본 lib/dueState). savePayment 의 FIFO 가 가장 오래된 달부터 채우므로 이 값을 그대로 저장하면 밀린 달이 완납이고 넘치는 돈이 없다
 *   (운영자 승인 '추천대로' G1, 2026-11-04). 납부일 1일·10월 미납·11/1 이면 10월분만(440,000), 11월분은 excludedToday 로 알린다.
 * - 기한이 지난 미납이 없으면 앞으로 낼 가장 이른 미완납 달의 남은 청구(납부일 당일인 그 달, 또는 선납. 인상 전 달 완납이면 인상가).
 * - 귀속월 목록을 아직 못 읽었으면 0(빈 칸, 저장 버튼이 막힌다). 원가나 조회월 잔액으로 먼저 채웠다가 바꾸지 않는다.
 * - 그것도 없으면(청구 달이 없거나 앞 석 달까지 다 냈다) 조회월 청구.
 */
export function suggestPay(p: {
  forcedMonth: 'auto' | string
  months: readonly SuggestMonth[] | null
  viewMonth: string
  expected: number
}): PaySuggestion {
  const none = (amount: number): PaySuggestion => ({ amount, excludedToday: [] })
  if (p.months === null) return none(0)
  const left = (o: SuggestMonth) => o.expectedAmount - o.paidAmount
  if (p.forcedMonth !== 'auto') {
    const o = p.months.find(t => t.month === p.forcedMonth)
    if (o) return none(left(o) > 0 ? left(o) : o.expectedAmount)
    return none(p.expected)
  }
  const open = p.months.filter(o => o.month <= p.viewMonth && left(o) > 0)
  const due = open.filter(o => o.dueState === 'overdue').reduce((s, o) => s + left(o), 0)
  if (due > 0) {
    return { amount: due, excludedToday: open.filter(o => o.dueState === 'today').map(o => ({ month: o.month, amount: left(o) })) }
  }
  const next = p.months.find(o => left(o) > 0)
  return none(next ? left(next) : p.expected)
}

/** 추천 납입액 금액만(suggestPay 의 amount). */
export function suggestPayAmount(p: Parameters<typeof suggestPay>[0]): number {
  return suggestPay(p).amount
}

/** 금액 칸 아래 캡션. '11월분 470,000원은 오늘이 납부일이라 넣지 않았습니다.' 뺀 달이 없으면 null. */
export function excludedTodayCaption(excluded: PaySuggestion['excludedToday']): string | null {
  if (excluded.length === 0) return null
  const parts = excluded.map(e => `${Number(e.month.slice(5))}월분 ${e.amount.toLocaleString('ko-KR')}원`)
  return `${withParticle(parts.join(' · '), '은/는')} 오늘이 납부일이라 넣지 않았습니다.`
}
