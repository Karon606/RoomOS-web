// 수납 폼 귀속월 목록(달마다 청구·수납·기한 도래)과 인수월 양도인 처리 판정의 정본 순수 함수. 서버 getTargetMonthOptions·FIFO 가 같이 부른다.
//
// 왜 꺼냈나(2026-11-04 독립 검수 B1). 귀속월 목록이 인수월(양도인 자동 처리 달)을 '미납·기한 도래'로 남겨, 그 목록을 합치는
// 수납 등록 기본값(lib/paymentSuggest)에 한 달치가 더 들어갔다(412호 12/2 700,000, 맞는 값 350,000). 저장 FIFO(findFirstUnpaidMonth)는
// 그 달을 건너뛰므로 그대로 저장하면 한 달치가 선납으로 적히고 초과분 확인창도 안 뜬다. 인수월 판정을 사본이 아니라 이 파일의
// acqMonthSettledByFifo 하나로 두고 FIFO 와 목록이 같이 부른다.
import { billForLeaseMonth, isAfterMoveOutMonth, isCheckoutNoBillingMonthFor, type BillingLeaseFields } from './billing'
import { leaseBillingEnd } from './leaseStatus'
import { effDueDateForMonth, monthDuePassed } from './roomMonth'

export type TargetMonthOptionRow = {
  month: string                                      // 'YYYY-MM'
  status: 'unpaid' | 'partial' | 'paid' | 'future'
  paidAmount: number
  expectedAmount: number
  // 그 달 기한이 오늘로 도래했나(lib/roomMonth monthDuePassed, 수납 관리 목록과 같은 식). 수납 등록 기본값이
  // 도래한 미완납 달만 합친다. 아직 기한 전인 이번 달 청구가 지난달 미납분 기본값에 섞이지 않게 한다(404호 2026-11-01).
  duePassed: boolean
}

type PayRec = { targetMonth: string; actualAmount: number; expectedAmount: number; payDate: Date | string; isPrevOwner: boolean }

/**
 * 인수월이 FIFO 에서 완납으로 넘어가나(findFirstUnpaidMonth 와 같은 판정). 그 달 수납 합(인수 전 양도인 입금 포함)이
 * 청구 이상이거나, 인수 시점 기간 시작일이 인수일 앞이고 인수 뒤 수납이 0 이면(양도인 자동 처리) 넘어간다.
 * baseDueDayNum 은 인수 시점의 기간 시작일(첫 납입일 변경 전 값, 말일 31)이다.
 */
export function acqMonthSettledByFifo(i: {
  cutoffDate: Date
  baseDueDayNum: number
  monthRecords: readonly { actualAmount: number; payDate: Date | string }[]   // 그 달 이용료 record(양도인 정산 행 없음)
  monthBill: number
}): boolean {
  const opPaid = i.monthRecords.filter(r => new Date(r.payDate) >= i.cutoffDate).reduce((s, r) => s + r.actualAmount, 0)
  const totalPaid = i.monthRecords.reduce((s, r) => s + r.actualAmount, 0)
  const dueBeforeCutoff = !isNaN(i.baseDueDayNum) && i.baseDueDayNum < i.cutoffDate.getDate()
  return totalPaid >= i.monthBill || (dueBeforeCutoff && opPaid === 0)
}

/**
 * 귀속월 목록. 시작은 인수일과 입주일 중 늦은 쪽, 끝은 조회월 + 3달. 청구 끝은 leaseBillingEnd(예정일 ?? 실제 퇴실일, 수납 관리 목록 정본)다.
 * 양도인 정산 달·청구 없는 달은 뺀다. 인수 전 입금은 수납 합에서 빼되,
 * 인수월은 FIFO 와 같은 판정(acqMonthSettledByFifo)으로 넘어가면 완납으로 적는다.
 */
export function buildTargetMonthOptions(i: {
  lease: BillingLeaseFields & {
    expectedMoveOut?: Date | string | null
    moveOutDate?: Date | string | null
    overrideDueDay?: string | null
    overrideDueDayMonth?: string | null
  }
  records: readonly PayRec[]
  cutoffDate: Date | null
  baseDueDayNum: number
  viewMonth: string
  today: { year: number; month: number; day: number }
}): TargetMonthOptionRow[] {
  const { lease, records, cutoffDate, viewMonth } = i
  const moveIn = lease.moveInDate ? new Date(lease.moveInDate) : null
  const startDate = moveIn && cutoffDate && moveIn > cutoffDate ? moveIn : (cutoffDate ?? moveIn ?? new Date())
  const [vy, vm] = viewMonth.split('-').map(Number)
  const endDate = new Date(vy, vm - 1 + 3, 1)
  const endY = endDate.getFullYear(), endM = endDate.getMonth() + 1
  // 청구 끝 = 예정일 ?? 실제 퇴실일(수납 관리 목록 정본). 예정일 없이 퇴실 처리된 계약(408·422·507호)이 퇴실 뒤 달을
  // 미납으로 끌고 와 기본값이 수백만 원이 되던 자리다(독립 검수 R1). 저장 FIFO 는 아직 예정일만 본다(별건, 보고).
  const billingEnd = leaseBillingEnd(lease)
  const acqMonth = cutoffDate ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}` : null

  const prevOwnerMonths = new Set(records.filter(r => r.isPrevOwner).map(r => r.targetMonth))
  const paidByMonth: Record<string, number> = {}
  const lockedByMonth: Record<string, number> = {}
  for (const r of records) {
    if (r.isPrevOwner) continue
    if (cutoffDate && new Date(r.payDate) < cutoffDate) continue
    paidByMonth[r.targetMonth] = (paidByMonth[r.targetMonth] ?? 0) + r.actualAmount
    if (r.expectedAmount > (lockedByMonth[r.targetMonth] ?? 0)) lockedByMonth[r.targetMonth] = r.expectedAmount
  }

  const out: TargetMonthOptionRow[] = []
  let cy = startDate.getFullYear(), cmn = startDate.getMonth() + 1
  for (; cy < endY || (cy === endY && cmn <= endM); cmn === 12 ? (cmn = 1, cy++) : cmn++) {
    const ms = `${cy}-${String(cmn).padStart(2, '0')}`
    if (prevOwnerMonths.has(ms)) continue
    // 퇴실월 이후는 청구 대상 아님(추천이 퇴실 후 달을 잡지 않게).
    if (isAfterMoveOutMonth(billingEnd, ms)) continue
    let paid = paidByMonth[ms] ?? 0
    // 그 달 청구액 — 읽기 엔진·savePayment 과 같은 단일 규칙(일할→락인→예약인상→할인).
    const locked = lockedByMonth[ms]
    const expected = billForLeaseMonth(lease, ms, locked && locked > 0 ? locked : null)
    // 청구가 없는 달(무청구 퇴실월·단기 비청구월)은 뺀다. 판정은 읽기 화면과 같은 정본(lib/billing).
    if (isCheckoutNoBillingMonthFor(lease, billingEnd, ms) || expected <= 0) continue
    // 인수월은 FIFO 와 같은 판정이다. FIFO 가 넘기는 달을 미납으로 두면 기본값 합에 한 달치가 더 든다(B1).
    if (cutoffDate && ms === acqMonth) {
      const monthRecords = records.filter(r => !r.isPrevOwner && r.targetMonth === ms)
      const fifoLock = monthRecords.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
      const monthBill = billForLeaseMonth(lease, ms, fifoLock > 0 ? fifoLock : null)
      if (acqMonthSettledByFifo({ cutoffDate, baseDueDayNum: i.baseDueDayNum, monthRecords, monthBill })) paid = Math.max(paid, expected)
    }
    const status: TargetMonthOptionRow['status'] = ms > viewMonth ? 'future' : paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const duePassed = monthDuePassed(ms, effDueDateForMonth({ dueDay: lease.dueDay, overrideDueDay: lease.overrideDueDay, overrideDueDayMonth: lease.overrideDueDayMonth }, ms), i.today)
    out.push({ month: ms, status, paidAmount: paid, expectedAmount: expected, duePassed })
  }
  return out
}
