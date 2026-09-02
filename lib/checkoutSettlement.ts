// 퇴실 이용료 정산의 갈래 정본 — 정본 섹션(퇴실 처리 세 화면)과 퇴실 정산 위젯이 같은 기본값·같은 산식·같은 라벨을 쓴다.
//
// 왜 한 벌인가. 갈래 판단이 위젯 한 곳에만 있었다. 위젯은 1개월을 못 채운 중도 퇴실이면 단기 요금을
// 기본으로 잡는데, 퇴실 처리 화면의 정본 섹션은 서버를 '위약금' 고정으로 불러 단기 견적을 버렸다.
// 같은 계약을 두 화면이 다르게 답했고, 506호가 그 틈으로 79,800원을 환불받았다(2026-09-02 신고).
// 판단을 여기 한 벌로 두면 화면이 늘어도 답은 하나다.

import type { CheckoutRefundResult, RefundMode } from './prorate'
import { fmtWon } from './fmtMoney'

/** 서버 모드 둘에 화면 갈래 둘을 얹는다. 단기 요금은 적용 금액의 기본값만 바꾸고, '환불 안 함'은 0을 확정한다. */
export type SettlementPick = RefundMode | 'shortStay' | 'none'

/** previewCheckoutRefund 가 내려주는 단기 견적 조각 — 이 파일은 baseAmount 만 쓴다. */
export type ShortStayQuoteLite = { stayDays: number; units: number; contractDays: number; baseAmount: number; roundedUp: boolean }

/**
 * 세그먼트 라벨 정본. 두 화면이 한 글자도 다르면 같은 물음으로 안 읽힌다.
 * 네 개가 320px 폼 폭(224px)과 글자 확대 1.25배에도 한 줄에 들어야 해서 '단기 요금'이 아니라 '단기',
 * '환불 안 함'이 아니라 '환불 없음'이다(웹디자이너 실측 2026-09-02). 짧아진 뜻은 세그먼트 위 전제문
 * (settlementPremise)과 갈래 캡션(settlementPickCaption)이 채운다.
 */
export const SETTLEMENT_PICK_LABEL: Record<SettlementPick, string> = {
  legal: '위약금',
  goodwill: '면제',
  shortStay: '단기',
  none: '환불 없음',
}

/**
 * 세그먼트 위 전제문. '면제'가 무엇의 면제인지 이 문장이 고정한다 — 옆에 '환불 없음'이 서는 화면에서는
 * 전제문 없이 '면제'만 보면 이용료 면제(전액 환불)로 거꾸로 읽힌다(웹디자이너 지적 2026-09-02).
 */
export function settlementPremise(withNone: boolean, hasFuturePrepaid = false): string {
  if (!withNone) return '셋 다 지낸 날짜만큼 일할로 받습니다. 위약금을 매기는지, 단기 요금표를 쓰는지가 다릅니다.'
  return `환불 없음은 지낸 달 이용료를 돌려주지 않고, 나머지 셋은 지낸 날짜만큼 받고 돌려줍니다.${hasFuturePrepaid ? ' 아직 지내지 않은 기간의 선납은 넷 다 돌려줍니다.' : ''}`
}

/**
 * 갈래 캡션 정본. 라벨만 정본으로 두면 설명이 두 벌로 갈린다 — 실제로 단기 갈래를 한 화면은
 * "기본입니다"로, 다른 화면은 "처음부터 단기로 계약했을 때와 같은 금액"으로 달리 설명하고 있었다.
 * 결제액을 넘는 단기 요금의 차액은 청구하지 않는다는 문장은 결제액을 아는 화면에서만 선다.
 */
export function settlementPickCaption(
  pick: SettlementPick,
  shortStay: ShortStayQuoteLite | null | undefined,
  opts: { prepaidAmount?: number; futurePrepaid?: number } = {},
): string {
  if (pick === 'legal') return '원칙. 사용한 일수에 잔여 이용금액의 위약금을 더해 청구합니다.'
  if (pick === 'goodwill') return '사용한 일수만 청구하고 위약금은 안 받습니다.'
  if (pick === 'none') {
    const future = opts.futurePrepaid ?? 0
    return future > 0
      ? `지낸 달 이용료는 돌려주지 않고, 아직 지내지 않은 기간의 선납 ${fmtWon(future)}만 돌려줍니다.`
      : '지낸 달 이용료는 돌려주지 않습니다.'
  }
  if (!shortStay) return ''
  const over = opts.prepaidAmount != null ? shortStay.baseAmount - opts.prepaidAmount : 0
  return `거주 ${shortStay.stayDays}일${shortStay.roundedUp ? ` (주 단위라 ${shortStay.contractDays}일로 올림)` : ''} · ${shortStay.units}주 계약 요금 ${fmtWon(shortStay.baseAmount)}. 처음부터 단기로 계약했을 때와 같은 금액입니다.${over > 0 ? ` 결제액을 넘는 차액 ${fmtWon(over)}은 청구하지 않습니다.` : ''}`
}

/**
 * 기본 갈래.
 *
 * '환불 없음'이 서는 퇴실 처리 화면(withNone)은 무조건 환불 없음이 기본이다. 일찍 나가면서 환불받아
 * 가는 쪽이 오히려 드물다는 운영 실태(운영자 확정 2026-09-02). 단기 견적이 서는 계약도 같다. '단기'는
 * 세그먼트에 남아 한 번 누르면 된다.
 *
 * 위젯(withNone 없음)은 청구액을 확정하는 자리라 종전대로다. 1개월을 못 채운 중도 퇴실은 처음부터
 * 단기로 계약했을 때와 같은 금액을 받는 게 원칙이고(운영자 확정 2026-08-29), 견적이 없다는 것은
 * 한 달을 채웠거나 만기 퇴실이라 단기 요금이라는 것이 없다는 뜻이라 계약서 §2 산식(위약금)이 원칙이다.
 */
export function defaultSettlementPick(shortStay: ShortStayQuoteLite | null | undefined, withNone = false): SettlementPick {
  if (withNone) return 'none'
  return shortStay ? 'shortStay' : 'legal'
}

/** 아직 지내지 않은 달 목록을 '10월분 · 11월분' 꼴로. 카드와 안내창이 같은 꼴로 부른다. */
export function futureMonthsLabel(months: { month: string }[]): string {
  return months.map(m => `${Number(m.month.slice(5, 7))}월분`).join(' · ')
}

/** 서버(previewCheckoutRefund)에 물을 모드. 위약금은 '위약금' 갈래에만 붙는다. */
export function serverModeFor(pick: SettlementPick): RefundMode {
  return pick === 'legal' ? 'legal' : 'goodwill'
}

/**
 * 갈래별 환불액과 회사 귀속(퇴실월 청구).
 *
 * 단기 요금이 결제액을 넘으면 환불은 0 에서 멈춘다. 차액은 청구하지 않는다 — 한 달치를 내고 나가는
 * 사람에게 더 내라는 것은 정산이 아니다(설계 확정 2026-09-02). 위젯의 적용 금액(청구액)은 단기 요금
 * 그대로 두어 종전 동작을 지킨다.
 *
 * '환불 없음'은 지낸 달(귀속월) 이용료만 안 돌려준다. 귀속월보다 뒤 달의 선납(futurePrepaid)은 이용
 * 자체를 안 했으니 환불 없음과 상관없이 돌려준다(운영자 확정 2026-09-02). 이 한 줄이 퇴실 처리 섹션·
 * 카드 예상·확정을 같이 움직인다.
 */
export function settlementAmounts(
  pick: SettlementPick,
  input: { prepaidAmount: number; refund: CheckoutRefundResult; shortStay: ShortStayQuoteLite | null | undefined },
): { refund: number; companyKeeps: number } {
  const prepaid = Math.max(0, input.prepaidAmount)
  if (pick === 'none') {
    const future = Math.max(0, Math.min(input.refund.futurePrepaid, prepaid))
    return { refund: future, companyKeeps: prepaid - future }
  }
  if (pick === 'shortStay' && input.shortStay) {
    const keeps = input.shortStay.baseAmount
    return { refund: Math.max(0, prepaid - keeps), companyKeeps: keeps }
  }
  return { refund: input.refund.refund, companyKeeps: input.refund.companyKeeps }
}

/**
 * 세그먼트 선택지. 단기 요금은 견적이 있을 때만, '환불 안 함'은 퇴실 처리 화면에만 선다
 * (위젯은 청구액을 확정하는 자리라 '안 함'이 성립하지 않는다).
 */
export function settlementPickOptions(hasShortStay: boolean, withNone: boolean): { value: SettlementPick; label: string }[] {
  const picks: SettlementPick[] = ['legal', 'goodwill', ...(hasShortStay ? ['shortStay' as const] : []), ...(withNone ? ['none' as const] : [])]
  return picks.map(value => ({ value, label: SETTLEMENT_PICK_LABEL[value] }))
}

/**
 * 퇴실 처리 세 화면(홈 알림·프리즘·입주자 수정)이 정본 섹션에서 부모로 올리는 정산 값.
 * null 이면 정산할 것이 없다는 뜻이고 섹션 자체가 안 선다.
 *
 * `max`(그 기간 결제액)는 부모가 저장 버튼을 막는 근거다. 초과 판정을 섹션 안에만 두면 부모는
 * 못 막고, 부모가 결제액을 따로 조회하면 두 벌이 된다. `pick`·`suggested`·`futurePrepaid` 는
 * 확인창(rentSettlementConfirmSpec)의 근거다.
 */
export type RentSettlementValue = { amount: number; max: number; pick: SettlementPick; suggested: number; futurePrepaid: number }

export type RentSettlementConfirmSpec = { title: string; message: string; confirmLabel: string }

/**
 * 확정 직전 확인창의 문장. null 이면 묻지 않는다. 화면이 confirmDialog 로 띄우고, 회귀 테스트가
 * 여기 문장을 직접 본다.
 *
 * 묻는 조건은 셋이다. 계산값과 다른 금액, 환불 0, 지낸 달 사용분까지 돌려주는 전액.
 * '전액'은 `amount >= max` 만으로는 모자란다. '환불 없음'이 뒤 달 선납을 돌려주게 된 뒤(2026-09-02)
 * 지낸 달 받은 돈이 0 인 계약은 기본값이 선납 전부(= max)라서, 그 식으로는 기본값 그대로 확정하는
 * 사람에게 '사용분까지 모두 돌려주는 금액입니다'가 떴다. 사용분은 뒤 달 선납 밖에 있으니
 * `amount > futurePrepaid` 가 문장의 뜻이다. 그러면 기본값 그대로는 종전 규칙대로 안 묻는다(2026-09-03).
 *
 * `depositReturn` 은 같은 확정에 실리는 보증금 반환액이다. '나중에 반환'처럼 아직 정하지 않았으면
 * null 을 넘긴다. 그때는 이용료만 말한다.
 */
export function rentSettlementConfirmSpec(rent: RentSettlementValue | null, depositReturn: number | null): RentSettlementConfirmSpec | null {
  if (!rent) return null
  const { amount, max, pick, suggested, futurePrepaid } = rent
  const full = amount > 0 && amount >= max && amount > futurePrepaid
  const differs = amount !== suggested
  if (!full && !differs && amount > 0) return null

  // 두 갈래가 같은 모양이다. 제목은 이용료 한 금액, 보증금 반환액과 총 환불액은 본문(§14 위계,
  // 제목 16/700 에 두 금액을 실으면 375px 에서 두 줄을 꽉 채운다). 취소는 늘 무변경이라 기본 라벨.
  const depositPart = depositReturn != null
    ? ` 보증금 반환 ${fmtWon(depositReturn)} · 총 환불액 ${fmtWon(amount + depositReturn)}.`
    : ''

  // 전액 환불(사용분·위약금까지 반환)은 계산값 초과 여부와 무관하게 결제액 전액이면 묻는다.
  // 이 화면에서 가장 센 확정이라 caution 이다. 계산값과 조금 다른 갈래보다 약하면 위험도가 뒤집힌다.
  if (full) {
    return {
      title: `이용료 ${fmtWon(amount)}을 전액 환불할까요?`,
      message: `사용분까지 모두 돌려주는 금액입니다.${depositPart}`,
      confirmLabel: '전액 환불',
    }
  }

  const message = amount === 0
    ? (pick === 'none'
      ? `결제액 ${fmtWon(max)}은 회사 귀속으로 남고 수납 기록은 바뀌지 않습니다.`
      : suggested === 0
      ? `계산값이 0원이라 돌려줄 이용료가 없습니다. 수납 기록은 바뀌지 않습니다.`
      : `계산값 ${fmtWon(suggested)} 대신 0원입니다. 수납 기록은 바뀌지 않습니다.`)
    : `계산값 ${fmtWon(suggested)}과 다른 금액입니다.`
  return {
    title: amount === 0 ? '이용료를 환불하지 않고 처리할까요?' : `이용료 ${fmtWon(amount)}을 환불할까요?`,
    message: `${message}${depositPart}`,
    confirmLabel: '퇴실 처리',
  }
}
