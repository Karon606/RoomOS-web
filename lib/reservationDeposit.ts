// 예약금 처리 모드 해석 — 계약 override → 단기 정책 → 영업장 기본 → 단기/장기 폴백
import type { ShortStayReservationMode } from './shortStay'

export type ReservationDepositMode = 'deposit' | 'prepaid' | 'none'

// 단기 정책의 예약금 처리 → 공통 모드 어휘. 청소비 차감 후 이용료 충당은 '이용료 선납'이고,
// 환불 보증금은 종전 '보증금 대체'와 같은 자리다.
const SHORT_STAY_MODE: Record<ShortStayReservationMode, ReservationDepositMode> = {
  applyToRent: 'prepaid',
  refundableDeposit: 'deposit',
}

// null(미설정)은 장기=보증금 대체, 단기=이용료 선납으로 안전 해석.
// 기존 예약자(모드 null)는 장기 전제라 deposit으로 떨어져 현행 동작을 유지한다.
//
// 단기 계약은 영업장 공통 기본값보다 단기 입실 정책(shortStayPolicy.reservationMode)을 먼저 본다 —
// 단기의 돈 구성은 장기와 다른 규칙이라 한 영업장 안에서 갈릴 수 있어서다. 계약별 개별 선택은 여전히 최우선.
// shortStayMode 가 미설정(null/undefined)이면 이 자리는 통째로 비어 있어 해석이 종전과 문자 그대로 같다.
export function resolveReservationDepositMode(
  leaseMode: string | null | undefined,
  propertyMode: string | null | undefined,
  isShortTerm: boolean,
  shortStayMode?: ShortStayReservationMode | null,
): ReservationDepositMode {
  const shortDefault = isShortTerm && shortStayMode ? SHORT_STAY_MODE[shortStayMode] : undefined
  const m = leaseMode ?? shortDefault ?? propertyMode
  if (m === 'deposit' || m === 'prepaid' || m === 'none') return m
  return isShortTerm ? 'prepaid' : 'deposit'
}

// 예약금을 청소비 몫과 이용료 선납 몫으로 나눈 결과. 두 몫의 합은 언제나 받은 예약금이다.
export type ReservationFeeSplit = {
  cleaning: number   // 청소비로 가는 몫 (청소비 한도까지)
  prepaid: number    // 남는 몫 — 이용료 선납
}

/**
 * 예약금 분해 — 청소비를 먼저 채우고 남은 돈이 이용료 선납이다(운영자 확정, 신고 8c0f9688).
 * 예약금이 청소비에 못 미치면 전액이 청소비 몫이고 선납은 0, 청소비가 0이면 전액이 선납이다.
 * 음수·비수치는 0으로 본다 — 돈을 쪼개는 자리라 NaN 이 새어 나가면 하류가 통째로 깨진다.
 */
export function reservationFeeSplit(reservationFee: number, cleaningFee: number): ReservationFeeSplit {
  const won = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
  const paid = won(reservationFee)
  const cleaning = Math.min(paid, won(cleaningFee))
  return { cleaning, prepaid: paid - cleaning }
}

/**
 * 받은 예약금을 **분해해서** 기록하는가 — 삼중 가드 정본(운영자 확정 2026-08-19, 신고 8c0f9688 2단계).
 *
 * 세 조건이 동시에 참일 때만 분해한다. 하나라도 어긋나면 종전 경로가 문자 그대로 그대로 돈다.
 *   ① 단기 정책의 예약금 처리가 'applyToRent' 다. 영업장 공통 기본값이 우연히 'prepaid' 인 경우까지
 *      분해하면, 이 규칙을 켜지 않은 영업장의 동작이 조용히 바뀐다(멀티테넌트 전제).
 *   ② 단기 계약이다. 분해는 단기 정책이 정한 규칙이라 장기 계약으로 흘러가면 안 된다.
 *   ③ 계약 청소비가 있다. 뗄 몫이 0 이면 분해할 것이 없고 결과가 종전 선납과 완전히 같다.
 *
 * mode 를 함께 보는 이유는 **계약별 개별 선택**이 정책보다 앞서기 때문이다(resolveReservationDepositMode).
 * 단기 정책이 applyToRent 여도 그 계약만 '보증금 대체'로 골랐다면 해석값이 'prepaid' 가 아니고,
 * 그때는 분해하지 않는 것이 그 선택의 뜻이다.
 *
 * 서버(수납 저장)와 화면(분해 미리보기)이 같은 판정을 써야 한다 — 화면이 나눠 보여주고 서버가
 * 안 나누면 그게 곧 다음 사고다(§27.2 화면 최대치와 서버 기준의 갈림 금지).
 */
export function reservationFeeSplitApplies(args: {
  mode: ReservationDepositMode
  isShortTerm: boolean
  shortStayMode: ShortStayReservationMode | null | undefined
  cleaningFee: number
}): boolean {
  return args.mode === 'prepaid'
    && args.isShortTerm
    && args.shortStayMode === 'applyToRent'
    && args.cleaningFee > 0
}

/**
 * '청소비 20,000 + 이용료 충당 30,000' — 분해 내역 문법 정본(총액 없이 몫만).
 * 총액이 바로 옆에 이미 서 있는 자리(예약금 구성 줄)가 쓴다.
 * 몫이 하나뿐이면 null — 그때는 총액을 다른 말로 한 번 더 쓰는 셈이라 줄을 세우지 않는다.
 */
export function reservationSplitPartsLabel(
  cleaning: number, prepaid: number, fmt: (n: number) => string,
): string | null {
  if (cleaning <= 0 || prepaid <= 0) return null
  return `청소비 ${fmt(cleaning)} + 이용료 충당 ${fmt(prepaid)}`
}

/**
 * '예약금 50,000 = 청소비 20,000 + 이용료 충당 30,000' 한 줄 — 분해 표시 문법 정본.
 * 수납 폼 미리보기·예약 취소 미니폼처럼 총액을 함께 말해야 하는 자리가 쓴다.
 * 몫이 하나뿐이면 null — 바로 옆 숫자를 두 번 말하지 않는다(depositCompositionLabel 과 같은 규칙).
 */
export function reservationCompositionLabel(
  cleaning: number, prepaid: number, fmt: (n: number) => string,
): string | null {
  const parts = reservationSplitPartsLabel(cleaning, prepaid, fmt)
  return parts ? `예약금 ${fmt(cleaning + prepaid)} = ${parts}` : null
}
