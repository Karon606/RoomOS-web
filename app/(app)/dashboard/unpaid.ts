// 월세 미납(도래·미회수) 계산 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
// 푸시 cron 이 "완납 시까지 매일" 미납 알림을 보내기 위해 사용.
//
// ⚠️ 정확성 주의: 이 계산은 app/(app)/dashboard/page.tsx 의 getDashboardData 내
//   "누적 미납 상세 — 발생주의(targetMonth 기반)" 블록(현재 'targetMonth'를 '오늘 월'로 본 경우)을
//   그대로 복제한 것이다. 발생주의·양도인 정산·납입일변경·FIFO 충당 로직이 동일해야
//   대시보드 '이달 미수납' 위젯 건수와 푸시 알림 건수가 일치한다.
//   ⇒ 한쪽 로직을 수정하면 반드시 양쪽을 함께 수정할 것. (장기적으로 단일 모듈로 통합 권장)
//
// targetMonth 는 항상 KST 오늘 월(kstMonthStr). 대시보드의 '미수납 위젯은 selected month 무관,
// 항상 오늘 기준'(page.tsx realTodayMonthStr) 정책과 동일.

import prisma from '@/lib/prisma'
import { dueDayForCutoff } from '@/lib/dueDate'
import { dueDayBeforeChange, isDueDayAdjust, loadDueDayAdjustMap, withDueDayAdjusts } from '@/lib/dueDayAdjust'
import { cycleDayOf } from '@/lib/dueDay'
import { kstMonthStr, kstYmdStr } from '@/lib/kstDate'
import { daysPastDue, deferredDueYmd, dueYmdOfLeaseMonth, monthDueState } from '@/lib/dueState'
import { leaseBillingEnd } from '@/lib/leaseStatus'
import { billForLeaseMonth, isCheckoutNoBillingMonthFor } from '@/lib/billing'

function monthRange(startMonth: string, endMonth: string): string[] {
  const result: string[] = []
  let [y, m] = startMonth.split('-').map(Number)
  const [ey, em] = endMonth.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return result
}

export type UnpaidLease = {
  roomNo: string
  roomId: string | null
  tenantName: string
  tenantId: string
  leaseId: string
  isShortTerm: boolean   // 단기 — 미납 알림 문구가 '월이용료' 대신 '이용료'를 쓴다(운영자 지시 2026-07-20)
  daysOverdue: number | null
  deferredDue: string | null   // 기한을 미뤄준 상태면 그 날짜('M/D'), 아니면 null
  unpaidAmount: number   // 기한 지남·미회수 portion(납부일 당일 몫은 빠진다)
  monthsOverdue: number
}

// 납부일 당일만 남은 계약(종·푸시 '오늘 납부일'). 금액은 오늘이 기한인 몫이다.
export type DueTodayLease = {
  roomNo: string
  roomId: string | null
  tenantName: string
  tenantId: string
  leaseId: string
  isShortTerm: boolean
  dueTodayAmount: number
}

export type UnpaidStatus = {
  unpaidCount: number       // 기한 지남·미회수(진짜 미납) 건수 — 대시보드 '이달 미수납' 위젯과 동일. 납부일 당일은 안 센다
  overdueAmount: number     // 기한 지남·미회수 금액 합
  unpaidLeases: UnpaidLease[]
  dueTodayLeases: DueTodayLease[]
}

export async function computeUnpaidStatus(propertyId: string): Promise<UnpaidStatus> {
  const targetMonth = kstMonthStr()        // = realTodayMonthStr (오늘 월)
  const realTodayMonthStr = targetMonth

  const [property, unpaidLeasesFetched, allHistoricalPayments, dueDayAdjustMap] = await Promise.all([
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { acquisitionDate: true, prevOwnerCutoffDate: true },
    }),
    // 미납 상세 (이달 청구 대상 계약) — RESERVED는 미입주라 제외
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] },
        rentAmount: { gt: 0 },
      },
      select: {
        id: true,
        rentAmount: true,
        moveInDate: true,
        expectedMoveOut: true,
        moveOutDate: true,   // 청구 끝(leaseBillingEnd) — 홈 미수 루프와 글자까지 같은 게이트를 쓰려고 읽는다
        status: true,
        dueDay: true, cycleDay: true,
        overrideDueDay: true,
        overrideDueDayMonth: true,
        // 퇴실 일할 정산 — 그 달 청구를 저장된 일할액으로 덮어씀(rooms·dashboard page 와 동일)
        checkoutProratedAmount: true,
        checkoutProratedMonth: true,
        isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing) — moveInDate와 함께 판정
        // #14 월세 할인 — 미수 계산에 월별 할인 반영(대시보드 발생주의 블록과 동일)
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        room: { select: { id: true, roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
        tenant: { select: { id: true, name: true } },
      },
    }),
    // 누적 미납 계산용 — 발생주의: targetMonth가 오늘 월 이하인 record만 매출 인식
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isDeposit: false,
        targetMonth: { lte: realTodayMonthStr },
      },
      select: { leaseTermId: true, targetMonth: true, actualAmount: true, expectedAmount: true, payDate: true, memo: true, isPrevOwner: true },
    }),
    // 청구 엔진의 조정 행 입력(입주달 첫 달 규칙, lib/dueDayAdjust 정본) — 홈 미수와 같은 영업장 범위 한 번.
    loadDueDayAdjustMap(prisma, { propertyId }),
  ])
  const unpaidLeasesRaw = withDueDayAdjusts(unpaidLeasesFetched, dueDayAdjustMap)

  // [저장 청구액 우선] (lease, month)별 락인된 청구액 — 월세 변경의 과거 소급 방지.
  // 같은 달 여러 record면 정규 월 청구(최대 expectedAmount)를 채택. record 없는 달은 현재 월세로 fallback.
  // rooms/actions.ts getRoomPaymentStatus 와 동일 정책 — 한쪽 수정 시 동기화.
  const lockedExpectedByLeaseMonth: Record<string, Map<string, number>> = {}
  for (const p of allHistoricalPayments) {
    if (p.isPrevOwner) continue
    const m = (lockedExpectedByLeaseMonth[p.leaseTermId] ??= new Map())
    const cur = m.get(p.targetMonth) ?? 0
    if (p.expectedAmount > cur) m.set(p.targetMonth, p.expectedAmount)
  }

  const acquisitionDate = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate)
    : property?.acquisitionDate ? new Date(property.acquisitionDate) : null

  const cutoffMonthStr = acquisitionDate
    ? `${acquisitionDate.getFullYear()}-${String(acquisitionDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay = acquisitionDate ? acquisitionDate.getDate() : 0

  // [납입일변경] 메모에서 변경 전 원래 dueDay 복원
  const originalDueDayByLease: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    if (!isDueDayAdjust(p.memo)) continue
    const existing = originalDueDayByLease[p.leaseTermId]
    const parsed = dueDayBeforeChange(p.memo)
    if (parsed === null) continue
    const recDate = new Date(p.payDate).getTime()
    const cur = (originalDueDayByLease as Record<string, number>)[`__date_${p.leaseTermId}`]
    if (existing === undefined || (cur !== undefined && recDate < cur)) {
      originalDueDayByLease[p.leaseTermId] = parsed
      ;(originalDueDayByLease as Record<string, number>)[`__date_${p.leaseTermId}`] = recDate
    }
  }
  // 인수월 판정은 기간 시작으로 본다(양도인이 받은 것은 그 기간 몫이다). 그래서 납부일이 아니라 이용 기간 시작일(cycleDayOf)이다.
  function getOriginalDueDay(l: { id: string; dueDay: string | null; cycleDay: string | null }): number | null {
    const restored = originalDueDayByLease[l.id]
    if (restored !== undefined) return restored
    const cycle = cycleDayOf(l)
    if (!cycle) return null
    if (cycle.includes('말')) return 31
    const n = parseInt(cycle, 10)
    return isNaN(n) ? null : n
  }

  // 양도인 몫으로 완납 처리되는 lease (viewMonth 기준)
  const prevOwnerLeaseIds = new Set<string>()
  if (cutoffMonthStr && targetMonth < cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) prevOwnerLeaseIds.add(l.id)
  } else if (cutoffMonthStr && targetMonth === cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) {
      const overrideForCutoff = (l.overrideDueDayMonth === cutoffMonthStr && l.overrideDueDay) ? l.overrideDueDay : null
      let dayNum: number | null = null
      if (overrideForCutoff) {
        // 전체 날짜형('YYYY-MM-DD')을 parseInt 하면 2026 이 나와 cutoff 비교가 뒤집힌다(lib/dueDate 정본)
        dayNum = dueDayForCutoff(overrideForCutoff, cutoffMonthStr)
      } else {
        dayNum = getOriginalDueDay(l)
      }
      if (dayNum != null && dayNum < cutoffDay) prevOwnerLeaseIds.add(l.id)
    }
  }

  // 기한 날짜 고르기와 상태는 lib/dueState 정본이다(수납 관리 목록·홈·수납 등록 기본값과 같은 함수, 2026-11-04).
  // 그 달 임시조정 · 다음 달에 걸린 늦은 유예(2026-06-02) · 첫 달 입주일(2026-09-07) · 말일 클램프가 한 함수 안에 있다.
  // 오늘은 이 요청에서 한 번만 잰다(두 번 재면 자정에 갈린다).
  const todayYmd = kstYmdStr()
  type DueL = Parameters<typeof dueYmdOfLeaseMonth>[0]
  // 그 달 경과일(오늘 − 기한, 음수 = 남은 날). 기한을 못 읽으면 null.
  function daysOverdueForMonth(l: DueL, monthStr: string): number | null {
    const due = dueYmdOfLeaseMonth(l, monthStr)
    return due ? daysPastDue(due, todayYmd) : null
  }
  // 기한을 미뤄준 상태면 그 날짜를 'M/D' 로(유예 날짜 당일은 유예가 아니라 납부일 당일). 수납 관리 isDeferredNow 와 같은 정본.
  function deferredDueForMonth(l: DueL, monthStr: string): string | null {
    const d = deferredDueYmd(l, monthStr, todayYmd)
    return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null
  }

  // 양도인 정산(isPrevOwner) record가 있는 (lease, month) — 그 월은 현 원장 청구 제외
  const prevOwnerMonthsByLease: Record<string, Set<string>> = {}
  for (const p of allHistoricalPayments) {
    if (!p.isPrevOwner) continue
    ;(prevOwnerMonthsByLease[p.leaseTermId] ??= new Set()).add(p.targetMonth)
  }

  // 인수월에 사용자가 받은 record 합 — 양도인 자동 처리 판정용
  const opPaidInCutoffMonthByLease: Record<string, number> = {}
  if (cutoffMonthStr && acquisitionDate) {
    for (const p of allHistoricalPayments) {
      if (p.isPrevOwner) continue
      if (p.targetMonth !== cutoffMonthStr) continue
      if (new Date(p.payDate) < acquisitionDate) continue
      opPaidInCutoffMonthByLease[p.leaseTermId] = (opPaidInCutoffMonthByLease[p.leaseTermId] ?? 0) + p.actualAmount
    }
  }

  // viewMonth(targetMonth) 기준 누적 수령액
  const accrualByLeaseForView: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    if (p.isPrevOwner) continue
    if (p.targetMonth > targetMonth) continue
    if (acquisitionDate && new Date(p.payDate) < acquisitionDate) continue
    accrualByLeaseForView[p.leaseTermId] = (accrualByLeaseForView[p.leaseTermId] ?? 0) + p.actualAmount
  }

  const unpaidMap: Record<string, number> = {}
  const firstUnpaidByLease: Record<string, string | null> = {}
  const overdueByLease: Record<string, number> = {}
  const todayByLease: Record<string, number> = {}
  for (const l of unpaidLeasesRaw) {
    const lMoveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const leaseStartMonth = lMoveIn
      ? `${lMoveIn.getFullYear()}-${String(lMoveIn.getMonth() + 1).padStart(2, '0')}`
      : (cutoffMonthStr ?? targetMonth)
    const firstMonth = cutoffMonthStr && leaseStartMonth < cutoffMonthStr ? cutoffMonthStr : leaseStartMonth
    if (firstMonth > targetMonth) continue

    // 청구 끝 — 홈 미수 루프(getDashboardData)와 같은 정본(leaseBillingEnd). 이 조회는 진행 중 계약뿐이라
    // 실제 퇴실일이 없어 종전 expectedMoveOut 과 같은 값이다(신고 70addd65 에서 홈 쪽과 맞춘 것).
    const billingEnd = leaseBillingEnd(l)
    const moveOut = billingEnd ? new Date(billingEnd) : null
    const moveOutMonth = moveOut
      ? `${moveOut.getFullYear()}-${String(moveOut.getMonth() + 1).padStart(2, '0')}`
      : null

    let dueDayNum: number = NaN
    if (l.overrideDueDayMonth === firstMonth && l.overrideDueDay) {
      const d = dueDayForCutoff(l.overrideDueDay, firstMonth)
      dueDayNum = d ?? NaN
    } else {
      const orig = getOriginalDueDay(l)
      if (orig != null) dueDayNum = orig
    }
    const opPaidInCutoff = opPaidInCutoffMonthByLease[l.id] ?? 0
    const acqMonthAutoPaid =
      !!(cutoffMonthStr && firstMonth === cutoffMonthStr && !isNaN(dueDayNum) && dueDayNum < cutoffDay && opPaidInCutoff === 0)

    const months = monthRange(firstMonth, targetMonth)
    const billableMonthList: string[] = []
    const lPrevOwnerMonths = prevOwnerMonthsByLease[l.id]
    for (const mon of months) {
      if (mon === cutoffMonthStr && acqMonthAutoPaid) continue
      if (prevOwnerLeaseIds.has(l.id) && mon === cutoffMonthStr) continue
      if (lPrevOwnerMonths?.has(mon)) continue
      if (moveOutMonth && mon > moveOutMonth) continue
      // 퇴실월 무청구 — 퇴실예정일이 그 월 납부일 이전이면 그 기간 미사용 = 청구 0
      // (rooms checkoutNoBilling 과 동일 규칙, lib/billing 공용. 수납 페이지=완납인데 푸시=미납 방지)
      if (isCheckoutNoBillingMonthFor(l, billingEnd, mon)) continue
      billableMonthList.push(mon)
    }
    // 청구 규칙(일할→락인→할인)은 lib/billing 공용 — rooms·dashboard page 와 동일
    const lockedMap = lockedExpectedByLeaseMonth[l.id]
    const billForMonth = (mon: string) => billForLeaseMonth(l, mon, lockedMap?.get(mon) ?? null)
    const totalExpected = billableMonthList.reduce((s, mon) => s + billForMonth(mon), 0)
    const totalReceived = accrualByLeaseForView[l.id] ?? 0
    unpaidMap[l.id] = Math.max(0, totalExpected - totalReceived)

    let allocated = 0
    let firstUnpaid: string | null = null
    for (const mon of billableMonthList) {
      if (totalReceived - allocated < billForMonth(mon)) { firstUnpaid = mon; break }
      allocated += billForMonth(mon)
    }
    firstUnpaidByLease[l.id] = firstUnpaid

    // 월별 도래·미도래 portion 분리 — FIFO 충당 후 각 월 미충당분을 dueDay 도래 여부로 분류
    let received = totalReceived
    let leaseOverdue = 0
    let leaseToday = 0
    for (const mon of billableMonthList) {
      const monthBill = billForMonth(mon)
      const allocThis = Math.min(received, monthBill)
      received -= allocThis
      const monthUnpaid = monthBill - allocThis
      if (monthUnpaid <= 0) continue
      // 기한 상태(lib/dueState): 미납(기한 다음 날부터) · 납부일 당일 · 납부일 전. 기한을 못 읽으면 지난 달은 미납, 이번 달은 납부일 전.
      const state = monthDueState(mon, dueYmdOfLeaseMonth(l, mon), todayYmd)
      if (state === 'overdue') leaseOverdue += monthUnpaid
      else if (state === 'today') leaseToday += monthUnpaid
    }
    overdueByLease[l.id] = leaseOverdue
    todayByLease[l.id] = leaseToday
  }

  // 도래·미회수 portion 이 있는 lease 만 = 진짜 미납 (대시보드 unpaidLeases 와 동일)
  const unpaidLeases: UnpaidLease[] = unpaidLeasesRaw
    .filter(l => (unpaidMap[l.id] ?? 0) > 0 && (overdueByLease[l.id] ?? 0) > 0)
    .map(l => {
      const overduePortion = overdueByLease[l.id] ?? 0
      const firstUnpaid = firstUnpaidByLease[l.id] ?? null
      const daysOverdue = firstUnpaid ? daysOverdueForMonth(l, firstUnpaid) : null
      const monthsOverdue = l.rentAmount > 0 ? Math.ceil((unpaidMap[l.id] ?? 0) / l.rentAmount) : 0
      return {
        roomNo: l.room?.roomNo ?? '?',
        roomId: l.room?.id ?? null,
        tenantName: l.tenant.name,
        tenantId: l.tenant.id,
        leaseId: l.id,
        isShortTerm: l.isShortTerm,
        daysOverdue,
        deferredDue: firstUnpaid ? deferredDueForMonth(l, firstUnpaid) : null,
        unpaidAmount: overduePortion,
        monthsOverdue,
      }
    })

  // 납부일 당일만 남은 계약(미납 몫이 없고 오늘이 기한인 몫이 있다). 종·푸시의 '오늘 납부일'이고, 받으면 사라진다.
  // 미납 몫이 함께 있는 계약은 미납 알림 하나만 선다(금액은 미납 몫만, 당일 청구는 아직 미납이 아니다).
  const dueTodayLeases: DueTodayLease[] = unpaidLeasesRaw
    .filter(l => (overdueByLease[l.id] ?? 0) === 0 && (todayByLease[l.id] ?? 0) > 0)
    .map(l => ({
      roomNo: l.room?.roomNo ?? '?',
      roomId: l.room?.id ?? null,
      tenantName: l.tenant.name,
      tenantId: l.tenant.id,
      leaseId: l.id,
      isShortTerm: l.isShortTerm,
      dueTodayAmount: todayByLease[l.id] ?? 0,
    }))

  const overdueAmount = unpaidLeases.reduce((s, l) => s + l.unpaidAmount, 0)
  return { unpaidCount: unpaidLeases.length, overdueAmount, unpaidLeases, dueTodayLeases }
}
