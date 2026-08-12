import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import { fmtWon } from '@/lib/fmtMoney'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { dueDayForCutoff } from '@/lib/dueDate'
import DashboardClient, { type DashboardData } from './DashboardClient'
import { getExpenseCategories, getPaymentMethods } from '@/app/(app)/settings/actions'
import { getRecurringExpensesWithStatus } from '@/app/(app)/finance/actions'
import { applyScheduledRents } from '@/app/(app)/room-manage/actions'
import { kstMonthStr, kstYmd, kstYmdStr } from '@/lib/kstDate'
import { ALERT_WINDOW_BEFORE_DAYS, ALERT_WINDOW_AFTER_DAYS, UNPAID_UPCOMING_ALERT_DAYS } from '@/lib/appConfig'
import { getNextBusinessDay } from '@/lib/krHolidays'
import { effectiveRecurringAmount, recurringAmountLabel } from '@/lib/recurringEstimate'
import { billForLeaseMonth, isCheckoutNoBillingMonthFor, monthOfDate, offerRentChangeAfterMonth, offerRentForMonth, resolveDueDateForMonth } from '@/lib/billing'
import { getCheckedOutRecognizedRevenue, getPaidRevenue, getPaidRevenueByMonths, getReservedFullMonthRevenue, roomAvailability, roomLeaseRowOrder, primaryRoomLease } from '@/lib/leaseStatus'
import { loadWishMatch, wishCandidateCaption, wishDelayHint, wishGateDetail, wishRoomFromLabel, wishRoomStateLabel } from '@/lib/wishMatch'
import { getFloorPlan } from '@/app/(app)/floor-plan/actions'
import FloorPlanWidget from '@/app/(app)/floor-plan/FloorPlanWidget'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { vacancyExcludedWhere, isVacancyExcluded } from '@/lib/vacancy'
import { displayName } from '@/lib/displayName'
import { cleaningFeeDeductible } from '@/lib/depositWithholdReasons'
import { depositComposition, depositCompositionLabel, heldContractCleaningPortion } from '@/lib/depositComposition'
import { CLEANING_FEE_RECEIVED_WHERE } from '@/lib/incomeCategories'

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
    select: { acquisitionDate: true, prevOwnerCutoffDate: true, cleaningFeeInDeposit: true },
  })
  // 청소비를 보증금 안의 몫으로 받는 영업장인지 — 보유 보증금 분해와 퇴실 알림 기준액의 판정 근거(2026-08-10)
  const cleaningFeeInDeposit = property?.cleaningFeeInDeposit ?? false
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
  const pPaidRevenue          = getPaidRevenue(prisma, propertyId, targetMonth)
  // 추이 막대의 이용료 항 — KPI 실수납과 같은 정본을 쓴다(2026-08-12 회계 패널). 종전에는 그 달 귀속
  // 수납의 무캡 합이라, 같은 화면에서 같은 달을 두 식이 말했다. 배치형이라 6개월도 쿼리 수는 그대로다.
  const pTrendPaidRevenue     = getPaidRevenueByMonths(prisma, propertyId, last6Months)
  const pCheckedOutRecognized = getCheckedOutRecognizedRevenue(prisma, propertyId, targetMonth)
  const pRecurringWithStatus  = getRecurringExpensesWithStatus(targetMonth)
  // 지출 카테고리 도넛의 색은 이 등록 순서가 정한다(금액 순위 아님) — 달을 바꿔도 같은
  // 카테고리가 같은 색이려면 달과 무관한 축이어야 한다. 목록 정본은 영업장 설정 하나뿐이다.
  const pExpenseCategories    = getExpenseCategories()
  const pDepositRecordedAgg   = prisma.paymentRecord.aggregate({
    where: { propertyId, isDeposit: true, leaseTerm: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } } },
    _sum: { actualAmount: true },
  })
  // 보유 보증금 분해에 쓸 계약별 구성 — 청소비를 보증금 안의 몫으로 받는 영업장에서만 조회한다.
  // 종전에는 그 몫이 통째로 '미기록'(전 원장 승계분)으로 잡혀, 받은 적 없는 돈처럼 읽혔다(520호 20,000).
  // 중첩 where 는 소프트삭제 자동 필터가 안 붙는다(lib/prisma 는 최상위 연산만) — deletedAt 명시 필수.
  const pDepositCleaningLeases = cleaningFeeInDeposit
    ? prisma.leaseTerm.findMany({
        where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
        select: {
          depositAmount: true,
          cleaningFee: true,
          paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { actualAmount: true } },
          extraIncomes:   { where: { ...CLEANING_FEE_RECEIVED_WHERE, deletedAt: null }, select: { amount: true } },
        },
      })
    : Promise.resolve([])
  // 예약 확정 전(RESERVED) 실수납 예약금 — 계약 보증금 총액엔 미포함이나 이미 받은 현금이라
  // 실수납·총액 양쪽에 동일 가산해 재무 요약과 정합(입주 전이므로 아직 안 받은 예약 보증금은 제외).
  const pReservedDepositReceivedAgg = prisma.paymentRecord.aggregate({
    where: { propertyId, isDeposit: true, leaseTerm: { status: 'RESERVED' } },
    _sum: { actualAmount: true },
  })
  const pReservedExpected = getReservedFullMonthRevenue(prisma, propertyId, targetMonth)
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
  for (const p of [pPaidRevenue, pTrendPaidRevenue, pCheckedOutRecognized, pRecurringWithStatus, pExpenseCategories, pDepositRecordedAgg, pDepositCleaningLeases, pReservedDepositReceivedAgg, pReservedExpected, pLastExpAggs, pOverduConfirmed] as Promise<unknown>[]) { void p.catch(() => {}) }

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
    trendExpenses,
    trendIncomes,
    activeCount,
    reservedCount,
    checkoutCount,
    nonResidentCount,
    activeTenants,
    wishMatch,
    roomsWithTenants,
    recentPaymentsRaw,
    unpaidLeasesRaw,
    tenantRequestsRaw,
    waitingTourLeases,
    allHistoricalPayments,
    reserveTxnsRaw,
    allMonthPayments,
    tourDoneCount,
    publishCandidateRooms,
    unpublishCandidateRooms,
    availabilityLeases,
  ] = await Promise.all([
    prisma.leaseTerm.findMany({
      // RESERVED는 아직 입주 안 한 상태 → 미수 합산 대상에서 제외
      where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      // #14 월세 할인 — 수납현황 위젯(완료 건수·예상 수입)에 할인 반영
      // moveInDate·expectedMoveOut — 이번달 청구 대상 여부 판정(다음달 입주자가 이번달 매출에 잡히는 버그 방지)
      // dueDay·override — 퇴실월 무청구(checkoutNoBilling) 판정용 (lib/billing 공용 규칙)
      select: { id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true, dueDay: true, overrideDueDay: true, overrideDueDayMonth: true, checkoutProratedAmount: true, checkoutProratedMonth: true, discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } }, room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } } },
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId, targetMonth, isDeposit: false, isPrevOwner: false,
        ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}),
      },
      select: { leaseTermId: true, actualAmount: true, expectedAmount: true },
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
        // 입실 때 받은 청소비 — 받았으면 퇴실에서 또 떼지 않는다(계약서 §2-4 either/or, 2026-08-03).
        // 중첩 where 는 소프트삭제 자동 필터가 안 붙는다(lib/prisma 는 최상위 연산만) — deletedAt 명시.
        extraIncomes:   { where: { ...CLEANING_FEE_RECEIVED_WHERE, deletedAt: null }, select: { amount: true } },
        // 정산 기준액 — 계약 보증금이 아니라 실제로 받은 보증금이다(환불 서버가 되계산하는 그 값).
        paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { actualAmount: true } },
      },
      orderBy: { expectedMoveOut: { sort: 'asc', nulls: 'last' } },
    }),
    // 6개월 트렌드 — 이용료 항은 pTrendPaidRevenue(정본)로 옮겼다. 여기 있던 무캡 합산 조회는
    // 그 자리에서 사라졌다(2026-08-12). 지출·부가수익은 date 축이라 그대로 남는다.
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
    // 희망 호실·조건 매칭 — 방 축(roomAvailability)·날짜 게이트·정렬까지 lib/wishMatch 가 정본이다.
    // 종전엔 여기서 자체 방 축('isVacant 인 방 + 퇴실 예정 방')을 만들어 호실 관리 '입주 가능'과 갈렸다.
    loadWishMatch(prisma, propertyId, kstYmdStr()),
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
        // 비거주 예약 인상 축 — billForLeaseMonth 가 NON_RESIDENT 계약을 이 축으로 읽는다(418호 유형).
        nonResidentScheduled: true,
        nonResidentRentDate: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          select: {
            // 타일에 부를 이름은 lib/displayName 이 고른다 — 별칭·영어이름·한글 이름 셋 중 하나.
            // 서류 성명(lib/documentName)과는 별개 축이고, 이 세 칸은 화면 카드에서만 쓴다.
            id: true, tenant: { select: { id: true, name: true, englishName: true, nickname: true, displayNameStyle: true } }, status: true, rentAmount: true,
            // 사람별 실제 청구액(lib/billing) — 할인·일할·단기·예약 인상을 수납 관리와 같은 식으로 읽는다.
            // expectedMoveOut — 타일 퇴실 예정일 줄("8/14 퇴실"). 청구 판정에는 쓰지 않는다.
            isShortTerm: true, moveInDate: true, expectedMoveOut: true,
            checkoutProratedAmount: true, checkoutProratedMonth: true,
            discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
          },
          // 주 계약은 primaryRoomLease 가 의미로 고른다. createdAt desc 이던 시절엔 최근에 만든 예약이
          // 실거주자를 밀어내 402호 카드에 김주호(입실 예정)가 떴다(신고 2026-08-11).
          //
          // take 는 타일이 세울 수 있는 최대 인원에서 거꾸로 잡는다 — 점유 4명 + 초과 감지 1 + 비거주 1.
          // 3 이던 시절엔 잘림이 곧 오표시였다: status asc 는 enum 선언 순서(RESERVED < ACTIVE)라
          // 예약이 셋 걸린 방에서는 실거주자가 잘려 나갔다. 호실 카드(getRooms)는 사람을 하나만
          // 세우므로 take 3 으로 충분하지만, 여기는 넷까지 세우므로 그만큼 더 읽는다.
          orderBy: { status: 'asc' },
          take: 6,
        },
      },
      orderBy: { roomNo: 'asc' },
    }),
    // 최근 수납 내역 (활동 피드용) — viewMonth 안에 payDate가 있는 record
    // [납입일변경] 메모 record(일할 차액)·청구 조정 전표(단기 연장·감액 마커)는 물리적 납입이 아니므로 제외
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
          isBillingAdjust: false,
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
        room: { select: { id: true, roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
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
    // (고정 지출 목록·이달 기록 여부는 getRecurringExpensesWithStatus 가 같은 조건으로 조회 — 중복 쿼리 제거)
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
    // 소개 페이지 공개 후보 — 공실이고 사진 있는데 아직 미공개인 방(창고·사무실 등 비거주 점유는 제외).
    // 집계 제외 방은 팔 수 있는 방이 아니다 — 415호에 사진만 올리면 손님에게 내보이라고 권하던 자리다.
    // 바로 아래 철회 후보가 이미 같은 where 를 빼고 있었다. 한 카드의 두 줄이 다른 모집단을 보면 안 된다.
    prisma.room.findMany({
      where: { propertyId, isVacant: true, showOnSite: false, photos: { some: {} }, NOT: vacancyExcludedWhere },
      select: { id: true, roomNo: true, tier: true, baseRent: true, photos: { select: { storageUrl: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
      orderBy: { roomNo: 'asc' },
    }),
    // 소개 페이지 철회 후보 — 입주 중인데 아직 공개 상태인 방(창고·사무실 등 비거주 점유는 제외)
    prisma.room.findMany({
      where: { propertyId, isVacant: false, showOnSite: true, NOT: vacancyExcludedWhere },
      select: { id: true, roomNo: true, tier: true, baseRent: true, photos: { select: { storageUrl: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
      orderBy: { roomNo: 'asc' },
    }),
    // 입주 가능 판정(roomAvailability)의 계산 입력 — 위 방 현황 조회는 take: 6 이라 여기 못 쓴다.
    // 잘린 한 건이 무기한이면 방은 '모른다'인데 '곧 입주 가능'으로 뒤집히고, 타일이 홈 매칭 알림보다
    // 이른 날짜를 말하게 된다(같은 함수라도 먹이는 집합이 다르면 답이 갈린다). 판정에 필요한 두 필드만
    // take 없이 읽는 처방은 2026-08-11 getRoomDetail 이 같은 함정에서 쓴 것 그대로다.
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      select: { roomId: true, status: true, expectedMoveOut: true },
    }),
  ])

  // ── 이달 집계 ────────────────────────────────────────────────
  // 이달 실수납(이용료 축)은 정본 하나로 — lib/leaseStatus getPaidRevenue.
  // 캡은 원가가 아니라 그 달 청구액이어야 한다. 원가로 캡하면 할인 계약에 정가가 입금되거나
  // 퇴실 일할월·인상 적용월에 매출이 과대/과소가 되고, '예상매출 = 수납완료 + 수납예정' 등식이 깨진다(A페이즈).
  // 여기 있던 인라인 계산은 퇴실 계약만 lease.rentAmount(오늘의 가격표)로 캡해, 락인 470,000 을
  // 완납한 502호 남태우에게서 5·6월 합 60,000 을 잘라내고 그만큼을 허수 미수로 세웠다(2026-08-11 회계 패널).
  // 수납 관리 캡션이 같은 항을 적으므로 식은 한 곳에만 둔다 — 화면이 자기 식을 만들면 그 순간 갈린다.
  const paidBreakdown = await pPaidRevenue
  const paidRevenue = paidBreakdown.total
  const extraRevenue = incomes.reduce((s, i) => s + i.amount, 0)
  const totalRevenue = paidRevenue + extraRevenue
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  // RESERVED 실수납 예약금 — 총액·실수납 양쪽에 같은 값을 더해 미기록분(차이)은 불변으로 유지.
  const reservedDepositReceived = (await pReservedDepositReceivedAgg)._sum.actualAmount ?? 0
  const totalDeposit = (depositAgg._sum.depositAmount ?? 0) + reservedDepositReceived
  // 보유 보증금 분해 — 받은 돈(실수취) vs 미기록(전 원장 등 계약상만). 총액(totalDeposit, 계약 기준) 유지.
  // 받은 돈 = 보증금 명목 수납 + 청소비 명목 수납이 보증금 부족분을 채운 몫(김민정형 역산 기록).
  // 청소비 몫은 **계약 축**이다(운영자 확정 2026-08-12) — 받은 돈 안에서 퇴실 때 청소비로 쓰일 몫.
  // 받은 돈과 나란히 더하는 항이 아니라 부분집합이라, 표시도 '이 중'으로 묶는다(항등: 받은 + 미기록 = 총액).
  const depositRecordedAgg = await pDepositRecordedAgg
  const depositCleaningLeases = await pDepositCleaningLeases
  const depositCleaningFunded = depositCleaningLeases.reduce((s, l) => s + depositComposition({
    contractDeposit: l.depositAmount,
    depositPaid: l.paymentRecords.reduce((a, r) => a + r.actualAmount, 0),
    cleaningPaid: l.extraIncomes.reduce((a, i) => a + i.amount, 0),
    cleaningFeeInDeposit: true,
  }).coveredByCleaning, 0)
  const depositReceived = (depositRecordedAgg._sum.actualAmount ?? 0) + reservedDepositReceived + depositCleaningFunded
  const depositByCleaning = depositCleaningLeases.reduce((s, l) => s + heldContractCleaningPortion({
    contractDeposit: l.depositAmount,
    cleaningFee: l.cleaningFee,
    depositPaid: l.paymentRecords.reduce((a, r) => a + r.actualAmount, 0),
    cleaningPaid: l.extraIncomes.reduce((a, i) => a + i.amount, 0),
  }), 0)
  const depositUnrecorded = Math.max(0, totalDeposit - depositReceived)

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
  // 고정지출 추정액은 정본식(lib/recurringEstimate) 하나만 쓴다 — 여기서 따로 추정하지 않는다.
  const nonRecurringPast = await prisma.expense.aggregate({
    where: { propertyId, recurringExpenseId: null, date: { gte: new Date(year, month - 4, 1), lt: startDate } },
    _sum: { amount: true },
  })

  const hasExpenseHistory = (nonRecurringPast._sum.amount ?? 0) > 0
  // 예상 지출 — 사용자 정의(2026-05-31): 실제 발생 지출 + 이번 달 미발생 고정지출.
  // 이 값은 page 후반(loop 뒤)에 totalExpense 와 projectedRecurringExpense 가 준비된 후 계산.
  let expectedExpense = 0  // placeholder, 아래에서 다시 채움

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
    // KST 기준 오늘 (서버 UTC와 시간대 차이로 연체일이 하루 어긋나는 것 방지 — 형제 calcDaysOverdueForMonth 와 같은 문법)
    const { year: ty, month: tm, day: td } = kstYmd()
    const todayCopy = new Date(ty, tm - 1, td)
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

  // 기한을 미뤄준 상태인가 — 맞으면 그 날짜를 'M/D' 로 (unpaid.ts deferredDueForMonth 와 동일 규칙).
  function deferredDueForMonth(
    l: { dueDay: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
    monthStr: string,
  ): string | null {
    if (!(l.overrideDueDay && l.overrideDueDayMonth && l.overrideDueDayMonth >= monthStr)) return null
    const abs = overrideAbsDate(l)
    if (!abs) return null
    const { year: ty, month: tm, day: td } = kstYmd()
    const days = Math.round((new Date(ty, tm - 1, td).getTime() - abs.getTime()) / 86400000)
    if (days >= 0) return null                                   // 그 날짜도 지남 — 유예가 아니라 연체
    const orig = calcDaysOverdueForMonth(l.dueDay, monthStr)
    if (orig != null && days >= orig) return null                // 뒤로 미룬 경우만
    return `${abs.getMonth() + 1}/${abs.getDate()}`
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
  // 수납 현황 도넛의 완납 건수는 아래 미납 루프 뒤에서 배타 3분류로 센다(2026-08-12 회계 패널).
  // 여기서 세던 그 달 축 완납(billableLeases + billThisMonth)은 나머지 두 항이 누적 축이라
  // 셋이 아무 모집단도 분할하지 못했다 — 사정은 그 자리 주석에 적었다.

  // ── 단기 입주·중도퇴실 lease 의 매출 추가 인식 (lib/leaseStatus.ts 정책)
  // 일할 정산되는 짧은 거주를 과다 인식하지 않도록 rentAmount 전체가 아닌
  // 그 달 귀속 paymentRecord 합계만 인식. paidRevenue 의 CHECKED_OUT 포함 정책과 통일.
  const checkedOutRecognized = await pCheckedOutRecognized

  // 신규 입실자(예약확정 RESERVED)의 이번 달 예상 매출 — 입주 예정월이 이 달 이내면 전액(할인 반영) 가산.
  // (사용자 결정 2026-06-20: RESERVED 이상은 그 달 전액으로 예상 매출에 반영. 입주 후엔 ACTIVE 로 일반 청구.)
  // 계산 정본은 lib/leaseStatus 로 옮겼다 — 수납 관리 등식 캡션이 같은 값을 써야 한다(2026-08-07).
  const reservedExpected = await pReservedExpected

  // 양도인 몫 제외 — 수납완료 + 미수납과 합산이 맞도록
  // 첫 항을 따로 세운 것은 KPI 카드 등식 캡션이 '이 달 청구'를 이름으로 부르기 때문이다.
  // 화면이 totalExpected 에서 두 항을 빼서 되계산하면 그 순간 캡션이 자기 식을 갖는다.
  const billedThisMonth = billableLeases
    .filter(l => !prevOwnerLeaseIds.has(l.id))
    .reduce((s, l) => s + billThisMonth(l), 0)
  const totalExpected  = billedThisMonth
    + checkedOutRecognized + reservedExpected

  // 지출 카테고리 분해는 예상 지출(expectedExpense)이 정해진 뒤에 만든다 — 도넛의 분모가
  // 그 값이라 여기서 만들면 아직 없는 값을 나눠야 한다(아래 '지출 카테고리 분해' 블록).

  // ── 희망 호실/조건 알림 ──────────────────────────────────────
  // 판정은 전부 lib/wishMatch 가 끝냈다(방 축·날짜 게이트·2군 정렬·제외 카운트). 여기는 문장만 만든다.
  const wishGroupedAlerts = wishMatch.rooms

  // ── 6개월 트렌드 ─────────────────────────────────────────────
  // 이용료 항은 정본(getPaidRevenueByMonths)이다 — 그 달 청구액으로 캡한 합이라 마지막 막대가
  // KPI '실수납'과 원 단위로 같다. 부가수익은 축이 하나(date)뿐이라 KPI extraRevenue 와 이미 같은 값이고,
  // 지출도 KPI 와 같은 창(그 달 1일~말일)이다.
  const trendPaidRevenue = await pTrendPaidRevenue
  const trend = last6Months.map(m => {
    const [y, mo] = m.split('-').map(Number)
    const mStart  = new Date(y, mo - 1, 1)
    const mEnd    = new Date(y, mo, 0)
    const revenue =
      (trendPaidRevenue.get(m)?.total ?? 0) +
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
  // 수납 현황 도넛의 모집단 — 이 루프가 실제로 판정한 계약. 아래 firstMonth 게이트에 걸려
  // 건너뛴 계약(조회월에는 아직 내 장부에 없던 계약)은 셋 중 어디에도 서지 않는다.
  const paymentStatusPool = new Set<string>()
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
      const d = dueDayForCutoff(lAny.overrideDueDay as string, firstMonth)
      dueDayNum = d ?? NaN
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
    paymentStatusPool.add(l.id)
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
    .reduce((s, r) => s + effectiveRecurringAmount(r), 0)
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
  const tierImmovable = recurringWithStatus.filter(r => !(r as { isVariable?: boolean }).isVariable).reduce((s, r) => s + effectiveRecurringAmount(r), 0)
  const tierVariable  = recurringWithStatus.filter(r => (r as { isVariable?: boolean }).isVariable).reduce((s, r) => s + effectiveRecurringAmount(r), 0)
  const tierSavable   = Math.max(0, expectedExpense - tierImmovable - tierVariable)

  // ── 지출 카테고리 분해 — 기록된 지출 + 이 달 고정 지출 (예정) ──────────────
  // 도넛의 분모는 **예상 지출**이다. 기록분만 세던 시절에는 아직 안 낸 임대료 396만이
  // 그 달 지출 그림에서 통째로 빠져, 8월 도넛이 "청소용역비가 두 번째로 큰 달"로 보였다.
  // 실제로는 임대료가 46% 이고 청소용역비는 8% 다.
  //
  // 새 금액을 만들지 않는다 — 두 항 모두 위에서 이미 쓴 값(expByCategory · recurringWithStatus)을
  // 카테고리로 모으기만 한다. 예정 항의 필터·추정식은 projectedRecurringExpense 와 글자까지 같고,
  // 과거월 가드도 expectedExpense 와 같은 isPastMonth 하나를 쓴다. 그래서
  //   sum(categoryBreakdown.amount) === expectedExpense
  // 가 어느 달에나 성립한다 — 감지망이 이 항등을 축으로 본다(도넛 합계 == 예상 지출).
  const pendingByCategory: Record<string, number> = {}
  if (!isPastMonth) {
    for (const r of recurringWithStatus) {
      if (r.isPending || r.recordedExpenseId) continue
      pendingByCategory[r.category] = (pendingByCategory[r.category] ?? 0) + effectiveRecurringAmount(r)
    }
  }
  const recordedCategories = new Set(expByCategory.map(c => c.category))
  const categoryBreakdown = [
    ...expByCategory.map(c => ({
      category: c.category,
      recorded: c._sum.amount ?? 0,
      pending:  pendingByCategory[c.category] ?? 0,
    })),
    // 이 달에 아직 한 건도 기록이 없는 카테고리(8월 임대료·관리비)는 여기서 처음 선다.
    ...Object.entries(pendingByCategory)
      .filter(([cat]) => !recordedCategories.has(cat))
      .map(([category, pending]) => ({ category, recorded: 0, pending })),
  ]
    .map(c => ({ ...c, amount: c.recorded + c.pending }))
    .sort((a, b) => b.amount - a.amount)
    .map(c => ({ ...c, percent: expectedExpense > 0 ? Math.round((c.amount / expectedExpense) * 100) : 0 }))

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
        deferredDue:   firstUnpaid ? deferredDueForMonth(l, firstUnpaid) : null,
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

  // ── 수납 현황 도넛 — 한 모집단을 한 축으로 배타 분할 (회계 패널 2026-08-12) ──
  //
  //   미납     도래·미회수가 하나라도 있다 (이월 미수 우선 — 수납 관리 isPaid 와 같은 규칙)
  //   수납예정 도래분은 없고 미도래 미회수만 있다
  //   완납     나머지
  //
  // 종전에는 완납만 '그 달 축'(billableLeases 중 그 달 귀속 수납 >= 그 달 청구)이고 나머지 둘은
  // '누적 축'이라, 세 항이 아무 모집단도 분할하지 않았다. 세 가지가 한꺼번에 어긋나 있었다.
  //   ① 완납이면서 이월 미수가 있는 계약은 완납과 미납 양쪽에 서서 분모에 두 번 잡힌다(잠복).
  //   ② 그 달 청구가 0인 계약은 0 >= 0 이라 완납으로 세어진다(2026-08 2건). 낼 것이 없던 달이다.
  //   ③ 그 달 귀속 수납이 모자란데 누적으로는 완납인 계약은 어디에도 안 서서 도넛에서 증발한다.
  //      2026-04 3건이 그랬고, 정체는 인수월 양도인 자동 처리분이었다 — billThisMonth 는 그 규칙을
  //      모르고 현재 rentAmount 로 47만·35만을 청구로 세웠다.
  //
  // 위 루프가 만든 값만 쓴다. 그 루프는 인수월 양도인 자동 처리·양도인 귀속월·무청구 퇴실월·
  // 퇴실월 초과·단기 비청구월 게이트를 이미 전부 물고 있어, 게이트를 여기서 다시 쓰면 사본이 갈린다.
  // 그래서 세 항의 합은 정의상 모집단(paymentStatusPool)과 같다.
  const paymentPool = unpaidLeasesRaw.filter(l => paymentStatusPool.has(l.id))
  const awaitingCount = paymentPool.filter(l =>
    (overdueByLease[l.id] ?? 0) === 0 && (upcomingByLease[l.id] ?? 0) > 0).length
  const paidCount = paymentPool.length - unpaidCount - awaitingCount
  // 수납률은 서버가 한 번만 나눈다 — 화면·AI 프롬프트 두 곳이 각자 나누던 시절엔 분모가 셋이었고
  // (완납/(완납+미납), 완납/(완납+예정+미납)) 2026-08 에 같은 화면이 100% 와 61% 를 동시에 말했다.
  const paymentRate = paymentPool.length > 0
    ? Math.round((paidCount / paymentPool.length) * 100)
    : 0

  // 방 현황 그리드 미납 호실 — unpaidLeases와 동일 (둘 다 viewMonth 기준)
  const unpaidRoomNosForView = Array.from(new Set(unpaidLeases.map(l => l.roomNo)))

  // 타일 '연체 D+N' 의 N — 미수납 위젯 배지가 쓰는 그 값을 그대로 옮겨 담는다(새 계산이 아니다).
  // 한 사람의 경과일을 두 위젯이 각자 세면 같은 화면에서 다른 날짜를 말하게 된다.
  const daysOverdueByLease: Record<string, number | null> = {}
  for (const c of unpaidCandidates) daysOverdueByLease[c.leaseId] = c.daysOverdue

  // ── 비거주자 현황 ────────────────────────────────────────────
  const nonResidentItems = roomsWithTenants.flatMap(r =>
    r.leaseTerms
      .filter(l => l.status === 'NON_RESIDENT')
      .map(l => ({
        roomNo:     r.roomNo,
        tenantId:   l.tenant.id,
        // 카드에 부를 이름 — 별칭을 골라 둔 사람은 별칭으로 선다(lib/displayName 정본).
        displayName: displayName(l.tenant, l.tenant.displayNameStyle),
        rentAmount: l.rentAmount,
        payStatus:  (overdueByLease[l.id] ?? 0) > 0 ? 'unpaid'   as const
                  : (upcomingByLease[l.id] ?? 0) > 0 ? 'awaiting' as const
                  : 'paid' as const,
        // 비거주자도 사람이라 같은 단계를 받는다 — 미납 7일 초과면 연체(§03).
        daysOverdue: daysOverdueByLease[l.id] ?? null,
      }))
  )

  // ── 방 현황 그리드 ───────────────────────────────────────────
  // 타일에 세울 사람 — 주 계약(사는 사람 우선) + 그 방에 잡혀 있는 다음 입실 예약.
  // 선택 규칙은 lib/leaseStatus 정본 하나만 쓴다. 홈이 자기 규칙을 만들던 시절엔 402호가
  // 카드·모달과 다른 사람(김주호)을 가리켰다 — primaryRoomLease 수렴의 다섯 번째 사본이었다.
  //
  // 금액은 방 기본 이용료가 아니라 그 계약의 그 달 청구액이다. 방 하나에 둘이 각자 내면
  // 방값 47만이 아니라 각자의 32만9천이 맞다(운영자 신고 2026-08-11).
  //   묻는 달 — 거주는 조회 월. 단기·예약은 입주월이다. 단기는 입주월에 체류 전체 사용료를
  //   한 번 청구하는 계약이라(lib/billing) 다른 달을 물으면 0 이 나온다. 수납 관리도 예약 행을
  //   입주월로 묻는다(rooms/actions reservedExpected) — 그 문법을 단기 거주까지 그대로 쓴다.
  //
  // 이 블록이 미납 분류(overdueByLease·upcomingByLease) 뒤에 서는 이유 — 타일 색이 방이 아니라
  // 사람마다 갈리기 때문이다(아래 payStatus). 조회·집계는 하나도 건드리지 않고 읽기만 한다.
  const tileBillMonth = (l: { status: string; isShortTerm: boolean; moveInDate: Date | null }): string =>
    (l.status === 'RESERVED' || l.isShortTerm) ? (monthOfDate(l.moveInDate) ?? targetMonth) : targetMonth
  // 타일 한 장에 세우는 사람 수 상한 — 넘치면 '+N명' 한 줄로 접는다(운영자 확정 2026-08-11).
  const TILE_OCCUPANT_LIMIT = 4
  // 방별 입주 가능 판정 — take 없이 읽은 계약으로 lib/leaseStatus 정본에 묻는다(판정 사본 금지).
  // roomId 가 없는 계약(방 미배정)은 방 축에 속하지 않는다.
  const availabilityLeasesByRoom = new Map<string, { status: string; expectedMoveOut: Date | null }[]>()
  for (const l of availabilityLeases) {
    if (!l.roomId) continue
    const arr = availabilityLeasesByRoom.get(l.roomId)
    if (arr) arr.push(l)
    else availabilityLeasesByRoom.set(l.roomId, [l])
  }
  const tileYmd = (d: Date | null): string | null => d ? new Date(d).toISOString().slice(0, 10) : null
  const tileOccupant = (r: typeof roomsWithTenants[number], l: typeof roomsWithTenants[number]['leaseTerms'][number]) => {
    const mon = tileBillMonth(l)
    return {
      leaseId:  l.id,
      tenantId: l.tenant.id,
      // 카드에 부를 이름 — 고객 정보의 '카드 표시 이름' 선택을 따른다(lib/displayName).
      // 법적 성명이 필요한 자리(서류·문자·내보내기)는 이 값을 쓰지 않는다.
      displayName: displayName(l.tenant, l.tenant.displayNameStyle),
      status:   l.status,
      // 일할 → 락인 → 할인. 수납 관리·미수납 위젯이 쓰는 그 함수 그대로 — 두 화면이 같은 숫자를 말한다.
      amount:   billForLeaseMonth({ ...l, room: r }, mon, lockedExpectedByLeaseMonth[l.id]?.get(mon) ?? null),
      // 수납 상태는 방이 아니라 사람에게 붙는다 — 한 방에 둘이 살면 한 명은 냈고 한 명은 안 냈을 수 있다.
      // 판정식은 바로 위 비거주자 현황과 같은 것을 쓴다(새 규칙이 아니라 같은 정본의 두 번째 소비처).
      payStatus: (overdueByLease[l.id] ?? 0) > 0 ? 'unpaid'   as const
               : (upcomingByLease[l.id] ?? 0) > 0 ? 'awaiting' as const
               : 'paid' as const,
      // 미납 중 7일 초과만 연체로 부른다(§03) — 그 판정에 쓰는 경과일.
      daysOverdue: daysOverdueByLease[l.id] ?? null,
      // 타일 보조줄용 날짜 — "8/17 입실" / "8/14 퇴실". 청구 판정에는 관여하지 않는다.
      moveInDate:      tileYmd(l.moveInDate),
      expectedMoveOut: tileYmd(l.expectedMoveOut),
    }
  }
  const roomsData = roomsWithTenants.map(r => {
    // 집계 제외(창고·사무실) — 배치도 등에서 공실로 칠하지 않기 위한 파생값(lib/vacancy 정본).
    // 아래 offerRentAhead 도 같은 판정을 봐야 해서 리터럴 밖으로 뺀다(같은 식 두 벌 금지).
    const vacancyExcluded = isVacancyExcluded(r, r.leaseTerms.some(l => l.status === 'NON_RESIDENT'))
    return {
    id:            r.id,
    roomNo:        r.roomNo,
    isVacant:      r.isVacant,
    vacancyExcluded,
    type:          r.type,
    tier:          r.tier as string | null,
    floor:         r.floor as string | null,
    windowType:    r.windowType as string | null,
    direction:     r.direction as string | null,
    areaPyeong:    r.areaPyeong,
    areaM2:        r.areaM2,
    baseRent:      r.baseRent,
    // 사람이 아직 없는 방을 지금 내놓는 값 — 예약 인상이 이번 달에 이미 걸려 있으면 인상가다.
    // 종전엔 타일이 baseRent 를 직표시해 인상 예약이 걸린 빈 방을 구가로 불렀다(오늘 해당 0실).
    offerRent:     offerRentForMonth(r, targetMonth),
    // 아직 제시가에 안 실린 예약 인상·인하 — 빈 방 타일 꼬리의 '9월 36만'(lib/billing 정본).
    // 비거주 점유 방은 금액 자체가 다른 축(nonResidentAmount)이라 거주 축 예고를 붙이면
    // 협의가 아래에 방 예약값이 서게 된다 — 415호 오표시와 같은 클래스라 여기서 뺀다.
    offerRentAhead: vacancyExcluded ? null : offerRentChangeAfterMonth(r, targetMonth),
    ...(() => {
      // 비거주는 위 '비거주자 현황' 블록이 따로 세운다 — 타일 사람 줄에서는 뺀다.
      const occupying = r.leaseTerms.filter(l => l.status !== 'NON_RESIDENT')
      const primary = primaryRoomLease(occupying)
      // 타일에 세울 사람 — 수납 관리 행 순서 정본(거주 먼저 입주일 순, 그다음 입실 예약)을 그대로 쓴다.
      // 종전 조립('주 계약 하나 + 나머지 예약')은 한 방에 거주 계약이 둘이면 두 번째 거주자를 통째로
      // 떨어뜨렸는데, 아래 입주 가능 판정은 그 떨어진 계약의 퇴실일까지 세어 날짜를 잡는다. 그러면
      // 화면에 없는 사람이 정한 날짜가 공실 블락에 뜬다. 두 축이 같은 계약 집합을 보게 맞춘다.
      const queue = roomLeaseRowOrder(occupying)
      const occupants = queue.slice(0, TILE_OCCUPANT_LIMIT).map(l => tileOccupant(r, l))
      // 언제부터 이 방을 줄 수 있나 — 사슬 끝 정본(lib/leaseStatus). 날짜가 잡힌 방(soon)에만 값이 있다.
      // 밴드 상한은 공실 블락까지 합쳐 넷이다(패널 판정 2026-08-12) — 사람이 넷을 채우면 블락은 안 붙는다.
      // 사람은 사실이고 공실은 파생값(맨 아래 퇴실일 + 1)이라, 잘라야 한다면 파생값 쪽을 자른다.
      const availability = roomAvailability({
        nonResidentVacant: r.nonResidentVacant,
        leaseTerms: availabilityLeasesByRoom.get(r.id) ?? [],
      })
      return {
        tenantName:   primary?.tenant.name ?? null,
        tenantId:     primary?.tenant.id ?? null,
        tenantStatus: primary?.status ?? null,
        // 네 명까지 세운다 — 320px 폭에서 밴드 넷이 타일 높이를 넘기지 않는 상한이다.
        occupants,
        // 다섯 명 이상이면 넘치는 수만 한 줄로 — 잘라 놓고 말이 없으면 없는 사람이 된다.
        occupantsMore: Math.max(0, queue.length - TILE_OCCUPANT_LIMIT),
        // 금액은 그 방이 비는 달의 제시가다 — 인상 적용월 이상이면 인상가(lib/billing 정본, 월 단위).
        availability: (availability?.kind === 'soon' && occupants.length < TILE_OCCUPANT_LIMIT)
          // 예고를 availability 안에 넣는 이유 — 이 블락의 기준월은 방이 비는 달이지 이번 달이 아니다.
          // 형제 필드로 두면 화면이 엉뚱한 달의 예고를 이 블락에 짝지을 여지가 생긴다.
          ? { from: availability.availableFrom,
              rent:  offerRentForMonth(r, availability.availableFrom.slice(0, 7)),
              ahead: offerRentChangeAfterMonth(r, availability.availableFrom.slice(0, 7)) }
          : null,
      }
    })(),
    nonResidentName:  r.leaseTerms.find(l => l.status === 'NON_RESIDENT')?.tenant.name ?? null,
    nonResidentId:    r.leaseTerms.find(l => l.status === 'NON_RESIDENT')?.tenant.id ?? null,
    // 비거주만 있는 방(창고·사무실)은 그 계약이 곧 타일의 사람이다 — 방 기본값이 아니라 협의가로 보여야 한다.
    nonResidentAmount: (() => {
      const nr = r.leaseTerms.find(l => l.status === 'NON_RESIDENT')
      return nr ? tileOccupant(r, nr).amount : null
    })(),
    }
  })

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
    // 홈에서 바로 퇴실 처리할 때 여는 최대치 — 서버(recordDepositReturn)가 되계산하는 기준액과 같아야 한다.
    // 종전에는 계약 보증금을 그대로 실어, 현금 30,000 만 받은 계약에 5만을 제시하고 저장이 거절됐다.
    const moveOutDepositPaid = l.paymentRecords.reduce((s2, r) => s2 + r.actualAmount, 0)
    const moveOutCleaningPaid = (l.extraIncomes ?? []).reduce((s2, e) => s2 + e.amount, 0)
    // 인수 전 입주자는 이 앱에 영수 기록이 없는 게 정상이라 계약 보증금이 기준이다(getDepositBasisForLease 규칙).
    const moveOutCarriedOver = moveOutDepositPaid === 0
      && !!(acquisitionDate && l.moveInDate && new Date(l.moveInDate) < acquisitionDate)
    const moveOutComp = depositComposition({
      contractDeposit: l.depositAmount, depositPaid: moveOutDepositPaid,
      cleaningPaid: moveOutCleaningPaid, cleaningFeeInDeposit,
    })
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
      moveOutDepositAmount: moveOutCarriedOver ? l.depositAmount : moveOutDepositPaid,
      // 입실 때 이미 받았으면 0 — 퇴실 환불창이 그만큼 또 빼지 않게 한다
      moveOutCleaningFee: cleaningFeeDeductible(l.cleaningFee, moveOutCleaningPaid),
      moveOutCompositionLabel: depositCompositionLabel(moveOutComp),
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
    // KST 오늘의 UTC 자정 — moveInDate 는 @db.Date(UTC 자정)라 같은 기준끼리 비교해야 한다.
    // 로컬 자정이면 서버(UTC)에서 KST 00~09 시에 아직 어제라 D-14 알림이 하루 늦게 뜬다.
    const t0 = new Date(`${kstYmdStr()}T00:00:00.000Z`)
    const leadDays =(await prisma.property.findUnique({ where: { id: propertyId }, select: { contactLeadDays: true } }))?.contactLeadDays ?? 14
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
    // "연락하세요"까지만 말하고 끝나면 운영자가 다시 방을 뒤져야 한다. 이미 뽑아 둔 매칭의 사람 축에
    // 답이 들어 있으므로 그 답을 뒷문장으로 잇는다 — 알림을 새로 만들지 않고, 조회도 늘리지 않는다.
    const wishByLease = new Map(wishMatch.leases.map(l => [l.leaseId, l]))
    for (const l of contactLeases) {
      if (!l.moveInDate) continue
      const wish = wishByLease.get(l.id)
      const okRooms = wish?.rooms.filter(r => r.gate === 'ok') ?? []
      // 희망일에 맞는 방이 있으면 그 방을, 없으면 며칠만 미루면 되는지를 말한다(둘 다 아니면 침묵).
      const answer = okRooms.length > 0
        ? `희망일에 맞는 방 ${okRooms.length}실(${okRooms.map(r => `${r.roomNo}호 ${wishRoomFromLabel(r.availability)}`).join(', ')})이 있습니다.`
        : wish ? wishDelayHint(wish.rooms) : ''
      alertItems.push({
        category:  'contact',
        text:      `${l.tenant.name}님 연락할 때 · 입주 희망 ${fmtShortDate(l.moveInDate)}${l.isShortTerm ? ' (단기)' : ''}`,
        link:      `/tenants?tenantId=${l.tenant.id}`,
        dotColor:  'var(--coral)',
        timeLabel: dayLabel(daysUntil(l.moveInDate)),
        tenantId:  l.tenant.id,
        detail:    [`입주 희망일이 ${leadDays}일 안입니다. 빈방이 나올지, 어렵겠는지 미리 연락해 주세요.`, answer]
          .filter(Boolean).join(' '),
        exactDate: fmtShortDate(l.moveInDate),
      })
    }
  }

  for (const g of wishGroupedAlerts) {
    // 방 상태는 날짜로 말한다 — "공실" 또는 "8/30 입주 가능"(운영자 승인 2026-08-11).
    const stateLabel = wishRoomStateLabel(g.availability)
    // 후보가 하나도 안 남아도 알린다. 날짜가 안 맞아 빠진 사람이 있다는 사실 자체가
    // 그 사람에게 연락할 이유이기 때문이다(운영자 오더 2026-08-11).
    if (g.candidates.length === 0) {
      alertItems.push({
        category:  'wish',
        text:      `${g.roomNo}호 ${stateLabel} · 조건 맞는 대기자 없음`,
        link:      `/tenants`,
        dotColor:  'var(--success-fg)',
        timeLabel: `날짜 불가 ${g.excludedCount}명`,
        detail:    `${g.roomNo}호를 희망한 ${g.excludedCount}명은 입주 희망일이 이 방이 비는 날과 맞지 않습니다. 방이 어렵다는 것을 미리 알려 주세요. 대상자는 고객 목록 카드에 사유가 표시됩니다.`,
        wishRoomNo: g.roomNo,
      })
      continue
    }
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
        detail:    [detail, wishGateDetail(c)].filter(Boolean).join(' '),
        wishExcludedCount: g.excludedCount,
      })
      continue
    }

    const text = `${g.roomNo}호 ${stateLabel} · 매칭 후보 ${g.candidates.length}명`
    const detail = g.candidates
      .map(c => `${c.rank}순위 ${c.tenantName}님 · ${wishCandidateCaption(c)}`)
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
        caption: wishCandidateCaption(c),
      })),
      wishRoomNo: g.roomNo,
      wishExcludedCount: g.excludedCount,
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

  // 금액은 재무 탭·예상지출과 같은 정본 추정액(effectiveRecurringAmount)을 쓴다 — 기본액을 그대로 쓰면
  // 예약금액·과거평균이 반영된 실제 금액과 알림이 어긋난다(2026-07-30 신고).
  for (const re of recurringWithStatus) {
    if (re.recordedExpenseId) continue
    if (re.isPending) continue

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
    // 금액 출처 라벨 — 재무 탭 표기와 동일 어휘('예약금액'·'예상치'). 기본액이면 라벨 없이 금액만.
    const expectedAmt = effectiveRecurringAmount(re)
    const amountLabel = recurringAmountLabel(re)
    alertItems.push({
      category:            'recurring',
      text:                `고정 지출: ${re.title}`,
      link:                '/finance',
      dotColor:            'var(--info-fg)',
      timeLabel:           dayLabel(daysLeft),
      exactDate:           fmtShortDate(effectiveDate),
      detail:              `${fmtWon(expectedAmt)}${amountLabel ? ` · ${amountLabel}` : ''} · ${re.category}${re.isAutoDebit ? ' · 자동이체' + shiftedNote : ''}${re.memo ? '\n' + re.memo : ''}`,
      recurringExpenseId:    re.id,
      recurringAmount:       expectedAmt,
      recurringDueDate:      effectiveDate.toISOString().slice(0, 10),
      recurringCategory:     re.category,
      recurringPayMethod:    re.payMethod ?? undefined,
      recurringIsVariable:   re.isVariable,
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
    depositReceived,
    depositByCleaning,
    depositUnrecorded,
    reserveBalance,
    reserveMonthly,
    operatingCashAvailable: (totalRevenue - totalExpense) - reserveAccrualFromThisMonth,
    reserveAccrualFromThisMonth,
    paidCount,
    unpaidCount,
    upcomingCount,
    // 도넛 전용 배타 항 — upcomingCount(이월 미수가 함께 있는 계약도 세는 누적 축)와 다른 값이다.
    // 그쪽은 upcomingAmount 와 짝이라 AI 프롬프트 '납부 예정 N만원 (M건)' 이 계속 쓴다.
    awaitingCount,
    paymentRate,
    pendingCount,
    pendingRevenue,
    unpaidAmount,
    overdueAmount,
    upcomingAmount,
    totalExpected,
    // KPI 등식 캡션의 항 — 새 계산이 아니라 위에서 쓴 값을 그대로 싣는다.
    billedThisMonth,
    reservedExpected,
    checkedOutRecognized,
    // 미래월 판정은 서버(KST)가 내린다 — 클라가 오늘을 다시 구하면 하이드레이션이 갈린다.
    isFutureMonth: targetMonth > realTodayMonthStr,
    categoryBreakdown,
    // 도넛·범례 색의 축 — 값이 아니라 순서만 쓴다(lib/chartColors expenseCategoryColor).
    expenseCategoryOrder: await pExpenseCategories,
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
    nonResidentItems,
    publishCandidates: publishCandidateRooms.map(r => ({
      id: r.id, roomNo: r.roomNo, tier: r.tier, baseRent: r.baseRent, thumbUrl: r.photos[0]?.storageUrl ?? null,
    })),
    unpublishCandidates: unpublishCandidateRooms.map(r => ({
      id: r.id, roomNo: r.roomNo, tier: r.tier, baseRent: r.baseRent, thumbUrl: r.photos[0]?.storageUrl ?? null,
    })),
  }

  return dashboardData
}

// ── 페이지 ────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { propertyId } = await requirePropertyAccess()

  const { month, tab } = await searchParams
  const targetMonth = month ?? kstMonthStr()
  // 어느 탭을 열고 있는지는 주소가 정본이다(수납 관리·지출 관리와 같은 문법).
  // 종전에는 탭이 클라 상태뿐이라 홈에서 지출 관리로 갔다 돌아오면 늘 '현황'이었고,
  // 재무 탭을 가리키는 딥링크를 만들 수단 자체가 없었다. 모르는 값은 기본 탭으로 떨군다.
  const initialTab = tab === 'finance' || tab === 'tenants' || tab === 'ai' ? tab : 'overview'

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
      <DashboardClient data={dashboardData} targetMonth={targetMonth} paymentMethods={paymentMethods} initialTab={initialTab} />

    </div>
  )
}
