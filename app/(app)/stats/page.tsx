import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import type { DashboardData } from '../dashboard/DashboardClient'
import StatsClient from './StatsClient'

function getLast6Months(targetMonth: string): string[] {
  const [year, month] = targetMonth.split('-').map(Number)
  const result: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

async function getStatsData(propertyId: string, targetMonth: string): Promise<DashboardData> {
  const [year, month] = targetMonth.split('-').map(Number)
  const startDate = new Date(year, month - 1, 1)
  const endDate   = new Date(year, month, 0)

  const last6Months = getLast6Months(targetMonth)
  const [tyear, tmonth] = last6Months[0].split('-').map(Number)
  const trendStartDate  = new Date(tyear, tmonth - 1, 1)

  const [
    activeLeases,
    payments,
    expenses,
    incomes,
    totalRooms,
    vacantRooms,
    depositAgg,
    expByCategory,
    trendPayments,
    trendExpenses,
    trendIncomes,
    activeCount,
    reservedCount,
    checkoutCount,
    nonResidentCount,
    activeTenants,
  ] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      select: { id: true, rentAmount: true },
    }),
    prisma.paymentRecord.findMany({
      where: { propertyId, targetMonth },
      select: { leaseTermId: true, actualAmount: true },
    }),
    prisma.expense.findMany({ where: { propertyId, date: { gte: startDate, lte: endDate } } }),
    prisma.extraIncome.findMany({ where: { propertyId, date: { gte: startDate, lte: endDate } } }),
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
    prisma.tenant.findMany({
      where: {
        propertyId,
        leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } } },
      },
      select: { gender: true, nationality: true, job: true },
    }),
  ])

  const activeLeaseIds = new Set(activeLeases.map(l => l.id))
  const paidRevenue    = payments.filter(p => activeLeaseIds.has(p.leaseTermId)).reduce((s, p) => s + p.actualAmount, 0)
  const extraRevenue   = incomes.reduce((s, i) => s + i.amount, 0)
  const totalRevenue   = paidRevenue + extraRevenue
  const totalExpense   = expenses.reduce((s, e) => s + e.amount, 0)
  const totalDeposit   = depositAgg._sum.depositAmount ?? 0

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

  const trend = last6Months.map(m => {
    const [y, mo] = m.split('-').map(Number)
    const mStart  = new Date(y, mo - 1, 1); const mEnd = new Date(y, mo, 0)
    const revenue =
      trendPayments.filter(p => p.targetMonth === m).reduce((s, p) => s + p.actualAmount, 0) +
      trendIncomes.filter(i => new Date(i.date) >= mStart && new Date(i.date) <= mEnd).reduce((s, i) => s + i.amount, 0)
    const expense = trendExpenses.filter(e => new Date(e.date) >= mStart && new Date(e.date) <= mEnd).reduce((s, e) => s + e.amount, 0)
    return { month: m, revenue, expense, profit: revenue - expense }
  })

  function toDistribution(map: Record<string, number>) {
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({
      label, count, percent: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
  }

  const genderMap: Record<string, number> = {}
  const nationalityMap: Record<string, number> = {}
  const jobMap: Record<string, number> = {}
  activeTenants.forEach(t => {
    genderMap[t.gender] = (genderMap[t.gender] ?? 0) + 1
    const nat = t.nationality?.trim() || '미기재'
    nationalityMap[nat] = (nationalityMap[nat] ?? 0) + 1
    const job = t.job?.trim() || '미기재'
    jobMap[job] = (jobMap[job] ?? 0) + 1
  })

  return {
    totalRevenue, paidRevenue, totalExpense,
    netProfit: totalRevenue - totalExpense,
    totalDeposit, paidCount, unpaidCount, unpaidAmount: 0,
    categoryBreakdown, trend,
    totalRooms, vacantRooms, occupiedRooms: totalRooms - vacantRooms,
    statusCounts: { active: activeCount, reserved: reservedCount, checkout: checkoutCount, nonResident: nonResidentCount },
    totalTenants: activeTenants.length,
    genderDist:      toDistribution(genderMap),
    nationalityDist: toDistribution(nationalityMap),
    jobDist:         toDistribution(jobMap),
    rooms: [], activity: [], unpaidLeases: [],
  }
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')

  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const data = await getStatsData(propertyId, targetMonth)

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold" style={{ color: 'var(--warm-dark)' }}>통계·리포트</h1>
      <StatsClient data={data} targetMonth={targetMonth} />
    </div>
  )
}
