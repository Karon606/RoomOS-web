// 호실 목록(rooms/actions getRoomPaymentStatus)의 '그 달' 판정 조각 정본. 목록과 납입일 변경 조정 칩이 같은 함수를 쓴다
//
// 왜 꺼냈나(2026-10-21 독립 검수, 운영자 요청 '통일감'). 조정 칩이 기한·청구를 따로 재면 같은 달에 목록은 완납인데
// 칩은 미수납이라 말할 수 있다(납부일 당일, 다음 달에 걸린 늦은 임시조정 유예, 퇴실 무청구·양도인·인수 선납 달).
// 그래서 목록 함수 안의 지역 함수였던 것을 식 그대로 옮겨 두 자리가 같이 부른다. 식은 바꾸지 않았다.
import { discountedRent } from './rentDiscount'
import { effectiveBaseRent, type BillingLeaseFields } from './billing'
import { dueDayBeforeChange, isDueDayAdjust } from './dueDayAdjust'

type DueLeaseFull = { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null }
type Rec = { targetMonth: string; actualAmount: number; expectedAmount: number; payDate: Date | string; isPrevOwner: boolean; memo: string | null; isDeposit?: boolean }

/** dueDay 원문을 그 달의 끝 시각(23:59:59.999)으로. override·말일·'YYYY-MM-DD' 모두 처리. */
export function resolveDueRawEnd(raw: string | null | undefined, ry: number, rm: number): Date | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const [fy, fm, fd] = raw.split('-').map(Number)
    return new Date(fy, fm - 1, fd, 23, 59, 59, 999)
  }
  const last = new Date(ry, rm, 0).getDate()
  let day: number
  if (raw.includes('말')) day = last
  else { day = parseInt(raw, 10); if (isNaN(day)) return null; day = Math.min(day, last) }
  return new Date(ry, rm - 1, day, 23, 59, 59, 999)
}

/**
 * 그 달의 기한. 그 달에 직접 건 임시조정은 그대로, 이후 달에 건 임시조정이 원래 납부일보다 늦으면
 * (이 달 채무를 뒤로 미룬 유예) 그 날짜다(2026-06-02 5월 미납 6/1 유예). unpaid.ts·dashboard daysOverdueForMonth 와 같은 규칙.
 */
export function effDueDateForMonth(l: DueLeaseFull, monthStr: string): Date | null {
  const [my, mn] = monthStr.split('-').map(Number)
  if (l.overrideDueDay && l.overrideDueDayMonth === monthStr) return resolveDueRawEnd(l.overrideDueDay, my, mn)
  if (l.overrideDueDay && l.overrideDueDayMonth && l.overrideDueDayMonth > monthStr) {
    const [oy, om] = l.overrideDueDayMonth.split('-').map(Number)
    const overrideDate = resolveDueRawEnd(l.overrideDueDay, oy, om)
    const origDate = resolveDueRawEnd(l.dueDay, my, mn)
    if (overrideDate && (!origDate || overrideDate.getTime() >= origDate.getTime())) return overrideDate
  }
  return resolveDueRawEnd(l.dueDay, my, mn)
}

/**
 * 인수 시점 기간 시작일. 첫 납입일 변경 조정 행의 '바꾸기 전' 값, 없으면 지금 이용 기간 시작일(말일 31).
 * 첫 인자는 lib/dueDay cycleDayOf(계약)다(양도인이 받은 것은 그 기간 몫이라 납부일이 아니라 기간 시작으로 본다, 2026-10-21).
 */
export function originalDueDayOf(cycleDay: string | null, records: readonly Rec[]): number {
  const base = cycleDay?.includes('말') ? 31 : Number(cycleDay ?? '1')
  const first = records
    .filter(p => isDueDayAdjust(p.memo))
    .sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())[0]
  const parsed = dueDayBeforeChange(first?.memo)
  return parsed !== null ? parsed : base
}

/** 그 달 락인 청구(같은 달 여러 행이면 최대 expectedAmount). 보증금은 뺀다. */
export function lockedExpectedMapOf(postCutoffRecords: readonly Rec[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of postCutoffRecords) {
    if (p.isDeposit) continue
    const cur = out.get(p.targetMonth) ?? 0
    if (p.expectedAmount > cur) out.set(p.targetMonth, p.expectedAmount)
  }
  return out
}

/** 목록 행의 그 달 이용료(퇴실 일할 달이면 일할액, 아니면 예약 인상·할인 반영). 인수월 양도인 판정의 기준이다. */
export function viewExpectedForMonth(
  lease: Omit<BillingLeaseFields, 'dueDayAdjusts'> & { discounts?: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[] },
  ms: string,
): number {
  if (lease.checkoutProratedAmount != null && lease.checkoutProratedMonth === ms) return lease.checkoutProratedAmount
  return discountedRent(lease.discounts ?? [], ms, effectiveBaseRent(lease, ms))
}

/** 인수월 양도인 처리. 양도인이 받았거나, 인수 시점 납부일이 인수일 앞이고 운영자 정규 수납이 없으면 선납으로 본다. */
export function acqMonthStateOf(i: {
  allLeaseRecords: readonly Rec[]
  postCutoffRecords: readonly Rec[]
  cutoffDate: Date | null
  acqMonthStr: string
  cutoffMonthStr: string
  expected: number
  originalDueDay: number
}): { paidToPrev: number; currentOpRecords: number; dueBeforeCutoff: boolean; prePaid: boolean } {
  const { cutoffDate, acqMonthStr } = i
  const dueBeforeCutoff = !!(cutoffDate && acqMonthStr === i.cutoffMonthStr && i.originalDueDay < cutoffDate.getDate())
  const paidToPrev = cutoffDate
    ? i.allLeaseRecords.filter(p => p.targetMonth === acqMonthStr && new Date(p.payDate) < cutoffDate).reduce((s, p) => s + p.actualAmount, 0)
    : 0
  const currentOpRecords = i.postCutoffRecords
    .filter(p => p.targetMonth === acqMonthStr && p.expectedAmount >= i.expected)
    .reduce((s, p) => s + p.actualAmount, 0)
  return { paidToPrev, currentOpRecords, dueBeforeCutoff, prePaid: paidToPrev >= i.expected || (dueBeforeCutoff && currentOpRecords === 0) }
}

/**
 * 그 달 청구와 기한 도래. 목록 행(rowExpected·viewMonthDuePassed)과 조정 칩이 같은 판정이다.
 *   skipped  인수 선납 달 · 양도인 달 · 퇴실 무청구(퇴실월 초과 포함) 달. 청구 0.
 *   duePassed 지난 달이거나 기한(effDueDateForMonth)이 오늘 끝 시각 이하. 납부일 당일부터 지났다고 본다(목록 미납 묶음과 같다).
 */
export function roomMonthBill(i: {
  ms: string
  bill: (ms: string) => number
  acqMonthStr: string
  acqMonthPrePaid: boolean
  prevOwnerMonths: ReadonlySet<string>
  skipByMoveOut: (ms: string) => boolean
  dueDate: Date | null
  today: { year: number; month: number; day: number }
}): { skipped: boolean; billed: number; duePassed: boolean } {
  const skipped = (i.ms === i.acqMonthStr && i.acqMonthPrePaid) || i.prevOwnerMonths.has(i.ms) || i.skipByMoveOut(i.ms)
  const todayMonth = `${i.today.year}-${String(i.today.month).padStart(2, '0')}`
  const todayEnd = new Date(i.today.year, i.today.month - 1, i.today.day, 23, 59, 59, 999)
  const duePassed = i.ms < todayMonth || (i.dueDate ? i.dueDate <= todayEnd : false)
  return { skipped, billed: skipped ? 0 : i.bill(i.ms), duePassed }
}
