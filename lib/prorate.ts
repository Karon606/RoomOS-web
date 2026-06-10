// 납입일 변경 일할 계산 — 한 달은 항상 30일로 고정 (실제 월 길이와 무관)
// 고객관리(TenantClient)·수납관리(RoomsClient) 공용.
export const PRORATE_BASE_DAYS = 30

export type ProRataResult =
  | { days: 0; amount: 0; type: 'none' }
  | { days: number; amount: number; type: 'extra' | 'refund' }

export function calcProRata(
  rentAmount: number,
  oldDueDay: string | null,
  newDueDayStr: string,
  targetMonth: string,
): ProRataResult | null {
  const str = newDueDayStr.trim()
  if (!str) return null
  const [y, m] = targetMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const parseDay = (d: string): number | null => {
    if (d.includes('말')) return daysInMonth
    const n = parseInt(d, 10)
    if (isNaN(n) || n < 1 || n > 31) return null
    return Math.min(n, daysInMonth)
  }
  const oldDay = oldDueDay ? parseDay(oldDueDay) : null
  const newDay = parseDay(str)
  if (oldDay === null || newDay === null) return null
  const diff = newDay - oldDay
  if (diff === 0) return { days: 0, amount: 0, type: 'none' }
  const amount = Math.floor((Math.abs(diff) * rentAmount) / PRORATE_BASE_DAYS)
  return { days: Math.abs(diff), amount, type: diff > 0 ? 'extra' : 'refund' }
}

// ── 퇴실 정산(일할) ──────────────────────────────────────────────────
// 선납 모델: dueDay = 그 서비스 기간의 시작일. 퇴실일이 같은 달 dueDay 이후면
// 그 마지막 기간을 (dueDay~퇴실일, 양끝 포함) 사용 일수만큼만 청구한다.
// 예) 납부일 8일, 퇴실 6/26 → 8~26 = 19일치 = 월 × 19/30.
// 퇴실일이 dueDay 이전이면 그 기간 자체를 안 쓰므로 null 반환(= 청구 0, rooms 의 checkoutNoBilling 영역).
export type CheckoutProrationResult = {
  daysUsed: number       // 청구 일수 (퇴실일 - 납부일 + 1, 양끝 포함, 1~30 클램프)
  amount: number         // 일할 청구액 = floor(monthlyRent × daysUsed / 30)
  fullAmount: number     // 일할 전 한 달 청구액
  reduction: number      // 감액 = fullAmount - amount
  moveOutMonth: string   // 'YYYY-MM' — 일할이 적용되는 퇴실 달
}

export function calcCheckoutProration(
  monthlyRent: number,
  dueDay: string | null,
  expectedMoveOut: string,   // 'YYYY-MM-DD'
): CheckoutProrationResult | null {
  if (!monthlyRent || monthlyRent <= 0) return null
  const parts = expectedMoveOut.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => isNaN(n))) return null
  const [y, m, d] = parts
  const moveOutMonth = `${y}-${String(m).padStart(2, '0')}`
  const daysInMonth = new Date(y, m, 0).getDate()
  let startDay: number
  if (!dueDay) startDay = 1
  else if (dueDay.includes('말')) startDay = daysInMonth
  else {
    const n = parseInt(dueDay, 10)
    startDay = isNaN(n) ? 1 : Math.min(Math.max(n, 1), daysInMonth)
  }
  // 퇴실일이 기간 시작(dueDay)보다 빠르면 그 달 기간 미사용 → 일할 청구 없음
  if (d < startDay) return null
  const rawDays = d - startDay + 1
  const daysUsed = Math.max(1, Math.min(rawDays, PRORATE_BASE_DAYS))
  const amount = Math.floor((monthlyRent * daysUsed) / PRORATE_BASE_DAYS)
  return { daysUsed, amount, fullAmount: monthlyRent, reduction: monthlyRent - amount, moveOutMonth }
}
