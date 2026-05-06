import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { Suspense } from 'react'
import DataButtons from '@/components/DataButtons'
import DashboardClient, { type DashboardData } from './DashboardClient'
import { getPaymentMethods } from '@/app/(app)/settings/actions'
import { kstMonthStr, kstYmd } from '@/lib/kstDate'
import { ALERT_WINDOW_BEFORE_DAYS, ALERT_WINDOW_AFTER_DAYS, UNPAID_UPCOMING_ALERT_DAYS } from '@/lib/appConfig'
import { getNextBusinessDay } from '@/lib/krHolidays'

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
  // KST 기준 오늘 (서버 UTC와 시간대 차이로 1일 어긋나는 문제 방지)
  const kst = kstYmd()
  const today = new Date(kst.year, kst.month - 1, kst.day)
  // target은 보통 'YYYY-MM-DD' 형태로 저장된 자정 UTC. UTC 컴포넌트로 캘린더 일자 추출.
  const t = new Date(date)
  const targetDay = new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
  return Math.round((targetDay.getTime() - today.getTime()) / 86400000)
}

function dayLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}일 경과`
  if (days === 0) return '오늘'
  return `D-${days} (${days}일 남음)`
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

  // 미수납·납입완료 위젯은 selected month와 무관하게 항상 "오늘 기준"으로 계산 (KST)
  const realTodayMonthStr = kstMonthStr()
  const isViewingRealMonth = targetMonth === realTodayMonthStr

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

  // KST 기준 오늘 자정
  const kstToday  = kstYmd()
  const today     = new Date(kstToday.year, kstToday.month - 1, kstToday.day)
  const alertFrom = new Date(today.getTime() - ALERT_WINDOW_BEFORE_DAYS * 86400000)
  const alertTo   = new Date(today.getTime() + ALERT_WINDOW_AFTER_DAYS  * 86400000)

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
      // RESERVED는 아직 입주 안 한 상태 → 미수 합산 대상에서 제외
      where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
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
    // 입실예정 알림 — 미래 moveInDate (또는 도래 전)이면서 미확정/확정 모두 포함
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: 'RESERVED',
        moveInDate: { gte: alertFrom, lte: alertTo },
      },
      select: {
        id: true, moveInDate: true, reservationConfirmedAt: true,
        tenant: { select: { name: true, id: true } },
        room:   { select: { id: true, roomNo: true } },
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
        room:   { select: { roomNo: true, type: true, windowType: true, direction: true } },
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
    // 희망 이동 호실용 공실 목록 (조건 매칭에 type/windowType/direction 사용)
    prisma.room.findMany({
      where: { propertyId, isVacant: true },
      select: { roomNo: true, type: true, windowType: true, direction: true },
    }),
    // 희망 이동 호실/조건 계약 (예약/투어/거주중/퇴실예정 — 호실 또는 조건 보유자)
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE'] },
        OR: [
          { wishRooms: { not: null } },
          { wishConditions: { not: null } },
        ],
      },
      select: {
        id: true, status: true, wishRooms: true, wishConditions: true, inquiryAt: true, createdAt: true,
        moveInDate: true, keepAlertAfterInquiry: true, reservationConfirmedAt: true,
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
    // 최근 수납 내역 (활동 피드용) — viewMonth 안에 payDate가 있는 record
    // [납입일변경] 메모 record(일할 차액)는 물리적 납입이 아니므로 제외
    (() => {
      const [vy, vm] = targetMonth.split('-').map(Number)
      const monthStart = new Date(vy, vm - 1, 1)
      const monthEnd = new Date(vy, vm, 0); monthEnd.setHours(23, 59, 59, 999)
      return prisma.paymentRecord.findMany({
        where: {
          propertyId,
          isDeposit: false,
          payDate: { gte: monthStart, lte: monthEnd },
          NOT: { memo: { contains: '[납입일변경]' } },
        },
        select: {
          targetMonth: true,
          createdAt: true,
          payDate: true,
          actualAmount: true,
          tenant: { select: { id: true, name: true } },
          leaseTerm: { select: { room: { select: { roomNo: true } } } },
        },
        orderBy: { payDate: 'desc' },
        take: 20,
      })
    })(),
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
    // 누적 미납 계산용 — 발생주의: targetMonth가 오늘 월 이하인 record만 매출 인식
    // (미래 targetMonth로 저장된 선납 record는 아직 매출 인식 X)
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isDeposit: false,
        targetMonth: { lte: realTodayMonthStr },
      },
      select: { leaseTermId: true, targetMonth: true, actualAmount: true, payDate: true, memo: true },
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

  // ── 예비비 잔고 + 이달 적립/사용 ─────────────────────────────────
  const reserveTxns = await prisma.reserveTransaction.findMany({
    where: { propertyId },
    select: { type: true, amount: true, date: true },
  })
  let reserveBalance = 0
  let reserveMonthlyDeposit = 0
  let reserveMonthlyWithdraw = 0
  for (const r of reserveTxns) {
    const isDep = r.type === 'DEPOSIT'
    if (isDep) reserveBalance += r.amount
    else reserveBalance -= r.amount
    if (r.date >= startDate && r.date <= endDate) {
      if (isDep) reserveMonthlyDeposit += r.amount
      else reserveMonthlyWithdraw += r.amount
    }
  }
  const reserveMonthly = { deposit: reserveMonthlyDeposit, withdraw: reserveMonthlyWithdraw }

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

  // 완납 여부 판단 — viewMonth(targetMonth) 기준 그 월의 납부 이력으로 평가
  const allMonthPayments = await prisma.paymentRecord.findMany({
    where: { propertyId, targetMonth, isDeposit: false },
    select: { leaseTermId: true, actualAmount: true },
  })
  const paymentByLeaseForStatus = allMonthPayments.reduce((acc, p) => {
    acc[p.leaseTermId] = (acc[p.leaseTermId] ?? 0) + p.actualAmount
    return acc
  }, {} as Record<string, number>)

  // 인수 기준일 이전 월 or 인수월 내 기준일 이전 납부일 → 양도인 몫으로 완납 처리 (viewMonth 기준)
  const cutoffMonthStr = acquisitionDate
    ? `${acquisitionDate.getFullYear()}-${String(acquisitionDate.getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay = acquisitionDate ? acquisitionDate.getDate() : 0

  // [납입일변경] 메모에서 변경 전 원래 dueDay를 복원 (changeDueDay로 lease.dueDay가 영구 변경된 경우 대비)
  const originalDueDayByLease: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    if (!p.memo?.includes('[납입일변경]')) continue
    const existing = originalDueDayByLease[p.leaseTermId]
    const m = p.memo.match(/\[납입일변경\]\s*([^일→]+?)일?\s*→/)
    if (!m) continue
    const t = m[1].trim()
    const parsed = t.includes('말') ? 31 : Number(t)
    if (isNaN(parsed) || parsed <= 0) continue
    // 가장 이른 [납입일변경] 기록의 변경 전 값을 사용
    const recDate = new Date(p.payDate).getTime()
    const cur = (originalDueDayByLease as any)[`__date_${p.leaseTermId}`] as number | undefined
    if (existing === undefined || (cur !== undefined && recDate < cur)) {
      originalDueDayByLease[p.leaseTermId] = parsed
      ;(originalDueDayByLease as any)[`__date_${p.leaseTermId}`] = recDate
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

  const prevOwnerLeaseIds = new Set<string>()
  if (cutoffMonthStr && targetMonth < cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) {
      paymentByLeaseForStatus[l.id] = l.rentAmount
      prevOwnerLeaseIds.add(l.id)
    }
  } else if (cutoffMonthStr && targetMonth === cutoffMonthStr) {
    for (const l of unpaidLeasesRaw) {
      // override가 cutoffMonth에 있으면 그것 사용, 아니면 originalDueDay (메모 복원) 사용
      const overrideForCutoff = (l.overrideDueDayMonth === cutoffMonthStr && l.overrideDueDay) ? l.overrideDueDay : null
      let dayNum: number | null = null
      if (overrideForCutoff) {
        dayNum = overrideForCutoff.includes('말') ? 31 : parseInt(overrideForCutoff, 10)
        if (isNaN(dayNum)) dayNum = null
      } else {
        dayNum = getOriginalDueDay(l)
      }
      if (dayNum != null && dayNum < cutoffDay) {
        paymentByLeaseForStatus[l.id] = l.rentAmount
        prevOwnerLeaseIds.add(l.id)
      }
    }
  }

  function effectiveDueDay(l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null }): string | null {
    if (l.overrideDueDay && l.overrideDueDayMonth === targetMonth) return l.overrideDueDay
    return l.dueDay
  }

  // 특정 월의 dueDay(override 적용)를 반환
  function effectiveDueDayForMonth(
    l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
    monthStr: string,
  ): string | null {
    if (l.overrideDueDay && l.overrideDueDayMonth === monthStr) return l.overrideDueDay
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

  // 특정 월의 dueDay 기준 today와의 일수 차이 (KST 기준)
  function calcDaysOverdueForMonth(dueDay: string | null, monthStr: string): number | null {
    if (!dueDay) return null
    // KST 기준 오늘 (서버 UTC와 시간대 차이로 today가 하루 어긋나는 것 방지)
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

  // ── 희망 호실/조건 알림 ──────────────────────────────────────
  // "공실"로 간주: 실제 공실(isVacant) + 퇴실 예정(CHECKOUT_PENDING) 호실
  type TargetRoomInfo = { roomNo: string; type: string | null; windowType: string | null; direction: string | null; isCheckoutPending: boolean }
  const vacantInfoMap = new Map<string, TargetRoomInfo>()
  for (const r of vacantRoomList) {
    vacantInfoMap.set(r.roomNo, { roomNo: r.roomNo, type: r.type, windowType: r.windowType, direction: r.direction, isCheckoutPending: false })
  }
  for (const l of moveOutLeases) {
    const r = l.room
    if (!r?.roomNo) continue
    if (vacantInfoMap.has(r.roomNo)) continue
    vacantInfoMap.set(r.roomNo, { roomNo: r.roomNo, type: r.type, windowType: r.windowType, direction: r.direction, isCheckoutPending: true })
  }

  const matchesConditions = (room: TargetRoomInfo, raw: string | null): boolean => {
    if (raw == null) return false
    let cond: { floor?: string; windowType?: string; type?: string; direction?: string }
    try { cond = JSON.parse(raw) } catch { return false }
    if (!cond) return false
    // 빈 객체 = 조건 무관 → 모든 빈 방 매칭
    const roomFloor = (() => {
      const n = room.roomNo.replace(/[^0-9]/g, '')
      return n.length >= 3 ? n.slice(0, n.length - 2) : ''
    })()
    if (cond.floor && cond.floor !== roomFloor) return false
    if (cond.windowType && cond.windowType !== room.windowType) return false
    if (cond.type && cond.type !== room.type) return false
    if (cond.direction && cond.direction !== room.direction) return false
    return true
  }

  // 입주 희망일 경과 시 옵션이 꺼져 있으면 매칭 제외
  // KST 기준 자정
  const todayMidnight = new Date(kstToday.year, kstToday.month - 1, kstToday.day)
  const isInquiryExpired = (l: { moveInDate: Date | null; keepAlertAfterInquiry: boolean }): boolean => {
    if (l.keepAlertAfterInquiry) return false
    if (!l.moveInDate) return false
    return new Date(l.moveInDate) < todayMidnight
  }

  type WishCandidate = {
    tenantName: string; tenantId: string; status: string
    inquiryAt: Date | null; createdAt: Date
    matchedBy: 'rooms' | 'conditions'
  }
  const candidatesByRoom = new Map<string, WishCandidate[]>()

  for (const l of wishRoomLeases) {
    // 입주 희망일이 지난 예약자는 옵션이 켜져 있지 않으면 매칭 제외
    if (isInquiryExpired(l)) continue
    // 예약 확정자는 이미 호실이 정해진 상태 → 매칭 알림에서 제외
    if (l.reservationConfirmedAt) continue

    const inquiryAt = l.inquiryAt ? new Date(l.inquiryAt) : null
    const createdAt = new Date(l.createdAt)

    // 1) 호실 직접 매칭
    const wished = (l.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
    for (const no of wished) {
      const info = vacantInfoMap.get(no)
      if (!info) continue
      if (l.room?.roomNo === no) continue
      if (!candidatesByRoom.has(no)) candidatesByRoom.set(no, [])
      candidatesByRoom.get(no)!.push({
        tenantName: l.tenant.name, tenantId: l.tenant.id, status: l.status,
        inquiryAt, createdAt, matchedBy: 'rooms',
      })
    }

    // 2) 조건 매칭 — 호실 미지정자가 wishConditions를 등록한 경우, 조건에 부합하는 모든 빈 방에 후보로 등록
    if (l.wishConditions) {
      for (const info of vacantInfoMap.values()) {
        if (!matchesConditions(info, l.wishConditions)) continue
        if (l.room?.roomNo === info.roomNo) continue
        // 같은 사람이 호실로도, 조건으로도 매칭되면 중복 방지
        const list = candidatesByRoom.get(info.roomNo) ?? []
        if (list.some(c => c.tenantId === l.tenant.id)) continue
        if (!candidatesByRoom.has(info.roomNo)) candidatesByRoom.set(info.roomNo, [])
        candidatesByRoom.get(info.roomNo)!.push({
          tenantName: l.tenant.name, tenantId: l.tenant.id, status: l.status,
          inquiryAt, createdAt, matchedBy: 'conditions',
        })
      }
    }
  }

  type WishGroupedAlert = {
    roomNo: string
    isCheckoutPending: boolean
    candidates: { tenantId: string; tenantName: string; rank: number; matchedBy: 'rooms' | 'conditions' }[]
  }
  const wishGroupedAlerts: WishGroupedAlert[] = []
  for (const [roomNo, candidates] of candidatesByRoom) {
    candidates.sort((a, b) => {
      const at = a.inquiryAt?.getTime() ?? a.createdAt.getTime()
      const bt = b.inquiryAt?.getTime() ?? b.createdAt.getTime()
      return at - bt
    })
    const info = vacantInfoMap.get(roomNo)
    wishGroupedAlerts.push({
      roomNo,
      isCheckoutPending: !!info?.isCheckoutPending,
      candidates: candidates.map((c, idx) => ({
        tenantId: c.tenantId,
        tenantName: c.tenantName,
        rank: idx + 1,
        matchedBy: c.matchedBy,
      })),
    })
  }
  wishGroupedAlerts.sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))

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

  // ── 누적 미납 상세 — 발생주의(targetMonth 기반) ──────────
  // "오늘 월 이하의 targetMonth로 인식된 매출" vs "청구 가능 월 수 × 임대료"의 차이
  // (allHistoricalPayments는 이미 targetMonth ≤ realTodayMonthStr 필터됨)
  const accrualByLease: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    // cutoff 이전 (양도인) 제외
    if (acquisitionDate && new Date(p.payDate) < acquisitionDate) continue
    accrualByLease[p.leaseTermId] = (accrualByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }

  // 인수월에 사용자가 받은 record(payDate >= cutoff) 합 — 양도인 자동 처리 판정용
  const opPaidInCutoffMonthByLease: Record<string, number> = {}
  if (cutoffMonthStr && acquisitionDate) {
    for (const p of allHistoricalPayments) {
      if (p.targetMonth !== cutoffMonthStr) continue
      if (new Date(p.payDate) < acquisitionDate) continue
      opPaidInCutoffMonthByLease[p.leaseTermId] = (opPaidInCutoffMonthByLease[p.leaseTermId] ?? 0) + p.actualAmount
    }
  }

  // viewMonth(targetMonth) 기준 누적 미납 — viewMonth가 과거이면 그 월말 시점, 현재/미래면 오늘 시점과 동일
  const accrualByLeaseForView: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    if (p.targetMonth > targetMonth) continue
    if (acquisitionDate && new Date(p.payDate) < acquisitionDate) continue
    accrualByLeaseForView[p.leaseTermId] = (accrualByLeaseForView[p.leaseTermId] ?? 0) + p.actualAmount
  }

  const unpaidMap: Record<string, number> = {}
  const firstUnpaidByLease: Record<string, string | null> = {}
  const overdueByLease: Record<string, number> = {}
  const upcomingByLease: Record<string, number> = {}
  for (const l of unpaidLeasesRaw) {
    const lMoveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const leaseStartMonth = lMoveIn
      ? `${lMoveIn.getFullYear()}-${String(lMoveIn.getMonth() + 1).padStart(2, '0')}`
      : (cutoffMonthStr ?? targetMonth)
    const firstMonth = cutoffMonthStr && leaseStartMonth < cutoffMonthStr ? cutoffMonthStr : leaseStartMonth
    if (firstMonth > targetMonth) continue

    // 퇴실예정 — expectedMoveOut 이후 월은 청구 종료
    const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : null
    const moveOutMonth = moveOut
      ? `${moveOut.getFullYear()}-${String(moveOut.getMonth() + 1).padStart(2, '0')}`
      : null

    // 인수월 양도인 자동 처리: dueDay < cutoffDay이고 사용자(인수 후) record가 0건일 때만
    // 자동으로 양도인이 받았다고 가정. 사용자 record가 있으면 그건 사용자가 받은 것이므로 청구 유효.
    // [납입일변경]으로 lease.dueDay가 영구 변경된 경우 originalDueDay를 우선 사용.
    const lAny = l as any
    let dueDayNum: number = NaN
    if (lAny.overrideDueDayMonth === firstMonth && lAny.overrideDueDay) {
      const eff = lAny.overrideDueDay as string
      dueDayNum = eff.includes('말') ? 31 : parseInt(eff, 10)
    } else {
      const orig = getOriginalDueDay(l)
      if (orig != null) dueDayNum = orig
    }
    const opPaidInCutoff = opPaidInCutoffMonthByLease[l.id] ?? 0
    const acqMonthAutoPaid =
      !!(cutoffMonthStr && firstMonth === cutoffMonthStr && !isNaN(dueDayNum) && dueDayNum < cutoffDay && opPaidInCutoff === 0)

    // 청구 가능 월 수 (인수월 자동 양도인 처리, 퇴실 후 제외) — viewMonth까지
    const months = monthRange(firstMonth, targetMonth)
    let billableMonths = 0
    const billableMonthList: string[] = []
    for (const mon of months) {
      if (mon === cutoffMonthStr && acqMonthAutoPaid) continue
      if (prevOwnerLeaseIds.has(l.id) && mon === cutoffMonthStr) continue
      if (moveOutMonth && mon > moveOutMonth) continue
      billableMonths++
      billableMonthList.push(mon)
    }
    const totalExpected = billableMonths * l.rentAmount
    const totalReceived = accrualByLeaseForView[l.id] ?? 0
    unpaidMap[l.id] = Math.max(0, totalExpected - totalReceived)

    // 첫 미수월 추적 — 받은 돈을 청구 가능 월에 차례로 배분, 부족한 첫 월
    let allocated = 0
    let firstUnpaid: string | null = null
    for (const mon of billableMonthList) {
      if (totalReceived - allocated < l.rentAmount) { firstUnpaid = mon; break }
      allocated += l.rentAmount
    }
    firstUnpaidByLease[l.id] = firstUnpaid

    // 월별 도래·미도래 portion 분리 — FIFO 충당 후 각 월의 미충당분을 dueDay 도래 여부로 분류
    let received = totalReceived
    let leaseOverdue = 0
    let leaseUpcoming = 0
    for (const mon of billableMonthList) {
      const allocThis = Math.min(received, l.rentAmount)
      received -= allocThis
      const monthUnpaid = l.rentAmount - allocThis
      if (monthUnpaid <= 0) continue
      const dueDayStr = effectiveDueDayForMonth(l, mon)
      const days = dueDayStr ? calcDaysOverdueForMonth(dueDayStr, mon) : null
      // days >= 0 (도래) 또는 알 수 없음 → 미수, days < 0 (미도래) → 납부 예정
      if (days == null || days >= 0) leaseOverdue += monthUnpaid
      else leaseUpcoming += monthUnpaid
    }
    overdueByLease[l.id] = leaseOverdue
    upcomingByLease[l.id] = leaseUpcoming
  }

  const unpaidAmount = Object.values(unpaidMap).reduce((s, v) => s + v, 0)
  // 진짜 미납(도래·미회수) vs 납부 예정(미도래·미회수) 금액 분리 — 월별로 분류
  const overdueAmount = Object.values(overdueByLease).reduce((s, v) => s + v, 0)
  const upcomingAmount = Object.values(upcomingByLease).reduce((s, v) => s + v, 0)
  // 미수납 후보 — 이후 daysOverdue 기반으로 위젯·알림 분기
  const unpaidCandidates = unpaidLeasesRaw
    .filter(l => (unpaidMap[l.id] ?? 0) > 0)
    .map(l => {
      const unpaid = unpaidMap[l.id]!
      const monthsOverdue = l.rentAmount > 0 ? Math.ceil(unpaid / l.rentAmount) : 0
      const firstUnpaid = firstUnpaidByLease[l.id] ?? null
      const dueDayForFirst = firstUnpaid ? effectiveDueDayForMonth(l, firstUnpaid) : null
      const daysOverdue = firstUnpaid && dueDayForFirst
        ? calcDaysOverdueForMonth(dueDayForFirst, firstUnpaid)
        : null
      const overduePortion = overdueByLease[l.id] ?? 0
      const upcomingPortion = upcomingByLease[l.id] ?? 0
      return {
        roomNo:        l.room?.roomNo ?? '?',
        tenantName:    l.tenant.name,
        tenantId:      l.tenant.id,
        leaseId:       l.id,
        daysOverdue,
        unpaidAmount:  unpaid,
        overduePortion,
        upcomingPortion,
        monthsOverdue,
      }
    })
  // 이달 미수납 위젯 — 도래·미회수 portion이 있는 lease만 표시 (월 단위 분리 후)
  // 표시 금액은 그 lease의 도래·미회수 portion (전체 unpaid가 아님)
  const unpaidLeases = unpaidCandidates
    .filter(l => l.overduePortion > 0)
    .map(l => ({ ...l, unpaidAmount: l.overduePortion }))
  const awaitingLeases = unpaidCandidates.filter(l => l.overduePortion === 0 && l.upcomingPortion > 0)
  const unpaidCount = unpaidLeases.length
  const upcomingCount = unpaidCandidates.filter(l => l.upcomingPortion > 0).length
  // 예상 매출 진행바용 — 도래·미도래 합산한 총 미수령 건수
  const pendingCount = unpaidCandidates.length

  // 방 현황 그리드 미납 호실 — unpaidLeases와 동일 (둘 다 viewMonth 기준)
  const unpaidRoomNosForView = Array.from(new Set(unpaidLeases.map(l => l.roomNo)))
  // 납부 예정 호실 — dueDay 미도래 + 아직 받지 않음 (방 현황 그리드 4번째 상태)
  const awaitingRoomNosForView = Array.from(new Set(awaitingLeases.map(l => l.roomNo)))

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

  // 예약 확정 + 입주 희망일 도래(오늘 KST 09:00 이후) → reservationDue
  // 그 외 RESERVED는 movein 알림
  const nowKst = (() => { const n = new Date(); return new Date(n.getTime() + 9 * 3600000) })()
  const todayKst9amLocal = (() => {
    const k = new Date(nowKst); k.setUTCHours(9, 0, 0, 0)
    return new Date(k.getTime() - 9 * 3600000)
  })()
  for (const l of moveInLeases) {
    const days = daysUntil(l.moveInDate!)
    const isConfirmed = !!l.reservationConfirmedAt
    const moveInD = l.moveInDate ? new Date(l.moveInDate) : null
    const isDue = moveInD && (
      moveInD.getTime() < todayKst9amLocal.getTime() ||
      (days === 0 && new Date() >= todayKst9amLocal)
    )

    if (isConfirmed && isDue) {
      alertItems.push({
        category:  'movein',
        text:      `${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}${l.tenant.name}님 입주 확정일 도래`,
        link:      `/tenants?tenantId=${l.tenant.id}`,
        dotColor:  '#22c55e',
        timeLabel: days === 0 ? '오늘' : days < 0 ? `${Math.abs(days)}일 경과` : dayLabel(days),
        tenantId:  l.tenant.id,
        detail:    `입주 희망일(${fmtKorDate(l.moveInDate)})이 도래했습니다. 거주중으로 변경하시겠어요?`,
        exactDate: fmtShortDate(l.moveInDate),
        reservationDueLeaseId: l.id,
        reservationDueRoomNo:  l.room?.roomNo ?? null,
      })
      continue
    }

    alertItems.push({
      category:  'movein',
      text:      `${l.tenant.name}님 ${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}입실 희망${isConfirmed ? ' (예약 확정)' : ' (예약)'}`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  isConfirmed ? '#22c55e' : '#3b82f6',
      timeLabel: dayLabel(days),
      tenantId:  l.tenant.id,
      detail:    fmtKorDate(l.moveInDate)
        ? `입주 희망일: ${fmtKorDate(l.moveInDate)}${isConfirmed ? ' · 예약 확정' : ' · 입주 미확정 (예약 단계)'}`
        : undefined,
      exactDate: fmtShortDate(l.moveInDate),
    })
  }

  // 7일보다 오래된 과거 입주 희망일을 가진 확정 예약 — alertFrom 범위 밖이라 별도 처리
  const overduConfirmed = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: 'RESERVED',
      reservationConfirmedAt: { not: null },
      moveInDate: { not: null, lt: alertFrom },
    },
    select: {
      id: true, moveInDate: true,
      tenant: { select: { name: true, id: true } },
      room:   { select: { id: true, roomNo: true } },
    },
  })
  for (const l of overduConfirmed) {
    const days = daysUntil(l.moveInDate!)
    alertItems.push({
      category:  'movein',
      text:      `${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}${l.tenant.name}님 입주 확정일 경과`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#22c55e',
      timeLabel: `${Math.abs(days)}일 경과`,
      tenantId:  l.tenant.id,
      detail:    `입주 희망일(${fmtKorDate(l.moveInDate)})이 ${Math.abs(days)}일 경과했습니다. 거주중으로 변경하시겠어요?`,
      exactDate: fmtShortDate(l.moveInDate),
      reservationDueLeaseId: l.id,
      reservationDueRoomNo:  l.room?.roomNo ?? null,
    })
  }

  for (const l of moveOutLeases) {
    const timeLabel = l.expectedMoveOut ? dayLabel(daysUntil(l.expectedMoveOut)) : '날짜 미정'
    alertItems.push({
      category:  'moveout',
      text:      `${l.tenant.name}님 ${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}퇴실 예정`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#eab308',
      timeLabel,
      tenantId:  l.tenant.id,
      detail:    l.expectedMoveOut ? `퇴실 예정일: ${fmtKorDate(l.expectedMoveOut)}` : '퇴실 날짜 미정',
      exactDate: fmtShortDate(l.expectedMoveOut),
      moveOutLeaseId: l.id,
      moveOutDepositAmount: l.depositAmount,
      moveOutCleaningFee: l.cleaningFee,
      moveOutTenantName: l.tenant.name,
    })
  }

  for (const l of waitingTourLeases) {
    const timeLabel = l.tourDate ? dayLabel(daysUntil(l.tourDate)) : '일정 미정'
    alertItems.push({
      category:  'tour',
      text:      `${l.tenant.name}님${l.room?.roomNo ? ` ${l.room.roomNo}호` : ''} 투어 예정`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  '#a855f7',
      timeLabel,
      tenantId:  l.tenant.id,
      detail:    l.tourDate ? `투어 예정일: ${fmtKorDate(l.tourDate)}` : '투어 일정 미정',
      exactDate: fmtShortDate(l.tourDate),
    })
  }

  for (const g of wishGroupedAlerts) {
    if (g.candidates.length === 0) continue
    const stateLabel = g.isCheckoutPending ? '퇴실 예정' : '공실'
    if (g.candidates.length === 1) {
      const c = g.candidates[0]
      const text = c.matchedBy === 'conditions'
        ? `${c.tenantName}님과 조건이 맞는 ${g.roomNo}호 ${stateLabel}`
        : `${c.tenantName}님이 희망한 ${g.roomNo}호 ${stateLabel}`
      const detail = c.matchedBy === 'conditions'
        ? `${c.tenantName}님이 원하는 조건과 일치하는 ${g.roomNo}호가 ${stateLabel} 상태입니다.`
        : `${c.tenantName}님이 입실을 희망한 ${g.roomNo}호가 ${stateLabel} 상태입니다.`
      alertItems.push({
        category:  'wish',
        text,
        link:      `/tenants?tenantId=${c.tenantId}`,
        dotColor:  '#22c55e',
        timeLabel: '연락 가능',
        tenantId:  c.tenantId,
        detail,
      })
      continue
    }

    const text = `${g.roomNo}호 ${stateLabel} — 매칭 후보 ${g.candidates.length}명`
    const detail = g.candidates
      .map(c => `${c.rank}순위 ${c.tenantName}님 · ${c.matchedBy === 'conditions' ? '조건 매칭' : '호실 지정'}`)
      .join('\n')
    alertItems.push({
      category:  'wish',
      text,
      link:      `/room-manage`,
      dotColor:  '#22c55e',
      timeLabel: `후보 ${g.candidates.length}명`,
      detail,
      wishCandidates: g.candidates.map(c => ({
        tenantId: c.tenantId,
        tenantName: c.tenantName,
        rank: c.rank,
        matchedBy: c.matchedBy,
      })),
      wishRoomNo: g.roomNo,
    })
  }

  // 미수/도래임박 알림 — 정책:
  //  · 도래·미회수 portion 있음(overduePortion > 0) → 누적 미수 카테고리 (오래 경과한 순)
  //  · 미도래·미회수만 + days >= -7 → 납부 예정 카테고리 (가까운 순)
  //  · 8일 이상 여유 → 알림 X
  for (const l of unpaidCandidates) {
    const days = l.daysOverdue
    if (days == null) continue
    if (l.overduePortion > 0 && days >= 1) {
      alertItems.push({
        category:  'unpaid',
        text:      `${l.tenantName}님 ${l.roomNo}호 미납 ${days}일 경과`,
        link:      `/rooms?tenantId=${l.tenantId}`,
        dotColor:  '#dc2626',
        timeLabel: `${days}일 경과`,
        tenantId:  l.tenantId,
        detail:    `미수금 ${l.overduePortion.toLocaleString()}원이 ${days}일 동안 회수되지 않고 있습니다.`,
        sortKey:   -days,
      })
    } else if (l.upcomingPortion > 0 && days < 0 && days >= -UNPAID_UPCOMING_ALERT_DAYS) {
      // D-N 또는 오늘 도래 — 별도 '납부 예정' 카테고리
      const timeLabel = days === 0 ? '오늘 납부일' : `D-${Math.abs(days)}`
      alertItems.push({
        category:  'upcoming',
        text:      `${l.tenantName}님 ${l.roomNo}호 납부 예정`,
        link:      `/rooms?tenantId=${l.tenantId}`,
        dotColor:  '#d4a847',
        timeLabel,
        tenantId:  l.tenantId,
        detail:    `청구 예정액 ${l.upcomingPortion.toLocaleString()}원${days === 0 ? ' — 오늘이 납부일입니다.' : ` — ${Math.abs(days)}일 후 납부 예정.`}`,
        sortKey:   days,
      })
    } else if (l.overduePortion > 0 && days === 0) {
      // 오늘 도래·미회수 (드문 케이스)
      alertItems.push({
        category:  'unpaid',
        text:      `${l.tenantName}님 ${l.roomNo}호 오늘 납부일`,
        link:      `/rooms?tenantId=${l.tenantId}`,
        dotColor:  '#dc2626',
        timeLabel: '오늘',
        tenantId:  l.tenantId,
        detail:    `미수금 ${l.overduePortion.toLocaleString()}원이 오늘 도래입니다.`,
        sortKey:   0,
      })
    }
  }

  for (const r of tenantRequestsRaw) {
    const daysLeft = r.targetDate
      ? (() => {
          const t = new Date(r.targetDate)
          const targetDay = new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
          return Math.round((targetDay.getTime() - today.getTime()) / 86400000)
        })()
      : null
    alertItems.push({
      category:  'request',
      text:      `${r.tenant.name}님 요청: ${r.content.slice(0, 28)}${r.content.length > 28 ? '…' : ''}`,
      link:      `/tenants?tenantId=${r.tenantId}&tab=requests`,
      dotColor:  '#f4623a',
      timeLabel: daysLeft != null ? (daysLeft <= 0 ? '처리 필요' : `D-${daysLeft}`) : '미처리',
      tenantId:  r.tenantId,
      detail:    r.content + (r.targetDate ? `\n처리 기한: ${fmtKorDate(r.targetDate)}` : ''),
      exactDate: fmtShortDate(r.targetDate),
    })
  }

  // ── 재고 부족 알림 (소진 예상 D-3 이내) ────────────────────
  try {
    const { getInventoryOverview } = await import('@/app/(app)/inventory/actions')
    const inventoryRows = await getInventoryOverview()
    for (const r of inventoryRows) {
      if (r.daysUntilEmpty == null || r.daysUntilEmpty > r.alertThresholdDays) continue
      const stockLabel = r.currentStock != null
        ? `${Math.round(r.currentStock * 100) / 100}${r.qtyUnit ?? ''}`
        : '잔량 미상'
      alertItems.push({
        category:  'inventory',
        text:      `${r.label} 재고 부족 (${stockLabel} 남음)`,
        link:      '/inventory',
        dotColor:  '#d4a847',
        timeLabel: r.daysUntilEmpty <= 0 ? '소진 임박' : `D-${r.daysUntilEmpty}`,
        detail:    `${r.category} · ${r.label}\n현재 잔량: ${stockLabel}\n평균 소모: ${r.avgDaily ? `${Math.round(r.avgDaily * 100) / 100}${r.qtyUnit ?? ''}/일` : '—'}\n소진 예상: ${r.daysUntilEmpty}일\n알림 기준: D-${r.alertThresholdDays}${r.reorderMemo ? `\n발주 메모: ${r.reorderMemo}` : ''}`,
      })
    }
  } catch { /* inventory 모듈 로드 실패 시 무시 */ }

  // ── 체크리스트 알림 (도래일 N일 이내 또는 경과) ────────────
  try {
    const { getDueChecklists } = await import('@/app/(app)/checklist/actions')
    const dueList = await getDueChecklists()
    for (const c of dueList) {
      let timeLabel: string
      if (c.daysUntilDue == null) timeLabel = '점검 필요'
      else if (c.daysUntilDue < 0) timeLabel = `${Math.abs(c.daysUntilDue)}일 경과`
      else if (c.daysUntilDue === 0) timeLabel = '오늘'
      else timeLabel = `D-${c.daysUntilDue}`
      const intervalText = c.intervalDays === 1 ? '매일'
        : c.intervalDays === 7 ? '매주'
        : c.intervalDays === 14 ? '격주'
        : c.intervalDays === 30 ? '매월'
        : c.intervalDays === 90 ? '분기'
        : `${c.intervalDays}일마다`
      alertItems.push({
        category:  'inventory',
        text:      `체크리스트: ${c.title}`,
        link:      '/checklist',
        dotColor:  '#d4a847',
        timeLabel,
        detail:    `주기: ${intervalText}${c.memo ? `\n${c.memo}` : ''}\n마지막 점검: ${c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleDateString('ko-KR') : '없음'}${c.nextDueAt ? `\n다음 도래: ${new Date(c.nextDueAt).toLocaleDateString('ko-KR')}` : ''}`,
      })
    }
  } catch { /* checklist 모듈 로드 실패 시 무시 */ }

  // ── 고정 지출 알림 ───────────────────────────────────────────

  // 자동이체 실제 이체일 — 주말·공휴일 회피 (lib/krHolidays에서 동적 조회)
  const getEffectiveTransferDate = getNextBusinessDay

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
      category:            'recurring',
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
    reserveBalance,
    reserveMonthly,
    paidCount,
    unpaidCount,
    upcomingCount,
    pendingCount,
    unpaidAmount,
    overdueAmount,
    upcomingAmount,
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
    unpaidRoomNosForView,
    awaitingRoomNosForView,
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
  const targetMonth = month ?? kstMonthStr()

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
