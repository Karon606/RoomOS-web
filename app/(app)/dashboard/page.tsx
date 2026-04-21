import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { Suspense } from 'react'
import DataButtons from '@/components/DataButtons'
import DashboardClient, { type DashboardData } from './DashboardClient'

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

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  if (diff < 60000) return '방금'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`
  if (diff < 2 * 86400000) return '어제'
  return `${Math.floor(diff / 86400000)}일 전`
}

// ── 데이터 패칭 ────────────────────────────────────────────────

async function getDashboardData(propertyId: string, targetMonth: string) {
  const [year, month] = targetMonth.split('-').map(Number)
  const startDate = new Date(year, month - 1, 1)
  const endDate   = new Date(year, month, 0)

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
  ] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      select: { id: true, rentAmount: true },
    }),
    prisma.paymentRecord.findMany({
      where: { propertyId, targetMonth },
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
        tenant: { select: { name: true } },
        room:   { select: { roomNo: true } },
      },
      orderBy: { moveInDate: 'asc' },
    }),
    // 퇴실예정 알림
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['CHECKOUT_PENDING', 'ACTIVE'] },
        expectedMoveOut: { gte: alertFrom, lte: alertTo },
      },
      include: {
        tenant: { select: { name: true } },
        room:   { select: { roomNo: true } },
      },
      orderBy: { expectedMoveOut: 'asc' },
    }),
    // 6개월 트렌드
    prisma.paymentRecord.findMany({
      where: { propertyId, targetMonth: { in: last6Months } },
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
        tenant: { select: { name: true } },
        room:   { select: { roomNo: true } },
      },
    }),
    // 방 현황 그리드용
    prisma.room.findMany({
      where: { propertyId },
      select: {
        roomNo: true,
        isVacant: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          select: { tenant: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
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
        createdAt: true,
        actualAmount: true,
        tenant: { select: { name: true } },
        leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    // 미납 상세 (이달 청구 대상 계약)
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
        rentAmount: { gt: 0 },
      },
      select: {
        id: true,
        rentAmount: true,
        room: { select: { roomNo: true } },
        tenant: { select: { name: true } },
      },
    }),
  ])

  // ── 이달 집계 ────────────────────────────────────────────────
  const activeLeaseIds = new Set(activeLeases.map(l => l.id))
  const paidRevenue    = payments
    .filter(p => activeLeaseIds.has(p.leaseTermId))
    .reduce((s, p) => s + p.actualAmount, 0)
  const extraRevenue = incomes.reduce((s, i) => s + i.amount, 0)
  const totalRevenue = paidRevenue + extraRevenue
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const totalDeposit = depositAgg._sum.depositAmount ?? 0

  const paymentByLease = payments.reduce((acc, p) => {
    acc[p.leaseTermId] = (acc[p.leaseTermId] ?? 0) + p.actualAmount
    return acc
  }, {} as Record<string, number>)

  const billableLeases = activeLeases.filter(l => l.rentAmount > 0)
  const paidCount      = billableLeases.filter(l => (paymentByLease[l.id] ?? 0) >= l.rentAmount).length
  const unpaidCount    = billableLeases.length - paidCount

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
        type:       'wish_room' as const,
        tenantName: l.tenant.name,
        roomNo:     no,
        days:       0,
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
    roomNo:     r.roomNo,
    isVacant:   r.isVacant,
    tenantName: r.leaseTerms[0]?.tenant.name ?? null,
  }))

  // ── 미납 상세 ────────────────────────────────────────────────
  const unpaidAmount = unpaidLeasesRaw.reduce((sum, l) => {
    const paid = paymentByLease[l.id] ?? 0
    return sum + Math.max(0, l.rentAmount - paid)
  }, 0)

  const unpaidLeases = unpaidLeasesRaw
    .filter(l => (paymentByLease[l.id] ?? 0) < l.rentAmount)
    .map(l => ({
      roomNo:     l.room.roomNo,
      tenantName: l.tenant.name,
      desc:       `${targetMonth.slice(5)}월 미납`,
    }))

  // ── 활동 피드 ────────────────────────────────────────────────
  const activityItems: { text: string; timeLabel: string; dotColor: string }[] = []

  // 알림 (입실/퇴실 예정)
  const alerts = [
    ...moveInLeases.map(l => ({
      type: 'move_in' as const,
      tenantName: l.tenant.name,
      roomNo: l.room.roomNo,
      days: daysUntil(l.moveInDate!),
    })),
    ...moveOutLeases.map(l => ({
      type: 'move_out' as const,
      tenantName: l.tenant.name,
      roomNo: l.room.roomNo,
      days: daysUntil(l.expectedMoveOut!),
    })),
    ...wishRoomAlerts,
  ].sort((a, b) => a.days - b.days)

  for (const a of alerts.slice(0, 3)) {
    const text = a.type === 'wish_room'
      ? `${a.tenantName}님 희망 호실 ${a.roomNo}호 공실`
      : a.type === 'move_in'
      ? `${a.tenantName}님 ${a.roomNo}호 입실 예정`
      : `${a.tenantName}님 ${a.roomNo}호 퇴실 예정`
    const dotColor = a.type === 'wish_room' ? '#a855f7' : a.type === 'move_in' ? '#3b82f6' : '#eab308'
    const timeLabel = a.days < 0 ? `${Math.abs(a.days)}일 경과` : a.days === 0 ? '오늘' : `${a.days}일 후`
    activityItems.push({ text, timeLabel, dotColor })
  }

  // 최근 수납
  for (const p of recentPaymentsRaw) {
    if (activityItems.length >= 6) break
    activityItems.push({
      text:      `${p.tenant.name}님 ${p.leaseTerm.room.roomNo}호 수납`,
      timeLabel: relativeTime(p.createdAt),
      dotColor:  '#22c55e',
    })
  }

  const dashboardData: DashboardData = {
    totalRevenue,
    paidRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
    totalDeposit,
    paidCount,
    unpaidCount,
    unpaidAmount,
    categoryBreakdown,
    trend,
    totalRooms,
    vacantRooms,
    occupiedRooms: totalRooms - vacantRooms,
    statusCounts: { active: activeCount, reserved: reservedCount, checkout: checkoutCount, nonResident: nonResidentCount },
    totalTenants:    activeTenants.length,
    genderDist:      toDistribution(genderMap),
    nationalityDist: toDistribution(nationalityMap),
    jobDist:         toDistribution(jobMap),
    rooms:           roomsData,
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

  const dashboardData = await getDashboardData(propertyId, targetMonth)

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
      <DashboardClient data={dashboardData} targetMonth={targetMonth} />

    </div>
  )
}
