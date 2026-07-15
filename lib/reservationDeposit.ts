// 예약금 처리 모드 해석 — 계약 override → 영업장 기본 → 단기/장기 폴백
export type ReservationDepositMode = 'deposit' | 'prepaid' | 'none'

// null(미설정)은 장기=보증금 대체, 단기=이용료 선납으로 안전 해석.
// 기존 예약자(모드 null)는 장기 전제라 deposit으로 떨어져 현행 동작을 유지한다.
export function resolveReservationDepositMode(
  leaseMode: string | null | undefined,
  propertyMode: string | null | undefined,
  isShortTerm: boolean,
): ReservationDepositMode {
  const m = leaseMode ?? propertyMode
  if (m === 'deposit' || m === 'prepaid' || m === 'none') return m
  return isShortTerm ? 'prepaid' : 'deposit'
}
