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

// 고객관리에서 퇴실 예정일을 입력했을 때 '퇴실 정산?' 팝업을 띄울지 판정.
// 조건: ① 일할이 실제로 의미 있음(부분 기간 — daysUsed<30, 감액>0) ② 근접 — 퇴실일이 '오늘 + 1달'(달력 기준) 이내.
//   ②는 고정 31일이 아니라 달력상 한 달: 입력일 6/2면 7/2까지(6월=30일), 5/2면 6/2까지(5월=31일).
//   달의 실제 길이에 맞춰 '한 달'이 되게 한다(사용자 기준 2026-06-10).
// 선납·완납 후 일찍 나가는(환불) 경우도, 미납 상태로 늦게 정산하는 경우도 모두 ①②로 잡힌다.
// 정산 자체를 자동 적용하진 않음 — 팝업으로 물어보기만.
export function shouldOfferCheckoutProration(
  monthlyRent: number,
  dueDay: string | null,
  expectedMoveOut: string,   // 'YYYY-MM-DD'
  todayYmd: string,          // 'YYYY-MM-DD' (KST 오늘)
): boolean {
  const calc = calcCheckoutProration(monthlyRent, dueDay, expectedMoveOut)
  if (!calc || calc.reduction <= 0 || calc.daysUsed >= PRORATE_BASE_DAYS) return false
  const tp = todayYmd.split('-').map(Number)
  if (tp.length !== 3 || tp.some(n => isNaN(n))) return false
  const [ty, tm, td] = tp
  // 오늘 + 1 달 (달력 기준, 일 클램프) = 팝업을 띄우는 상한 날짜
  const y2 = tm === 12 ? ty + 1 : ty
  const m2 = tm === 12 ? 1 : tm + 1            // 1-based 다음 달
  const lastDay = new Date(y2, m2, 0).getDate() // m2 의 말일
  const limit = new Date(y2, m2 - 1, Math.min(td, lastDay))
  const mo = new Date(expectedMoveOut + 'T00:00:00')
  if (isNaN(mo.getTime())) return false
  // 퇴실일이 '오늘+1달' 이내(과거 포함 — 늦은 정산 케이스). 그보다 먼 미래면 묻지 않음.
  return mo.getTime() <= limit.getTime()
}
