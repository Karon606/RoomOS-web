// 월별 청구액 단일 규칙 — 순수함수(부수효과 없음).
// 읽기 3곳(rooms getRoomPaymentStatus · dashboard page.tsx · dashboard/unpaid.ts)과
// 쓰기 경로(rooms savePayment 등)가 전부 이 헬퍼를 쓴다. 우선순위:
//   ① 퇴실 일할 정산(checkoutProratedMonth === 그 달) — 저장된 일할액 최우선
//   ② 락인된 record.expectedAmount(그 달 최대) — 월세 변경의 과거 소급 방지
//   ③ 현재 월세(할인 반영) fallback — record 없는 달
// 여기 규칙을 바꾸면 세 화면·푸시·수납 등록이 한 번에 같이 바뀐다.
import { RentDiscountInput, discountedRent } from './rentDiscount'

export type BillingLeaseFields = {
  rentAmount: number
  checkoutProratedAmount?: number | null
  checkoutProratedMonth?: string | null
  discounts?: RentDiscountInput[] | null
}

export function billForLeaseMonth(
  l: BillingLeaseFields,
  mon: string,                  // 'YYYY-MM'
  locked?: number | null,       // 그 달 record들의 최대 expectedAmount (없으면 null)
): number {
  if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return l.checkoutProratedAmount
  if (locked && locked > 0) return locked
  return discountedRent(l.discounts, mon, l.rentAmount)
}

// 'YYYY-MM' 추출 (Date | 'YYYY-MM-DD' | null)
export function monthOfDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

// 퇴실월 이후 청구 제외 — mon이 퇴실월보다 뒤면 true (상태 무관, 날짜 기준)
export function isAfterMoveOutMonth(expectedMoveOut: Date | string | null | undefined, mon: string): boolean {
  const mo = monthOfDate(expectedMoveOut ?? null)
  return !!mo && mon > mo
}

// dueDay 문자열('N' | '말' | 'YYYY-MM-DD')을 그 월(mon)의 실제 만기 Date로 환산
export function resolveDueDateForMonth(raw: string | null | undefined, mon: string): Date | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const [fy, fm, fd] = raw.split('-').map(Number)
    if ([fy, fm, fd].some(isNaN)) return null
    return new Date(fy, fm - 1, fd, 23, 59, 59, 999)
  }
  const [y, m] = mon.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  let day: number
  if (raw.includes('말')) day = last
  else { day = parseInt(raw, 10); if (isNaN(day)) return null; day = Math.min(day, last) }
  return new Date(y, m - 1, day, 23, 59, 59, 999)
}

// 선납 모델: 퇴실예정일이 그 월 납부일(서비스 기간 시작) 이전이면 그 기간을 안 쓰므로 청구 0.
// lib/prorate calcCheckoutProration 이 null 을 반환하는 영역(일할 저장값이 없는 케이스).
// 퇴실월 당월에만 적용 — 이후 월은 isAfterMoveOutMonth 로 제외.
export function isCheckoutNoBillingMonth(
  expectedMoveOut: Date | string | null | undefined,
  mon: string,
  dueDate: Date | null,         // 그 월의 실제 만기(override 반영은 호출부 책임)
): boolean {
  if (!expectedMoveOut || !dueDate) return false
  if (monthOfDate(expectedMoveOut) !== mon) return false
  return new Date(expectedMoveOut).getTime() <= dueDate.getTime()
}
