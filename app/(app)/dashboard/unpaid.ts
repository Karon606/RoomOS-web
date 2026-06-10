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
import { kstMonthStr, kstYmd } from '@/lib/kstDate'
import { discountedRent } from '@/lib/rentDiscount'

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
  daysOverdue: number | null
  unpaidAmount: number   // 도래·미회수 portion
  monthsOverdue: number
}

export type UnpaidStatus = {
  unpaidCount: number       // 도래·미회수(진짜 미납) 건수 — 대시보드 '이달 미수납' 위젯과 동일
  overdueAmount: number     // 도래·미회수 금액 합
  unpaidLeases: UnpaidLease[]
}

export async function computeUnpaidStatus(propertyId: string): Promise<UnpaidStatus> {
  const targetMonth = kstMonthStr()        // = realTodayMonthStr (오늘 월)
  const realTodayMonthStr = targetMonth

  const [property, unpaidLeasesRaw, allHistoricalPayments] = await Promise.all([
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
        status: true,
        dueDay: true,
        overrideDueDay: true,
        overrideDueDayMonth: true,
        // 퇴실 일할 정산 — 그 달 청구를 저장된 일할액으로 덮어씀(rooms·dashboard page 와 동일)
        checkoutProratedAmount: true,
        checkoutProratedMonth: true,
        // #14 월세 할인 — 미수 계산에 월별 할인 반영(대시보드 발생주의 블록과 동일)
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        room: { select: { id: true, roomNo: true } },
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
  ])

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
    if (!p.memo?.includes('[납입일변경]')) continue
    const existing = originalDueDayByLease[p.leaseTermId]
    const m = p.memo.match(/\[납입일변경\]\s*([^일→]+?)일?\s*→/)
    if (!m) continue
    const t = m[1].trim()
    const parsed = t.includes('말') ? 31 : Number(t)
    if (isNaN(parsed) || parsed <= 0) continue
    const recDate = new Date(p.payDate).getTime()
    const cur = (originalDueDayByLease as Record<string, number>)[`__date_${p.leaseTermId}`]
    if (existing === undefined || (cur !== undefined && recDate < cur)) {
      originalDueDayByLease[p.leaseTermId] = parsed
      ;(originalDueDayByLease as Record<string, number>)[`__date_${p.leaseTermId}`] = recDate
    }
  }
  function getOriginalDueDay(l: { id: string; dueDay: string | null }): number | null {
    const restored = originalDueDayByLease[l.id]
    if (restored !== undefined) return restored
    if (!l.dueDay) return null
    if (l.dueDay.includes('말')) return 31
    const n = parseInt(l.dueDay, 10)
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
        dayNum = overrideForCutoff.includes('말') ? 31 : parseInt(overrideForCutoff, 10)
        if (isNaN(dayNum)) dayNum = null
      } else {
        dayNum = getOriginalDueDay(l)
      }
      if (dayNum != null && dayNum < cutoffDay) prevOwnerLeaseIds.add(l.id)
    }
  }

  function effectiveDueDayForMonth(
    l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
    monthStr: string,
  ): string | null {
    if (l.overrideDueDay && l.overrideDueDayMonth === monthStr) return l.overrideDueDay
    return l.dueDay
  }

  // 납부일 임시조정(override)을 절대 날짜로 해석. 유예 적용 기준.
  // overrideDueDay 가 'YYYY-MM-DD' 면 그대로, 'N'·'말' 이면 overrideDueDayMonth 의 그 날.
  function overrideAbsDate(
    l: { overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
  ): Date | null {
    if (!l.overrideDueDay || !l.overrideDueDayMonth) return null
    if (l.overrideDueDay.includes('-')) {
      const [y, m, d] = l.overrideDueDay.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    const [y, m] = l.overrideDueDayMonth.split('-').map(Number)
    const day = l.overrideDueDay.includes('말') ? new Date(y, m, 0).getDate() : parseInt(l.overrideDueDay, 10)
    if (isNaN(day) || day < 1) return null
    return new Date(y, m - 1, day)
  }

  // 특정 미납 월의 경과일 — 납부일 유예 반영.
  // override 가 이 월(또는 이후 월)에 걸려 있고, 그 유예 날짜가 이 월 원래 납부일보다 늦으면
  // (= 미납 채무를 뒤로 미룬 경우) 유예 날짜 기준으로 경과일을 계산한다.
  // 2026-06-02 사용자 보고: 5월 미납을 6/1로 유예했는데 19일 경과로 잡히던 문제.
  function daysOverdueForMonth(
    l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
    monthStr: string,
  ): number | null {
    if (l.overrideDueDay && l.overrideDueDayMonth && l.overrideDueDayMonth >= monthStr) {
      const abs = overrideAbsDate(l)
      const orig = calcDaysOverdueForMonth(l.dueDay, monthStr)
      if (abs) {
        const { year: ty, month: tm, day: td } = kstYmd()
        const today = new Date(ty, tm - 1, td)
        const days = Math.round((today.getTime() - abs.getTime()) / 86400000)
        // 유예는 '뒤로 미루기'만 — 유예 경과일이 원래보다 작을 때만 적용(채무를 더 급하게 만들지 않음).
        if (orig == null || days <= orig) return days
      }
    }
    return calcDaysOverdueForMonth(effectiveDueDayForMonth(l, monthStr), monthStr)
  }

  // 특정 월의 dueDay 기준 today와의 일수 차이 (KST 기준)
  function calcDaysOverdueForMonth(dueDay: string | null, monthStr: string): number | null {
    if (!dueDay) return null
    const { year: ty, month: tm, day: td } = kstYmd()
    const todayCopy = new Date(ty, tm - 1, td)
    if (dueDay.includes('-')) {
      const [yy, mm, dd] = dueDay.split('-').map(Number)
      const dueDate = new Date(yy, mm - 1, dd)
      return Math.round((todayCopy.getTime() - dueDate.getTime()) / 86400000)
    }
    const [y, m] = monthStr.split('-').map(Number)
    let dayNum: number
    if (dueDay.includes('말')) {
      dayNum = new Date(y, m, 0).getDate()
    } else {
      dayNum = parseInt(dueDay, 10)
      if (isNaN(dayNum) || dayNum < 1) return null
    }
    const dueDate = new Date(y, m - 1, dayNum)
    return Math.round((todayCopy.getTime() - dueDate.getTime()) / 86400000)
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
  for (const l of unpaidLeasesRaw) {
    const lMoveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const leaseStartMonth = lMoveIn
      ? `${lMoveIn.getFullYear()}-${String(lMoveIn.getMonth() + 1).padStart(2, '0')}`
      : (cutoffMonthStr ?? targetMonth)
    const firstMonth = cutoffMonthStr && leaseStartMonth < cutoffMonthStr ? cutoffMonthStr : leaseStartMonth
    if (firstMonth > targetMonth) continue

    const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : null
    const moveOutMonth = moveOut
      ? `${moveOut.getFullYear()}-${String(moveOut.getMonth() + 1).padStart(2, '0')}`
      : null

    let dueDayNum: number = NaN
    if (l.overrideDueDayMonth === firstMonth && l.overrideDueDay) {
      const eff = l.overrideDueDay
      dueDayNum = eff.includes('말') ? 31 : parseInt(eff, 10)
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
      billableMonthList.push(mon)
    }
    // [저장 청구액 우선] 그 달 record의 락인 청구액 우선, 없으면 현재 월세(#14 할인 반영) fallback
    const lockedMap = lockedExpectedByLeaseMonth[l.id]
    const billForMonth = (mon: string) => {
      // 퇴실 일할 정산이 걸린 달은 저장된 일할액 최우선
      if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return l.checkoutProratedAmount
      const locked = lockedMap?.get(mon)
      return locked && locked > 0 ? locked : discountedRent(l.discounts, mon, l.rentAmount)
    }
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
    for (const mon of billableMonthList) {
      const monthBill = billForMonth(mon)
      const allocThis = Math.min(received, monthBill)
      received -= allocThis
      const monthUnpaid = monthBill - allocThis
      if (monthUnpaid <= 0) continue
      const days = daysOverdueForMonth(l, mon)
      // days >= 0 (도래) 또는 알 수 없음 → 미수(미납), days < 0 (미도래) → 납부 예정
      if (days == null || days >= 0) leaseOverdue += monthUnpaid
    }
    overdueByLease[l.id] = leaseOverdue
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
        daysOverdue,
        unpaidAmount: overduePortion,
        monthsOverdue,
      }
    })

  const overdueAmount = unpaidLeases.reduce((s, l) => s + l.unpaidAmount, 0)
  return { unpaidCount: unpaidLeases.length, overdueAmount, unpaidLeases }
}
