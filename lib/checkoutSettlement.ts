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
export function settlementPremise(withNone: boolean): string {
  return withNone
    ? '환불 없음 말고는 지낸 날짜만큼 받고 나머지를 돌려줍니다. 위약금을 매기는지, 단기 요금표를 쓰는지가 다릅니다.'
    : '셋 다 지낸 날짜만큼 일할로 받습니다. 위약금을 매기는지, 단기 요금표를 쓰는지가 다릅니다.'
}

/**
 * 갈래 캡션 정본. 라벨만 정본으로 두면 설명이 두 벌로 갈린다 — 실제로 단기 갈래를 한 화면은
 * "기본입니다"로, 다른 화면은 "처음부터 단기로 계약했을 때와 같은 금액"으로 달리 설명하고 있었다.
 * 결제액을 넘는 단기 요금의 차액은 청구하지 않는다는 문장은 결제액을 아는 화면에서만 선다.
 */
export function settlementPickCaption(
  pick: SettlementPick,
  shortStay: ShortStayQuoteLite | null | undefined,
  opts: { prepaidAmount?: number } = {},
): string {
  if (pick === 'legal') return '원칙. 사용한 일수에 잔여 이용금액의 위약금을 더해 청구합니다.'
  if (pick === 'goodwill') return '사용한 일수만 청구하고 위약금은 안 받습니다.'
  if (pick === 'none') return '이용료를 돌려주지 않고 퇴실 처리합니다.'
  if (!shortStay) return ''
  const over = opts.prepaidAmount != null ? shortStay.baseAmount - opts.prepaidAmount : 0
  return `거주 ${shortStay.stayDays}일${shortStay.roundedUp ? ` (주 단위라 ${shortStay.contractDays}일로 올림)` : ''} · ${shortStay.units}주 계약 요금 ${fmtWon(shortStay.baseAmount)}. 처음부터 단기로 계약했을 때와 같은 금액입니다.${over > 0 ? ` 결제액을 넘는 차액 ${fmtWon(over)}은 청구하지 않습니다.` : ''}`
}

/**
 * 기본 갈래. 단기 견적이 있으면 단기 요금, 없으면 위약금.
 *
 * 1개월을 못 채운 중도 퇴실은 처음부터 단기로 계약했을 때와 같은 금액을 받는 게 원칙이다
 * (운영자 확정 2026-08-29). 견적이 없다는 것은 한 달을 채웠거나 만기 퇴실이라 단기 요금이라는 것이
 * 없다는 뜻이고, 그때는 계약서 §2 산식(위약금)이 원칙이다.
 */
export function defaultSettlementPick(shortStay: ShortStayQuoteLite | null | undefined): SettlementPick {
  return shortStay ? 'shortStay' : 'legal'
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
 */
export function settlementAmounts(
  pick: SettlementPick,
  input: { prepaidAmount: number; refund: CheckoutRefundResult; shortStay: ShortStayQuoteLite | null | undefined },
): { refund: number; companyKeeps: number } {
  const prepaid = Math.max(0, input.prepaidAmount)
  if (pick === 'none') return { refund: 0, companyKeeps: prepaid }
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
