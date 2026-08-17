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
