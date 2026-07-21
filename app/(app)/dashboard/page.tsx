import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import { fmtWon } from '@/lib/fmtMoney'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import DashboardClient, { type DashboardData } from './DashboardClient'
import { getPaymentMethods } from '@/app/(app)/settings/actions'
import { getRecurringExpensesWithStatus } from '@/app/(app)/finance/actions'
import { applyScheduledRents } from '@/app/(app)/room-manage/actions'
import { kstMonthStr, kstYmd } from '@/lib/kstDate'
import { ALERT_WINDOW_BEFORE_DAYS, ALERT_WINDOW_AFTER_DAYS, UNPAID_UPCOMING_ALERT_DAYS } from '@/lib/appConfig'
import { getNextBusinessDay } from '@/lib/krHolidays'
import { billForLeaseMonth, isCheckoutNoBillingMonthFor, resolveDueDateForMonth } from '@/lib/billing'
import { getCheckedOutLeasesWithRevenue, getCheckedOutRecognizedRevenue } from '@/lib/leaseStatus'
import { getFloorPlan } from '@/app/(app)/floor-plan/actions'
import FloorPlanWidget from '@/app/(app)/floor-plan/FloorPlanWidget'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { vacancyExcludedWhere, isVacancyExcluded } from '@/lib/vacancy'

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
  return `${days}일 남음`
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

  // ── 응답시간: 서로 독립인 조회를 여기서 미리 시작 — await는 각 사용 지점 그대로 ──
  // 값·계산식·에러 처리 불변, 쿼리 시작 시점만 앞당김(순차 왕복 → 동시 실행).
  const pCheckedOutRev        = getCheckedOutLeasesWithRevenue(prisma, propertyId, targetMonth)
  const pCheckedOutRecognized = getCheckedOutRecognizedRevenue(prisma, propertyId, targetMonth)
  const pRecurringWithStatus  = getRecurringExpensesWithStatus(targetMonth)
  const pDepositRecordedAgg   = prisma.paymentRecord.aggregate({
    where: { propertyId, isDeposit: true, leaseTerm: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } } },
    _sum: { actualAmount: true },
  })
  // 예약 확정 전(RESERVED) 실수납 예약금 — 계약 보증금 총액엔 미포함이나 이미 받은 현금이라
  // 실수납·총액 양쪽에 동일 가산해 재무 요약과 정합(입주 전이므로 아직 안 받은 예약 보증금은 제외).
  const pReservedDepositReceivedAgg = prisma.paymentRecord.aggregate({
    where: { propertyId, isDeposit: true, leaseTerm: { status: 'RESERVED' } },
    _sum: { actualAmount: true },
  })
  const pReservedLeases = prisma.leaseTerm.findMany({
    where: { propertyId, status: 'RESERVED', rentAmount: { gt: 0 } },
    select: {
      id: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true } },   // 예약 인상 — 미래월 청구 반영
    },
  })
  const [tcY, tcM] = targetMonth.split('-').map(Number)
  const pLastExpAggs = Promise.all([
    prisma.expense.aggregate({ where: { propertyId, date: { gte: new Date(tcY, tcM - 2, 1), lte: new Date(tcY, tcM - 1, 0) } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { propertyId, date: { gte: new Date(tcY - 1, tcM - 1, 1), lte: new Date(tcY - 1, tcM, 0) } }, _sum: { amount: true } }),
  ])
  const pOverduConfirmed = prisma.leaseTerm.findMany({
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
  const pInventoryRows = import('@/app/(app)/inventory/actions').then(m => m.getInventoryOverview()).catch(() => null)
  const pStockDrafts = prisma.stockCheckDraft.findMany({
    where: { trackedItem: { propertyId } },
    select: {
      trackedItemId: true,
      updatedAt: true,
      trackedItem: { select: { label: true, category: true } },
    },
    orderBy: { updatedAt: 'desc' },
  }).catch(() => null)
  // 조기 시작 프라미스의 unhandled rejection 방지 — 실제 에러는 각 await 지점에서 기존대로 전파
  for (const p of [pCheckedOutRev, pCheckedOutRecognized, pRecurringWithStatus, pDepositRecordedAgg, pReservedDepositReceivedAgg, pReservedLeases, pLastExpAggs, pOverduConfirmed] as Promise<unknown>[]) { void p.catch(() => {}) }

  const [
    activeLeases,
    payments,
    expenses,
    incomes,
    totalRooms,
    vacantRooms,
    excludedRooms,
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
    reserveTxnsRaw,
    allMonthPayments,
    tourDoneCount,
  ] = await Promise.all([
    prisma.leaseTerm.findMany({
      // RESERVED는 아직 입주 안 한 상태 → 미수 합산 대상에서 제외
      where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      // #14 월세 할인 — 수납현황 위젯(완료 건수·예상 수입)에 할인 반영
      // moveInDate·expectedMoveOut — 이번달 청구 대상 여부 판정(다음달 입주자가 이번달 매출에 잡히는 버그 방지)
      // dueDay·override — 퇴실월 무청구(checkoutNoBilling) 판정용 (lib/billing 공용 규칙)
      select: { id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true, dueDay: true, overrideDueDay: true, overrideDueDayMonth: true, checkoutProratedAmount: true, checkoutProratedMonth: true, discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } }, room: { select: { scheduledRent: true, rentUpdateDate: true } } },
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId, targetMonth, isDeposit: false, isPrevOwner: false,
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
    // 공실 = isVacant 이면서 '집계 제외'(창고·사무실, lib/vacancy 정본) 아님 — 호실관리 공실 수와 정합(신고 9d844226)
    prisma.room.count({ where: { propertyId, isVacant: true, NOT: vacancyExcludedWhere } }),
    prisma.room.count({ where: { propertyId, isVacant: true, ...vacancyExcludedWhere } }),
    prisma.leaseTerm.aggregate({
      // 보유 보증금 = 실제 거주 중(입주 완료)인 계약만. RESERVED(입실 전)는 보증금 입력만 했을 뿐
      // 아직 받은 게 아니므로 제외(입주하면 ACTIVE 로 바뀌며 자동 포함). 사용자 보고 2026-06-05.
      where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
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
        room:   { select: { roomNo: true, type: true, floor: true, windowType: true, direction: true, baseRent: true } },
      },
      orderBy: { expectedMoveOut: { sort: 'asc', nulls: 'last' } },
    }),
    // 6개월 트렌드
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        targetMonth: { in: last6Months },
        isDeposit: false,
        isPrevOwner: false,
        // RESERVED 선납·취소분 제외(조기 매출 차단). CHECKED_OUT는 유지 — dashboard/actions fetchRangeData와 동일 규칙.
        leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } },
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
    // 희망 이동 호실용 공실 목록 (조건 매칭에 type/windowType/direction/baseRent 사용)
    prisma.room.findMany({
      // 비거주 점유 중 + '공실 표시 안 함' 방(창고·사무실)은 이동 후보에서 제외 (2026-07-06, lib/vacancy 정본)
      where: {
        propertyId, isVacant: true,
        NOT: vacancyExcludedWhere,
      },
      select: { roomNo: true, type: true, floor: true, windowType: true, direction: true, baseRent: true },
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
        id: true,
        roomNo: true,
        isVacant: true,
        nonResidentVacant: true,
        type: true,
        tier: true,
        floor: true,
        windowType: true,
        direction: true,
        areaPyeong: true,
        areaM2: true,
        baseRent: true,
        scheduledRent: true,
        rentUpdateDate: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          select: { id: true, tenant: { select: { id: true, name: true } }, status: true, rentAmount: true },
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
      // 납입완료 피드 범위 = (이 달에 낸 결제) ∪ (이 달분 결제).
      //   → 7월분을 6월에 선납한 건: 6월 화면(payDate∈6월)·7월 화면(targetMonth=7월) 양쪽에 뜬다. 각 줄에 귀속월·선납/지연 뱃지.
      return prisma.paymentRecord.findMany({
        where: {
          propertyId,
          isDeposit: false,
          isPrevOwner: false,
          NOT: { memo: { contains: '[납입일변경]' } },
          OR: [
            { payDate: { gte: monthStart, lte: monthEnd } },
            { targetMonth },
          ],
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
        take: 40,
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
        // 퇴실 일할 정산 — 그 달 청구를 저장된 일할액으로 덮어씀(rooms·unpaid.ts 와 동일)
        checkoutProratedAmount: true,
        checkoutProratedMonth: true,
        isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing) — moveInDate와 함께 판정
        // #14 월세 할인 — 발생주의 미수 계산에 월별 할인 반영
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        room: { select: { id: true, roomNo: true, scheduledRent: true, rentUpdateDate: true } },   // 예약 인상 — 미래월 청구 반영
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
      select: { leaseTermId: true, targetMonth: true, actualAmount: true, expectedAmount: true, payDate: true, memo: true, isPrevOwner: true },
    }),
    prisma.reserveTransaction.findMany({
      where: { propertyId },
      select: { type: true, amount: true, date: true, sourceMonth: true },
    }),
    prisma.paymentRecord.findMany({
      where: { propertyId, targetMonth, isDeposit: false, isPrevOwner: false },
      select: { leaseTermId: true, actualAmount: true },
    }),
    // '문의·투어' StatCard 집계용 — 라벨에 걸맞게 투어 완료도 포함(e1b81629 후속, 운영자 승인)
    prisma.leaseTerm.count({ where: { propertyId, status: 'TOUR_DONE' } }),
  ])

  // ── 이달 집계 ────────────────────────────────────────────────
  const activeLeaseIds  = new Set(activeLeases.map(l => l.id))
  const leaseRentMap    = new Map(activeLeases.map(l => [l.id, l.rentAmount]))

  // CHECKED_OUT lease 도 그 달 귀속 입금이 있으면 매출 인식 (totalExpected/Revenue 통일 정책).
  // 단기 입주 후 퇴실(예: 5월 단기 정산) + 거주 중 중도퇴실(예: 월초 입금 후 퇴실).
  // 헬퍼: lib/leaseStatus.ts — 같은 의도의 다른 페이지도 이 헬퍼 사용.
  const checkedOutLeasesForRev = await pCheckedOutRev
  for (const l of checkedOutLeasesForRev) {
    activeLeaseIds.add(l.id)
    leaseRentMap.set(l.id, l.rentAmount)
  }

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
  // RESERVED 실수납 예약금 — 총액·실수납 양쪽에 같은 값을 더해 미기록분(차이)은 불변으로 유지.
  const reservedDepositReceived = (await pReservedDepositReceivedAgg)._sum.actualAmount ?? 0
  const totalDeposit = (depositAgg._sum.depositAmount ?? 0) + reservedDepositReceived
  // 보유 보증금 분해 — 실수납(보증금 입금기록 있음) vs 미기록(전 원장 등 기록 없이 계약상만).
  // 총액(totalDeposit, 계약 기준)은 유지하고 아래에 분해만 표기 → 전 원장 보증금 누락 위험 없음.
  const depositRecordedAgg = await pDepositRecordedAgg
  const depositRecorded = (depositRecordedAgg._sum.actualAmount ?? 0) + reservedDepositReceived
  const depositUnrecorded = Math.max(0, totalDeposit - depositRecorded)

  // 예상 매출/순이익은 unpaidLeasesRaw 루프(line ~832) 안에서 projectedThisMonthByLease
  // 가 채워진 뒤 계산해야 함 → 아래 unpaidAmount 계산 직후로 이동.

  // ── 예비비 잔고 + 이달 적립/사용 ─────────────────────────────────
  const reserveTxns = reserveTxnsRaw
  let reserveBalance = 0
  let reserveMonthlyDeposit = 0
  let reserveMonthlyWithdraw = 0
  let reserveAccrualFromThisMonth = 0  // 출처가 이 달 매출인 적립 합계 (sourceMonth=targetMonth)
  for (const r of reserveTxns) {
    const isDep = r.type === 'DEPOSIT'
    if (isDep) reserveBalance += r.amount
    else reserveBalance -= r.amount
    if (r.date >= startDate && r.date <= endDate) {
      if (isDep) reserveMonthlyDeposit += r.amount
      else reserveMonthlyWithdraw += r.amount
    }
    if (isDep && r.sourceMonth === targetMonth) reserveAccrualFromThisMonth += r.amount
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
  // 예상 지출 — 사용자 정의(2026-05-31): 실제 발생 지출 + 이번 달 미발생 고정지출.
  // 이 값은 page 후반(loop 뒤)에 totalExpense 와 projectedRecurringExpense 가 준비된 후 계산.
  let expectedExpense = 0  // placeholder, 아래에서 다시 채움

  // 완납 여부 판단 — viewMonth(targetMonth) 기준 그 월의 납부 이력으로 평가
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

  // 납부일 임시조정(override)을 절대 날짜로 해석 (unpaid.ts 와 동기화 — 한쪽 수정 시 양쪽).
  function overrideAbsDate(
    l: { overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
  ): Date | null {
    if (!l.overrideDueDay || !l.overrideDueDayMonth) return null
    if (l.overrideDueDay.includes('-')) {
      const [yy, mm, dd] = l.overrideDueDay.split('-').map(Number)
      return new Date(yy, mm - 1, dd)
    }
    const [yy, mm] = l.overrideDueDayMonth.split('-').map(Number)
    const day = l.overrideDueDay.includes('말') ? new Date(yy, mm, 0).getDate() : parseInt(l.overrideDueDay, 10)
    if (isNaN(day) || day < 1) return null
    return new Date(yy, mm - 1, day)
  }

  // 특정 미납 월의 경과일 — 납부일 유예 반영 (unpaid.ts daysOverdueForMonth 와 동일 규칙).
  // override 가 이 월(또는 이후)에 걸려 있고 유예 날짜가 원래 납부일보다 늦으면 유예 날짜 기준.
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
        if (orig == null || days <= orig) return days
      }
    }
    return calcDaysOverdueForMonth(effectiveDueDayForMonth(l, monthStr), monthStr)
  }

  const paymentByLease = payments.reduce((acc, p) => {
    acc[p.leaseTermId] = (acc[p.leaseTermId] ?? 0) + p.actualAmount
    return acc
  }, {} as Record<string, number>)

  // 이번달(targetMonth) 청구 대상 여부 — 입주월 ≤ 대상월 ≤ 퇴실월.
  // (다음달 입주 예정인 ACTIVE 계약이 이번달 예상매출에 잡히던 버그 방지: 507·509호 사례)
  const monthOfDate = (d: Date | string | null): string | null => {
    if (!d) return null
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }
  const billableInTargetMonth = (l: { moveInDate?: Date | string | null; expectedMoveOut?: Date | string | null }): boolean => {
    const mi = monthOfDate(l.moveInDate ?? null)
    if (mi && mi > targetMonth) return false   // 아직 입주 전
    const mo = monthOfDate(l.expectedMoveOut ?? null)
    if (mo && mo < targetMonth) return false   // 이미 퇴실
    return true
  }
  const billableLeases = activeLeases.filter(l => l.rentAmount > 0 && billableInTargetMonth(l))

  // 양도인 정산(isPrevOwner) record가 있는 (lease, month) — 그 월은 현 원장 청구·매출에서 제외.
  // [저장 청구액 우선] 락인 맵 — 둘 다 아래 '누적 미납 상세' 블록과 공유 (한 번만 구성).
  const prevOwnerMonthsByLease: Record<string, Set<string>> = {}
  const lockedExpectedByLeaseMonth: Record<string, Map<string, number>> = {}
  for (const p of allHistoricalPayments) {
    if (p.isPrevOwner) {
      ;(prevOwnerMonthsByLease[p.leaseTermId] ??= new Set()).add(p.targetMonth)
      continue
    }
    const m = (lockedExpectedByLeaseMonth[p.leaseTermId] ??= new Map())
    const cur = m.get(p.targetMonth) ?? 0
    if (p.expectedAmount > cur) m.set(p.targetMonth, p.expectedAmount)
  }

  // 이달(targetMonth) 청구액 — 일할→락인→할인(lib/billing 공용, rooms·unpaid.ts 와 동일).
  // 양도인 정산 월·퇴실월 무청구(납부일 이전 퇴실)는 0. 완납 판정·예상 수입 모두 이 값 기준.
  const billThisMonth  = (l: typeof activeLeases[number]) => {
    if (prevOwnerMonthsByLease[l.id]?.has(targetMonth)) return 0
    const dueRaw = (l.overrideDueDayMonth === targetMonth && l.overrideDueDay) ? l.overrideDueDay : l.dueDay
    if (isCheckoutNoBillingMonthFor(l, l.expectedMoveOut, targetMonth, resolveDueDateForMonth(dueRaw, targetMonth))) return 0
    return billForLeaseMonth(l, targetMonth, lockedExpectedByLeaseMonth[l.id]?.get(targetMonth) ?? null)
  }
  const paidCount      = billableLeases.filter(l => (paymentByLeaseForStatus[l.id] ?? 0) >= billThisMonth(l)).length

  // ── 단기 입주·중도퇴실 lease 의 매출 추가 인식 (lib/leaseStatus.ts 정책)
  // 일할 정산되는 짧은 거주를 과다 인식하지 않도록 rentAmount 전체가 아닌
  // 그 달 귀속 paymentRecord 합계만 인식. paidRevenue 의 CHECKED_OUT 포함 정책과 통일.
  const checkedOutRecognized = await pCheckedOutRecognized

  // 신규 입실자(예약확정 RESERVED)의 이번 달 예상 매출 — 입주 예정월이 이 달 이내면 전액(할인 반영) 가산.
  // (사용자 결정 2026-06-20: RESERVED 이상은 그 달 전액으로 예상 매출에 반영. 입주 후엔 ACTIVE 로 일반 청구.)
  const reservedLeases = await pReservedLeases
  const reservedExpected = reservedLeases
    .filter(l => billableInTargetMonth(l))
    .reduce((s, l) => s + billForLeaseMonth(l, targetMonth, null), 0)

  // 양도인 몫 제외 — 수납완료 + 미수납과 합산이 맞도록
  const totalExpected  = billableLeases
    .filter(l => !prevOwnerLeaseIds.has(l.id))
    .reduce((s, l) => s + billThisMonth(l), 0)
    + checkedOutRecognized + reservedExpected

  const categoryBreakdown = expByCategory.map(c => ({
    category: c.category,
    amount:   c._sum.amount ?? 0,
    percent:  totalExpense > 0 ? Math.round(((c._sum.amount ?? 0) / totalExpense) * 100) : 0,
  }))

  // ── 희망 호실/조건 알림 ──────────────────────────────────────
  // "공실"로 간주: 실제 공실(isVacant) + 퇴실 예정(CHECKOUT_PENDING) 호실
  type TargetRoomInfo = { roomNo: string; type: string | null; floor: string | null; windowType: string | null; direction: string | null; baseRent: number; isCheckoutPending: boolean }
  const vacantInfoMap = new Map<string, TargetRoomInfo>()
  for (const r of vacantRoomList) {
    vacantInfoMap.set(r.roomNo, { roomNo: r.roomNo, type: r.type, floor: r.floor ?? null, windowType: r.windowType, direction: r.direction, baseRent: r.baseRent, isCheckoutPending: false })
  }
  for (const l of moveOutLeases) {
    const r = l.room
    if (!r?.roomNo) continue
    if (vacantInfoMap.has(r.roomNo)) continue
    vacantInfoMap.set(r.roomNo, { roomNo: r.roomNo, type: r.type, floor: r.floor ?? null, windowType: r.windowType, direction: r.direction, baseRent: r.baseRent ?? 0, isCheckoutPending: true })
  }

  const matchesConditions = (room: TargetRoomInfo, raw: string | null): boolean => {
    if (raw == null) return false
    let cond: { floor?: string; windowType?: string; type?: string; direction?: string; minRent?: number; maxRent?: number }
    try { cond = JSON.parse(raw) } catch { return false }
    if (!cond) return false
    // 빈 객체 = 조건 무관 → 모든 빈 방 매칭
    const roomFloor = room.floor ?? (() => {
      const n = room.roomNo.replace(/[^0-9]/g, '')
      return n.length >= 3 ? n.slice(0, n.length - 2) : ''
    })()
    if (cond.floor && cond.floor !== roomFloor) return false
    if (cond.windowType && cond.windowType !== room.windowType) return false
    if (cond.type && cond.type !== room.type) return false
    if (cond.direction && cond.direction !== room.direction) return false
    if (cond.minRent != null && room.baseRent < cond.minRent) return false
    if (cond.maxRent != null && room.baseRent > cond.maxRent) return false
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

    // 2) 조건 매칭 — 호실 미지정자가 wishConditions를 등록한 경우, 조건에 부합하는 모든 빈 방에 후보로 등록.
    //    단 '조건 무관'(빈 객체 "{}")은 '호실 미지정 seeker'에게만. 이미 방 배정된 거주중/퇴실예정의 잔여 "{}"는
    //    '아무 방이나'로 잘못 매칭되므로 제외(구체 조건이 있는 실제 이동희망은 그대로 매칭). 2026-07-01 오탐 수정(412호 등).
    if (l.wishConditions) {
      const hasRealCond = (() => {
        try { const c = JSON.parse(l.wishConditions!); return !!c && Object.values(c).some(v => v != null && v !== '') } catch { return false }
      })()
      if (hasRealCond || !l.room?.roomNo) for (const info of vacantInfoMap.values()) {
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
    id:            r.id,
    roomNo:        r.roomNo,
    isVacant:      r.isVacant,
    // 집계 제외(창고·사무실) — 배치도 등에서 공실로 칠하지 않기 위한 파생값(lib/vacancy 정본)
    vacancyExcluded: isVacancyExcluded(r, r.leaseTerms.some(l => l.status === 'NON_RESIDENT')),
    type:          r.type,
    tier:          r.tier as string | null,
    floor:         r.floor as string | null,
    windowType:    r.windowType as string | null,
    direction:     r.direction as string | null,
    areaPyeong:    r.areaPyeong,
    areaM2:        r.areaM2,
    baseRent:      r.baseRent,
    scheduledRent: r.scheduledRent,
    rentUpdateDate: r.rentUpdateDate ? new Date(r.rentUpdateDate).toISOString().slice(0, 10) : null,
    tenantName:       r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.tenant.name ?? null,
    tenantId:         r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.tenant.id ?? null,
    tenantStatus:     r.leaseTerms.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))?.status ?? null,
    nonResidentName:  r.leaseTerms.find(l => l.status === 'NON_RESIDENT')?.tenant.name ?? null,
    nonResidentId:    r.leaseTerms.find(l => l.status === 'NON_RESIDENT')?.tenant.id ?? null,
  }))

  // ── 누적 미납 상세 — 발생주의(targetMonth 기반) ──────────
  // "오늘 월 이하의 targetMonth로 인식된 매출" vs "청구 가능 월 수 × 임대료"의 차이
  // (allHistoricalPayments는 이미 targetMonth ≤ realTodayMonthStr 필터됨)
  // prevOwnerMonthsByLease · lockedExpectedByLeaseMonth 는 위쪽(billThisMonth 직전)에서 구성 — 공유.

  const accrualByLease: Record<string, number> = {}
  for (const p of allHistoricalPayments) {
    // cutoff 이전 (양도인) 제외 + 양도인 정산 record 제외
    if (p.isPrevOwner) continue
    if (acquisitionDate && new Date(p.payDate) < acquisitionDate) continue
    accrualByLease[p.leaseTermId] = (accrualByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }

  // 인수월에 사용자가 받은 record(payDate >= cutoff) 합 — 양도인 자동 처리 판정용
  const opPaidInCutoffMonthByLease: Record<string, number> = {}
  if (cutoffMonthStr && acquisitionDate) {
    for (const p of allHistoricalPayments) {
      if (p.isPrevOwner) continue
      if (p.targetMonth !== cutoffMonthStr) continue
      if (new Date(p.payDate) < acquisitionDate) continue
      opPaidInCutoffMonthByLease[p.leaseTermId] = (opPaidInCutoffMonthByLease[p.leaseTermId] ?? 0) + p.actualAmount
    }
  }

  // viewMonth(targetMonth) 기준 누적 미납 — viewMonth가 과거이면 그 월말 시점, 현재/미래면 오늘 시점과 동일
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
    const billableMonthList: string[] = []
    const lPrevOwnerMonths = prevOwnerMonthsByLease[l.id]
    for (const mon of months) {
      if (mon === cutoffMonthStr && acqMonthAutoPaid) continue
      if (prevOwnerLeaseIds.has(l.id) && mon === cutoffMonthStr) continue
      // 양도인 정산 처리된 월 — 현 원장 청구 제외
      if (lPrevOwnerMonths?.has(mon)) continue
      if (moveOutMonth && mon > moveOutMonth) continue
      // 퇴실월 무청구 — 퇴실예정일이 그 월 납부일 이전이면 청구 0 (rooms·unpaid.ts 와 동일, lib/billing 공용)
      if (isCheckoutNoBillingMonthFor(l, l.expectedMoveOut, mon, resolveDueDateForMonth(effectiveDueDayForMonth(l, mon), mon))) continue
      billableMonthList.push(mon)
    }
    // 청구 규칙(일할→락인→할인)은 lib/billing 공용 — rooms·unpaid.ts 와 동일
    const lockedMap = lockedExpectedByLeaseMonth[l.id]
    const billForMonth = (mon: string) => billForLeaseMonth(l, mon, lockedMap?.get(mon) ?? null)
    const totalExpected = billableMonthList.reduce((s, mon) => s + billForMonth(mon), 0)
    const totalReceived = accrualByLeaseForView[l.id] ?? 0
    unpaidMap[l.id] = Math.max(0, totalExpected - totalReceived)
    // 이번 달 청구액 — totalExpected 가 별도 계산 (line 586). 통일 위해 그쪽 사용.

    // 첫 미수월 추적 — 받은 돈을 청구 가능 월에 차례로 배분, 부족한 첫 월
    let allocated = 0
    let firstUnpaid: string | null = null
    for (const mon of billableMonthList) {
      if (totalReceived - allocated < billForMonth(mon)) { firstUnpaid = mon; break }
      allocated += billForMonth(mon)
    }
    firstUnpaidByLease[l.id] = firstUnpaid

    // 월별 도래·미도래 portion 분리 — FIFO 충당 후 각 월의 미충당분을 dueDay 도래 여부로 분류
    let received = totalReceived
    let leaseOverdue = 0
    let leaseUpcoming = 0
    for (const mon of billableMonthList) {
      const monthBill = billForMonth(mon)
      const allocThis = Math.min(received, monthBill)
      received -= allocThis
      const monthUnpaid = monthBill - allocThis
      if (monthUnpaid <= 0) continue
      const days = daysOverdueForMonth(l, mon)
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

  // ── 예상 매출/지출/순이익 (2026-05-31, KPI 카드와 손익 현황 통일) ────────
  //   예상 매출 = 이번 달 청구액(할인·override 반영) + 발생 기타수익
  //              · totalExpected 는 page 앞쪽에서 billableLeases 기반 계산됨 (양도인 제외)
  //   예상 지출 = 발생 지출 + 이번 달 미발생 고정지출 (사용자 정의: 검증식 totalExpense+projectedRecurring)
  //   예상 순이익 = 예상 매출 - 예상 지출
  // 지출 화면과 동일한 추정식으로 통일: 임시조정 → 과거평균(변동) → 기본액.
  // (getRecurringExpensesWithStatus 재사용 — 두 화면이 같은 데이터·식을 써 금액이 일치)
  const recurringWithStatus = await pRecurringWithStatus
  const projectedRecurringExpense = recurringWithStatus
    .filter(r => !r.isPending && !r.recordedExpenseId)
    .reduce((s, r) => s + (r.pendingAmount ?? r.historicalAvg ?? r.amount), 0)
  const projectedRevenue = totalExpected + extraRevenue
  // 과거 조회월은 미기록 고정지출 추정을 가산하지 않는다 — 실제 지출만 반영해 결산보고서와 정합.
  // 현재·미래 월만 추정 가산. 월 비교는 KST 기준(realTodayMonthStr = kstMonthStr()) 문자열 비교.
  const isPastMonth = targetMonth < realTodayMonthStr
  expectedExpense = isPastMonth ? totalExpense : totalExpense + projectedRecurringExpense
  const projectedNetProfit = projectedRevenue - expectedExpense
  // 지출 통제가능성 3단계 (홈 월지출 위젯) — 노력으로 줄일 수 있는 정도 순:
  //   ① 불변 고정(월임대료 등 isVariable=false) — 못 줄임
  //   ② 변동 고정(전기·수도 등 isVariable=true) — 노력하면 줄임
  //   ③ 세이브 가능(비고정 지출) = 예상 지출 − 고정 합 — 가장 줄이기 쉬움
  const recMonthAmt = (r: { pendingAmount: number | null; historicalAvg: number | null; amount: number }) =>
    r.pendingAmount ?? r.historicalAvg ?? r.amount
  const tierImmovable = recurringWithStatus.filter(r => !(r as { isVariable?: boolean }).isVariable).reduce((s, r) => s + recMonthAmt(r), 0)
  const tierVariable  = recurringWithStatus.filter(r => (r as { isVariable?: boolean }).isVariable).reduce((s, r) => s + recMonthAmt(r), 0)
  const tierSavable   = Math.max(0, expectedExpense - tierImmovable - tierVariable)
  // 지난달·전년동월 지출(실제 합계) — 예상 지출이 더/덜 쓰는지 비교용 (trend는 6개월뿐이라 전년동월은 별도 집계)
  const [lastMonthExpAgg, lastYearExpAgg] = await pLastExpAggs
  const lastMonthExpense = lastMonthExpAgg._sum.amount ?? 0
  const lastYearExpense  = lastYearExpAgg._sum.amount ?? 0
  // 수납 예정 = 이번 달 청구 중 아직 안 들어온 매출 = 예상 매출 − 수납완료(귀속).
  // 이렇게 정의해야 손익 패널이 정합: 예상매출 = 수납완료 + 수납예정,
  // 예상순이익 = 현재순이익 + 수납예정 − 예정고정지출.
  // (기존엔 accrual-net 미납액만 표기해 도래 전 청구·선납분이 빠져 합산이 안 맞았음)
  const pendingRevenue = Math.max(0, projectedRevenue - totalRevenue)
  // 미수납 후보 — 이후 daysOverdue 기반으로 위젯·알림 분기
  const unpaidCandidates = unpaidLeasesRaw
    .filter(l => (unpaidMap[l.id] ?? 0) > 0)
    .map(l => {
      const unpaid = unpaidMap[l.id]!
      const monthsOverdue = l.rentAmount > 0 ? Math.ceil(unpaid / l.rentAmount) : 0
      const firstUnpaid = firstUnpaidByLease[l.id] ?? null
      const daysOverdue = firstUnpaid ? daysOverdueForMonth(l, firstUnpaid) : null
      const overduePortion = overdueByLease[l.id] ?? 0
      const upcomingPortion = upcomingByLease[l.id] ?? 0
      return {
        roomNo:        l.room?.roomNo ?? '?',
        roomId:        l.room?.id ?? null,
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

  // ── 비거주자 현황 ────────────────────────────────────────────
  const nonResidentItems = roomsWithTenants.flatMap(r =>
    r.leaseTerms
      .filter(l => l.status === 'NON_RESIDENT')
      .map(l => ({
        roomNo:     r.roomNo,
        tenantId:   l.tenant.id,
        tenantName: l.tenant.name,
        rentAmount: l.rentAmount,
        payStatus:  (overdueByLease[l.id] ?? 0) > 0 ? 'unpaid'   as const
                  : (upcomingByLease[l.id] ?? 0) > 0 ? 'awaiting' as const
                  : 'paid' as const,
      }))
  )

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
        dotColor:  'var(--success-fg)',
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
      text:      `${l.tenant.name}님 ${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}입실 희망${isConfirmed ? ' (예약 확정)' : ' (입실 예약)'}`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  isConfirmed ? 'var(--success-fg)' : 'var(--info-fg)',
      timeLabel: dayLabel(days),
      tenantId:  l.tenant.id,
      detail:    fmtKorDate(l.moveInDate)
        ? `입주 희망일: ${fmtKorDate(l.moveInDate)}${isConfirmed ? ' · 예약 확정' : ' · 입주 미확정 (입실 예약 단계)'}`
        : undefined,
      exactDate: fmtShortDate(l.moveInDate),
    })
  }

  // 7일보다 오래된 과거 입주 희망일을 가진 확정 예약 — alertFrom 범위 밖이라 별도 처리
  const overduConfirmed = await pOverduConfirmed
  for (const l of overduConfirmed) {
    const days = daysUntil(l.moveInDate!)
    alertItems.push({
      category:  'movein',
      text:      `${l.room?.roomNo ? `${l.room.roomNo}호 ` : ''}${l.tenant.name}님 입주 확정일 경과`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  'var(--success-fg)',
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
      dotColor:  'var(--warning-fg)',
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
    // 투어일 없는 WAITING_TOUR = '문의'(연락만 받은 상태) — 파생 라벨 규칙(e1b81629)
    const timeLabel = l.tourDate ? dayLabel(daysUntil(l.tourDate)) : '일정 미정'
    alertItems.push({
      category:  'tour',
      text:      `${l.tenant.name}님${l.room?.roomNo ? ` ${l.room.roomNo}호` : ''} ${l.tourDate ? '투어 예정' : '문의'}`,
      link:      `/tenants?tenantId=${l.tenant.id}`,
      dotColor:  'var(--deposit-fg)',
      timeLabel,
      tenantId:  l.tenant.id,
      detail:    l.tourDate ? `투어 예정일: ${fmtKorDate(l.tourDate)}` : '문의 단계 (투어일 미지정)',
      exactDate: fmtShortDate(l.tourDate),
    })
  }

  // 잠재 고객 연락(D-14) — 입주 희망일 2주 전부터 빈방 가능 여부 연락 안내(운영자 기준 2026-07-10)
  {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0)
    const leadDays = (await prisma.property.findUnique({ where: { id: propertyId }, select: { contactLeadDays: true } }))?.contactLeadDays ?? 14
    const contactLeases = await prisma.leaseTerm.findMany({
      where: {
        propertyId, status: { in: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] }, reservationConfirmedAt: null,
        moveInDate: { gte: t0 },
        OR: [
          { contactAlertDate: { lte: t0 } },
          { contactAlertDate: null, moveInDate: { lt: new Date(t0.getTime() + leadDays * 86400000) } },
        ],
      },
      select: { id: true, moveInDate: true, isShortTerm: true, room: { select: { roomNo: true } }, tenant: { select: { id: true, name: true } } },
    })
    for (const l of contactLeases) {
      if (!l.moveInDate) continue
      alertItems.push({
        category:  'contact',
        text:      `${l.tenant.name}님 연락할 때 · 입주 희망 ${fmtShortDate(l.moveInDate)}${l.isShortTerm ? ' (단기)' : ''}`,
        link:      `/tenants?tenantId=${l.tenant.id}`,
        dotColor:  'var(--coral)',
        timeLabel: dayLabel(daysUntil(l.moveInDate)),
        tenantId:  l.tenant.id,
        detail:    `입주 희망일이 ${leadDays}일 안입니다. 빈방이 나올지, 어렵겠는지 미리 연락해 주세요.`,
        exactDate: fmtShortDate(l.moveInDate),
      })
    }
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
        dotColor:  'var(--success-fg)',
        timeLabel: '연락 가능',
        tenantId:  c.tenantId,
        detail,
      })
      continue
    }

    const text = `${g.roomNo}호 ${stateLabel} · 매칭 후보 ${g.candidates.length}명`
    const detail = g.candidates
      .map(c => `${c.rank}순위 ${c.tenantName}님 · ${c.matchedBy === 'conditions' ? '조건 매칭' : '호실 지정'}`)
      .join('\n')
    alertItems.push({
      category:  'wish',
      text,
      link:      `/room-manage`,
      dotColor:  'var(--success-fg)',
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
        link:      `/tenants?tenantId=${l.tenantId}`,
        dotColor:  'var(--danger-fg)',
        timeLabel: `${days}일 경과`,
        tenantId:  l.tenantId,
        leaseTermId: l.leaseId,
        roomId:    l.roomId,
        detail:    `미수금 ${fmtWon(l.overduePortion)}이 ${days}일 동안 회수되지 않고 있습니다.`,
        sortKey:   -days,
      })
    } else if (l.upcomingPortion > 0 && days < 0 && days >= -UNPAID_UPCOMING_ALERT_DAYS) {
      // 도래 임박 — '납부 예정' 카테고리. 가까운 순(D-1 → D-7)으로 정렬되도록 sortKey는 절댓값.
      // days = today - dueDate (음수=미래). 미래 dueDate 복원은 today - days, 즉 today + |days|.
      const daysLeft = -days
      const dueDate = new Date(today.getTime() + daysLeft * 86400000)
      const timeLabel = daysLeft === 0 ? '오늘 납부일' : `${daysLeft}일 남음`
      alertItems.push({
        category:  'upcoming',
        text:      `${l.tenantName}님 ${l.roomNo}호 납부 예정`,
        link:      `/tenants?tenantId=${l.tenantId}`,
        dotColor:  'var(--inspect-fg)',
        timeLabel,
        tenantId:  l.tenantId,
        leaseTermId: l.leaseId,
        roomId:    l.roomId,
        detail:    `청구 예정액 ${fmtWon(l.upcomingPortion)}${daysLeft === 0 ? '. 오늘이 납부일입니다.' : `. ${daysLeft}일 후 납부 예정.`}`,
        exactDate: fmtShortDate(dueDate),
        sortKey:   Math.abs(days),
      })
    } else if (l.overduePortion > 0 && days === 0) {
      // 오늘 도래·미회수 (드문 케이스)
      alertItems.push({
        category:  'unpaid',
        text:      `${l.tenantName}님 ${l.roomNo}호 오늘 납부일`,
        link:      `/tenants?tenantId=${l.tenantId}`,
        dotColor:  'var(--danger-fg)',
        timeLabel: '오늘',
        tenantId:  l.tenantId,
        leaseTermId: l.leaseId,
        roomId:    l.roomId,
        detail:    `미수금 ${fmtWon(l.overduePortion)}이 오늘 도래입니다.`,
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
      text:      r.tenant ? `${r.tenant.name}님 요청: ${r.content.slice(0, 28)}${r.content.length > 28 ? '…' : ''}` : `공용 요청: ${r.content.slice(0, 28)}${r.content.length > 28 ? '…' : ''}`,
      link:      r.tenantId ? `/tenants?tenantId=${r.tenantId}&tab=requests` : '/requests',
      dotColor:  'var(--persimmon)',
      timeLabel: daysLeft != null ? (daysLeft <= 0 ? '처리 필요' : `${daysLeft}일 남음`) : '미처리',
      tenantId:  r.tenantId ?? undefined,
      detail:    r.content + (r.targetDate ? `\n처리 기한: ${fmtKorDate(r.targetDate)}` : ''),
      exactDate: fmtShortDate(r.targetDate),
    })
  }

  // ── 재고 부족 알림 (소진 예상 D-3 이내) ────────────────────
  try {
    const inventoryRows = (await pInventoryRows) ?? []
    for (const r of inventoryRows) {
      if (r.daysUntilEmpty == null || r.daysUntilEmpty > r.effectiveAlertDays) continue
      // #17: 재고 표시 단위는 추적 단위(규격이면 specUnit=kg, 수량이면 qtyUnit=개/박스)와 일치시켜야 함.
      //      이전엔 qtyUnit(박스)을 써서 재고 관리(kg)와 단위가 어긋났음.
      const dispUnit = (r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit || r.qtyUnit)) ?? ''
      const stockLabel = r.currentStock != null
        ? `${Math.round(r.currentStock * 100) / 100}${dispUnit}`
        : '잔량 미상'
      const emptyDate = r.daysUntilEmpty > 0
        ? new Date(today.getTime() + r.daysUntilEmpty * 86400000)
        : null
      alertItems.push({
        category:  'inventory',
        text:      `${r.label} 재고 부족 (${stockLabel} 남음)`,
        link:      '/inventory',
        dotColor:  'var(--inspect-fg)',
        timeLabel: r.daysUntilEmpty <= 0 ? '소진 임박' : `${r.daysUntilEmpty}일 남음`,
        detail:    `${r.category} · ${r.label}\n현재 잔량: ${stockLabel}\n평균 소모: ${r.avgDaily ? `${Math.round(r.avgDaily * 100) / 100}${dispUnit}/일` : '—'}\n소진 예상: ${r.daysUntilEmpty}일\n알림 기준: ${r.effectiveAlertDays}일 남음${r.reorderMemo ? `\n발주 메모: ${r.reorderMemo}` : ''}`,
        exactDate: fmtShortDate(emptyDate),
      })
    }
  } catch { /* inventory 모듈 로드 실패 시 무시 */ }

  // ── 재고 점검 임시저장 (저장 안 한 채 남아 있는 점검) ─────────────────
  try {
    const drafts = (await pStockDrafts) ?? []
    // 같은 trackedItem 의 위치별 드래프트 여러 개는 1건으로 묶음
    type DraftEntry = { label: string; category: string; latestUpdate: Date; count: number }
    const draftMap = new Map<string, DraftEntry>()
    for (const d of drafts) {
      const existing = draftMap.get(d.trackedItemId)
      if (existing) {
        existing.count++
        if (d.updatedAt > existing.latestUpdate) existing.latestUpdate = d.updatedAt
      } else {
        draftMap.set(d.trackedItemId, {
          label: d.trackedItem.label,
          category: d.trackedItem.category,
          latestUpdate: d.updatedAt,
          count: 1,
        })
      }
    }
    for (const v of draftMap.values()) {
      const sinceMs = Date.now() - v.latestUpdate.getTime()
      const sinceHr = Math.floor(sinceMs / (60 * 60 * 1000))
      const sinceTxt = sinceHr < 1 ? '방금 전' : sinceHr < 24 ? `${sinceHr}시간 전` : `${Math.floor(sinceHr / 24)}일 전`
      alertItems.push({
        category:  'inventory',
        text:      `${v.label} 점검 임시저장 중`,
        link:      '/inventory',
        dotColor:  'var(--inspect-fg)',
        timeLabel: '임시저장 보관 중',  // urgencyDaysOf=9999 → 긴급 아님(예정 그룹)
        detail:    `${v.category} · ${v.label}\n${v.count > 1 ? `위치별 ${v.count}건 임시저장됨\n` : ''}점검 모달을 다시 열어 '저장' 버튼으로 확정해주세요.\n마지막 임시저장: ${sinceTxt}`,
      })
    }
  } catch { /* StockCheckDraft 미지원 등 무시 */ }

  // (체크리스트 알림은 제거됨 — 체크리스트를 스테이음 Lab으로 이동, 대시보드 알림 비노출. 2026-05-26)

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
      dotColor:            'var(--info-fg)',
      timeLabel:           dayLabel(daysLeft),
      exactDate:           fmtShortDate(effectiveDate),
      detail:              `${fmtWon(re.amount)} · ${re.category}${re.isAutoDebit ? ' · 자동이체' + shiftedNote : ''}${re.memo ? '\n' + re.memo : ''}`,
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
  // 각 결제의 귀속월(targetMonth=T)·납부월(payDate=P)·보는 달(viewMonth=targetMonth=V) 관계로 뱃지 결정.
  //  · T=V, P<V → '선납 완료'(이 달분을 미리 냄)  · T=V, P>V → '지연 완료'  · T=V, P=V → 뱃지 없음(당월 정상)
  //  · T>V → 'N월 선납분'(다음달+ 분을 이 달에 냄)  · T<V → 'N월분 지연'(지난달 분을 이 달에 냄)
  const V = targetMonth
  const activityItems: DashboardData['activity'] = recentPaymentsRaw.map(p => {
    const T = p.targetMonth
    const payIso = p.payDate.toISOString()          // @db.Date → UTC 자정, 날짜부만 사용
    const P = payIso.slice(0, 7)
    const payLabel = `${Number(payIso.slice(5, 7))}/${Number(payIso.slice(8, 10))} 납부`
    const tNum = Number(T.slice(5))
    let badgeLabel: string | undefined
    let badgeTone: 'prepay' | 'late' | undefined
    if (T === V) {
      if (P < V) { badgeLabel = '선납 완료'; badgeTone = 'prepay' }
      else if (P > V) { badgeLabel = '지연 완료'; badgeTone = 'late' }
    } else if (T > V) {
      badgeLabel = `${tNum}월 선납분`; badgeTone = 'prepay'
    } else {
      badgeLabel = `${tNum}월분 지연`; badgeTone = 'late'
    }
    return {
      text:       `${p.tenant.name}님 ${p.leaseTerm.room?.roomNo ?? '?'}호 납입 완료`,
      timeLabel:  payLabel,
      dotColor:   'var(--success-fg)',
      link:       `/tenants?tenantId=${p.tenant.id}&tab=info`,
      tenantId:   p.tenant.id,
      tenantName: p.tenant.name,
      roomNo:     p.leaseTerm.room?.roomNo ?? '?',
      amount:     p.actualAmount,
      badgeLabel,
      badgeTone,
    }
  })

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
        dotColor:   'var(--warning-fg)',
        link:       `/tenants?tenantId=${l.tenant.id}&tab=info`,
        tenantId:   l.tenant.id,
        tenantName: l.tenant.name,
        roomNo:     l.room?.roomNo ?? '?',
        amount:     l.rentAmount,
      })
    }
  }

  // 시작 체크리스트(온보딩) — 신규 영업장 안내. 3단계 모두 완료면 null(카드 미표시).
  // 수납 여부는 이 달 조회분에 없을 때만 전체 이력 1건 존재를 확인(설립 초기 외엔 추가 쿼리 없음).
  let onboarding: { hasRooms: boolean; hasTenants: boolean; hasPayments: boolean } | null = null
  {
    const obRooms = totalRooms > 0
    const obTenants = activeLeases.length > 0
    let obPayments = payments.length > 0
    if (!obRooms || !obTenants || !obPayments) {
      if (!obPayments) {
        const anyPay = await prisma.paymentRecord.findFirst({ where: { propertyId }, select: { id: true } })
        obPayments = !!anyPay
      }
      if (!(obRooms && obTenants && obPayments)) onboarding = { hasRooms: obRooms, hasTenants: obTenants, hasPayments: obPayments }
    }
  }

  const dashboardData: DashboardData = {
    totalRevenue,
    paidRevenue,
    extraRevenue,
    projectedRevenue,
    projectedRecurringExpense,
    projectedNetProfit,
    expenseTiers: { immovable: tierImmovable, variable: tierVariable, savable: tierSavable },
    lastMonthExpense,
    lastYearExpense,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
    totalDeposit,
    depositRecorded,
    depositUnrecorded,
    reserveBalance,
    reserveMonthly,
    operatingCashAvailable: (totalRevenue - totalExpense) - reserveAccrualFromThisMonth,
    reserveAccrualFromThisMonth,
    paidCount,
    unpaidCount,
    upcomingCount,
    pendingCount,
    pendingRevenue,
    unpaidAmount,
    overdueAmount,
    upcomingAmount,
    totalExpected,
    categoryBreakdown,
    trend,
    totalRooms,
    vacantRooms,
    excludedRooms,
    // 입실 = 전체 − 공실 − 집계 제외 — 제외분(창고·사무실)이 입실로 부풀지 않게(운영자 결정 2026-07-21)
    occupiedRooms: totalRooms - vacantRooms - excludedRooms,
    onboarding,
    statusCounts: { active: activeCount, reserved: reservedCount, checkout: checkoutCount, nonResident: nonResidentCount, waitingTour: waitingTourLeases.length + tourDoneCount },
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
    nonResidentItems,
  }

  return dashboardData
}

// ── 페이지 ────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { propertyId } = await requirePropertyAccess()

  const { month } = await searchParams
  const targetMonth = month ?? kstMonthStr()

  // 예약 인상/인하 적용일 경과분 동기화 — 어느 페이지로 들어와도 7/1 인상이 baseRent·rentAmount 에 반영되게
  // (호실관리 미방문 시 리스트·표시가 옛값으로 남는 것 방지). 실패해도 페이지는 정상 노출.
  after(() => applyScheduledRents().catch(() => {}))   // 인상 적용 영속화는 응답 후 — 청구 표시는 billForLeaseMonth(scheduledRent)가 이미 정확

  const [dashboardData, paymentMethods, floorPlanData] = await Promise.all([
    getDashboardData(propertyId, targetMonth),
    getPaymentMethods(),
    getFloorPlan(),
  ])

  return (
    <div className="space-y-3.5">

      {/* ── 평면 배치도 (켠 경우 표시. 한 번도 만든 적 없으면 발견용 빈 상태 CTA) ─── */}
      {(floorPlanData == null || floorPlanData.showOnDashboard) && (() => {
        const rooms = dashboardData.rooms.map(r => ({ id: r.roomNo, roomNo: r.roomNo }))
        const roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }> = {}
        dashboardData.rooms.forEach(r => {
          // 집계 제외 방(창고·사무실)은 배치도에서도 공실로 칠하지 않는다(신고 9d844226)
          roomStatuses[r.roomNo] = { isVacant: r.isVacant && !r.vacancyExcluded, tenantName: r.tenantName ?? undefined }
        })
        return (
          <FloorPlanWidget
            floorPlanData={floorPlanData}
            rooms={rooms}
            roomStatuses={roomStatuses}
          />
        )
      })()}

      {/* ── 대시보드 ──────────────────────────────────────────── */}
      <DashboardClient data={dashboardData} targetMonth={targetMonth} paymentMethods={paymentMethods} />

    </div>
  )
}
