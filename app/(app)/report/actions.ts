'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { kstMonthStr } from '@/lib/kstDate'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { user, propertyId }
}

export type MonthlyRow = {
  month: string         // "YYYY-MM"
  revenue: number       // 발생주의 매출 (paymentRecord.actualAmount, targetMonth = 해당 월)
  extraIncome: number   // 기타수익 (date 기준)
  expense: number       // 지출 (date 기준)
  profit: number        // (revenue + extraIncome) - expense
  unpaidAmount: number  // 그 월말 시점 누적 미수금
}

export type AnnualSummary = {
  year: string
  rows: MonthlyRow[]
  totalRevenue: number
  totalExtraIncome: number
  totalExpense: number
  totalProfit: number
  endingUnpaid: number
  expenseByCategory: { category: string; amount: number; percent: number }[]
  prevYear?: {
    rows: MonthlyRow[]
    totalRevenue: number
    totalProfit: number
  }
}

export async function getAnnualReport(year: string, includePrev = true): Promise<AnnualSummary> {
  const { propertyId } = await getPropertyId()
  const yearNum = parseInt(year, 10)
  if (isNaN(yearNum)) throw new Error('잘못된 연도')

  const yearStart = new Date(yearNum, 0, 1)
  const yearEnd = new Date(yearNum, 11, 31, 23, 59, 59, 999)

  const months = Array.from({ length: 12 }, (_, i) => `${yearNum}-${String(i + 1).padStart(2, '0')}`)

  // 양도인 cutoff 처리
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const cutoffRaw = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const cutoffDate = cutoffRaw ? new Date(cutoffRaw) : null

  // 발생주의 매출 — targetMonth 기준 (payDate는 양도인 cutoff 판정용)
  const payments = await prisma.paymentRecord.findMany({
    where: {
      propertyId,
      isDeposit: false,
      targetMonth: { in: months },
    },
    select: { targetMonth: true, actualAmount: true, leaseTermId: true, payDate: true },
  })

  // lease별 임대료 맵 — 매출 계산 시 임대료 상한 적용 (선납 과입금분 매출 미포함)
  const allLeases = await prisma.leaseTerm.findMany({
    where: { propertyId },
    select: { id: true, rentAmount: true },
  })
  const rentMap = new Map(allLeases.map(l => [l.id, l.rentAmount]))

  // 월별 × lease별 받은 금액 (양도인 cutoff 이전 record 제외)
  const receivedByMonthLease: Record<string, Record<string, number>> = {}
  for (const m of months) receivedByMonthLease[m] = {}
  for (const p of payments) {
    if (cutoffDate && new Date(p.payDate) < cutoffDate) continue
    const map = receivedByMonthLease[p.targetMonth]
    if (!map) continue
    map[p.leaseTermId] = (map[p.leaseTermId] ?? 0) + p.actualAmount
  }

  // 매출 = sum( min(받은 금액, 임대료) ) — dashboard와 동일 로직
  const revenueByMonth: Record<string, number> = {}
  for (const m of months) {
    let total = 0
    for (const [leaseId, received] of Object.entries(receivedByMonthLease[m])) {
      const rent = rentMap.get(leaseId) ?? 0
      total += Math.min(received, rent)
    }
    revenueByMonth[m] = total
  }

  // 지출 / 기타수익 — 발생일(date) 기준
  const [expenses, incomes] = await Promise.all([
    prisma.expense.findMany({
      where: { propertyId, date: { gte: yearStart, lte: yearEnd } },
      select: { date: true, amount: true, category: true },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: { gte: yearStart, lte: yearEnd } },
      select: { date: true, amount: true },
    }),
  ])

  const expenseByMonth: Record<string, number> = {}
  for (const e of expenses) {
    const d = new Date(e.date)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    expenseByMonth[m] = (expenseByMonth[m] ?? 0) + e.amount
  }
  const extraByMonth: Record<string, number> = {}
  for (const i of incomes) {
    const d = new Date(i.date)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    extraByMonth[m] = (extraByMonth[m] ?? 0) + i.amount
  }

  // 청구 가능 lease 정보
  const leases = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'CHECKED_OUT'] },
      rentAmount: { gt: 0 },
    },
    select: {
      id: true, rentAmount: true, dueDay: true,
      moveInDate: true, expectedMoveOut: true, moveOutDate: true,
      overrideDueDay: true, overrideDueDayMonth: true,
    },
  })

  // 월말 시점 누적 미수 계산
  const cutoffMonthStr = cutoffDate
    ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay = cutoffDate ? cutoffDate.getDate() : 0

  // 월말 누적 미수 계산용 — viewMonth 이하 targetMonth로 인식된 매출 lease별 누적
  const receivedByLeaseUntilMonth: Record<string, Record<string, number>> = {}
  for (const m of months) receivedByLeaseUntilMonth[m] = {}
  for (const p of payments) {
    if (cutoffDate && new Date(p.payDate) < cutoffDate) continue
    for (const m of months) {
      if (p.targetMonth <= m) {
        receivedByLeaseUntilMonth[m][p.leaseTermId] = (receivedByLeaseUntilMonth[m][p.leaseTermId] ?? 0) + p.actualAmount
      }
    }
  }

  const monthRange = (from: string, to: string): string[] => {
    const out: string[] = []
    const [fy, fm] = from.split('-').map(Number)
    const [ty, tm] = to.split('-').map(Number)
    let y = fy, mn = fm
    while (y < ty || (y === ty && mn <= tm)) {
      out.push(`${y}-${String(mn).padStart(2, '0')}`)
      mn++; if (mn > 12) { mn = 1; y++ }
    }
    return out
  }

  const todayMonth = kstMonthStr()

  const unpaidByMonth: Record<string, number> = {}
  for (const month of months) {
    // 아직 도래하지 않은 미래 월은 청구 자체가 발생 X → 미수 0
    if (month > todayMonth) {
      unpaidByMonth[month] = 0
      continue
    }
    let total = 0
    for (const l of leases) {
      const lMoveIn = l.moveInDate ? new Date(l.moveInDate) : null
      const leaseStartMonth = lMoveIn
        ? `${lMoveIn.getFullYear()}-${String(lMoveIn.getMonth() + 1).padStart(2, '0')}`
        : (cutoffMonthStr ?? month)
      const firstMonth = cutoffMonthStr && leaseStartMonth < cutoffMonthStr ? cutoffMonthStr : leaseStartMonth
      if (firstMonth > month) continue

      const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : (l.moveOutDate ? new Date(l.moveOutDate) : null)
      const moveOutMonth = moveOut
        ? `${moveOut.getFullYear()}-${String(moveOut.getMonth() + 1).padStart(2, '0')}`
        : null

      const effDueDay = (l.overrideDueDayMonth === firstMonth && l.overrideDueDay)
        ? l.overrideDueDay
        : l.dueDay
      const dueDayNum = parseInt(effDueDay ?? '99')
      const acqMonthDueBeforeCutoff =
        !!(cutoffMonthStr && firstMonth === cutoffMonthStr && !isNaN(dueDayNum) && dueDayNum < cutoffDay)

      const ms = monthRange(firstMonth, month)
      let billable = 0
      for (const mn of ms) {
        if (mn === cutoffMonthStr && acqMonthDueBeforeCutoff) continue
        if (moveOutMonth && mn > moveOutMonth) continue
        billable++
      }
      const expected = billable * l.rentAmount
      const received = receivedByLeaseUntilMonth[month][l.id] ?? 0
      total += Math.max(0, expected - received)
    }
    unpaidByMonth[month] = total
  }

  const rows: MonthlyRow[] = months.map(m => {
    const revenue = revenueByMonth[m] ?? 0
    const extraIncome = extraByMonth[m] ?? 0
    const expense = expenseByMonth[m] ?? 0
    return {
      month: m,
      revenue,
      extraIncome,
      expense,
      profit: revenue + extraIncome - expense,
      unpaidAmount: unpaidByMonth[m] ?? 0,
    }
  })

  // endingUnpaid — 현재 연도면 오늘 월 기준, 과거 연도면 12월 기준
  const endingUnpaid = year === todayMonth.slice(0, 4)
    ? (unpaidByMonth[todayMonth] ?? 0)
    : (unpaidByMonth[months[months.length - 1]] ?? 0)

  // 카테고리별 지출 합계 (연간)
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const catMap = new Map<string, number>()
  for (const e of expenses) {
    const c = e.category || '미분류'
    catMap.set(c, (catMap.get(c) ?? 0) + e.amount)
  }
  const expenseByCategory = Array.from(catMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percent: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  // 전년도 데이터 (재귀 방지를 위해 includePrev=false로 호출)
  let prevYear: AnnualSummary['prevYear']
  if (includePrev) {
    const prev = await getAnnualReport(String(yearNum - 1), false)
    prevYear = {
      rows: prev.rows,
      totalRevenue: prev.totalRevenue,
      totalProfit: prev.totalProfit,
    }
  }

  return {
    year,
    rows,
    totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    totalExtraIncome: rows.reduce((s, r) => s + r.extraIncome, 0),
    totalExpense: rows.reduce((s, r) => s + r.expense, 0),
    totalProfit: rows.reduce((s, r) => s + r.profit, 0),
    endingUnpaid,
    expenseByCategory,
    prevYear,
  }
}

// ── 예상(forecast) 보고서 ─────────────────────────────────────────

export type ForecastRow = {
  month: string                  // "YYYY-MM"
  expectedRevenue: number        // 호실별 점유·임대료 변동 반영
  expectedExtraIncome: number    // 전년 동월 또는 최근 3개월 평균
  expectedExpense: number        // 전년 동월 또는 최근 3개월 평균
  expectedProfit: number
  occupiedRooms: number
  vacantRooms: number
}

export type ForecastSummary = {
  rows: ForecastRow[]
  totalRevenue: number
  totalExpense: number
  totalProfit: number
}

export async function getForecastReport(monthsAhead = 6): Promise<ForecastSummary> {
  const { propertyId } = await getPropertyId()
  const today = new Date()
  const startY = today.getFullYear()
  const startM = today.getMonth() + 1

  // 대상 월 리스트
  const months: string[] = []
  let cy = startY, cmn = startM
  for (let i = 0; i < monthsAhead; i++) {
    months.push(`${cy}-${String(cmn).padStart(2, '0')}`)
    cmn++; if (cmn > 12) { cmn = 1; cy++ }
  }

  // 1) 호실별 baseRent + scheduledRent + 적용 예정일
  const [rooms, property] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      select: {
        id: true, baseRent: true, scheduledRent: true, rentUpdateDate: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          select: {
            id: true, status: true, rentAmount: true,
            moveInDate: true, expectedMoveOut: true, moveOutDate: true,
          },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { acquisitionDate: true, prevOwnerCutoffDate: true },
    }),
  ])
  // 인수월(이 월부터 사용자 데이터). 그 이전은 평균 계산에서 제외해 0 데이터로 인한 왜곡 방지
  const acqRaw = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const acquisitionMonthStr = acqRaw
    ? `${new Date(acqRaw).getFullYear()}-${String(new Date(acqRaw).getMonth() + 1).padStart(2, '0')}`
    : null

  // 2) 전년 동월 + 최근 3개월 — 지출/기타수익 평균 산출용
  const last3Months: string[] = (() => {
    const arr: string[] = []
    let y = startY, m = startM - 1
    if (m < 1) { m = 12; y-- }
    for (let i = 0; i < 3; i++) {
      arr.push(`${y}-${String(m).padStart(2, '0')}`)
      m--; if (m < 1) { m = 12; y-- }
    }
    return arr
  })()
  const last3Start = new Date(startY, startM - 4, 1)
  const last3End = new Date(startY, startM - 1, 0); last3End.setHours(23, 59, 59, 999)

  // 전년 1년치 + 최근 3개월
  const yearBackStart = new Date(startY - 1, startM - 1, 1)
  const yearBackEnd = new Date(startY, startM + monthsAhead - 1, 0); yearBackEnd.setHours(23, 59, 59, 999)

  const [historicalExpenses, historicalIncomes] = await Promise.all([
    prisma.expense.findMany({
      where: {
        propertyId,
        date: { gte: yearBackStart, lte: yearBackEnd },
      },
      select: { date: true, amount: true },
    }),
    prisma.extraIncome.findMany({
      where: {
        propertyId,
        date: { gte: yearBackStart, lte: yearBackEnd },
      },
      select: { date: true, amount: true },
    }),
  ])

  const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const expByMonth: Record<string, number> = {}
  for (const e of historicalExpenses) {
    const k = monthKeyOf(new Date(e.date))
    expByMonth[k] = (expByMonth[k] ?? 0) + e.amount
  }
  const incByMonth: Record<string, number> = {}
  for (const i of historicalIncomes) {
    const k = monthKeyOf(new Date(i.date))
    incByMonth[k] = (incByMonth[k] ?? 0) + i.amount
  }

  // 인수 전 월(데이터 없는 0)은 평균 계산에서 제외 — 분모도 그만큼 줄어듦
  const validAvgMonths = acquisitionMonthStr
    ? last3Months.filter(m => m >= acquisitionMonthStr)
    : last3Months
  const last3ExpAvg = validAvgMonths.length > 0
    ? Math.round(validAvgMonths.reduce((s, m) => s + (expByMonth[m] ?? 0), 0) / validAvgMonths.length)
    : 0
  const last3IncAvg = validAvgMonths.length > 0
    ? Math.round(validAvgMonths.reduce((s, m) => s + (incByMonth[m] ?? 0), 0) / validAvgMonths.length)
    : 0

  const prevYearKey = (m: string): string => {
    const [y, mn] = m.split('-').map(Number)
    return `${y - 1}-${String(mn).padStart(2, '0')}`
  }
  // 전년 동월 데이터 사용 가능 여부 — 인수월 이전이면 데이터 없으므로 폴백
  const isPrevYearAvailable = (m: string) =>
    !acquisitionMonthStr || m >= acquisitionMonthStr

  // 3) 월별 예상 매출 — 호실별 점유 여부 + 임대료 변동 반영
  const rows: ForecastRow[] = months.map(month => {
    const [my, mm] = month.split('-').map(Number)
    const monthStart = new Date(my, mm - 1, 1)
    const monthEnd = new Date(my, mm, 0); monthEnd.setHours(23, 59, 59, 999)

    let revenue = 0
    let occupied = 0
    let vacant = 0
    for (const r of rooms) {
      // 임대료: scheduledRent 적용 예정일이 이 월 이전이면 scheduledRent, 아니면 baseRent
      let rent = r.baseRent
      if (r.scheduledRent != null && r.rentUpdateDate) {
        const updateDate = new Date(r.rentUpdateDate)
        if (updateDate <= monthEnd) rent = r.scheduledRent
      }
      // 그 월에 점유될 lease가 하나라도 있는지
      const occLease = r.leaseTerms.find(l => {
        const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
        const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut)
          : (l.moveOutDate ? new Date(l.moveOutDate) : null)
        // 입주 전이면 X
        if (moveIn && moveIn > monthEnd) return false
        // 퇴실 후면 X
        if (moveOut && moveOut < monthStart) return false
        return true
      })
      if (occLease) {
        // 가격 인상 예정(scheduledRent + rentUpdateDate)이 있으면 그 월의 호실 임대료(rent) 사용.
        // lease.rentAmount는 계약 시점 금액이라 미래 인상이 반영 안 되어 있음 — 무시.
        revenue += rent
        occupied++
      } else {
        vacant++
      }
    }

    // 지출: 전년 동월(인수월 이후만 신뢰) → 없으면 인수 후 최근 3개월 평균
    const pyKey = prevYearKey(month)
    const py = isPrevYearAvailable(pyKey) ? expByMonth[pyKey] : undefined
    const expectedExpense = py != null && py > 0 ? py : last3ExpAvg

    // 기타수익: 동일 규칙
    const pyInc = isPrevYearAvailable(pyKey) ? incByMonth[pyKey] : undefined
    const expectedExtraIncome = pyInc != null && pyInc > 0 ? pyInc : last3IncAvg

    return {
      month,
      expectedRevenue: revenue,
      expectedExtraIncome,
      expectedExpense,
      expectedProfit: revenue + expectedExtraIncome - expectedExpense,
      occupiedRooms: occupied,
      vacantRooms: vacant,
    }
  })

  return {
    rows,
    totalRevenue: rows.reduce((s, r) => s + r.expectedRevenue, 0),
    totalExpense: rows.reduce((s, r) => s + r.expectedExpense, 0),
    totalProfit: rows.reduce((s, r) => s + r.expectedProfit, 0),
  }
}

// 사용 가능한 연도 목록 (paymentRecord 또는 expense 기반)
export async function getAvailableYears(): Promise<string[]> {
  const { propertyId } = await getPropertyId()
  const [pmtMonths, exps, incs] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { propertyId, isDeposit: false },
      select: { targetMonth: true },
      distinct: ['targetMonth'],
    }),
    prisma.expense.findMany({ where: { propertyId }, select: { date: true } }),
    prisma.extraIncome.findMany({ where: { propertyId }, select: { date: true } }),
  ])
  const years = new Set<string>()
  for (const p of pmtMonths) years.add(p.targetMonth.slice(0, 4))
  for (const e of exps) years.add(String(new Date(e.date).getFullYear()))
  for (const i of incs) years.add(String(new Date(i.date).getFullYear()))
  const arr = Array.from(years).sort((a, b) => Number(b) - Number(a))
  if (arr.length === 0) arr.push(String(new Date().getFullYear()))
  return arr
}
