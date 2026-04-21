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

function formatKoreanDate(date: Date | string): string {
  const d = new Date(date)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
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
    // 입실예정 알림 (RESERVED + moveInDate)
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
    // 퇴실예정 알림 (CHECKOUT_PENDING + expectedMoveOut)
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
    // 6개월 트렌드 벌크 조회
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
    // 입주자 분포 (성별/국적/직업) — NON_RESIDENT 포함
    prisma.tenant.findMany({
      where: {
        propertyId,
        leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } } },
      },
      select: { gender: true, nationality: true, job: true },
    }),
    // 희망 이동 호실 알림용 — 현재 공실 목록
    prisma.room.findMany({
      where: { propertyId, isVacant: true },
      select: { roomNo: true },
    }),
    // 희망 이동 호실이 있는 활성 계약
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
  ])

  // ── 이달 집계 ────────────────────────────────────────────────
  // active 계약 기준으로만 수납액 집계 (해지된 계약 제외)
  const activeLeaseIds = new Set(activeLeases.map(l => l.id))
  const paidRevenue    = payments
    .filter(p => activeLeaseIds.has(p.leaseTermId))
    .reduce((s, p) => s + p.actualAmount, 0)
  const extraRevenue = incomes.reduce((s, i) => s + i.amount, 0)
  const totalRevenue = paidRevenue + extraRevenue
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const totalDeposit = depositAgg._sum.depositAmount ?? 0

  // 완납 판단: 입주자별로 이달 납부 합계 >= 이용료 (rentAmount > 0인 청구 대상만)
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

  // ── 알림 목록 ────────────────────────────────────────────────
  const vacantRoomNos = new Set(vacantRoomList.map(r => r.roomNo))

  // 희망 이동 호실이 현재 공실인 경우 알림 생성
  const wishRoomAlerts = wishRoomLeases.flatMap(l => {
    const wished = (l.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
    return wished
      .filter(no => vacantRoomNos.has(no))
      .map(no => ({
        type:       'wish_room' as const,
        tenantName: l.tenant.name,
        roomNo:     no,
        dateStr:    `${l.room.roomNo}호 거주 중`,
        days:       0,
      }))
  })

  const alerts = [
    ...moveInLeases.map(l => ({
      type:       'move_in' as const,
      tenantName: l.tenant.name,
      roomNo:     l.room.roomNo,
      dateStr:    formatKoreanDate(l.moveInDate!),
      days:       daysUntil(l.moveInDate!),
    })),
    ...moveOutLeases.map(l => ({
      type:       'move_out' as const,
      tenantName: l.tenant.name,
      roomNo:     l.room.roomNo,
      dateStr:    formatKoreanDate(l.expectedMoveOut!),
      days:       daysUntil(l.expectedMoveOut!),
    })),
    ...wishRoomAlerts,
  ].sort((a, b) => a.days - b.days)

  // ── 6개월 트렌드 인메모리 계산 ──────────────────────────────
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

  // ── 입주자 분포 계산 ─────────────────────────────────────────
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

  const dashboardData: DashboardData = {
    totalRevenue,
    paidRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
    totalDeposit,
    paidCount,
    unpaidCount,
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
  }

  return { dashboardData, alerts }
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

  const { dashboardData, alerts } = await getDashboardData(propertyId, targetMonth)

  return (
    <div className="space-y-6">

      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">{property?.name}</h1>
        <Suspense fallback={null}>
          <DataButtons />
        </Suspense>
      </div>

      {/* ── 알림 (탭보다 위) ───────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--warm-border)] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            <p className="text-xs font-semibold text-[var(--warm-mid)] uppercase tracking-wider">
              알림 {alerts.length}건
            </p>
          </div>
          <div className="divide-y divide-gray-800/60">
            {alerts.map((a, i) => {
              const isWishRoom = a.type === 'wish_room'
              const isMoveIn   = a.type === 'move_in'
              const isOverdue  = a.days < 0
              const isToday    = a.days === 0
              const isUrgent   = a.days > 0 && a.days <= 7

              const typeColor = isWishRoom ? 'text-purple-400'
                : isMoveIn   ? 'text-blue-400'
                : 'text-red-400'
              const typeBg = isWishRoom ? 'bg-purple-500/10'
                : isMoveIn  ? 'bg-blue-500/10'
                : 'bg-red-500/10'
              const typeLabel = isWishRoom ? '희망호실 공실'
                : isMoveIn   ? '입실 예정'
                : '퇴실 예정'

              const dayLabel = isWishRoom ? '' : isOverdue ? `${Math.abs(a.days)}일 초과`
                : isToday    ? '오늘'
                : `${a.days}일 후`
              const dayColor = isOverdue  ? 'text-red-400 font-bold'
                : isToday    ? 'text-orange-400 font-bold'
                : isUrgent   ? 'text-orange-300 font-semibold'
                : 'text-[var(--warm-muted)]'

              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  {/* 유형 뱃지 */}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 ${typeBg} ${typeColor}`}>
                    {typeLabel}
                  </span>

                  {/* 호실 + 이름 */}
                  <span className="text-sm text-[var(--warm-dark)] font-medium shrink-0">
                    {isWishRoom
                      ? <>{a.tenantName}님 → {a.roomNo}호</>
                      : <>{a.roomNo}호&nbsp;{a.tenantName}</>
                    }
                  </span>

                  {/* 구분선 */}
                  <span className="text-gray-700 shrink-0">|</span>

                  {/* 날짜/설명 */}
                  <span className="text-sm text-[var(--warm-mid)] shrink-0">{a.dateStr}</span>

                  {/* D-day */}
                  {dayLabel && (
                    <span className={`ml-auto text-sm shrink-0 ${dayColor}`}>{dayLabel}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 탭 + 내용 (클라이언트) ─────────────────────────────── */}
      <DashboardClient data={dashboardData} targetMonth={targetMonth} />

    </div>
  )
}
