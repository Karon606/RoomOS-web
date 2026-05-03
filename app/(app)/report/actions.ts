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
// ─────────────────────────────────────────────────────────────────
// AI 영업장 진단
// ─────────────────────────────────────────────────────────────────

export type PropertyDiagnostics = {
  asOfMonth: string                              // "YYYY-MM"
  occupancyRate: number                          // 0~1
  totalRooms: number
  occupiedRooms: number
  vacantRooms: number
  unpaidRate: number                             // 미수율 = 누적 미수 / 누적 청구 (12mo)
  totalUnpaid: number                            // 현재 누적 미수
  avgDaysOverdue: number                         // 미수 lease들의 평균 경과일
  avgStayMonths: number | null                   // 종료된 lease의 평균 거주 개월수
  turnoverPer6mo: number                         // 최근 6개월 퇴실 건수
  trend12mo: { month: string; revenue: number; expense: number; profit: number; occupancy: number }[]
  expenseTopCategories: { category: string; amount: number; percent: number }[]
  rentRange: { min: number; max: number; avg: number }
  scheduledRentChanges: { roomNo: string; from: number; to: number; effectiveDate: string }[]
  reservedConfirmedCount: number
  vacantTooLong: { roomNo: string; vacantSince: string | null }[]   // 30일 이상 공실
}

async function gatherDiagnostics(): Promise<PropertyDiagnostics> {
  const { propertyId } = await getPropertyId()
  const now = new Date()
  const asOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 점유율
  const [totalRooms, occupiedRooms, vacantRooms] = await Promise.all([
    prisma.room.count({ where: { propertyId } }),
    prisma.room.count({ where: { propertyId, isVacant: false } }),
    prisma.room.count({ where: { propertyId, isVacant: true } }),
  ])
  const occupancyRate = totalRooms > 0 ? occupiedRooms / totalRooms : 0

  // 미수율 (최근 12개월)
  const oneYearAgo = new Date(now); oneYearAgo.setMonth(oneYearAgo.getMonth() - 12)
  const trendMonths: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now); d.setMonth(d.getMonth() - i)
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const yearPayments = await prisma.paymentRecord.findMany({
    where: { propertyId, isDeposit: false, targetMonth: { in: trendMonths } },
    select: { targetMonth: true, expectedAmount: true, actualAmount: true },
  })
  const expectedByMonth: Record<string, number> = {}
  const actualByMonth: Record<string, number> = {}
  for (const p of yearPayments) {
    expectedByMonth[p.targetMonth] = (expectedByMonth[p.targetMonth] ?? 0) + p.expectedAmount
    actualByMonth[p.targetMonth]   = (actualByMonth[p.targetMonth]   ?? 0) + p.actualAmount
  }
  const totalExpected = Object.values(expectedByMonth).reduce((s, v) => s + v, 0)
  const totalActual   = Object.values(actualByMonth).reduce((s, v) => s + v, 0)
  const unpaidRate    = totalExpected > 0 ? Math.max(0, totalExpected - totalActual) / totalExpected : 0

  // 현재 미수 (active lease들의 누적 미수)
  const activeLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
    select: {
      id: true, rentAmount: true, dueDay: true, moveInDate: true,
      paymentRecords: { where: { isDeposit: false }, select: { targetMonth: true, actualAmount: true, expectedAmount: true } },
    },
  })
  let totalUnpaid = 0
  let overdueDaysAcc = 0
  let overdueLeaseCount = 0
  for (const l of activeLeases) {
    const expected = l.paymentRecords.reduce((s, p) => s + p.expectedAmount, 0)
    const paid     = l.paymentRecords.reduce((s, p) => s + p.actualAmount, 0)
    const unpaid = expected - paid
    if (unpaid > 0) {
      totalUnpaid += unpaid
      // 첫 미납월 추정 — 단순화: 미납액 / 월 이용료 * 30
      if (l.rentAmount > 0) {
        const days = Math.round((unpaid / l.rentAmount) * 30)
        overdueDaysAcc += days
        overdueLeaseCount++
      }
    }
  }
  const avgDaysOverdue = overdueLeaseCount > 0 ? overdueDaysAcc / overdueLeaseCount : 0

  // 평균 거주기간 (CHECKED_OUT만)
  const closedLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: 'CHECKED_OUT', moveInDate: { not: null }, moveOutDate: { not: null } },
    select: { moveInDate: true, moveOutDate: true },
  })
  let avgStayMonths: number | null = null
  if (closedLeases.length > 0) {
    const total = closedLeases.reduce((s, l) => {
      const days = (new Date(l.moveOutDate!).getTime() - new Date(l.moveInDate!).getTime()) / 86400000
      return s + days / 30
    }, 0)
    avgStayMonths = total / closedLeases.length
  }

  // 6개월 퇴실 건수
  const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const turnoverPer6mo = await prisma.leaseTerm.count({
    where: { propertyId, moveOutDate: { gte: sixMonthsAgo } },
  })

  // 12개월 트렌드
  const trendRevenue = trendMonths.map(m => actualByMonth[m] ?? 0)
  const monthRanges = trendMonths.map(m => {
    const [y, mo] = m.split('-').map(Number)
    return { from: new Date(y, mo - 1, 1), to: new Date(y, mo, 0, 23, 59, 59, 999) }
  })
  const expenses12 = await prisma.expense.findMany({
    where: { propertyId, date: { gte: monthRanges[0].from, lte: monthRanges[11].to } },
    select: { date: true, amount: true, category: true },
  })
  const expenseByMonth: Record<string, number> = {}
  const categoryAcc: Record<string, number> = {}
  for (const e of expenses12) {
    const m = `${new Date(e.date).getFullYear()}-${String(new Date(e.date).getMonth() + 1).padStart(2, '0')}`
    expenseByMonth[m] = (expenseByMonth[m] ?? 0) + e.amount
    categoryAcc[e.category] = (categoryAcc[e.category] ?? 0) + e.amount
  }
  const totalCatExpense = Object.values(categoryAcc).reduce((s, v) => s + v, 0)
  const expenseTopCategories = Object.entries(categoryAcc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount, percent: totalCatExpense > 0 ? (amount / totalCatExpense) * 100 : 0 }))

  const trend12mo = trendMonths.map((m, i) => ({
    month: m,
    revenue: trendRevenue[i],
    expense: expenseByMonth[m] ?? 0,
    profit:  trendRevenue[i] - (expenseByMonth[m] ?? 0),
    occupancy: occupancyRate, // 정확한 월별 점유는 비용 큼 — 현재 점유로 통일
  }))

  // 임대료 분포
  const allActiveRents = await prisma.leaseTerm.findMany({
    where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] }, rentAmount: { gt: 0 } },
    select: { rentAmount: true },
  })
  const rents = allActiveRents.map(r => r.rentAmount)
  const rentRange = rents.length > 0
    ? { min: Math.min(...rents), max: Math.max(...rents), avg: rents.reduce((s, v) => s + v, 0) / rents.length }
    : { min: 0, max: 0, avg: 0 }

  // 예약된 가격 변경
  const scheduled = await prisma.room.findMany({
    where: { propertyId, scheduledRent: { not: null }, rentUpdateDate: { not: null } },
    select: { roomNo: true, baseRent: true, scheduledRent: true, rentUpdateDate: true },
  })
  const scheduledRentChanges = scheduled.map(s => ({
    roomNo: s.roomNo,
    from: s.baseRent,
    to: s.scheduledRent ?? 0,
    effectiveDate: s.rentUpdateDate ? new Date(s.rentUpdateDate).toISOString().slice(0, 10) : '',
  }))

  // 예약 확정자 수
  const reservedConfirmedCount = await prisma.leaseTerm.count({
    where: { propertyId, status: 'RESERVED', reservationConfirmedAt: { not: null } },
  })

  // 30일 이상 공실인 호실
  const thirtyAgo = new Date(now); thirtyAgo.setDate(thirtyAgo.getDate() - 30)
  const longVacantRooms = await prisma.room.findMany({
    where: { propertyId, isVacant: true },
    select: {
      roomNo: true,
      leaseTerms: {
        where: { status: 'CHECKED_OUT' },
        orderBy: { moveOutDate: 'desc' },
        take: 1,
        select: { moveOutDate: true },
      },
    },
  })
  const vacantTooLong = longVacantRooms
    .filter(r => {
      const last = r.leaseTerms[0]?.moveOutDate
      if (!last) return false
      return new Date(last) < thirtyAgo
    })
    .map(r => ({
      roomNo: r.roomNo,
      vacantSince: r.leaseTerms[0]?.moveOutDate ? new Date(r.leaseTerms[0].moveOutDate!).toISOString().slice(0, 10) : null,
    }))

  return {
    asOfMonth,
    occupancyRate, totalRooms, occupiedRooms, vacantRooms,
    unpaidRate, totalUnpaid, avgDaysOverdue,
    avgStayMonths, turnoverPer6mo,
    trend12mo,
    expenseTopCategories,
    rentRange,
    scheduledRentChanges,
    reservedConfirmedCount,
    vacantTooLong,
  }
}

export async function getPropertyDiagnostics(): Promise<PropertyDiagnostics> {
  return gatherDiagnostics()
}

export async function analyzePropertyWithGemini(): Promise<{ ok: true; text: string; data: PropertyDiagnostics } | { ok: false; error: string }> {
  try {
    const data = await gatherDiagnostics()

    const trendLines = data.trend12mo.map(t =>
      `  - ${t.month}: 매출 ${t.revenue.toLocaleString()}원 / 지출 ${t.expense.toLocaleString()}원 / 순이익 ${t.profit.toLocaleString()}원`
    ).join('\n')

    const catLines = data.expenseTopCategories.map(c =>
      `  - ${c.category}: ${c.amount.toLocaleString()}원 (${c.percent.toFixed(1)}%)`
    ).join('\n')

    const scheduledLines = data.scheduledRentChanges.length > 0
      ? data.scheduledRentChanges.map(s => `  - ${s.roomNo}호: ${s.from.toLocaleString()}원 → ${s.to.toLocaleString()}원 (${s.effectiveDate})`).join('\n')
      : '  없음'

    const longVacantLines = data.vacantTooLong.length > 0
      ? data.vacantTooLong.map(v => `  - ${v.roomNo}호 (마지막 퇴실: ${v.vacantSince ?? '미상'})`).join('\n')
      : '  없음'

    const prompt = `당신은 한국의 공간 대여(고시원/셰어하우스) 운영 전문 컨설턴트 AI입니다. 아래 영업장 진단 데이터를 바탕으로 한국어로 진단 결과를 작성해주세요.

[영업장 현황 (${data.asOfMonth} 기준)]
- 객실: 총 ${data.totalRooms}실 / 거주중 ${data.occupiedRooms}실 / 공실 ${data.vacantRooms}실 (점유율 ${(data.occupancyRate * 100).toFixed(1)}%)
- 임대료: 평균 ${Math.round(data.rentRange.avg).toLocaleString()}원 / 최저 ${data.rentRange.min.toLocaleString()}원 / 최고 ${data.rentRange.max.toLocaleString()}원
- 예약 확정자: ${data.reservedConfirmedCount}명

[수납 건전성]
- 최근 12개월 미수율: ${(data.unpaidRate * 100).toFixed(1)}%
- 현재 누적 미수: ${data.totalUnpaid.toLocaleString()}원
- 미수 입주자 평균 경과일: ${Math.round(data.avgDaysOverdue)}일

[입주자 회전]
- 최근 6개월 퇴실 건수: ${data.turnoverPer6mo}건
- 평균 거주기간: ${data.avgStayMonths != null ? data.avgStayMonths.toFixed(1) + '개월' : '데이터 부족'}
- 30일 이상 공실 호실:
${longVacantLines}

[12개월 매출/지출 추이]
${trendLines}

[지출 비중 Top 5]
${catLines}

[예약된 가격 변경]
${scheduledLines}

다음 형식으로 작성해주세요 (각 항목 1~2문장씩, 구체적 숫자 인용):
1. **종합 진단**: 현재 영업장의 전반적 상태
2. **잘하고 있는 점**: 데이터로 보이는 강점 1~2개
3. **개선이 필요한 점**: 우선 해결해야 할 약점 1~2개
4. **실행 제안**: 향후 30일 내 시도해볼 구체 액션 2~3개`

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
        }),
      }
    )

    if (!res.ok) return { ok: false, error: `Gemini API 응답 실패 (${res.status})` }
    const json = await res.json()
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 분석 결과를 가져올 수 없습니다.' }
    return { ok: true, text, data }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

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
