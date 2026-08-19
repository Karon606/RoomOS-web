'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { unpaidForLease } from '@/lib/billing'
import { dueDayForCutoff } from '@/lib/dueDate'
import { redirect } from 'next/navigation'
import { dbDateMonthKey, kstMonthStr, monthsDbRange, yearDbRange } from '@/lib/kstDate'
import { discountedRent } from '@/lib/rentDiscount'
import { billForLeaseMonth, isCheckoutNoBillingMonthFor, resolveDueDateForMonth, monthOfDate } from '@/lib/billing'
import { BILLABLE_STATUSES, getCheckedOutRecognizedRevenue } from '@/lib/leaseStatus'
import { vacancyExcludedWhere, isVacancyExcluded } from '@/lib/vacancy'
import { shiftMonth } from '@/lib/moveCalendar'

async function getPropertyId() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId }
}

export type MonthlyRow = {
  month: string         // "YYYY-MM"
  billedAmount: number  // 그 달 발생 청구액 (미수 루프와 동일 스코프, billForLeaseMonth 합)
  revenue: number       // 발생주의 매출 (paymentRecord.actualAmount, targetMonth = 해당 월)
  extraIncome: number   // 기타수익 (date 기준)
  expense: number       // 지출 (date 기준)
  profit: number        // (revenue + extraIncome) - expense
  unpaidAmount: number  // 그 월말 시점 누적 미수금
}

export type AnnualSummary = {
  year: string
  rows: MonthlyRow[]
  totalBilled: number
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

  // 한 해 창 — lib/kstDate 정본. 로컬 자정으로 잡던 시절엔 KST 기기에서 창이 하루 밀려
  // 12/31 지출이 그 해 보고서에서 빠지고 전년 12/31 이 딸려 들어왔다.
  const yearWindow = yearDbRange(yearNum)

  const months = Array.from({ length: 12 }, (_, i) => `${yearNum}-${String(i + 1).padStart(2, '0')}`)

  // 양도인 cutoff 처리
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const cutoffRaw = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const cutoffDate = cutoffRaw ? new Date(cutoffRaw) : null

  // 발생주의 매출 + 누적 미수 공용 결제 조회 — 그 해 12월까지 전 기간(targetMonth <= 마지막 월).
  // 미수는 전년부터 거주한 lease 의 기수납까지 반영해야 하므로 그 해 월만이 아닌 전 기간을 가져온다.
  // (payDate 는 양도인 cutoff 판정용) deletedAt 은 소프트삭제 익스텐션이 top-level 조회에 자동 주입 —
  // where 에 deletedAt 키를 넣지 말 것(넣으면 자동 필터가 꺼짐), include/select 중첩도 피한다.
  const lastMonth = months[months.length - 1]
  const payments = await prisma.paymentRecord.findMany({
    where: {
      propertyId,
      isDeposit: false,
      targetMonth: { lte: lastMonth },
    },
    select: { targetMonth: true, actualAmount: true, expectedAmount: true, leaseTermId: true, payDate: true, isPrevOwner: true },
  })

  // 양도인 정산(isPrevOwner) record가 있는 (lease, month) — 그 월은 양도인 몫이므로 청구·매출 제외
  const prevOwnerMonthsByLease: Record<string, Set<string>> = {}
  for (const p of payments) {
    if (!p.isPrevOwner) continue
    ;(prevOwnerMonthsByLease[p.leaseTermId] ??= new Set()).add(p.targetMonth)
  }

  // 청구 대상 lease — 미수(5종 상태) 계산용. billForLeaseMonth 인자(일할·락인·할인·예약 인상)를 함께 조회.
  const leases = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'CHECKED_OUT'] },
      rentAmount: { gt: 0 },
    },
    select: {
      id: true, status: true, rentAmount: true, isShortTerm: true, dueDay: true,
      moveInDate: true, expectedMoveOut: true, moveOutDate: true,
      overrideDueDay: true, overrideDueDayMonth: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    },
  })

  // 매출 인식 lease 범위 — BILLABLE(ACTIVE/CHECKOUT_PENDING/NON_RESIDENT) + CHECKED_OUT.
  // RESERVED(선수납)·CANCELLED(취소 계약 수취액)는 매출에서 제외 (dashboard 와 통일).
  const revenueStatuses = new Set<string>([...BILLABLE_STATUSES, 'CHECKED_OUT'])
  const rentMap = new Map(leases.filter(l => revenueStatuses.has(l.status)).map(l => [l.id, l.rentAmount]))

  // 월별 × lease별 받은 금액 (양도인 cutoff 이전 record 제외)
  const receivedByMonthLease: Record<string, Record<string, number>> = {}
  for (const m of months) receivedByMonthLease[m] = {}
  for (const p of payments) {
    if (p.isPrevOwner) continue
    if (cutoffDate && new Date(p.payDate) < cutoffDate) continue
    const map = receivedByMonthLease[p.targetMonth]
    if (!map) continue
    map[p.leaseTermId] = (map[p.leaseTermId] ?? 0) + p.actualAmount
  }

  // [저장 청구액 우선] 락인 맵 — (lease, month)별 record 최대 expectedAmount. 월세 변경 과거 소급 방지.
  const lockedExpectedByLeaseMonth: Record<string, Map<string, number>> = {}
  for (const p of payments) {
    if (p.isPrevOwner) continue
    const m = (lockedExpectedByLeaseMonth[p.leaseTermId] ??= new Map())
    const cur = m.get(p.targetMonth) ?? 0
    if (p.expectedAmount > cur) m.set(p.targetMonth, p.expectedAmount)
  }

  // 매출 = sum( min(받은 금액, 그 달 청구액) ) — 캡은 원가가 아니라 청구 정본이어야 한다.
  // 원가로 캡하면 할인 계약에 정가가 입금되거나 퇴실 일할월·인상 적용월에 매출이 과대/과소가 된다(A페이즈).
  const leaseById = new Map(leases.map(l => [l.id, l]))
  const revenueByMonth: Record<string, number> = {}
  for (const m of months) {
    let total = 0
    for (const [leaseId, received] of Object.entries(receivedByMonthLease[m])) {
      if (!rentMap.has(leaseId)) continue          // 매출 인식 대상(RESERVED·CANCELLED 제외) 유지
      const l = leaseById.get(leaseId)
      const cap = l ? billForLeaseMonth(l, m, lockedExpectedByLeaseMonth[leaseId]?.get(m) ?? null) : 0
      total += Math.min(received, cap)
    }
    revenueByMonth[m] = total
  }

  // 지출 / 기타수익 — 발생일(date) 기준
  const [expenses, incomes] = await Promise.all([
    prisma.expense.findMany({
      where: { propertyId, date: yearWindow },
      select: { date: true, amount: true, category: true },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: yearWindow },
      select: { date: true, amount: true },
    }),
  ])

  const expenseByMonth: Record<string, number> = {}
  for (const e of expenses) {
    const m = dbDateMonthKey(e.date)
    expenseByMonth[m] = (expenseByMonth[m] ?? 0) + e.amount
  }
  const extraByMonth: Record<string, number> = {}
  for (const i of incomes) {
    const m = dbDateMonthKey(i.date)
    extraByMonth[m] = (extraByMonth[m] ?? 0) + i.amount
  }

  // 월말 시점 누적 미수 계산
  const cutoffMonthStr = cutoffDate
    ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay = cutoffDate ? cutoffDate.getDate() : 0

  // 월말 누적 미수 계산용 — viewMonth 이하 targetMonth로 인식된 실수납 lease별 누적 (전 기간).
  const receivedByLeaseUntilMonth: Record<string, Record<string, number>> = {}
  for (const m of months) receivedByLeaseUntilMonth[m] = {}
  for (const p of payments) {
    if (p.isPrevOwner) continue
    if (cutoffDate && new Date(p.payDate) < cutoffDate) continue
    for (const m of months) {
      if (p.targetMonth <= m) {
        receivedByLeaseUntilMonth[m][p.leaseTermId] = (receivedByLeaseUntilMonth[m][p.leaseTermId] ?? 0) + p.actualAmount
      }
    }
  }

  // 인수월에 사용자(인수 후)가 실수납한 금액 lease별 합 — 양도인 자동 처리 판정용 (dashboard 와 통일).
  const opPaidInCutoffMonthByLease: Record<string, number> = {}
  if (cutoffMonthStr && cutoffDate) {
    for (const p of payments) {
      if (p.isPrevOwner) continue
      if (p.targetMonth !== cutoffMonthStr) continue
      if (new Date(p.payDate) < cutoffDate) continue
      opPaidInCutoffMonthByLease[p.leaseTermId] = (opPaidInCutoffMonthByLease[p.leaseTermId] ?? 0) + p.actualAmount
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

  // 특정 월의 dueDay(override 적용) — dashboard effectiveDueDayForMonth 와 동일 규칙.
  const effectiveDueDayForMonth = (
    l: { dueDay: string | null; overrideDueDay: string | null; overrideDueDayMonth: string | null },
    monthStr: string,
  ): string | null => (l.overrideDueDay && l.overrideDueDayMonth === monthStr ? l.overrideDueDay : l.dueDay)

  const todayMonth = kstMonthStr()

  const unpaidByMonth: Record<string, number> = {}
  const billedByMonth: Record<string, number> = {}
  for (const month of months) {
    // 아직 도래하지 않은 미래 월은 청구 자체가 발생 X → 미수 0
    if (month > todayMonth) {
      unpaidByMonth[month] = 0
      billedByMonth[month] = 0
      continue
    }
    let total = 0
    let monthBilled = 0
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

      // 인수월 양도인 자동 처리 — dueDay < cutoffDay 이면서 그 달 사용자 실수납이 0건일 때만 (dashboard 통일).
      const effDueDay = effectiveDueDayForMonth(l, firstMonth)
      const dueDayNum = dueDayForCutoff(effDueDay, firstMonth) ?? NaN
      const opPaidInCutoff = opPaidInCutoffMonthByLease[l.id] ?? 0
      const acqMonthAutoPaid =
        !!(cutoffMonthStr && firstMonth === cutoffMonthStr && !isNaN(dueDayNum) && dueDayNum < cutoffDay && opPaidInCutoff === 0)

      const lPrevOwnerMonths = prevOwnerMonthsByLease[l.id]
      const lockedMap = lockedExpectedByLeaseMonth[l.id]
      // 청구 규칙(일할→락인→할인·예약 인상)은 lib/billing 공용 — dashboard·rooms·unpaid.ts 와 동일.
      let expected = 0
      for (const mn of monthRange(firstMonth, month)) {
        if (mn === cutoffMonthStr && acqMonthAutoPaid) continue
        if (lPrevOwnerMonths?.has(mn)) continue
        if (moveOutMonth && mn > moveOutMonth) continue
        // 퇴실월 무청구 — 퇴실예정일이 그 월 납부일 이전이면 청구 0.
        if (isCheckoutNoBillingMonthFor(l, l.expectedMoveOut, mn, resolveDueDateForMonth(effectiveDueDayForMonth(l, mn), mn))) continue
        const bill = billForLeaseMonth(l, mn, lockedMap?.get(mn) ?? null)
        expected += bill
        if (mn === month) monthBilled += bill   // 그 달 발생 청구액 — 미수와 동일 스코프
      }
      const received = receivedByLeaseUntilMonth[month][l.id] ?? 0
      total += Math.max(0, expected - received)
    }
    unpaidByMonth[month] = total
    billedByMonth[month] = monthBilled
  }

  const rows: MonthlyRow[] = months.map(m => {
    const revenue = revenueByMonth[m] ?? 0
    const extraIncome = extraByMonth[m] ?? 0
    const expense = expenseByMonth[m] ?? 0
    return {
      month: m,
      billedAmount: billedByMonth[m] ?? 0,
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
    totalBilled: rows.reduce((s, r) => s + r.billedAmount, 0),
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

  // 1) lease 단위 발생주의 매출 (dashboard 와 통일 정책, 2026-06-01)
  //    - BILLABLE_STATUSES (ACTIVE/CHECKOUT_PENDING/NON_RESIDENT) 중 그 달 활성인 lease 의
  //      청구액(할인 반영) 을 합산
  //    - CHECKED_OUT 의 그 달 귀속 paymentRecord 합은 별도로 추가 인식 (단기·중도퇴실)
  //    이전 정책(호실 단위 baseRent)은 단기 입주(파트쿨리나 422호) / NON_RESIDENT(사무실호)
  //    / 호실 baseRent ≠ lease.rentAmount 차이 등 dashboard 와 불일치 케이스가 있었음.
  const [billableLeases, property] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: BILLABLE_STATUSES }, rentAmount: { gt: 0 } },
      select: {
        id: true, status: true, rentAmount: true, isShortTerm: true,
        moveInDate: true, expectedMoveOut: true, moveOutDate: true,
        checkoutProratedAmount: true, checkoutProratedMonth: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
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
  const startMonth = `${startY}-${String(startM).padStart(2, '0')}`
  // 최근 3개월 창 — 지금은 소비처가 없다(평균은 아래 last3Months 월 키로 낸다). 형태만 정본을 따른다.
  const last3Window = monthsDbRange(shiftMonth(startMonth, -3), shiftMonth(startMonth, -1))

  // 전년 1년치 + 최근 3개월. 창 정본은 lib/kstDate — 로컬 자정으로 잡던 시절엔 KST 기기에서
  // 창이 하루 밀려 각 달 말일 지출이 그 달 평균에서 통째로 빠졌다.
  const yearBackWindow = monthsDbRange(shiftMonth(startMonth, -12), shiftMonth(startMonth, monthsAhead - 1))

  const [historicalExpenses, historicalIncomes] = await Promise.all([
    prisma.expense.findMany({
      where: {
        propertyId,
        date: yearBackWindow,
      },
      select: { date: true, amount: true },
    }),
    prisma.extraIncome.findMany({
      where: {
        propertyId,
        date: yearBackWindow,
      },
      select: { date: true, amount: true },
    }),
  ])

  const expByMonth: Record<string, number> = {}
  for (const e of historicalExpenses) {
    const k = dbDateMonthKey(e.date)
    expByMonth[k] = (expByMonth[k] ?? 0) + e.amount
  }
  const incByMonth: Record<string, number> = {}
  for (const i of historicalIncomes) {
    const k = dbDateMonthKey(i.date)
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

  // 호실 점유 수 카운트용 — UI 표시에만 사용. 매출 계산은 lease 기반(아래).
  // NON_RESIDENT 포함 조회 — 집계 제외 방(창고·사무실) 판정용(lib/vacancy 정본, 신고 9d844226)
  const allRoomsForCount = await prisma.room.findMany({
    where: { propertyId },
    select: {
      id: true,
      nonResidentVacant: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: { status: true, moveInDate: true, expectedMoveOut: true, moveOutDate: true },
      },
    },
  })

  // 3) 월별 예상 매출 — lease 단위 발생주의 (dashboard 와 통일 정책)
  //    매출 = Σ 그 달 활성 billable lease 의 청구액(할인 반영) + CHECKED_OUT 의 그 달 귀속 paymentRecord 합
  const rowsAsync = months.map(async month => {
    const [my, mm] = month.split('-').map(Number)
    const monthStart = new Date(my, mm - 1, 1)
    const monthEnd = new Date(my, mm, 0); monthEnd.setHours(23, 59, 59, 999)

    let revenue = 0
    for (const lease of billableLeases) {
      const moveIn = lease.moveInDate ? new Date(lease.moveInDate) : null
      const moveOut = lease.expectedMoveOut ? new Date(lease.expectedMoveOut)
        : (lease.moveOutDate ? new Date(lease.moveOutDate) : null)
      if (moveIn && moveIn > monthEnd) continue        // 아직 미입주
      if (moveOut && moveOut < monthStart) continue     // 이미 퇴실
      // 단기는 입주월 1회 인식 — rentAmount가 체류 전체 사용료라 월 반복 합산 금지(lib/billing 단기 규칙과 동일)
      const shortInMonth = lease.isShortTerm ? monthOfDate(lease.moveInDate) : null
      if (shortInMonth && shortInMonth !== month) continue
      // 정본 수렴(크리티컬 신고 50a2a69b 후속) — 퇴실 일할 확정월은 일할액, 예약 인상은 적용월부터
      // scheduledRent 기준, 그 위에 할인. 원가 직산입 금지(buildLeaseRow 와 동일 규칙).
      // 정본 호출로 대체 — 종전에는 같은 규칙(일할·인상·할인)을 손으로 다시 짜 두 벌이 됐다.
      // 미래월 예측이라 락은 넘기지 않는다(그 달 record 가 아직 없다).
      revenue += billForLeaseMonth(lease, month, null)
    }
    // CHECKED_OUT 단기·중도퇴실 lease 의 그 달 귀속 paymentRecord 합 추가
    revenue += await getCheckedOutRecognizedRevenue(prisma, propertyId, month)

    // 호실 점유 수 — UI 표시용. 집계 제외 방(창고·사무실)은 점유에도 공실에도 안 넣음
    let occupied = 0
    let vacant = 0
    for (const room of allRoomsForCount) {
      if (isVacancyExcluded(room)) continue
      const has = room.leaseTerms.some(l => {
        if (l.status === 'NON_RESIDENT') return false
        const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
        const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut)
          : (l.moveOutDate ? new Date(l.moveOutDate) : null)
        if (moveIn && moveIn > monthEnd) return false
        if (moveOut && moveOut < monthStart) return false
        return true
      })
      if (has) occupied++; else vacant++
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
  const rows: ForecastRow[] = await Promise.all(rowsAsync)

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
  const now = new Date()   // 아래 '몇 개월 전' 구간 계산용 — 순간 시각이라 타임존 무관
  const asOfMonth = kstMonthStr()   // 진단 기준월은 KST — 서버(UTC) 로컬이면 매월 1일 새벽에 지난달로 진단된다

  // 점유율 — 공실·분모에서 집계 제외(창고·사무실, lib/vacancy 정본) 반영. 대시보드 KPI 와 동일 정의(신고 9d844226)
  const [totalRooms, occupiedRooms, vacantRooms, excludedRooms] = await Promise.all([
    prisma.room.count({ where: { propertyId } }),
    prisma.room.count({ where: { propertyId, isVacant: false } }),
    prisma.room.count({ where: { propertyId, isVacant: true, NOT: vacancyExcludedWhere } }),
    prisma.room.count({ where: { propertyId, isVacant: true, ...vacancyExcludedWhere } }),
  ])
  const occupancyRate = totalRooms - excludedRooms > 0 ? occupiedRooms / (totalRooms - excludedRooms) : 0

  // 미수율 (최근 12개월)
  const oneYearAgo = new Date(now); oneYearAgo.setMonth(oneYearAgo.getMonth() - 12)
  const trendMonths: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now); d.setMonth(d.getMonth() - i)
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const yearPayments = await prisma.paymentRecord.findMany({
    where: { propertyId, isDeposit: false, isPrevOwner: false, targetMonth: { in: trendMonths } },
    select: { leaseTermId: true, targetMonth: true, expectedAmount: true, actualAmount: true, isBillingAdjust: true },
  })
  // 청구액은 (계약, 달)별 **최댓값**이다. 합으로 잡으면 한 달에 나눠 낸 계약이 곱해져
  // 미수율이 부풀려진다(신고 2026-08-02 — 9.4% 로 뜨는데 실제 0.5%).
  const expectedByLeaseMonth = new Map<string, number>()
  const expectedByMonth: Record<string, number> = {}
  const actualByMonth: Record<string, number> = {}
  for (const p of yearPayments) {
    const key = `${p.leaseTermId}|${p.targetMonth}`
    const cur = expectedByLeaseMonth.get(key) ?? 0
    if (p.expectedAmount > cur) expectedByLeaseMonth.set(key, p.expectedAmount)
    // 청구 조정 전표는 수납이 아니라 청구 락 마커라 수납 합에서 뺀다
    if (!p.isBillingAdjust) actualByMonth[p.targetMonth] = (actualByMonth[p.targetMonth] ?? 0) + p.actualAmount
  }
  for (const [key, amount] of expectedByLeaseMonth) {
    const mon = key.split('|')[1]
    expectedByMonth[mon] = (expectedByMonth[mon] ?? 0) + amount
  }
  const totalExpected = Object.values(expectedByMonth).reduce((s, v) => s + v, 0)
  const totalActual   = Object.values(actualByMonth).reduce((s, v) => s + v, 0)
  const unpaidRate    = totalExpected > 0 ? Math.max(0, totalExpected - totalActual) / totalExpected : 0

  // 현재 미수 (active lease들의 누적 미수)
  const activeLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
    select: {
      id: true, rentAmount: true, dueDay: true, moveInDate: true,
      paymentRecords: { where: { isDeposit: false, isPrevOwner: false, deletedAt: null }, select: { targetMonth: true, actualAmount: true, expectedAmount: true, isBillingAdjust: true, isDeposit: true, isPrevOwner: true } },
    },
  })
  let totalUnpaid = 0
  let overdueDaysAcc = 0
  let overdueLeaseCount = 0
  for (const l of activeLeases) {
    // 정본 규칙 — 월별 최댓값. 아래 avgDaysOverdue(미납액 ÷ 월세 × 30)도 이 값을 입력으로 쓴다.
    const unpaid = unpaidForLease(l.paymentRecords)
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
  const expenses12 = await prisma.expense.findMany({
    where: { propertyId, date: monthsDbRange(trendMonths[0], trendMonths[11]) },
    select: { date: true, amount: true, category: true },
  })
  const expenseByMonth: Record<string, number> = {}
  const categoryAcc: Record<string, number> = {}
  for (const e of expenses12) {
    const m = dbDateMonthKey(e.date)
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

  // 30일 이상 공실인 호실 — 집계 제외 방(창고·사무실)은 대상 아님
  const thirtyAgo = new Date(now); thirtyAgo.setDate(thirtyAgo.getDate() - 30)
  const longVacantRooms = await prisma.room.findMany({
    where: { propertyId, isVacant: true, NOT: vacancyExcludedWhere },
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

    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

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
  if (arr.length === 0) arr.push(kstMonthStr().slice(0, 4))   // 데이터가 없을 때의 기본 연도도 KST
  return arr
}
