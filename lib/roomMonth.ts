// 호실 목록(rooms/actions getRoomPaymentStatus)의 '그 달' 판정 조각 정본. 목록과 납입일 변경 조정 칩이 같은 함수를 쓴다
//
// 왜 꺼냈나(2026-10-21 독립 검수, 운영자 요청 '통일감'). 조정 칩이 기한·청구를 따로 재면 같은 달에 목록은 완납인데
// 칩은 미수납이라 말할 수 있다(납부일 당일, 다음 달에 걸린 늦은 임시조정 유예, 퇴실 무청구·양도인·인수 선납 달).
// 그래서 목록 함수 안의 지역 함수였던 것을 식 그대로 옮겨 두 자리가 같이 부른다. 식은 바꾸지 않았다.
// 2026-11-04 기한 날짜 고르기와 기한 상태는 lib/dueState 정본으로 옮겼다(납부일 당일은 미납이 아니라 납부일 당일, 운영자 승인 '추천대로').
import { discountedRent } from './rentDiscount'
import { effectiveBaseRent, type BillingLeaseFields } from './billing'
import { dueDayBeforeChange, isDueDayAdjust } from './dueDayAdjust'
import { monthDueState, type DueState } from './dueState'

type Rec = { targetMonth: string; actualAmount: number; expectedAmount: number; payDate: Date | string; isPrevOwner: boolean; memo: string | null; isDeposit?: boolean }

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
 * 그 달 청구와 기한 상태. 목록 행(rowExpected·viewDueState)과 조정 칩이 같은 판정이다.
 *   skipped   인수 선납 달 · 양도인 달 · 퇴실 무청구(퇴실월 초과 포함) 달. 청구 0.
 *   dueState  그 달 기한(lib/dueState dueYmdOfLeaseMonth)과 오늘로 낸 상태(before · today · overdue). 기한을 못 읽으면
 *             지난 달은 overdue, 이번 달·앞 달은 before(monthDueState 한 규칙). 납부일 당일은 미납이 아니다(2026-11-04).
 */
export function roomMonthBill(i: {
  ms: string
  bill: (ms: string) => number
  acqMonthStr: string
  acqMonthPrePaid: boolean
  prevOwnerMonths: ReadonlySet<string>
  skipByMoveOut: (ms: string) => boolean
  dueYmd: string | null
  todayYmd: string
}): { skipped: boolean; billed: number; dueState: DueState } {
  const skipped = (i.ms === i.acqMonthStr && i.acqMonthPrePaid) || i.prevOwnerMonths.has(i.ms) || i.skipByMoveOut(i.ms)
  const dueState = monthDueState(i.ms, i.dueYmd, i.todayYmd)
  return { skipped, billed: skipped ? 0 : i.bill(i.ms), dueState }
}
