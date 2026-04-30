import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { Suspense } from 'react'
import DataButtons from '@/components/DataButtons'
import DashboardClient, { type DashboardData } from './DashboardClient'
import { getPaymentMethods } from '@/app/(app)/settings/actions'

// ── 헬퍼 ──────────────────────────────────────────────────────

function getLast6Months(targetMonth: string): string[] {
  const [year, month] = targetMonth.split('-').map(Number)
  const result: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

function daysUntil(date: Date | string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(date); target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function dayLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}일 경과`
  if (days === 0) return '오늘'
  return `D-${days}`
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  if (diff < 60000) return '방금'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`
  if (diff < 2 * 86400000) return '어제'
  return `${Math.floor(diff / 86400000)}일 전`
}

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

// ── 데이터 패칭 ────────────────────────────────────────────────

async function getDashboardData(propertyId: string, targetMonth: string) {
  const [year, month] = targetMonth.split('-').map(Number)
  const startDate = new Date(year, month - 1, 1)
  const endDate   = new Date(year, month, 0)

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const acquisitionDate = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate)
    : property?.acquisitionDate ? new Date(property.acquisitionDate) : null

  const last6Months = getLast6Months(targetMonth)
  const [tyear, tmonth] = last6Months[0].split('-').map(Number)
  const trendStartDate  = new Date(tyear, tmonth - 1, 1)

  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const alertFrom = new Date(today.getTime() - 7  * 86400000)
  const alertTo   = new Date(today.getTime() + 30 * 86400000)

  const [
    activeLeases,
    payments,
    expenses,
    incomes,
    totalRooms,
    vacantRooms,
    depositAgg,
    expByCategory,
    moveInLeases,
    moveOutLeases,
    trendPayments,
    trendExpenses,
    trendIncomes,
    activeCount,
    reservedCount,
    checkoutCount,
    nonResidentCount,
    activeTenants,
    vacantRoomList,
    wishRoomLeases,
    roomsWithTenants,
    recentPaymentsRaw,
    unpaidLeasesRaw,
    tenantRequestsRaw,
    waitingTourLeases,
    recurringExpenses,
    recurringExpensesThisMonth,
    allHistoricalPayments,
  ] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      select: { id: true, rentAmount: true },
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId, targetMonth, isDeposit: false,
        ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}),
      },
      select: { leaseTermId: true, actualAmount: true },
    }),
    prisma.expense.findMany({
      where: { propertyId, date: { gte: startDate, lte: endDate } },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: { gte: startDate, lte: endDate } },
    }),
    prisma.room.count({ where: { propertyId } }),
    prisma.room.count({ where: { propertyId, isVacant: true } }),
    prisma.leaseTerm.aggregate({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      _sum: { depositAmount: true },
    }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { propertyId, date: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    }),
    // 입실예정 알림
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: 'RESERVED',
        moveInDate: { gte: alertFrom, lte: alertTo },
      },
      include: {
        tenant: { select: { name: true, id: true } },
        room:   { select: { roomNo: true } },
      },
      orderBy: { moveInDate: 'asc' },
    }),
    // 퇴실예정 알림 — CHECKOUT_PENDING은 날짜 무관하게 모두, ACTIVE는 범위 내만
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        OR: [
          { status: 'CHECKOUT_PENDING' },
          { status: 'ACTIVE', expectedMoveOut: { gte: alertFrom, lte: alertTo } },
        ],
      },
      include: {
        tenant: { select: { name: true, id: true } },
        room:   { select: { roomNo: true } },
      },
      orderBy: { expectedMoveOut: { sort: 'asc', nulls: 'last' } },
    }),
    // 6개월 트렌드
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        targetMonth: { in: last6Months },
        isDeposit: false,
        ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}),
      },
      select: { targetMonth: true, actualAmount: true },
    }),
    prisma.expense.findMany({
      where: { propertyId, date: { gte: trendStartDate, lte: endDate } },
      select: { date: true, amount: true },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: { gte: trendStartDate, lte: endDate } },
      select: { date: true, amount: true },
    }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'ACTIVE' } }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'RESERVED' } }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'CHECKOUT_PENDING' } }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'NON_RESIDENT' } }),
    // 입주자 분포
    prisma.tenant.findMany({
      where: {
        propertyId,
        leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } } },
      },
      select: { gender: true, nationality: true, job: true },
    }),
    // 희망 이동 호실용 공실 목록
    prisma.room.findMany({
      where: { propertyId, isVacant: true },
      select: { roomNo: true },
    }),
    // 희망 이동 호실 계약
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
        wishRooms: { not: null },
      },
      include: {
        tenant: { select: { name: true, id: true } },
        room:   { select: { roomNo: true } },
      },
    }),
    // 방 현황 그리드용
    prisma.room.findMany({
      where: { propertyId },
      select: {
        roomNo: true,
        isVacant: true,
        type: true,
        windowType: true,
        direction: true,
        areaPyeong: true,
        areaM2: true,
        baseRent: true,
        scheduledRent: true,
        rentUpdateDate: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          select: { tenant: { select: { id: true, name: true } }, status: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { roomNo: 'asc' },
    }),
    // 최근 수납 내역 (활동 피드용)
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      select: {
        targetMonth: true,
        createdAt: true,
        actualAmount: true,
        tenant: { select: { id: true, name: true } },
        leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    // 미납 상세 (이달 청구 대상 계약)
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] },
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
        room: { select: { roomNo: true } },
        tenant: { select: { id: true, name: true } },
      },
    }),
    // 미해결 입주자 요청사항
    prisma.tenantRequest.findMany({
      where: { propertyId, resolvedAt: null },
      orderBy: { requestDate: 'asc' },
      select: {
        id: true, content: true, requestDate: true, targetDate: true,
        tenantId: true,
        tenant: { select: { name: true } },
      },
    }),
    // 투어 대기 알림
    prisma.leaseTerm.findMany({
      where: { propertyId, status: 'WAITING_TOUR' },
      include: {
        tenant: { select: { name: true, id: true } },
        room:   { select: { roomNo: true } },
      },
      orderBy: { tourDate: { sort: 'asc', nulls: 'last' } },
    }),
    // 고정 지출 목록
    prisma.recurringExpense.findMany({
      where: { propertyId, isActive: true },
      orderBy: { dueDay: 'asc' },
    }),
    // 이달 고정 지출 기록 여부
    prisma.expense.findMany({
      where: {
        propertyId,
        recurringExpenseId: { not: null },
        date: { gte: startDate, lte: endDate },
      },
      select: { recurringExpenseId: true },
    }),
    // 누적 미납 계산용 전체 납부 이력
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        targetMonth: { lte: targetMonth },
        isDeposit: false,
      },
      select: { leaseTermId: true, targetMonth: true, actualAmount: true },
    }),
  ])

  // ── 이달 집계 ────────────────────────────────────────────────
  const activeLeaseIds  = new Set(activeLeases.map(l => l.id))
  const leaseRentMap    = new Map(activeLeases.map(l => [l.id, l.rentAmount]))

  // 계약당 이달 납부 합계 → 이용료 상한 적용 (과납분은 다음달 수입)
  const paidByLease: Record<string, number> = {}
  for (const p of payments) {
    if (!activeLeaseIds.has(p.leaseTermId)) continue
    paidByLease[p.leaseTermId] = (paidByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }
  const paidRevenue = Object.entries(paidByLease).reduce((s, [id, paid]) => {
    const rent = leaseRentMap.get(id) ?? 0
    return s + Math.min(paid, rent)
  }, 0)
  const extraRevenue = incomes.reduce((s, i) => s + i.amount, 0)
  const totalRevenue = paidRevenue + extraRevenue
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const totalDeposit = depositAgg._sum.depositAmount ?? 0

  // ── 예상 지출 계산 ────────────────────────────────────────────
  // 변동 항목의 과거 기록 배치 조회 (전년 동월 우선, 없으면 과거 평균)
  const variableRecIds = recurringExpenses.filter(re => (re as any).isVariable).map(re => re.id)
  const priorYearStart = new Date(year - 1, month - 1, 1)
  const priorYearEnd   = new Date(year - 1, month, 0)
  const [variablePastExpenses, nonRecurringPast] = await Promise.all([
    variableRecIds.length > 0
      ? prisma.expense.findMany({
          where: { propertyId, recurringExpenseId: { in: variableRecIds }, date: { lt: startDate } },
          select: { recurringExpenseId: true, amount: true, date: true },
        })
      : Promise.resolve([]),
    prisma.expense.aggregate({
      where: { propertyId, recurringExpenseId: null, date: { gte: new Date(year, month - 4, 1), lt: startDate } },
      _sum: { amount: true },
    }),
  ])

  // 전년 동월 합계 / 전체 과거 합계·건수
  const priorYearSumMap: Record<string, number> = {}
  const varSumMap: Record<string, number> = {}
  const varCntMap: Record<string, number> = {}
  for (const e of variablePastExpenses) {
    const id = e.recurringExpenseId!
    varSumMap[id] = (varSumMap[id] ?? 0) + e.amount
    varCntMap[id] = (varCntMap[id] ?? 0) + 1
    const d = new Date(e.date)
    if (d >= priorYearStart && d <= priorYearEnd) {
      priorYearSumMap[id] = (priorYearSumMap[id] ?? 0) + e.amount
    }
  }
  // 변동 항목 예측: 전년 동월 > 과거 평균(2건 이상) > baseline(re.amount)
  const variableAvgMap: Record<string, number> = {}
  for (const id of variableRecIds) {
    if (priorYearSumMap[id] !== undefined) {
      variableAvgMap[id] = priorYearSumMap[id]
    } else if ((varCntMap[id] ?? 0) >= 2) {
      variableAvgMap[id] = Math.round(varSumMap[id] / varCntMap[id])
    }
  }

  const hasExpenseHistory = (nonRecurringPast._sum.amount ?? 0) > 0
  let expectedExpense = 0
  for (const re of recurringExpenses) {
    const activeSince = (re as any).activeSince as Date | null
    if (activeSince && new Date(activeSince) > endDate) continue  // 이달 미활성
    const isVar = (re as any).isVariable as boolean
    expectedExpense += (isVar && variableAvgMap[re.id] !== undefined) ? variableAvgMap[re.id] : re.amount
  }
  expectedExpense += Math.round((nonRecurringPast._sum.amount ?? 0) / 3)

  // 완납 여부 판단: cutoff 이전 납부도 포함 (수익 계산과 별개)
  const allMonthPayments = await prisma.paymentRecord.findMany({
    where: { propertyId, targetMonth, isDeposit: false },
    select: { leaseTermId: true, actualAmount: true },
  })
  const paymentByLeaseForStatus = allMonthPayments.reduce((acc, p) => {
    acc[p.leaseTermId] = (acc[p.leaseTermId] ?? 0) + p.actualAmount
    return acc
  }, {} as Record<string, number>)

  // 인수 기준일 이전 월 or 인수월 내 기준일 이전 납부일 → 양도인 몫으로 완납 처리
  const cutoffMonthStr = acquisitionDate
    ? `${acquisitionDate.getFullYear()}-${String(acquisitionDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay = acquisitionDate ? acquisitionDate.getDate() : 0
  const prevOwnerLeaseIds = new Set<string>()
  if (cutoffMonthStr && targetMonth < cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) {
      paymentByLeaseForStatus[l.id] = l.rentAmount
      prevOwnerLeaseIds.add(l.id)
    }
  } else if (cutoffMonthStr && targetMonth === cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) {
      const eff = effectiveDueDay(l)
      if (!eff) continue
      const dayNum = parseInt(eff, 10)
      if (!isNaN(dayNum) && dayNum < cutoffDay) {
        paymentByLeaseForStatus[l.id] = l.rentAmount
        prevOwnerLeaseIds.add(l.id)
      }
    }
  }

  function effectiveDueDay(l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null }): string | null {
    if (l.overrideDueDay && l.overrideDueDayMonth === targetMonth) return l.overrideDueDay
    return l.dueDay
  }

  function calcDaysOverdue(dueDay: string | null): number | null {
    if (!dueDay) return null
    const todayCopy = new Date(); todayCopy.setHours(0, 0, 0, 0)
    if (dueDay.includes('-')) {
      // 다음달 지정 전체 날짜 (YYYY-MM-DD)
      const dueDate = new Date(dueDay + 'T00:00:00')
      dueDate.setHours(0, 0, 0, 0)
      return Math.round((todayCopy.getTime() - dueDate.getTime()) / 86400000)
    }
    const y = todayCopy.getFullYear()
    const m = todayCopy.getMonth() + 1
    let dayNum: number
    if (dueDay.includes('말')) {
      dayNum = new Date(y, m, 0).getDate()
    } else {
      dayNum = parseInt(dueDay, 10)
      if (isNaN(dayNum) || dayNum < 1) return null
    }
    const dueDate = new Date(y, m - 1, dayNum)
    dueDate.setHours(0, 0, 0, 0)
    return Math.round((todayCopy.getTime() - dueDate.getTime()) / 86400000)
  }

  const paymentByLease = payments.reduce((acc, p) => {
    acc[p.leaseTermId] = (acc[p.leaseTermId] ?? 0) + p.actualAmount
    return acc
  }, {} as Record<string, number>)

  const billableLeases = activeLeases.filter(l => l.rentAmount > 0)
  const paidCount      = billableLeases.filter(l => (paymentByLeaseForStatus[l.id] ?? 0) >= l.rentAmount).length
  // 양도인 몫 제외 — 수납완료 + 미수납과 합산이 맞도록
  const totalExpected  = billableLeases
    .filter(l => !prevOwnerLeaseIds.has(l.id))
    .reduce((s, l) => s + l.rentAmount, 0)

  const categoryBreakdown = expByCategory.map(c => ({
    category: c.category,
    amount:   c._sum.amount ?? 0,
    percent:  totalExpense > 0 ? Math.round(((c._sum.amount ?? 0) / totalExpense) * 100) : 0,
  }))

  // ── 희망 호실 알림 ───────────────────────────────────────────
  const vacantRoomNos = new Set(vacantRoomList.map(r => r.roomNo))
  const wishRoomAlerts = wishRoomLeases.flatMap(l => {
    const wished = (l.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
    return wished
      .filter(no => vacantRoomNos.has(no))
      .map(no => ({
        tenantName: l.tenant.name,
        tenantId:   l.tenant.id,
        roomNo:     no,
      }))
  })

  // ── 6개월 트렌드 ─────────────────────────────────────────────
  const trend = last6Months.map(m => {
    const [y, mo] = m.split('-').map(Number)
    const mStart  = new Date(y, mo - 1, 1)
    const mEnd    = new Date(y, mo, 0)
    const revenue =
      trendPayments.filter(p => p.targetMonth === m).reduce((s, p) => s + p.actualAmount, 0) +
      trendIncomes
        .filter(i => new Date(i.date) >= mStart && new Date(i.date) <= mEnd)
        .reduce((s, i) => s + i.amount, 0)
    const expense =
      trendExpenses
        .filter(e => new Date(e.date) >= mStart && new Date(e.date) <= mEnd)
        .reduce((s, e) => s + e.amount, 0)
    return { month: m, revenue, expense, profit: revenue - expense }
  })

  // ── 입주자 분포 ──────────────────────────────────────────────
  function toDistribution(map: Record<string, number>) {
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({
        label,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
  }

  const genderMap:      Record<string, number> = {}
  const nationalityMap: Record<string, number> = {}
  const jobMap:         Record<string, number> = {}

  activeTenants.forEach(t => {
    genderMap[t.gender] = (genderMap[t.gender] ?? 0) + 1
    const nat = t.nationality?.trim() || '미기재'
    nationalityMap[nat] = (nationalityMap[nat] ?? 0) + 1
    const job = t.job?.trim() || '미기재'
    jobMap[job] = (jobMap[job] ?? 0) + 1
  })

  // ── 방 현황 그리드 ───────────────────────────────────────────
  const roomsData = roomsWithTenants.map(r => ({
    roomNo:        r.roomNo,
    isVacant:      r.isVacant,
    type:          r.type,
    windowType:    r.windowType as string | null,
    direction:     r.direction as string | null,
    areaPyeong:    r.areaPyeong,
    areaM2:        r.areaM2,
    baseRent:      r.baseRent,
    scheduledRent: r.scheduledRent,
    rentUpdateDate: r.rentUpdateDate ? new Date(r.rentUpdateDate).toISOString().slice(0, 10) : null,
    tenantName:    r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.tenant.name ?? null,
    tenantId:      r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.tenant.id ?? null,
    tenantStatus:  r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.status ?? null,
  }))

  // ── 누적 미납 상세 (관점 B: 임대 시작월부터 조회월까지 합산) ──────────
  const payHistMap: Record<string, Record<string, number>> = {}
  for (const p of allHistoricalPayments) {
    if (!payHistMap[p.leaseTermId]) payHistMap[p.leaseTermId] = {}
    payHistMap[p.leaseTermId][p.targetMonth] = (payHistMap[p.leaseTermId][p.targetMonth] ?? 0) + p.actualAmount
  }

  const unpaidMap: Record<string, number> = {}
  for (const l of unpaidLeasesRaw) {
    const lMoveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const leaseStartMonth = lMoveIn
      ? `${lMoveIn.getFullYear()}-${String(lMoveIn.getMonth() + 1).padStart(2, '0')}`
      : targetMonth
    const firstMonth = cutoffMonthStr && leaseStartMonth < cutoffMonthStr ? cutoffMonthStr : leaseStartMonth
    if (firstMonth > targetMonth) continue

    // 퇴실예정 — expectedMoveOut 이후 월은 청구 종료
    const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : null
    const moveOutMonth = moveOut
      ? `${moveOut.getFullYear()}-${String(moveOut.getMonth() + 1).padStart(2, '0')}`
      : null

    const months = monthRange(firstMonth, targetMonth)
    let cum = 0
    for (const mon of months) {
      if (prevOwnerLeaseIds.has(l.id) && mon === cutoffMonthStr) continue
      if (moveOutMonth && mon > moveOutMonth) continue
      cum += Math.max(0, l.rentAmount - (payHistMap[l.id]?.[mon] ?? 0))
    }
    unpaidMap[l.id] = cum
  }

  const unpaidAmount = Object.values(unpaidMap).reduce((s, v) => s + v, 0)
  const unpaidLeases = unpaidLeasesRaw
    .filter(l => (unpaidMap[l.id] ?? 0) > 0)
    .map(l => ({
      roomNo:       l.room?.roomNo ?? '?',
      tenantName:   l.tenant.name,
      tenantId:     l.tenant.id,
      leaseId:      l.id,
      daysOverdue:  calcDaysOverdue(effectiveDueDay(l)),
      unpaidAmount: unpaidMap[l.id]!,
    }))
  const unpaidCount = unpaidLeases.length

  // ── 알림 ────────────────────────────────────────────────────
  const alertItems: DashboardData['alerts'] = []

  const fmtKorDate = (d: Date | string | null | undefined): string | undefined => {
    if (!d) return undefined
    const dt = new Date(d)
    return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`
  }
  const fmtShortDate = (d: Date | string | null | undefined): string | undefined => {
    if (!d) return undefined
    const dt = new Date(d)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일`
  }

  for (const l of moveInLeases) {
    const days = daysUntil(l.moveInDate!)
    alertItems.push({
      text:      `${l.tenant.name}님 ${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}입실 예정`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#3b82f6',
      timeLabel: dayLabel(days),
      tenantId:  l.tenant.id,
      detail:    fmtKorDate(l.moveInDate) ? `입실 예정일: ${fmtKorDate(l.moveInDate)}` : undefined,
      exactDate: fmtShortDate(l.moveInDate),
    })
  }

  for (const l of moveOutLeases) {
    const timeLabel = l.expectedMoveOut ? dayLabel(daysUntil(l.expectedMoveOut)) : '날짜 미정'
    alertItems.push({
      text:      `${l.tenant.name}님 ${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}퇴실 예정`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#eab308',
      timeLabel,
      tenantId:  l.tenant.id,
      detail:    l.expectedMoveOut ? `퇴실 예정일: ${fmtKorDate(l.expectedMoveOut)}` : '퇴실 날짜 미정',
      exactDate: fmtShortDate(l.expectedMoveOut),
    })
  }

  for (const l of waitingTourLeases) {
    const timeLabel = l.tourDate ? dayLabel(daysUntil(l.tourDate)) : '일정 미정'
    alertItems.push({
      text:      `${l.tenant.name}님${l.room?.roomNo ? ` ${l.room.roomNo}호` : ''} 투어 예정`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#a855f7',
      timeLabel,
      tenantId:  l.tenant.id,
      detail:    l.tourDate ? `투어 예정일: ${fmtKorDate(l.tourDate)}` : '투어 일정 미정',
      exactDate: fmtShortDate(l.tourDate),
    })
  }

  for (const a of wishRoomAlerts) {
    alertItems.push({
      text:      `${a.tenantName}님 희망 ${a.roomNo}호 공실`,
      link:      `/tenants?tenantId=${a.tenantId}`,
      dotColor:  '#22c55e',
      timeLabel: '지금',
      tenantId:  a.tenantId,
      detail:    `${a.tenantName}님이 희망하던 ${a.roomNo}호가 공실 전환되었습니다.`,
    })
  }

  for (const r of tenantRequestsRaw) {
    const daysLeft = r.targetDate
      ? Math.round((new Date(r.targetDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
      : null
    alertItems.push({
      text:      `${r.tenant.name}님 요청: ${r.content.slice(0, 28)}${r.content.length > 28 ? '…' : ''}`,
      link:      `/tenants?tenantId=${r.tenantId}&tab=requests`,
      dotColor:  '#f4623a',
      timeLabel: daysLeft != null ? (daysLeft <= 0 ? '처리 필요' : `D-${daysLeft}`) : '미처리',
      tenantId:  r.tenantId,
      detail:    r.content + (r.targetDate ? `\n처리 기한: ${fmtKorDate(r.targetDate)}` : ''),
      exactDate: fmtShortDate(r.targetDate),
    })
  }

  // ── 고정 지출 알림 ───────────────────────────────────────────

  // 한국 공휴일 (연도별 정적 목록 — 주말 대체공휴일 포함)
  const KR_HOLIDAYS: Record<string, string[]> = {
    '2025': ['2025-01-01','2025-01-28','2025-01-29','2025-01-30','2025-03-01','2025-05-05','2025-05-06','2025-06-06','2025-08-15','2025-10-03','2025-10-06','2025-10-07','2025-10-08','2025-10-09','2025-12-25'],
    '2026': ['2026-01-01','2026-01-28','2026-01-29','2026-01-30','2026-03-01','2026-03-02','2026-05-05','2026-05-25','2026-06-06','2026-08-17','2026-09-24','2026-09-25','2026-09-28','2026-10-05','2026-10-09','2026-12-25'],
  }

  function getEffectiveTransferDate(baseDate: Date): Date {
    const d = new Date(baseDate)
    const yearKey = String(d.getFullYear())
    const holidays = new Set(KR_HOLIDAYS[yearKey] ?? [])
    while (true) {
      const dow = d.getDay()
      const iso = d.toISOString().slice(0, 10)
      if (dow === 0) { d.setDate(d.getDate() + 1); continue }  // 일요일 → +1
      if (dow === 6) { d.setDate(d.getDate() + 2); continue }  // 토요일 → +2
      if (holidays.has(iso)) { d.setDate(d.getDate() + 1); continue } // 공휴일 → +1
      break
    }
    return d
  }

  const recordedRecurringIds = new Set(
    recurringExpensesThisMonth.map(e => e.recurringExpenseId).filter(Boolean)
  )
  for (const re of recurringExpenses) {
    if (recordedRecurringIds.has(re.id)) continue
    // activeSince 필터
    const activeSince = (re as any).activeSince as Date | null
    if (activeSince && new Date(activeSince) > endDate) continue

    const [y, m] = targetMonth.split('-').map(Number)
    const nominalDate = new Date(y, m - 1, Math.min(re.dueDay, new Date(y, m, 0).getDate()))
    nominalDate.setHours(0, 0, 0, 0)
    // 자동이체인 경우 실제 이체일(주말/공휴일 다음 영업일) 기준으로 알림 계산
    const effectiveDate = re.isAutoDebit ? getEffectiveTransferDate(new Date(nominalDate)) : nominalDate
    effectiveDate.setHours(0, 0, 0, 0)
    const daysLeft = Math.round((effectiveDate.getTime() - today.getTime()) / 86400000)
    if (daysLeft > re.alertDaysBefore) continue
    const shiftedNote = re.isAutoDebit && effectiveDate.getTime() !== nominalDate.getTime()
      ? ` (실제이체 ${fmtShortDate(effectiveDate)})`
      : ''
    alertItems.push({
      text:                `고정 지출: ${re.title}`,
      link:                '/finance',
      dotColor:            '#6366f1',
      timeLabel:           daysLeft < 0 ? `${Math.abs(daysLeft)}일 경과` : daysLeft === 0 ? '오늘' : `D-${daysLeft}`,
      exactDate:           fmtShortDate(effectiveDate),
      detail:              `${re.amount.toLocaleString()}원 · ${re.category}${re.isAutoDebit ? ' · 자동이체' + shiftedNote : ''}${re.memo ? '\n' + re.memo : ''}`,
      recurringExpenseId:    re.id,
      recurringAmount:       re.amount,
      recurringDueDate:      effectiveDate.toISOString().slice(0, 10),
      recurringCategory:     re.category,
      recurringPayMethod:    re.payMethod ?? undefined,
      recurringIsVariable:   (re as any).isVariable as boolean,
      recurringHistoricalAvg: variableAvgMap[re.id],
    })
  }

  // ── 최근 납입 완료 ────────────────────────────────────────────
  const activityItems: DashboardData['activity'] = recentPaymentsRaw.map(p => ({
    text:       `${p.tenant.name}님 ${p.leaseTerm.room?.roomNo ?? '?'}호 납입 완료`,
    timeLabel:  relativeTime(p.createdAt),
    dotColor:   '#22c55e',
    link:       `/tenants?tenantId=${p.tenant.id}&tab=info`,
    tenantId:   p.tenant.id,
    tenantName: p.tenant.name,
    roomNo:     p.leaseTerm.room?.roomNo ?? '?',
    amount:     p.actualAmount,
  }))

  // 양도인 자동 완납 항목 — 수납 기록 없이 납부일이 귀속 기준일 이전인 경우 납입완료 피드에 표시
  if (cutoffMonthStr && targetMonth === cutoffMonthStr) {
    const actualPaidLeaseIds = new Set(allMonthPayments.map(p => p.leaseTermId))
    for (const l of unpaidLeasesRaw) {
      if (!l.dueDay || actualPaidLeaseIds.has(l.id)) continue
      const dayNum = parseInt(l.dueDay, 10)
      if (isNaN(dayNum) || dayNum >= cutoffDay) continue
      activityItems.unshift({
        text:       `${l.tenant.name}님 ${l.room?.roomNo ?? '?'}호 납입 완료`,
        timeLabel:  '양도인 수납',
        dotColor:   '#f59e0b',
        link:       `/tenants?tenantId=${l.tenant.id}&tab=info`,
        tenantId:   l.tenant.id,
        tenantName: l.tenant.name,
        roomNo:     l.room?.roomNo ?? '?',
        amount:     l.rentAmount,
      })
    }
  }

  const dashboardData: DashboardData = {
    totalRevenue,
    paidRevenue,
    extraRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
    totalDeposit,
    paidCount,
    unpaidCount,
    unpaidAmount,
    totalExpected,
    categoryBreakdown,
    trend,
    totalRooms,
    vacantRooms,
    occupiedRooms: totalRooms - vacantRooms,
    statusCounts: { active: activeCount, reserved: reservedCount, checkout: checkoutCount, nonResident: nonResidentCount, waitingTour: waitingTourLeases.length },
    totalTenants:    activeTenants.length,
    genderDist:      toDistribution(genderMap),
    nationalityDist: toDistribution(nationalityMap),
    jobDist:         toDistribution(jobMap),
    rooms:           roomsData,
    alerts:          alertItems,
    expectedExpense,
    hasExpenseHistory,
    activity:        activityItems,
    unpaidLeases,
  }

  return dashboardData
}

// ── 페이지 ────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')

  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { name: true },
  })

  const [dashboardData, paymentMethods] = await Promise.all([
    getDashboardData(propertyId, targetMonth),
    getPaymentMethods(),
  ])

  return (
    <div className="space-y-3.5">

      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: 'var(--warm-dark)' }}>{property?.name}</h1>
        <Suspense fallback={null}>
          <DataButtons />
        </Suspense>
      </div>

      {/* ── 대시보드 ──────────────────────────────────────────── */}
      <DashboardClient data={dashboardData} targetMonth={targetMonth} paymentMethods={paymentMethods} />

    </div>
  )
}
