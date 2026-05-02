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
      select: { date: true, amount: true },
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
    prevYear,
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
