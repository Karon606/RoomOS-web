'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireEdit, getMyRole, canEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { maskStoredForeignRegNo } from '@/lib/pii'
import { kstDateTimeToUtc, kstMonthTsRange, kstYmd, kstYmdStr, monthDbRange, monthsDbRange, ymdToDbDate } from '@/lib/kstDate'
import { paymentAggregateBucket, resolveCashReceiptIssuedAt } from '@/lib/cashReceipt'
import { shiftMonth } from '@/lib/moveCalendar'
import { FIFO_MAX_ALLOCATE_MONTHS } from '@/lib/appConfig'
import { discountedRent } from '@/lib/rentDiscount'
import { CARD_LIKE_METHODS } from '@/lib/paymentMethods'
import { reasonsForStatus } from '@/lib/statusReasons'
import { BILLABLE_STATUSES, TENANT_LIST_STATUSES, primaryRoomLease, primaryTenantLease, roomAvailability, roomLeaseRowOrder, roomStatusView } from '@/lib/leaseStatus'
import { billForLeaseMonth, effectiveBaseRent, isAfterMoveOutMonth, isCheckoutNoBillingMonthFor, resolveDueDateForMonth, monthOfDate } from '@/lib/billing'
import { resolveReservationDepositMode, reservationFeeSplit, reservationFeeSplitApplies } from '@/lib/reservationDeposit'
import { parseShortStayPolicy, type ShortStayReservationMode } from '@/lib/shortStay'
import { CLEANING_FEE_CATEGORY, CLEANING_FEE_RECEIVED_WHERE } from '@/lib/incomeCategories'
import { depositComposition } from '@/lib/depositComposition'
import { effectiveDueRawForMonth } from '@/lib/dueDate'
// 수납 재계산·락인 되쓰기는 서버 액션이 아니다 — 여기서 export 하면 그 자체가 무권한 엔드포인트가 된다.
import { recalculatePayments, rewriteLockedExpectedForDiscountChange } from './paymentEngine'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

// ============================================================
type RoomRow = {
  roomId: string; roomNo: string; type: string | null; floor: string | null; windowType: string | null; direction: string | null
  isVacant: boolean; tenantId: string | null; tenantName: string | null; contact: string | null
  noMoveInReport: boolean   // 전입신고 불가 방 — 공실 카드·행 배지(2026-07-06)
  status: string | null; expected: number; dueDay: string | null; currentPaid: number
  // 단기 계약 — 입주월 1회 전액 청구라 '매월 N일' 반복 납부일이 성립하지 않는다.
  // 표시 가드 전용(계산·집계 비관여). dueDay 자체는 입주월 미납 판정 기한으로 계속 저장된다.
  isShortTerm: boolean
  carryOver: number; totalPaid: number; balance: number; isPaid: boolean
  leaseTermId: string | null; depositAmount: number; cleaningFee: number; accumulatedUnpaid: number
  isFutureMonth: boolean; baseRent: number; prevTenantName: string | null; prevContact: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | null; prevPaidThisMonth: boolean
  cashReceiptIssued?: boolean   // 이달(viewMonth) 이용료 record 중 현금영수증 발행분 존재 — 표시 메타(오류신고 2bd8befa)
  firstUnpaidMonth: string | null
  isReservationConfirmed: boolean   // RESERVED + reservationConfirmedAt != null
  // 지연납부 — 이 viewMonth 귀속분이 모두 dueDay 이후에 입금된 경우 가장 늦은 payDate ('YYYY-MM-DD')
  latePaidAt: string | null
  // 실제 가장 최근 납부일 — 수납 표에 '언제 냈는지' 표시용 ('YYYY-MM-DD' or null)
  lastPayDate: string | null
  // 다음 청구 도래일 (오늘 이후 가장 가까운 dueDay, override·말일 등 반영). 'YYYY-MM-DD'
  nextDueDate: string | null
  // 다음 청구 도래 시 받아야 할 추가 금액 (월 청구액 - 누적 선납 잔액)
  nextDueAmount: number
  expectedMoveOut: string | null  // CHECKOUT_PENDING 시 'YYYY-MM-DD'
  // 퇴실 일할 정산 — 설정 시 그 달(checkoutProratedMonth) 청구를 checkoutProratedAmount 로 덮어씀
  checkoutProratedAmount?: number | null
  checkoutProratedMonth?: string | null
  // 이 달에 청구가 없는 이유 — 0원을 '안 냄'이 아니라 '더 받을 게 없음'으로 읽히게 하는 표시 메타.
  // 계산에는 관여하지 않는다(집계·정렬·필터 전부 무변경).
  noBillReason?: 'shortTermPrepaid' | 'checkoutNoBilling' | null
  noBillCoveredAmount?: number | null   // 그 달을 덮은 실수납 합
  noBillCoveredDate?: string | null     // 그 돈을 받은 날 'YYYY-MM-DD'
  noBillCoveredMonth?: string | null    // 그 돈의 귀속월 'YYYY-MM'
  // 예약금 처리 모드 해석값 'deposit'|'prepaid'|'none' — 예약자 수납/표시 분기용(RESERVED 행·조회 fallback에서만 채움)
  reservationDepositMode?: string | null
  // 단기 정책 원값 — 예약금 분해 판정(reservationFeeSplitApplies)과 프리필에 필요하다.
  // 해석값(reservationDepositMode)만으로는 'applyToRent 라서 prepaid' 인지 '영업장 기본이 prepaid' 인지
  // 구분할 수 없어서, 화면이 서버와 같은 판정을 하려면 원값이 있어야 한다. RESERVED 행에서만 채움.
  shortStayReservationMode?: ShortStayReservationMode | null
  shortStayDeposit?: number   // 단기 정책 예약금 시드(원) — 예약금 폼 기본값 프리필
  // 예약(RESERVED) 실수납 합 — 조회월 무관 lease 전체("받은 돈은 사실", 신고 50a2a69b). 비예약 행은 null.
  // cleaning 은 분해 수납의 청소비 몫(ExtraIncome '청소비'). record 가 아니라 부가수익이라 따로 센다 —
  // 빼면 5만을 받은 예약이 화면에서 3만으로 보인다(받은 돈이 화면에서 증발하는 그 사고 유형).
  reservationPaid?: { deposit: number; prepaid: number; cleaning: number } | null
  // 청구 조정 이력(단기 연장·감액) — 미취소 스냅샷만 시간순. 월 이용료 보조 줄·배지 표시 전용(계산 비관여).
  billingAdjusts?: BillingAdjustEntry[]
}

// 월 이용료가 왜 그 값인지 한 줄로 보여주기 위한 표시 메타 (LeaseTerm.shortStayExtensions 스냅샷의 부분집합)
export type BillingAdjustEntry = {
  at: string          // ISO — 조정 시각
  prev: number        // 조정 전 이용료
  next: number        // 조정 후 이용료
  kind: 'increase' | 'decrease'
}

// 미취소 스냅샷만 시간순 — 구 스냅샷은 kind 가 없어 연장으로 본다.
function billingAdjustsOf(raw: unknown): BillingAdjustEntry[] {
  if (!Array.isArray(raw)) return []
  const out: BillingAdjustEntry[] = []
  for (const e of raw as { at?: string; prevRentAmount?: number; newRentAmount?: number; kind?: string; undoneAt?: string | null }[]) {
    if (!e || e.undoneAt || typeof e.prevRentAmount !== 'number' || typeof e.newRentAmount !== 'number') continue
    out.push({ at: e.at ?? '', prev: e.prevRentAmount, next: e.newRentAmount, kind: e.kind === 'decrease' ? 'decrease' : 'increase' })
  }
  return out
}

// 핵심 비즈니스 로직 — GAS의 getRoomPaymentStatus 이관
// ============================================================
export async function getRoomPaymentStatus(targetMonth: string): Promise<RoomRow[]> {
  const propertyId = await getPropertyId()

  const [yyyy, mm] = targetMonth.split('-').map(Number)

  // 조회 시점 필터 — 미래 월은 미납 표시 안 함 (KST 기준)
  const kst = kstYmd()
  const isFutureMonth = (yyyy > kst.year) || (yyyy === kst.year && mm > kst.month)

  // 영업장 인수 날짜 조회
  // 다섯 조회 모두 propertyId·월에만 의존 — 병렬 실행(값·계산식 불변, 응답시간 단축)
  const [property, rooms, activeLeases, prevLeases, allRecordsThruMonth] = await Promise.all([
    prisma.property.findUnique({
      where: { id: propertyId },
      // shortStayPolicy — 단기 계약의 예약금 처리가 영업장 공통 기본값보다 앞선다(resolveReservationDepositMode).
      select: { acquisitionDate: true, prevOwnerCutoffDate: true, reservationDepositMode: true, shortStayPolicy: true },
    }),
    prisma.room.findMany({
      where: { propertyId },
      orderBy: { roomNo: 'asc' },
    }),
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] },
      },
      include: {
        tenant: {
          include: {
            contacts: { where: { isPrimary: true }, take: 1 },
          },
        },
        discounts: true,   // #14 월세 할인
      },
    }),
    // 공실 방의 직전 입주자 (CHECKED_OUT, moveOutDate 최신순)
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['CHECKED_OUT', 'CANCELLED'] } },
      orderBy: { moveOutDate: 'desc' },
      include: {
        tenant: {
          include: { contacts: { where: { isPrimary: true }, take: 1 } },
        },
      },
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isDeposit: false,
        // targetMonth가 viewMonth 이하인 record + viewMonth 말일까지의 payDate record (선납분 등)
        // + [납입일변경] 메모 record는 viewMonth와 무관하게 항상 — originalDueDay 복원용
        OR: [
          { targetMonth: { lte: targetMonth } },
          { payDate: { lte: new Date(yyyy, mm, 0, 23, 59, 59, 999) } },
          { memo: { contains: '[납입일변경]' } },
          { isPrevOwner: true },
        ],
      },
    }),
  ])
  // 예약(RESERVED) lease 실수납 합 — 예약 단계 표시는 조회월 필터를 타지 않는다(신고 50a2a69b:
  // 예약금이 입주월(8월) 날짜로 저장되면 7월 화면에서 0원으로 보여 재시도 → 중복 수납 유발).
  const reservedIds = activeLeases.filter(le => le.status === 'RESERVED').map(le => le.id)
  const reservedPaidRows = reservedIds.length > 0 ? await prisma.paymentRecord.groupBy({
    by: ['leaseTermId', 'isDeposit'],
    where: { leaseTermId: { in: reservedIds }, deletedAt: null },
    _sum: { actualAmount: true },
  }) : []
  // 예약 단계 청소비 몫(분해 수납) — 부가수익이라 record groupBy 로는 안 잡힌다.
  const reservedCleaningRows = reservedIds.length > 0 ? await prisma.extraIncome.groupBy({
    by: ['leaseTermId'],
    where: { leaseTermId: { in: reservedIds }, propertyId, ...CLEANING_FEE_RECEIVED_WHERE },
    _sum: { amount: true },
  }) : []
  const reservedPaidMap = new Map<string, { deposit: number; prepaid: number; cleaning: number }>()
  for (const g of reservedPaidRows) {
    const cur = reservedPaidMap.get(g.leaseTermId) ?? { deposit: 0, prepaid: 0, cleaning: 0 }
    if (g.isDeposit) cur.deposit += g._sum.actualAmount ?? 0
    else cur.prepaid += g._sum.actualAmount ?? 0
    reservedPaidMap.set(g.leaseTermId, cur)
  }
  for (const g of reservedCleaningRows) {
    if (!g.leaseTermId) continue
    const cur = reservedPaidMap.get(g.leaseTermId) ?? { deposit: 0, prepaid: 0, cleaning: 0 }
    cur.cleaning += g._sum.amount ?? 0
    reservedPaidMap.set(g.leaseTermId, cur)
  }

  // 단기 예약금 처리 — 행마다 다시 파싱하지 않는다(정책은 영업장 하나뿐이다).
  const shortStayPolicy = parseShortStayPolicy(property?.shortStayPolicy)
  const shortStayResvMode = shortStayPolicy.reservationMode
  const acquisitionDate = property?.acquisitionDate ?? null
  // 양도인 귀속 기준일 — 별도 설정 없으면 인수일과 동일
  const cutoffDate: Date | null = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate)
    : acquisitionDate ? new Date(acquisitionDate) : null

  // 발생주의(귀속월) 모델:
  // - 잔액/이월액/총수납/firstUnpaidMonth/매출 → targetMonth 기준
  //   (4/30 dueDay인데 5/1 입금 + targetMonth=4월 → 4월 페이지에서 완납으로 인식)
  // - 지연납부 라벨(latePaidAt)만 payDate를 보조로 사용
  // 인수일 이전 양도인 record는 별도 처리. [납입일변경] 메모는 payDate에 무관하게 항상 조회되어야 함.
  // (조회 자체는 위 Promise.all의 allRecordsThruMonth)

  type LeaseWithOverride = (typeof activeLeases)[number] & {
    overrideDueDay: string | null
    overrideDueDayMonth: string | null
    overrideDueDayReason: string | null
  }

  const buildLeaseRow = (room: typeof rooms[number], lease: LeaseWithOverride, prevTenantName: string | null, prevContact: string | null): RoomRow => {
    const l = lease as LeaseWithOverride
    // #14 월세 할인 — 그 달 청구액 = rentAmount - 할인(월별). 단위테스트된 lib/rentDiscount 헬퍼 사용.
    const leaseDiscounts = (lease as { discounts?: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[] }).discounts ?? []
    // 퇴실 일할 정산 — 그 달(checkoutProratedMonth)은 저장된 일할액으로 청구를 덮어씀
    const proratedAmt = l.checkoutProratedAmount
    const proratedMonth = l.checkoutProratedMonth
    // 예약 인상 — 대상월이 인상 적용월 이상이면 scheduledRent 로 청구('7월 이용료부터' 반영, 적용일 전 선납도 인상가).
    // 규칙은 lib/billing effectiveBaseRent 정본이 쥔다. 여기 손으로 베껴 두었더니 상태 분기가
    // 빠져 있어서, 거주 인상 예약이 같은 방의 비거주 계약까지 물 수 있었다(418호 4.8배 클래스).
    const baseForMonth = effectiveBaseRent({ ...lease, room }, targetMonth)
    const expected = (proratedAmt != null && proratedMonth === targetMonth)
      ? proratedAmt
      : discountedRent(leaseDiscounts, targetMonth, baseForMonth)
    const effectiveDueDay = (l.overrideDueDayMonth === targetMonth && l.overrideDueDay)
      ? l.overrideDueDay
      : lease.dueDay
    // overrideDueDay가 full date("YYYY-MM-DD")이면 day만 추출, 다른 달이면 말일 취급(cutoff 비교용)
    const overrideIsFullDate = effectiveDueDay?.includes('-')
    const overrideIsDiffMonth = overrideIsFullDate && !effectiveDueDay!.startsWith(targetMonth)
    const dueDay = overrideIsDiffMonth
      ? 99
      : overrideIsFullDate
        ? new Date(effectiveDueDay! + 'T00:00:00').getDate()
        : effectiveDueDay?.includes('말') ? 31 : Number(effectiveDueDay ?? '1')

    const acqDate     = acquisitionDate ? new Date(acquisitionDate) : null
    const acqYyyy     = acqDate ? acqDate.getFullYear() : 2000
    const acqMm       = acqDate ? acqDate.getMonth() + 1 : 1
    const acqMonthStr = `${acqYyyy}-${String(acqMm).padStart(2, '0')}`

    const moveInDate = lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null

    // 예약(RESERVED) 단계는 아직 입주 안 한 상태 → 청구·잔액·미납 계산 제외.
    // 호실 행은 정상 노출하되 expected/balance 0, isPaid=true로 미납 카운터에서 빠지게 함.
    // moveInDate · isReservationConfirmed는 유지 → UI에서 '예약 확정 / 입주 예정 D-N' 라벨 분기 표시.
    if (lease.status === 'RESERVED') {
      // 표시 정본 수렴(신고 50a2a69b) — 청구 예정액은 입주월 기준 할인·예약 인상 반영(원가 직표시 금지).
      // balance·totalPaid 0 + isPaid true 는 유지(예약은 미납·수금 집계 제외 정본) — 실수납은 reservationPaid 로 노출.
      const moveInMonth = moveInDate ? moveInDate.slice(0, 7) : targetMonth
      const reservedBase = effectiveBaseRent({ ...lease, room }, moveInMonth)
      const reservedExpected = discountedRent(leaseDiscounts, moveInMonth, reservedBase)
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, noMoveInReport: room.noMoveInReport, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: 'RESERVED', expected: reservedExpected, dueDay: lease.dueDay,
        isShortTerm: lease.isShortTerm,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: true,
        reservationPaid: reservedPaidMap.get(lease.id) ?? { deposit: 0, prepaid: 0, cleaning: 0 },
        leaseTermId: lease.id, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee ?? 0,
        accumulatedUnpaid: 0, isFutureMonth, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
        moveInDate, prevPaidThisMonth: false,
        firstUnpaidMonth: null,
        isReservationConfirmed: !!lease.reservationConfirmedAt,
        latePaidAt: null,
        lastPayDate: null,
        nextDueDate: null,
        nextDueAmount: 0,
        expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
        reservationDepositMode: resolveReservationDepositMode(
          lease.reservationDepositMode, property?.reservationDepositMode, lease.isShortTerm, shortStayResvMode,
        ),
        shortStayReservationMode: shortStayResvMode,
        shortStayDeposit: shortStayPolicy.deposit,
      }
    }

    if (targetMonth < acqMonthStr) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, noMoveInReport: room.noMoveInReport, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected, dueDay: lease.dueDay,
        isShortTerm: lease.isShortTerm,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: true,
        leaseTermId: lease.id, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee ?? 0,
        accumulatedUnpaid: 0, isFutureMonth: false, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
        moveInDate, prevPaidThisMonth: false,
        firstUnpaidMonth: null,
        isReservationConfirmed: false,
        latePaidAt: null,
        lastPayDate: null,
        nextDueDate: null,
        nextDueAmount: 0,
        expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      }
    }

    // ── 하이브리드 누적 계산 ──
    // 잔액/이월액/총수납 → payDate 기준(현금주의)
    // firstUnpaidMonth → targetMonth 기준(발생주의, 아래에서 별도 계산)
    const cutoffMonthStr = cutoffDate
      ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
      : acqMonthStr
    const cutoffDay = cutoffDate ? cutoffDate.getDate() : 0
    // 인수월 양도인 자동 처리 판정용 dueDay — 정확성을 위해 다음 우선순위로 결정:
    //   1) changeDueDay 기록 memo의 원본 dueDay (영구 변경 후에도 인수 시점 dueDay 복원)
    //   2) lease.dueDay (override 무시 — override는 특정 월 임시 조정이므로 acqMonth와 무관할 수 있음)
    // 그리고 acqMonth dueDay가 cutoffDay 이전이어야 양도인이 가져갔다고 판정.
    const baseDueDay = lease.dueDay?.includes('말') ? 31 : Number(lease.dueDay ?? '1')
    let originalDueDay = baseDueDay
    {
      const allLeaseRecords_forMemo = allRecordsThruMonth.filter(p => p.leaseTermId === lease.id)
      const changeRecord = allLeaseRecords_forMemo
        .filter(p => p.memo?.includes('[납입일변경]'))
        .sort((a, b) => new Date(a.payDate).getTime() - new Date(b.payDate).getTime())[0]
      if (changeRecord?.memo) {
        const m = changeRecord.memo.match(/\[납입일변경\]\s*([^일→]+?)일?\s*→/)
        if (m) {
          const t = m[1].trim()
          const parsed = t.includes('말') ? 31 : Number(t)
          if (!isNaN(parsed) && parsed > 0) originalDueDay = parsed
        }
      }
    }
    const acqMonthDueBeforeCutoff = !!(cutoffDate && acqMonthStr === cutoffMonthStr && originalDueDay < cutoffDay)

    const allLeaseRecords = allRecordsThruMonth.filter(p => p.leaseTermId === lease.id)
    // 양도인 정산 월 — 양도인이 받은 달. 현 소유주 청구·미납에서 제외.
    const prevOwnerMonths = new Set(allLeaseRecords.filter(p => p.isPrevOwner).map(p => p.targetMonth))
    // 양도인 몫 (payDate < cutoffDate) + 양도인 정산 record — 현 원장 계산에서 제외
    const postCutoffRecords = allLeaseRecords.filter(p => !p.isPrevOwner && (!cutoffDate || new Date(p.payDate) >= cutoffDate))
    // 이달 현금영수증 발행 여부 — viewMonth 귀속 이용료 record에 발행 스탬프가 하나라도 있으면(표시 전용)
    const cashReceiptIssuedThisMonth = postCutoffRecords.some(p => p.targetMonth === targetMonth && !!p.cashReceiptIssuedAt)

    // [저장 청구액 우선] 과거월 청구는 그 달 record에 락인된 expectedAmount를 사용.
    // 월세가 바뀌어도(거주→비거주 등) 과거가 현재 요율로 소급 재계산되지 않게 함.
    // 같은 달 여러 record면 정규 월 청구(최대 expectedAmount)를 그 달 청구액으로 본다
    // (일할·부분납 record는 더 작으므로 무시됨). record 없는 달만 현재 월세(할인 반영)로 fallback.
    const lockedExpectedByMonth = new Map<string, number>()
    for (const p of postCutoffRecords) {
      if (p.isDeposit) continue
      const cur = lockedExpectedByMonth.get(p.targetMonth) ?? 0
      if (p.expectedAmount > cur) lockedExpectedByMonth.set(p.targetMonth, p.expectedAmount)
    }
    // 청구 규칙(일할→락인→할인)은 lib/billing 공용 — dashboard·unpaid.ts·savePayment 와 동일
    const billForMonth = (ms: string): number =>
      billForLeaseMonth(
        { rentAmount: lease.rentAmount, status: lease.status, checkoutProratedAmount: proratedAmt, checkoutProratedMonth: proratedMonth, discounts: leaseDiscounts,
          isShortTerm: lease.isShortTerm, moveInDate: lease.moveInDate,   // 단기 입주월 단일 청구
          room: { scheduledRent: room.scheduledRent, rentUpdateDate: room.rentUpdateDate,
                  nonResidentScheduled: room.nonResidentScheduled, nonResidentRentDate: room.nonResidentRentDate } },
        ms,
        lockedExpectedByMonth.get(ms) ?? null,
      )

    // 인수월에 양도인이 받은 금액 / 사용자가 받은 금액 (acqMonthPrePaid 판정용)
    const acqMonthPaidToPrev = cutoffDate
      ? allLeaseRecords
          .filter(p => p.targetMonth === acqMonthStr && new Date(p.payDate) < cutoffDate)
          .reduce((s, p) => s + p.actualAmount, 0)
      : 0
    // 정규 월 청구만 — '일할 추가' 같이 expectedAmount가 한 달 이용료 미만인 record는
    // 양도인 자동 처리 판정에서 제외 (그렇지 않으면 일할 record 하나가 4월 청구를 락인시켜 이월액이 잘못 발생)
    const acqMonthCurrentOpRecords = postCutoffRecords
      .filter(p => p.targetMonth === acqMonthStr && p.expectedAmount >= expected)
      .reduce((s, p) => s + p.actualAmount, 0)
    const acqMonthPrePaid =
      acqMonthPaidToPrev >= expected ||
      (acqMonthDueBeforeCutoff && acqMonthCurrentOpRecords === 0)

    // 그 월의 effectiveDueDay를 실제 Date로 환산 (override · 말일 · 'YYYY-MM-DD' 모두 처리)
    const resolveDueRaw = (raw: string | null, ry: number, rm: number): Date | null => {
      if (!raw) return null
      if (raw.includes('-')) {
        const [fy, fm, fd] = raw.split('-').map(Number)
        return new Date(fy, fm - 1, fd, 23, 59, 59, 999)
      }
      const last = new Date(ry, rm, 0).getDate()
      let day: number
      if (raw.includes('말')) day = last
      else { day = parseInt(raw, 10); if (isNaN(day)) return null; day = Math.min(day, last) }
      return new Date(ry, rm - 1, day, 23, 59, 59, 999)
    }
    const effDueDateForMonth = (monthStr: string): Date | null => {
      const [my, mn] = monthStr.split('-').map(Number)
      // 그 월에 직접 지정된 override — 무조건 적용 (기존 동작)
      if (l.overrideDueDay && l.overrideDueDayMonth === monthStr) return resolveDueRaw(l.overrideDueDay, my, mn)
      // 납부일 유예: override 가 이 월보다 이후 월에 걸려 있고 그 유예 날짜가 원래 납부일보다 늦으면
      // (= 이 미납 채무를 뒤로 미룬 것) 유예 날짜를 적용 (2026-06-02 사용자 보고: 5월 미납 6/1 유예).
      // unpaid.ts / dashboard page.tsx 의 daysOverdueForMonth 와 동일 규칙 — 한쪽 수정 시 동기화.
      if (l.overrideDueDay && l.overrideDueDayMonth && l.overrideDueDayMonth > monthStr) {
        const [oy, om] = l.overrideDueDayMonth.split('-').map(Number)
        const overrideDate = resolveDueRaw(l.overrideDueDay, oy, om)
        const origDate = resolveDueRaw(lease.dueDay, my, mn)
        if (overrideDate && (!origDate || overrideDate.getTime() >= origDate.getTime())) return overrideDate
      }
      return resolveDueRaw(lease.dueDay, my, mn)
    }
    const todayKstEnd = new Date(kst.year, kst.month - 1, kst.day, 23, 59, 59, 999)

    // viewMonth 격리 — 그 달의 정산만 (이월액은 별도)
    // 과거 청구 가능 월수: 인수일 vs 입주일 중 더 늦은 달부터 viewMonth-1까지
    // (인수 이후 신규 등록된 입주자가 이전 기간을 미납으로 잘못 인식하는 버그 방지)
    const leaseStart  = lease.moveInDate ? new Date(lease.moveInDate) : null
    const lsYyyy      = leaseStart ? leaseStart.getFullYear() : 0
    const lsMm        = leaseStart ? leaseStart.getMonth() + 1 : 0
    const useLeaseStart = leaseStart && (lsYyyy > acqYyyy || (lsYyyy === acqYyyy && lsMm > acqMm))
    // 인수일·입주일 둘 다 없으면 과거 청구 시작점을 알 수 없음 → viewMonth부터(과거 청구 0).
    // 대시보드 unpaid 의 'cutoffMonthStr ?? targetMonth' 폴백과 동일 규칙 (2000-01 폭주 방지).
    const noStartInfo   = !acqDate && !leaseStart
    const loopStartYyyy = noStartInfo ? yyyy : (useLeaseStart ? lsYyyy : acqYyyy)
    const loopStartMm   = noStartInfo ? mm   : (useLeaseStart ? lsMm   : acqMm)

    // 퇴실예정일 기준 청구 종료 — 퇴실월 초과 월 제외 + 퇴실월 자체도 납부일 이전 퇴실이면 청구 0.
    // dashboard·unpaid.ts 와 동일 규칙(날짜 기준, 상태 무관).
    const skipByMoveOut = (ms: string): boolean =>
      isAfterMoveOutMonth(lease.expectedMoveOut, ms)
      || isCheckoutNoBillingMonthFor({ checkoutProratedAmount: proratedAmt, checkoutProratedMonth: proratedMonth }, lease.expectedMoveOut, ms, effDueDateForMonth(ms))

    let pastBillable = 0
    let billedBeforeSum = 0   // #14 과거월 청구 합 — 월별 할인 반영(곱셈 대신 합산)
    for (let cy = loopStartYyyy, cmn = loopStartMm; cy < yyyy || (cy === yyyy && cmn < mm); ) {
      const ms = `${cy}-${String(cmn).padStart(2, '0')}`
      const skip = (ms === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(ms) || skipByMoveOut(ms)
      if (!skip) { pastBillable++; billedBeforeSum += billForMonth(ms) }
      cmn++; if (cmn > 12) { cmn = 1; cy++ }
    }

    // viewMonth 격리: 받은 돈 / 청구 / 잔액
    const accrualThruRecords = postCutoffRecords.filter(p => p.targetMonth <= targetMonth)
    const receivedThisMonth = accrualThruRecords
      .filter(p => p.targetMonth === targetMonth)
      .reduce((s, p) => s + p.actualAmount, 0)
    const receivedBeforeMonth = accrualThruRecords
      .filter(p => p.targetMonth < targetMonth)
      .reduce((s, p) => s + p.actualAmount, 0)

    // viewMonth 청구권 도래 여부 사전 계산 (skipViewMonthBilled에서 사용)
    const _isPastView = (yyyy < kst.year) || (yyyy === kst.year && mm < kst.month)
    const _viewDueDate = effDueDateForMonth(targetMonth)
    // 선납 모델: dueDay = 다음 서비스 기간 시작점. expectedMoveOut ≤ dueDay이면
    // 그 dueDay분 서비스를 사용하지 않으므로 납부 의무 없음 (502호: 5/6 dueDay지만 5/6 이전 퇴실)
    // + 퇴실월 초과 월도 청구 0. lib/billing 공용 규칙(날짜 기준) — dashboard·unpaid.ts 동일.
    const checkoutNoBilling = skipByMoveOut(targetMonth)
    // viewMonth 청구액 — 락인(그 달 record expectedAmount) 반영. 월세 변경 직후에도
    // 수납 페이지·미수납 위젯·푸시가 같은 당월 청구액을 보게 한다.
    const viewBill = billForMonth(targetMonth)
    // (인수월 양도인 처리 / 미래월 / 퇴실 무청구이면 0)
    const skipViewMonthBilled = (targetMonth === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(targetMonth) || isFutureMonth || checkoutNoBilling
    const viewBilled = skipViewMonthBilled ? 0 : viewBill
    // 행 표시용 청구액 — 무청구 퇴실월·양도인 월·인수 선납월은 0(홈 예상 매출과 동일 규칙, 2026-07-07).
    // 미래월은 표시 목적상 청구 예정액을 그대로 보여준다(잔액 계산만 스킵).
    const rowExpected = ((targetMonth === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(targetMonth) || checkoutNoBilling) ? 0 : viewBill
    const viewBalance = receivedThisMonth - viewBilled                 // viewMonth 정산 (음수=미수, 양수=선납)

    // 이 달에 청구가 없는 이유 — 새 계산이 아니라 위에서 이미 나온 두 판정을 화면으로 꺼내는 것뿐이다.
    // 운영자 지적 2026-08-02: "0원인데 완납이면 이상한데? 납부는 했잖아?" 실제로 돈은 이미 받았고
    // 이 달에 더 받을 게 없는 상태인데, 화면은 0원 두 개만 보여줘 안 낸 사람처럼 읽혔다.
    //   shortTermPrepaid  단기 — 입주월에 체류 전체 사용료를 한 번에 받는다(billForLeaseMonth 의 그 규칙)
    //   checkoutNoBilling 퇴실월인데 퇴실일이 납부일보다 앞 — 그 기간 서비스를 안 쓰므로 청구 없음
    // 인수 선납월·양도인 월은 여기서 다루지 않는다. 그 둘은 '내 장부에 없는 달'이라 사정이 다르다.
    const shortTermPrepaid = !!lease.isShortTerm && !!lease.moveInDate
      && monthOfDate(lease.moveInDate) !== targetMonth && viewBill === 0
    const noBillReason: 'shortTermPrepaid' | 'checkoutNoBilling' | null =
      isFutureMonth ? null : checkoutNoBilling ? 'checkoutNoBilling' : shortTermPrepaid ? 'shortTermPrepaid' : null
    // 그 달을 덮은 실수납 합 — 단기는 입주월에 받은 돈, 무청구 퇴실월은 직전 달에 받은 돈.
    // totalPaid 숫자 자체는 손대지 않는다(월 격리 값이라 엑셀·AI 등 소비처가 그 의미에 의존).
    const noBillCoveredAmount: number | null = (() => {
      if (!noBillReason) return null
      const covered = noBillReason === 'shortTermPrepaid'
        ? monthOfDate(lease.moveInDate)
        : `${mm === 1 ? yyyy - 1 : yyyy}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`
      if (!covered) return null
      const sum = postCutoffRecords
        .filter(p => !p.isDeposit && p.targetMonth === covered)
        .reduce((s, p) => s + p.actualAmount, 0)
      return sum > 0 ? sum : null
    })()
    // 그 돈이 어느 달 몫인가 — '7월분 7/7 수납 470,000원'. 귀속월이 없으면 이번 달 수납으로 읽힌다.
    const noBillCoveredMonth: string | null = !noBillReason ? null
      : (noBillReason === 'shortTermPrepaid'
          ? monthOfDate(lease.moveInDate)
          : `${mm === 1 ? yyyy - 1 : yyyy}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`)
    // 그 돈을 받은 날 — 'M/D 수납 470,000원' 캡션용
    const noBillCoveredDate: string | null = (() => {
      if (noBillCoveredAmount == null) return null
      const covered = noBillCoveredMonth
      const dates = postCutoffRecords
        .filter(p => !p.isDeposit && p.targetMonth === covered)
        .map(p => new Date(p.payDate).getTime())
      if (dates.length === 0) return null
      const d = new Date(Math.max(...dates))
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()

    // 이월액 — 이전 달 누적 (양수=과거 선납, 음수=과거 미수). #14: 월별 할인 반영 합산.
    const billedBefore = billedBeforeSum
    const pastBalance = receivedBeforeMonth - billedBefore

    // viewMonth 청구권 도래 여부 (과거 viewMonth는 자동 도래, 현재월은 effDueDay 검사)
    const isPastView = _isPastView
    const viewDueDate = _viewDueDate
    const viewMonthDuePassed = isPastView || (viewDueDate ? viewDueDate <= todayKstEnd : false)

    // 표시 필드 (월 격리)
    const cumulativeBalance = viewBalance                              // 잔액 = viewMonth 정산
    const displayCarryOver = pastBalance                               // 이월액 = 이전 달 누적
    const realCurrentPaid = receivedThisMonth                          // 총수납 = 이번 달 받은 금액
    // 이월 미수 있으면 무조건 미납 우선 (503호: 4월 미수 + 5월 미도래 → '미납' 표시)
    const hasPastUnpaid = pastBalance < 0
    const isPaid = !hasPastUnpaid && (skipViewMonthBilled || receivedThisMonth >= viewBilled || !viewMonthDuePassed)

    // 모달의 "양도인 자동 완납" 플레이스홀더 — 인수월 보기에서 사용자 record 없을 때만
    const prevPaidThisMonth = !!(
      cutoffDate &&
      targetMonth === cutoffMonthStr &&
      acqMonthDueBeforeCutoff &&
      acqMonthCurrentOpRecords === 0
    )

    // 첫 미납월 — cash 누적 FIFO: record.targetMonth 무관하게 받은 총액이
    // 그 월까지의 누적 청구를 충족하는지로 판단. 지연 입금이라도 받은 돈은
    // 가장 오래된 미수부터 충당 (사용자 멘탈 모델과 일치).
    // 예: 김영일이 4월말 dueDay 놓치고 5/1에 4월분 28만 입금
    //   → record가 5월에 저장돼 있어도, 받은 28만이 4월 청구 28만을 충당
    //   → firstUnpaidMonth = 5월 (5월 dueDay 미래)
    let firstUnpaidMonth: string | null = null
    {
      // viewMonth 이하 귀속분만 합산 (선납 = targetMonth > viewMonth은 제외)
      const totalReceivedAll = accrualThruRecords.reduce((s, p) => s + p.actualAmount, 0)
      let cumExpected = 0
      // pastBillable과 동일하게 loopStart(인수일 vs 입주일 중 더 늦은 달)부터 순회
      for (let cy = loopStartYyyy, cmn = loopStartMm; cy < yyyy || (cy === yyyy && cmn <= mm); ) {
        const ms = `${cy}-${String(cmn).padStart(2, '0')}`
        const skip = (ms === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(ms) || skipByMoveOut(ms)
        if (!skip) {
          // 청구권 미발생 월은 미수 후보에서 제외 (404호처럼 dueDay 미도래)
          const dueDate = effDueDateForMonth(ms)
          const isMsPast = ms < targetMonth
          const billedThisStep = isMsPast || (dueDate && dueDate <= todayKstEnd)
          if (billedThisStep) {
            cumExpected += billForMonth(ms)   // [저장 청구액 우선] + #14 월별 할인 반영(fallback)
            if (totalReceivedAll < cumExpected) { firstUnpaidMonth = ms; break }
          }
        }
        cmn++; if (cmn > 12) { cmn = 1; cy++ }
      }
    }

    // 지연납부 — viewMonth 귀속분이 모두 dueDay 이후에 입금된 경우 가장 늦은 payDate
    // (= 4월 탭에서 4/30 dueDay인데 5/1에 입금된 4월분 record가 있으면 표시)
    let latePaidAt: string | null = null
    if (isPaid && dueDay >= 1 && dueDay <= 31) {
      // viewMonth가 cutoff 이전이면 해당 없음
      const dueDate = new Date(yyyy, mm - 1, Math.min(dueDay, new Date(yyyy, mm, 0).getDate()))
      dueDate.setHours(23, 59, 59, 999)
      const lateRecords = postCutoffRecords
        .filter(p => !p.isBillingAdjust && p.targetMonth === targetMonth && new Date(p.payDate) > dueDate)
        .map(p => new Date(p.payDate))
      if (lateRecords.length > 0) {
        const latest = new Date(Math.max(...lateRecords.map(d => d.getTime())))
        latePaidAt = `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}-${String(latest.getDate()).padStart(2, '0')}`
      }
    }

    // 실제 최근 납부일 — 현 원장(postCutoff) record 중 가장 늦은 payDate.
    // 청구 조정 전표(payDate=조작 시각)는 납부가 아니라 제외 — 위 지연납부 판정도 동일(락 계산에는 그대로 포함).
    const lastPayDate: string | null = (() => {
      const paidRecords = postCutoffRecords.filter(p => !p.isBillingAdjust)
      if (paidRecords.length === 0) return null
      const latest = new Date(Math.max(...paidRecords.map(p => new Date(p.payDate).getTime())))
      return `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}-${String(latest.getDate()).padStart(2, '0')}`
    })()

    // 다음 청구 도래일 — viewMonth 안에서만 (그 달 dueDay가 미도래이고 아직 받지 못한 금액이 있을 때)
    // 4월 페이지에서 5월/6월 dueDay를 표시하지 않음 — 그건 5월/6월 페이지에서 다룬다
    // 이월 미수가 있으면 '납부 예정'이 아니라 '미납' 우선이라 nextDue 표시 안 함
    let nextDueDate: string | null = null
    let nextDueAmount = 0
    if (!isFutureMonth && !skipViewMonthBilled && !viewMonthDuePassed && viewDueDate
        && receivedThisMonth < viewBilled && !hasPastUnpaid) {
      nextDueDate = `${viewDueDate.getFullYear()}-${String(viewDueDate.getMonth() + 1).padStart(2, '0')}-${String(viewDueDate.getDate()).padStart(2, '0')}`
      nextDueAmount = viewBilled - receivedThisMonth
    }

    if (isFutureMonth) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, noMoveInReport: room.noMoveInReport, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected: rowExpected, dueDay: effectiveDueDay,
        isShortTerm: lease.isShortTerm,
        currentPaid: 0, carryOver: displayCarryOver,
        totalPaid: 0, balance: cumulativeBalance,
        isPaid, cashReceiptIssued: cashReceiptIssuedThisMonth,
        leaseTermId: lease.id, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee ?? 0,
        accumulatedUnpaid: 0, isFutureMonth: true, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
        moveInDate, prevPaidThisMonth: false,
        firstUnpaidMonth,
        isReservationConfirmed: false,
        latePaidAt,
        lastPayDate,
        nextDueDate,
        nextDueAmount,
        expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
        checkoutProratedAmount: proratedAmt ?? null,
        checkoutProratedMonth: proratedMonth ?? null,
        noBillReason: null, noBillCoveredAmount: null, noBillCoveredDate: null, noBillCoveredMonth: null,   // 미래월은 '아직 안 온 달'이라 무청구와 다르다
        billingAdjusts: billingAdjustsOf(lease.shortStayExtensions),
      }
    }

    return {
      roomId: room.id, roomNo: room.roomNo, type: room.type,
      floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
      isVacant: false, noMoveInReport: room.noMoveInReport, tenantId: lease.tenant.id,
      tenantName: lease.tenant.name,
      contact: lease.tenant.contacts[0]?.contactValue ?? null,
      status: lease.status, expected: rowExpected, dueDay: overrideIsFullDate ? lease.dueDay : effectiveDueDay,
      isShortTerm: lease.isShortTerm,
      currentPaid: realCurrentPaid, carryOver: displayCarryOver,
      totalPaid: realCurrentPaid, balance: cumulativeBalance, isPaid, cashReceiptIssued: cashReceiptIssuedThisMonth,
      leaseTermId: lease.id, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee ?? 0,
      accumulatedUnpaid: 0, isFutureMonth: false, baseRent: room.baseRent,
      prevTenantName, prevContact,
      overrideDueDay: l.overrideDueDay ?? null,
      overrideDueDayMonth: l.overrideDueDayMonth ?? null,
      overrideDueDayReason: l.overrideDueDayReason ?? null,
      moveInDate, prevPaidThisMonth,
      firstUnpaidMonth,
      isReservationConfirmed: false,
      latePaidAt,
      lastPayDate,
      nextDueDate,
      nextDueAmount,
      expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      checkoutProratedAmount: proratedAmt ?? null,
      checkoutProratedMonth: proratedMonth ?? null,
      noBillReason, noBillCoveredAmount, noBillCoveredDate, noBillCoveredMonth,
      billingAdjusts: billingAdjustsOf(lease.shortStayExtensions),
    }
  }

  return rooms.flatMap(room => {
    // 점유 계약 전부를 행으로 — 방이 아니라 계약이 청구의 단위다(정본 lib/leaseStatus roomLeaseRowOrder).
    // 종전에는 방마다 대표 하나만 골라, 한 방에 계약이 둘이면 나머지 하나의 청구가 화면에서 사라졌다.
    const roomLeases = roomLeaseRowOrder(activeLeases.filter(l => l.roomId === room.id))

    if (roomLeases.length === 0) {
      const prev = prevLeases.find(l => l.roomId === room.id)
      return [{
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: true, noMoveInReport: room.noMoveInReport, tenantId: null, tenantName: null,
        contact: null, status: null, expected: 0, dueDay: null,
        isShortTerm: false,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: false, leaseTermId: null,
        depositAmount: 0, cleaningFee: 0, accumulatedUnpaid: 0, isFutureMonth,
        baseRent: room.baseRent,
        prevTenantName: prev?.tenant.name ?? null,
        prevContact: prev?.tenant.contacts[0]?.contactValue ?? null,
        overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null,
        moveInDate: null, prevPaidThisMonth: false,
        firstUnpaidMonth: null,
        isReservationConfirmed: false,
        latePaidAt: null,
        lastPayDate: null,
        nextDueDate: null,
        nextDueAmount: 0,
        expectedMoveOut: null,
      }]
    }

    const rows = roomLeases.map(lease => buildLeaseRow(room, lease as LeaseWithOverride, null, null))
    // 입주일이 viewMonth보다 미래인 행 제외 (예: 5월 11일 입주자가 4월 수납에 미납으로 표시되는 버그)
    // RESERVED는 예외 — 입주 전에도 예약 확인용으로 표시
    return rows.filter(row => {
      if (row.status === 'RESERVED') return true
      if (!row.moveInDate) return true
      return row.moveInDate.slice(0, 7) <= targetMonth
    })
  })
}

// 발생주의 FIFO: lease의 가장 오래된 미수월을 찾는다 (없으면 viewMonth 반환)
// 양도인 record(payDate < cutoff)도 그 월 매출로 인식 — 양도인이 받았으면 그 월은 완납
async function findFirstUnpaidMonth(
  leaseTermId: string,
  expectedAmount: number,   // 클라이언트 제시값 — lease 조회 실패 시 fallback 으로만 사용
  viewMonth: string,
): Promise<string> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      moveInDate: true,
      dueDay: true,
      rentAmount: true,
      status: true,        // 비거주 축 분기(lib/billing effectiveBaseRent)
      isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing)
      expectedMoveOut: true,
      checkoutProratedAmount: true,
      checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
      property: { select: { acquisitionDate: true, prevOwnerCutoffDate: true } },
    },
  })
  if (!lease) return viewMonth

  const cutoffRaw = lease.property.prevOwnerCutoffDate ?? lease.property.acquisitionDate
  const cutoffDate = cutoffRaw ? new Date(cutoffRaw) : null
  const acqDate = cutoffDate ?? (lease.moveInDate ? new Date(lease.moveInDate) : new Date())

  const moveIn = lease.moveInDate ? new Date(lease.moveInDate) : null
  const startBase = moveIn && cutoffDate && moveIn > cutoffDate ? moveIn : acqDate
  let cy = startBase.getFullYear()
  let cmn = startBase.getMonth() + 1

  const [vy, vm] = viewMonth.split('-').map(Number)
  const acqYearMonth = cutoffDate
    ? { y: cutoffDate.getFullYear(), m: cutoffDate.getMonth() + 1 }
    : null

  // 납입일변경 이력에서 인수 시점의 원본 납부일 복원 (buildLeaseRow와 동일 로직)
  // lease.dueDay는 변경 후 값일 수 있으므로 [납입일변경] 메모에서 원본을 추출
  let baseDueDayNum = lease.dueDay?.includes('말') ? 31 : parseInt(lease.dueDay ?? '99', 10)
  if (cutoffDate) {
    const firstChangeMemo = await prisma.paymentRecord.findFirst({
      where: { leaseTermId, memo: { contains: '[납입일변경]' } },
      orderBy: { payDate: 'asc' },
      select: { memo: true },
    })
    if (firstChangeMemo?.memo) {
      const m = firstChangeMemo.memo.match(/\[납입일변경\]\s*([^일→]+?)일?\s*→/)
      if (m) {
        const t = m[1].trim()
        const parsed = t.includes('말') ? 31 : Number(t)
        if (!isNaN(parsed) && parsed > 0) baseDueDayNum = parsed
      }
    }
  }

  while (cy < vy || (cy === vy && cmn <= vm)) {
    const ms = `${cy}-${String(cmn).padStart(2, '0')}`
    const records = await prisma.paymentRecord.findMany({
      where: { leaseTermId, targetMonth: ms, isDeposit: false },
      select: { actualAmount: true, expectedAmount: true, payDate: true, isPrevOwner: true },
    })

    // 양도인 정산 월은 미수월 후보에서 제외
    if (records.some(r => r.isPrevOwner)) { cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue }

    // 퇴실예정월 초과·퇴실월 무청구(납부일 이전 퇴실) — 미수월 후보에서 제외 (lib/billing 공용 규칙)
    if (isAfterMoveOutMonth(lease.expectedMoveOut, ms)
        || isCheckoutNoBillingMonthFor(lease, lease.expectedMoveOut, ms, resolveDueDateForMonth(lease.dueDay, ms))) {
      cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue
    }

    // 그 달 청구액 — 일할→락인(기존 record 최대)→할인 순 (읽기 엔진 3곳과 동일 규칙)
    const lockedMax = records.filter(r => !r.isPrevOwner).reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    const monthBill = billForLeaseMonth(lease, ms, lockedMax > 0 ? lockedMax : null)

    // 인수월(cutoffDate가 속한 달): 양도인 자동 처리 검사
    if (cutoffDate && acqYearMonth && cy === acqYearMonth.y && cmn === acqYearMonth.m) {
      const cutoffDay = cutoffDate.getDate()
      const opPaid = records
        .filter(r => new Date(r.payDate) >= cutoffDate)
        .reduce((s, r) => s + r.actualAmount, 0)
      const totalPaid = records.reduce((s, r) => s + r.actualAmount, 0)
      const dueBeforeCutoff = !isNaN(baseDueDayNum) && baseDueDayNum < cutoffDay
      const acqMonthAutoPaid = dueBeforeCutoff && opPaid === 0
      // 양도인이 받았거나(record 합으로 expected 충족) 자동 처리 조건이면 완납으로 본다
      if (totalPaid >= monthBill || acqMonthAutoPaid) {
        cmn++; if (cmn > 12) { cmn = 1; cy++ }
        continue
      }
      if (totalPaid < monthBill) return ms
    } else {
      // 일반 월: 모든 record 합산 (양도인 record는 인수월에만 발생하므로 여긴 영향 없음)
      const received = records.reduce((s, r) => s + r.actualAmount, 0)
      if (received < monthBill) return ms
    }
    cmn++; if (cmn > 12) { cmn = 1; cy++ }
  }
  return viewMonth
}

// 수납 등록 — 발생주의 FIFO: 가장 오래된 미수월부터 자동 충당, 과납분은 다음달로 이월
// (한 record의 actualAmount는 절대 expectedAmount를 초과하지 않음)
export type SavePaymentResult = {
  inputMonth: string                                       // 사용자가 입력 시점에 보던 viewMonth
  startMonth: string                                       // FIFO가 시작한 월 (가장 오래된 미수월)
  allocations: { targetMonth: string; amount: number }[]   // 각 월에 분배된 금액
  // 이 결제가 만든 record id 전부 — 화면 토스트의 적용취소가 되돌릴 대상(v2.0 §16).
  // allocations 로 대신할 수 없다. 그쪽은 portion > 0 일 때만 쌓이는데 record 는 0원 흔적으로도
  // 생기므로(아래 isOriginalMonth && remaining === 0), allocations 기준으로 지우면 고아가 남는다.
  createdIds: string[]
}

export async function savePayment(data: {
  leaseTermId: string
  tenantId:    string
  targetMonth: string
  expectedAmount: number
  actualAmount:   number
  payDate:     string
  payMethod:   string
  memo?:       string
  // 사용자가 귀속월을 명시한 경우 — FIFO 우회. 해당 월부터 분배 시작 (과납분은 다음달로 이월)
  forcedTargetMonth?: string
  // 현금영수증 발행 표시(메타데이터, 충당·잔액 수식 비관여) — 그 결제가 만든 record 전부에 스탬프
  cashReceiptIssued?: boolean
  // 발행일 'YYYY-MM-DD'(KST). 안 넘기면 오늘. 값 결정은 lib/cashReceipt 정본이 한다.
  cashReceiptIssuedDate?: string | null
}): Promise<SavePaymentResult> {
  await requireEdit()
  const propertyId = await getPropertyId()
  // 스탬프는 루프 **밖에서 한 번** 정한다. 안에서 부르면 쪼개진 record 마다 밀리초가 갈려
  // '한 결제 = 한 발행'이라는 사실이 흐려진다(형제 묶음 판정도 createdAt 근사에 기댄다).
  const crStamp = resolveCashReceiptIssuedAt({ issued: !!data.cashReceiptIssued, issuedDate: data.cashReceiptIssuedDate })

  // 월별 청구액을 서버에서 직접 계산(일할→락인→할인, lib/billing 공용 규칙).
  // 클라이언트가 보낸 expectedAmount(할인 미반영 원금일 수 있음)를 그대로 record 에 락인하면
  // 읽기 엔진의 [저장 청구액 우선] 규칙이 할인을 무효화한다 — lease 조회 실패 시에만 fallback.
  const billingLease = await prisma.leaseTerm.findUnique({
    where: { id: data.leaseTermId },
    select: {
      rentAmount: true, status: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
      isShortTerm: true, moveInDate: true,   // 단기 입주월 단일 청구(lib/billing)
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      // 예약 인상 — 미래월 선납 시 인상가로 락인되도록('7월 이용료부터' 반영). 거주·비거주 두 축.
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    },
  })

  let remaining = data.actualAmount
  // forcedTargetMonth 명시 시 FIFO 우회, 아니면 가장 오래된 미수월부터 시작
  let currentTm = data.forcedTargetMonth
    ? data.forcedTargetMonth
    : await findFirstUnpaidMonth(data.leaseTermId, data.expectedAmount, data.targetMonth)
  const startTm = currentTm
  let isOriginalMonth = true
  const touchedMonths: string[] = []
  const monthBillByTm: Record<string, number> = {}
  const allocations: { targetMonth: string; amount: number }[] = []
  const createdIds: string[] = []

  // 안전장치: 무한루프 방지 — appConfig.FIFO_MAX_ALLOCATE_MONTHS (60개월 = 5년)
  let safety = FIFO_MAX_ALLOCATE_MONTHS
  // 직전에 충당한 달과, 그 달에 이 결제가 실제로 기여했는지 — 자동 메모 문구 판정용(표시 전용, 수식 무관)
  let prevTm = startTm
  let prevFilled = false
  while (remaining > 0 && safety-- > 0) {
    const existing = await prisma.paymentRecord.findMany({
      where: { leaseTermId: data.leaseTermId, targetMonth: currentTm, isDeposit: false },
      select: { actualAmount: true, expectedAmount: true, isPrevOwner: true },
    })
    const alreadyPaid = existing.reduce((s, r) => s + r.actualAmount, 0)
    const lockedMax   = existing.filter(r => !r.isPrevOwner).reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    const monthBill   = billingLease
      ? billForLeaseMonth(billingLease, currentTm, lockedMax > 0 ? lockedMax : null)
      : data.expectedAmount
    monthBillByTm[currentTm] = monthBill
    const remainingThisMon = Math.max(0, monthBill - alreadyPaid)
    // 단기는 입주월 외 청구 0(billForLeaseMonth 단기 규칙)이라 과납을 다음 달로 이월할 곳이 없다.
    // 청소비를 사용료와 합쳐 입금하는 실관행(파트쿨리나 사례)에서 잔액이 어느 record에도 못 남고
    // 증발하는 것을 막기 위해, 입력월에서 남는 금액을 전부 흡수해 과납(+잔액)으로 보이게 한다.
    const shortAbsorb = !!billingLease?.isShortTerm && !!billingLease?.moveInDate && isOriginalMonth
    const portion          = shortAbsorb ? remaining : Math.min(remaining, remainingThisMon)

    // portion이 0이어도 원본 월에 한 번은 record를 남겨야 0원 입력이 흔적 남음
    // (이 케이스는 원본 월이 이미 완납인 상태에서 추가 입력한 경우 — 다음 달로 이월)
    if (portion > 0 || (isOriginalMonth && remaining === 0)) {
      const seqNo = await prisma.paymentRecord.count({
        where: { leaseTermId: data.leaseTermId, targetMonth: currentTm, deletedAt: undefined },
      })
      // 자동 메모 — '과납 이월'은 이 경로에서 사실과 반대로 읽힌다(운영자 지적 2026-08-02).
      // 넘어갈 달이 있으니 정의상 과납이 아니다. 남는 돈을 다음 달로 미는 것뿐이다.
      // 사정은 둘이다. 실측 13건 중 앞 달 완납 10건 / 앞 달 채우고 남음 3건.
      //
      // 가리키는 달도 startTm 이 아니라 **직전 충당월**이어야 한다. 두 달 이상 건너뛰면
      // 종전 문구는 엉뚱한 달을 가리켰다(421호 이종현 — 6월 record 에 "2026-04 과납 이월").
      // 연도를 넣는 이유: 메모는 영구 기록이라 나중에 그 자체로 읽혀야 한다.
      const prevY = Number(prevTm.slice(0, 4)), prevM = Number(prevTm.slice(5))
      const carryMemo = prevFilled
        ? `${prevY}년 ${prevM}월분 채우고 남은 금액`
        : `${prevY}년 ${prevM}월분까지 완납 · 미리 낸 금액`
      const memo = isOriginalMonth
        ? (data.memo ?? null)
        : `${carryMemo}${data.memo ? ` · ${data.memo}` : ''}`
      const created = await prisma.paymentRecord.create({
        data: {
          leaseTermId:    data.leaseTermId,
          tenantId:       data.tenantId,
          propertyId,
          targetMonth:    currentTm,
          expectedAmount: monthBillByTm[currentTm] ?? data.expectedAmount,
          actualAmount:   portion,
          payDate:        new Date(data.payDate),
          payMethod:      data.payMethod,
          memo,
          seqNo:          seqNo + 1,
          isPaid:         false,
          carryOver:      0,
          // 한 결제가 여러 달로 쪼개지면 **전부**에 찍는다(2026-08-03 봉합).
          // 종전 isOriginalMonth 조건은 첫 달 record 에만 찍었는데, 합계는 결제일 기준으로
          // record 별 금액을 더하므로 쪼개진 결제가 일부만 잡혔다. 앞 달이 이미 완납이라
          // 첫 달 record 자체가 안 생기면 찍을 대상이 아예 없어 전액이 소실됐다.
          // saveDepositPayment·saveCleaningFeePayment 는 원래부터 결제 단위로 찍는다 — 정본 수렴이다.
          cashReceiptIssuedAt: portion > 0 ? crStamp : null,
        },
      })
      touchedMonths.push(currentTm)
      // 적용취소 대상 수집 — 바로 아래 allocations.push 와 달리 portion 가드 밖이다.
      // 0원 흔적 record 도 이 결제가 만든 것이라 되돌릴 때 같이 지워야 한다.
      createdIds.push(created.id)
      if (portion > 0) allocations.push({ targetMonth: currentTm, amount: portion })
    }

    remaining -= portion
    prevTm = currentTm
    prevFilled = portion > 0
    isOriginalMonth = false
    if (remaining <= 0) break

    // 다음 달로 이동
    const [y, m] = currentTm.split('-').map(Number)
    const next   = new Date(y, m, 1)
    currentTm    = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
  }

  // 영향받은 모든 월에 대해 isPaid 재계산 (그 달 청구액 기준)
  for (const tm of touchedMonths) {
    await recalculatePayments(data.leaseTermId, tm, monthBillByTm[tm] ?? data.expectedAmount)
  }

  revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
  return { inputMonth: data.targetMonth, startMonth: startTm, allocations, createdIds }
}

// 수납 등록 시 사용자가 명시 선택할 수 있는 귀속월 후보 — 전체 미수월 + viewMonth ± 향후 3개월
// 자동(FIFO) 옵션은 클라이언트에서 별도 추가
export type TargetMonthOption = {
  month: string                                      // 'YYYY-MM'
  status: 'unpaid' | 'partial' | 'paid' | 'future'
  paidAmount: number
  expectedAmount: number
}

export async function getTargetMonthOptions(
  leaseTermId: string,
  viewMonth: string,
): Promise<TargetMonthOption[]> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      moveInDate: true,
      rentAmount: true,
      status: true,        // 비거주 축 분기(lib/billing effectiveBaseRent)
      isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing)
      expectedMoveOut: true,
      checkoutProratedAmount: true,
      checkoutProratedMonth: true,
      // 무청구 퇴실월 판정용 — 그 달 만기를 알아야 한다(임시조정 포함)
      dueDay: true,
      overrideDueDay: true,
      overrideDueDayMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
      property: { select: { acquisitionDate: true, prevOwnerCutoffDate: true } },
    },
  })
  if (!lease) return []

  const cutoffRaw = lease.property.prevOwnerCutoffDate ?? lease.property.acquisitionDate
  const cutoffDate = cutoffRaw ? new Date(cutoffRaw) : null
  const moveIn = lease.moveInDate ? new Date(lease.moveInDate) : null
  // 시작점: 인수일과 입주일 중 더 늦은 쪽
  const startDate = moveIn && cutoffDate && moveIn > cutoffDate ? moveIn : (cutoffDate ?? moveIn ?? new Date())
  const startY = startDate.getFullYear()
  const startM = startDate.getMonth() + 1

  const [vy, vm] = viewMonth.split('-').map(Number)
  // viewMonth + 3개월까지
  const endDate = new Date(vy, vm - 1 + 3, 1)
  const endY = endDate.getFullYear()
  const endM = endDate.getMonth() + 1

  // 모든 record 합산 by targetMonth (+ 그 달 락인 expectedAmount 최대)
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false },
    select: { targetMonth: true, actualAmount: true, expectedAmount: true, payDate: true, isPrevOwner: true },
  })
  const prevOwnerMonths = new Set(records.filter(r => r.isPrevOwner).map(r => r.targetMonth))
  const paidByMonth: Record<string, number> = {}
  const lockedByMonth: Record<string, number> = {}
  for (const r of records) {
    if (r.isPrevOwner) continue
    if (cutoffDate && new Date(r.payDate) < cutoffDate) continue
    paidByMonth[r.targetMonth] = (paidByMonth[r.targetMonth] ?? 0) + r.actualAmount
    if (r.expectedAmount > (lockedByMonth[r.targetMonth] ?? 0)) lockedByMonth[r.targetMonth] = r.expectedAmount
  }

  const out: TargetMonthOption[] = []
  let cy = startY, cmn = startM
  while (cy < endY || (cy === endY && cmn <= endM)) {
    const ms = `${cy}-${String(cmn).padStart(2, '0')}`
    if (prevOwnerMonths.has(ms)) { cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue }
    // 퇴실월 이후는 청구 대상 아님 — findFirstUnpaidMonth 와 동일 규칙(추천이 퇴실 후 달을 잡지 않게).
    if (isAfterMoveOutMonth(lease.expectedMoveOut, ms)) { cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue }
    const paid = paidByMonth[ms] ?? 0
    // 그 달 청구액 — 읽기 엔진 3곳·savePayment 과 동일한 단일 규칙(일할→락인→예약인상→할인).
    const locked = lockedByMonth[ms]
    const expected = billForLeaseMonth(lease, ms, locked && locked > 0 ? locked : null)
    // 청구가 없는 달은 선택지에서 뺀다 — 무청구 퇴실월(퇴실일이 그 달 납부일 이전)과
    // 단기 비청구월(입주월 외)이 여기 해당한다. 종전에는 무청구 퇴실월이 '미납 470,000원'
    // 선택지로 떠서 청구가 0인 달에 수납을 넣도록 유도했다(운영자 지적 2026-08-02, A-findings P2).
    // 판정은 읽기 화면과 같은 정본(lib/billing)을 쓴다 — 여기서 다시 짜면 또 갈린다.
    const dueDateForMs = resolveDueDateForMonth(effectiveDueRawForMonth(lease, ms), ms)
    if (isCheckoutNoBillingMonthFor(lease, lease.expectedMoveOut, ms, dueDateForMs) || expected <= 0) {
      cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue
    }
    let status: TargetMonthOption['status']
    if (ms > viewMonth) status = 'future'
    else if (paid >= expected) status = 'paid'
    else if (paid > 0) status = 'partial'
    else status = 'unpaid'
    out.push({ month: ms, status, paidAmount: paid, expectedAmount: expected })
    cmn++; if (cmn > 12) { cmn = 1; cy++ }
  }
  return out
}

// 양도인 정산 — 특정 월 임대료를 양도인이 받았다고 기록.
// 그 달은 현 소유주 청구·미납·매출에서 제외 (record는 isPrevOwner=true).
export async function savePrevOwnerSettle(
  leaseTermId: string,
  targetMonth: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: { rentAmount: true, tenantId: true },
  })
  if (!lease) return { ok: false, error: '계약을 찾을 수 없습니다.' }

  const dup = await prisma.paymentRecord.findFirst({
    where: { leaseTermId, targetMonth, isPrevOwner: true },
  })
  if (dup) return { ok: false, error: '이미 양도인 정산 처리된 달입니다.' }

  const seqNo = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth, deletedAt: undefined } })
  await prisma.paymentRecord.create({
    data: {
      leaseTermId, tenantId: lease.tenantId, propertyId,
      targetMonth,
      expectedAmount: lease.rentAmount,
      actualAmount:   lease.rentAmount,
      payDate:        ymdToDbDate(`${targetMonth}-01`),
      payMethod:      '양도인 정산',
      memo:           '[양도인 정산]',
      isPrevOwner:    true,
      isDeposit:      false,
      isPaid:         true,
      seqNo:          seqNo + 1,
      carryOver:      0,
    },
  })
  revalidatePath('/rooms')
  return { ok: true }
}

// 양도인 정산 메뉴 노출 여부 — auto: 인수월+다음달 한정 + 1회 사용 후 숨김.
// lease.prevOwnerSettleMenu 가 'show'/'hide'이면 강제.
export async function getPrevOwnerSettleState(
  leaseTermId: string,
  viewMonth: string,
): Promise<{ canSettle: boolean; settledMonths: string[]; menuMode: string }> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      prevOwnerSettleMenu: true,
      property: { select: { acquisitionDate: true, prevOwnerCutoffDate: true } },
    },
  })
  if (!lease) return { canSettle: false, settledMonths: [], menuMode: 'auto' }
  const settled = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isPrevOwner: true },
    select: { targetMonth: true },
  })
  const settledMonths = settled.map(r => r.targetMonth)
  const menuMode = lease.prevOwnerSettleMenu
  if (menuMode === 'hide') return { canSettle: false, settledMonths, menuMode }
  if (menuMode === 'show') return { canSettle: true, settledMonths, menuMode }
  const cutoffRaw = lease.property.prevOwnerCutoffDate ?? lease.property.acquisitionDate
  if (!cutoffRaw) return { canSettle: false, settledMonths, menuMode }
  const c = new Date(cutoffRaw)
  const acqM = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`
  const nx = new Date(c.getFullYear(), c.getMonth() + 1, 1)
  const acqNext = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, '0')}`
  const inWindow = viewMonth === acqM || viewMonth === acqNext
  return { canSettle: inWindow && settledMonths.length === 0, settledMonths, menuMode }
}

// 양도인 정산 메뉴 표시 모드 변경 (auto|show|hide) — 세입자별 override
export async function setPrevOwnerSettleMenu(
  leaseTermId: string,
  mode: 'auto' | 'show' | 'hide',
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
  if (!lease) return { ok: false, error: '계약을 찾을 수 없습니다.' }
  await prisma.leaseTerm.update({ where: { id: leaseTermId }, data: { prevOwnerSettleMenu: mode } })
  revalidatePath('/rooms')
  return { ok: true }
}

// 보증금 수납 등록 (초과금은 이용료로 분리 저장)
//
// ── 역할 경계 ─ saveDepositPayment 대 recordDepositReceived (2026-08-24, 신고 98fb6fce·00c39371) ──
//
// **실제로 돈이 들어온 기록은 전부 이쪽이다.** 가드가 여기 다 있다 — 계약 보증금 미입력 차단,
// 초과 수납 차단(잔여 기준, 청소비 몫 반영), 이용료 과납 차단, 초과분의 이용료 분리와 락인,
// recalculatePayments 까지. 입금일·결제수단을 **호출부가 반드시 넘긴다**(옵셔널이 아니다).
//
// `recordDepositReceived`(아래)는 **소급 기록** 전용이다. 전 원장이 받았거나 앱 밖에서 이미 받아
// 입금 기록만 없는 계약에 사실을 남기는 자리라 결제수단 기본값이 '기타'다. 그 '기타'는 정직한
// 기록이므로 억지로 바꾸지 않는다. 다만 **날짜는 반드시 물어야 한다** — 안 물으면 버튼을 누른
// 날이 입금일로 박혀, 실입금과 다른 날짜가 세무 대사 축(payDate)에 남는다. 실제로 그렇게 7건이
// 쌓였다(2026-08-24 조사).
//
// 새 진입로를 만들 때 판단 기준은 하나다. **지금 돈을 받았으면 이쪽, 예전에 받은 사실을 적는
// 것이면 저쪽.** 헷갈리면 이쪽이다 — 가드가 있는 편이 안전하다.
export async function saveDepositPayment(data: {
  leaseTermId: string
  tenantId:    string
  targetMonth: string
  depositAmount: number
  rentAmount:  number
  totalPaid:   number
  payDate:     string
  payMethod:   string
  memo?:       string
  cashReceiptIssued?: boolean   // 현금영수증 발행 표시 — 보증금·초과분 record 모두(한 결제 단위)
  cashReceiptIssuedDate?: string | null   // 발행일 'YYYY-MM-DD'(KST). 값 결정은 lib/cashReceipt 정본.
  // 이 결제가 만든 record 를 되돌릴 수 있게 id 를 돌려준다(§16 적용취소). 금액 계산에는 관여하지 않는다.
}): Promise<{ ok: true; createdIds: string[] } | { ok: false; error: string }> {
  await requireEdit()
  const propertyId = await getPropertyId()
  // 보증금 몫과 초과분(이용료) 몫은 한 결제다 — 스탬프도 하나를 나눠 쓴다.
  const crStamp = resolveCashReceiptIssuedAt({ issued: !!data.cashReceiptIssued, issuedDate: data.cashReceiptIssuedDate })

  // 계약 보증금이 0이면 보증금 수납을 받지 않는다 (2026-08-02 조사).
  //
  // 종전에는 이 경우 depositActual 이 0 이 되어 보증금 record 가 0원으로 생기고,
  // 받은 돈 전액이 아래 초과분 분기를 타 **이용료로** 넘어갔다. 즉 돌려줘야 할 예수금이 매출로 인식됐다.
  // knowledge/cash-receipt-refund §"보증금은 애초에 매출이 아니다" 와 정면 충돌이라 케이스가 아니라 클래스다.
  //
  // 계약 보증금 0 은 대부분 '무보증'이 아니라 '미입력'이다(스키마가 Int @default(0) 이라 둘을 구분 못 한다).
  // 실측 90건 중 54건이 0이고 이 영업장 표준은 5만원이다. 그래서 막고 입력을 유도하는 쪽이 맞다.
  // 예약금 경로(saveReservationDeposit)의 중복 가드도 `depositAmount > 0` 조건이라 0 계약에서는 건너뛴다.
  if (data.depositAmount <= 0) {
    return { ok: false, error: '계약 보증금이 입력되지 않았습니다. 입주자 정보 수정에서 보증금을 먼저 입력해 주세요.' }
  }

  // 보증금 초과 수납 차단 (신고 a5edc93e 후속, 운영자 승인 2026-08-10).
  // 종전에는 min(받은 돈, 계약 보증금) 만 봐서, 보증금을 이미 받아 둔 계약에 또 넣으면
  // 보증금 합계가 계약액을 넘어갔다(예약금 경로에는 같은 가드가 이미 있는데 이 경로만 없었다).
  // 잔여가 있으면 잔여까지만 보증금으로 잡고 나머지는 아래 초과분(이용료) 분기로 흘린다.
  //
  // 청소비를 보증금 안의 몫으로 받는 영업장(설정 cleaningFeeInDeposit)에서는 입실 때 받은 청소비도
  // 계약 보증금의 일부다. 그 몫을 빼지 않으면 현금 몫을 다 받은 계약에 청소비만큼을 또 넣을 수 있다
  // (520호 김민정 — 현금 30,000 을 받은 계약에 20,000 을 더 넣으면 이중 계상 복원). 설정이 꺼진
  // 영업장에서는 청소비가 보증금과 무관하므로 종전과 완전히 같은 판정이다(정상 수납을 막지 않는다).
  const [depositAgg, cleaningAgg, propForDeposit] = await Promise.all([
    prisma.paymentRecord.aggregate({
      where: { leaseTermId: data.leaseTermId, isDeposit: true, deletedAt: null },
      _sum: { actualAmount: true },
    }),
    prisma.extraIncome.aggregate({
      where: { leaseTermId: data.leaseTermId, propertyId, ...CLEANING_FEE_RECEIVED_WHERE, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { cleaningFeeInDeposit: true } }),
  ])
  const depositPaid = depositAgg._sum.actualAmount ?? 0
  const depoComp = depositComposition({
    contractDeposit: data.depositAmount, depositPaid,
    cleaningPaid: cleaningAgg._sum.amount ?? 0,
    cleaningFeeInDeposit: propForDeposit?.cleaningFeeInDeposit ?? false,
  })
  const depositRemaining = depoComp.shortfall
  if (depositRemaining <= 0) {
    return {
      ok: false as const,
      error: depoComp.coveredByCleaning > 0
        ? `계약 보증금 ${data.depositAmount.toLocaleString()}원은 현금 ${depositPaid.toLocaleString()}원과 입실 청소비 ${depoComp.coveredByCleaning.toLocaleString()}원으로 이미 채워져 더 받을 몫이 없습니다. 이용료라면 일반 수납으로 등록해 주세요.`
        : `계약 보증금 ${data.depositAmount.toLocaleString()}원은 이미 ${depositPaid.toLocaleString()}원을 받아 더 받을 몫이 없습니다. 수납 내역을 확인해 주세요. 이용료라면 일반 수납으로 등록해 주세요.`,
    }
  }

  // 예약금 부분 수납 대응 (오류신고 9b974be0·63bf23bc): 실제 받은 금액을 **잔여 보증금** 상한으로 기록.
  // 예: 계약 보증금 30만에 예약금 10만만 받으면 보증금 record 는 10만으로 남는다(초과분은 아래 이용료 분리).
  const depositActual = Math.min(data.totalPaid, depositRemaining)

  // 중복 입력 가드 — 이미 받은 돈을 못 보고 총액을 다시 넣는 사고를 막는다(신고 2026-08-02, 402호 황인정).
  //
  // 그 건은 이랬다. 7/15 에 예약금 50,000 을 일반 수납으로 기록해 뒀는데(예약금 전용 폼 도입 전),
  // 오늘 입실 처리하며 총액 379,000 을 여기로 다시 넣었다. 결과적으로 같은 5만원이 두 번 잡혀
  // 이용료가 5만원 과납이 되고 **8월 매출이 379,000 으로 5만원 과대**가 됐다(보증금은 매출이 아닌데 섞였다).
  //
  // 예약금 경로(saveReservationDeposit)에는 '보증금 합계가 계약 보증금 이상이면 차단'하는 가드가
  // 이미 있는데, 그것만으로는 이 사고를 **못 잡는다** — 그때 보증금 record 는 0건이었고
  // 중복된 5만원은 이용료 쪽에 있었다. 그래서 여기서는 **이용료 과납**을 본다.
  const monthBillForGuard = await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount)
  const already = await prisma.paymentRecord.aggregate({
    where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth, isDeposit: false, isPrevOwner: false, deletedAt: null },
    _sum: { actualAmount: true },
  })
  const alreadyRent = already._sum.actualAmount ?? 0
  // 이용료로 흘러갈 몫은 '계약 보증금'이 아니라 '잔여 보증금'을 뺀 나머지다 — 위 초과 수납 차단과 같은 기준.
  const incomingRent = Math.max(0, data.totalPaid - depositRemaining)
  // incomingRent === 0 이면 이번 저장은 이용료 record 를 아예 안 만든다(아래 excess 분기를 안 탄다).
  // 그 경우까지 막으면 "이미 과납인 달"이라는 이유로 순수 보증금 기록이 거절된다 — 막을 대상이 없는데
  // 막는 것이고, 에러 문구("지금 입력한 금액까지 더하면")도 사실과 다르다. 그 달이 과납이 되는 경로는
  // 실재한다(단기 입주월 흡수·예약 선납 재앵커·퇴실 일할·단기 감액 되쓰기). 신고 00c39371 "보증금
  // 수납처리가 안되는데?" 가 닿는 자리라 조인다. 금액은 한 톨도 안 움직인다 — 거절 조건만 좁힌다.
  if (monthBillForGuard > 0 && incomingRent > 0 && alreadyRent > 0 && alreadyRent + incomingRent > monthBillForGuard) {
    return {
      ok: false as const,
      error: `이 달에 이미 ${alreadyRent.toLocaleString()}원이 수납돼 있습니다. 지금 입력한 금액까지 더하면 청구액 ${monthBillForGuard.toLocaleString()}원을 넘습니다. 수납 내역을 확인하고 차액만 입력해 주세요.`,
    }
  }
  // RESERVED(예약) 단계 수납이면 기본 메모를 '예약금'으로 — leaseTermId 로 status 만 조회.
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: data.leaseTermId, propertyId },
    select: { status: true },
  })
  const defaultDepositMemo = lease?.status === 'RESERVED' ? '예약금' : '보증금'

  const existingCount = await prisma.paymentRecord.count({
    where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth, deletedAt: undefined },
  })

  const createdIds: string[] = []
  const depositRec = await prisma.paymentRecord.create({
    data: {
      leaseTermId:    data.leaseTermId,
      tenantId:       data.tenantId,
      propertyId,
      targetMonth:    data.targetMonth,
      expectedAmount: data.depositAmount,
      actualAmount:   depositActual,
      payDate:        new Date(data.payDate),
      payMethod:      data.payMethod,
      memo:           data.memo ?? defaultDepositMemo,
      seqNo:          existingCount + 1,
      isPaid:         false,
      isDeposit:      true,
      carryOver:      0,
      cashReceiptIssuedAt: crStamp,
    },
  })
  createdIds.push(depositRec.id)

  const excess = data.totalPaid - depositActual
  if (excess > 0) {
    // 초과분은 이용료 record — expectedAmount 는 그 달 실제 청구액(할인·일할 반영)으로 락인
    const monthBill = await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount)
    const excessRec = await prisma.paymentRecord.create({
      data: {
        leaseTermId:    data.leaseTermId,
        tenantId:       data.tenantId,
        propertyId,
        targetMonth:    data.targetMonth,
        expectedAmount: monthBill,
        actualAmount:   excess,
        payDate:        new Date(data.payDate),
        payMethod:      data.payMethod,
        memo:           null,
        seqNo:          existingCount + 2,
        isPaid:         false,
        carryOver:      0,
        cashReceiptIssuedAt: crStamp,
      },
    })
    createdIds.push(excessRec.id)
  }

  await recalculatePayments(
    data.leaseTermId, data.targetMonth,
    await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount),
  )
  revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
  return { ok: true as const, createdIds }
}

// 청소비 수납 — 입실 때 청소비를 **별도로** 받는 경우(주로 단기: 보증금 0 + 청소비 있음).
//
// 청소비는 보증금이 아니다. 돌려줄 의무가 없는 확정 대가라 **받은 달 수익**이다(회계 패널 2026-08-02).
// 종전에는 saveDepositPayment 로 넘겨 isDeposit=true 인 record 를 만들었는데, 그러면
//   · 매출 집계가 isDeposit 을 통째로 빼므로 받은 청소비가 매출에 안 잡히고
//   · 홈의 '보유 보증금'(부채성 잔고)에는 잡힌다. 보증금이 0인 계약인데도.
// 두 번 틀린 구조였다(단기 2건 40,000원 — 정다솜·김민정).
//
// ExtraIncome 은 이미 발생일(date) 기준으로 매출에 합산되므로 새 집계 로직이 필요 없다.
// 초과분(이용료) 처리는 기존과 동일하게 record 로 남긴다.
// 청소비 수익 생성부 정본 — 입실 별도 수령(saveCleaningFeePayment)과 예약금 분해(saveReservationDeposit) 공용.
//
// 두 자리가 각자 만들면 카테고리 보장·detail 문법·결제수단 규약이 갈린다. 카테고리 보장을 여기서
// 함께 하는 이유는, 영업장 수입 카테고리에 '청소비'가 없으면 재무 화면 필터에 안 떠서 받은 돈이
// 화면에서 사라지기 때문이다(생성과 노출이 한 벌이라 떼어 두면 한쪽만 도는 날이 온다).
//
// occasion 은 원장에서 "언제 받은 청소비인가"가 읽히게 하는 자리다. 입실 수령분과 예약금 분해분은
// 계정도 결제수단 규약도 같지만(둘 다 실제 입금 경로), 나중에 되짚을 때 구분이 필요하다.
async function createCleaningFeeIncome(args: {
  propertyId:  string
  leaseTermId: string
  tenantId:    string
  amount:      number
  payDate:     string
  payMethod:   string
  memo?:       string
  occasion:    '입실' | '예약'
}): Promise<string> {
  const property = await prisma.property.findUnique({
    where: { id: args.propertyId }, select: { incomeCategories: true },
  })
  const cats = (property?.incomeCategories ?? '').split(',').map(c => c.trim()).filter(Boolean)
  if (!cats.includes(CLEANING_FEE_CATEGORY)) {
    await prisma.property.update({
      where: { id: args.propertyId },
      data: { incomeCategories: [...cats, CLEANING_FEE_CATEGORY].join(',') },
    })
  }
  const tenant = await prisma.tenant.findFirst({ where: { id: args.tenantId, propertyId: args.propertyId }, select: { name: true } })
  const created = await prisma.extraIncome.create({
    data: {
      propertyId:  args.propertyId,
      date:        new Date(args.payDate),
      amount:      args.amount,
      category:    CLEANING_FEE_CATEGORY,
      detail:      `${tenant?.name ?? '입실자'} ${args.occasion} · 청소비${args.memo ? ` · ${args.memo}` : ''}`,
      payMethod:   args.payMethod,
      tenantId:    args.tenantId,
      leaseTermId: args.leaseTermId,
    },
  })
  return created.id
}

export async function saveCleaningFeePayment(data: {
  leaseTermId: string
  tenantId:    string
  targetMonth: string
  cleaningFee: number
  rentAmount:  number
  totalPaid:   number
  payDate:     string
  payMethod:   string
  memo?:       string
  cashReceiptIssued?: boolean
  cashReceiptIssuedDate?: string | null   // 발행일 'YYYY-MM-DD'(KST). 값 결정은 lib/cashReceipt 정본.
  // 되돌리기용 id — 청소비 몫은 ExtraIncome, 초과분은 수납 record 다(§16 적용취소). 계산 비관여.
}): Promise<{ ok: true; createdIds: string[]; extraIncomeId: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const feeActual = Math.max(0, Math.min(data.totalPaid, data.cleaningFee))
    if (feeActual <= 0) return { ok: false, error: '청소비 금액이 올바르지 않습니다.' }

    const extraIncomeId = await createCleaningFeeIncome({
      propertyId, leaseTermId: data.leaseTermId, tenantId: data.tenantId,
      amount: feeActual, payDate: data.payDate, payMethod: data.payMethod,
      memo: data.memo, occasion: '입실',
    })
    const createdIds: string[] = []

    // 초과분은 이용료 record — 기존 경로와 동일한 락인 규칙
    const excess = data.totalPaid - feeActual
    if (excess > 0) {
      const existingCount = await prisma.paymentRecord.count({
        where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth, deletedAt: undefined },
      })
      const monthBill = await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount)
      const excessRec = await prisma.paymentRecord.create({
        data: {
          leaseTermId: data.leaseTermId, tenantId: data.tenantId, propertyId,
          targetMonth: data.targetMonth,
          expectedAmount: monthBill, actualAmount: excess,
          payDate: new Date(data.payDate), payMethod: data.payMethod,
          memo: null, seqNo: existingCount + 1, isPaid: false, carryOver: 0,
          cashReceiptIssuedAt: resolveCashReceiptIssuedAt({ issued: !!data.cashReceiptIssued, issuedDate: data.cashReceiptIssuedDate }),
        },
      })
      createdIds.push(excessRec.id)
      await recalculatePayments(data.leaseTermId, data.targetMonth, monthBill)
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true, createdIds, extraIncomeId }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '청소비 수납 중 오류가 발생했습니다.' }
  }
}

// 예약금 수납 진입점 — 모드 인지. 기존 결제 엔진(saveDepositPayment·savePayment) 재사용, 신규 수식 0.
//   deposit: 현행 보증금 대체 그대로(isDeposit=true).
//   prepaid: savePayment(forcedTargetMonth=입주 예정월, isDeposit=false)로 첫 청구월 이용료 선납.
//            expectedAmount는 savePayment가 서버 재계산하므로 클라 값을 신뢰하지 않는다(0 전달).
//            단기 정책이 applyToRent 면 여기서 **분해**한다 — 아래 주석 참조.
//   none: record 생성 안 함(모드만 저장).
// 어느 모드로 받았는지 수납 시점에 LeaseTerm.reservationDepositMode로 확정 저장.
export async function saveReservationDeposit(data: {
  leaseTermId: string
  tenantId:    string
  mode:        'deposit' | 'prepaid' | 'none'
  amount:      number
  payDate:     string
  payMethod:   string
  memo?:       string
  cashReceiptIssued?: boolean
  cashReceiptIssuedDate?: string | null   // 발행일 'YYYY-MM-DD'(KST) — 아래 두 엔진으로 그대로 넘긴다.
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: data.leaseTermId, propertyId },
      select: {
        depositAmount: true, rentAmount: true, moveInDate: true,
        // 분해 판정 입력(reservationFeeSplitApplies) — 단기 여부·계약 청소비·영업장 단기 정책.
        // 정책은 lease 관계로 한 번에 가져온다(모드마다 쿼리를 하나 더 걸 이유가 없다).
        isShortTerm: true, cleaningFee: true,
        property: { select: { shortStayPolicy: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약을 찾을 수 없습니다.' }

    // 수납 시점에 모드 확정 — 이후 선납 환불(record 소프트삭제) 뒤에도 '안 받음'과 구분 가능.
    await prisma.leaseTerm.update({
      where: { id: data.leaseTermId },
      data: { reservationDepositMode: data.mode },
    })

    // 입주 예정월(첫 청구월) = moveInDate의 YYYY-MM, 미설정이면 현재 KST 월.
    const kst = kstYmd()
    const firstMonth = lease.moveInDate
      ? `${new Date(lease.moveInDate).getFullYear()}-${String(new Date(lease.moveInDate).getMonth() + 1).padStart(2, '0')}`
      : `${kst.year}-${String(kst.month).padStart(2, '0')}`

    if (data.mode === 'deposit') {
      // 중복 수납 가드 — 이미 계약 보증금만큼 받았으면 추가 저장 차단(반응 없음으로 오인한 재시도가
      // 5만원 2건 중복을 만든 사고, 신고 50a2a69b). 초과 수납은 기존 내역 확인으로 유도.
      const dupCheck = await prisma.paymentRecord.aggregate({
        where: { leaseTermId: data.leaseTermId, isDeposit: true, deletedAt: null },
        _sum: { actualAmount: true },
      })
      const alreadyPaid = dupCheck._sum.actualAmount ?? 0
      if (lease.depositAmount > 0 && alreadyPaid >= lease.depositAmount) {
        return { ok: false, error: `이미 계약 보증금 ${lease.depositAmount.toLocaleString()}원만큼 수납되어 있습니다 (기수납 ${alreadyPaid.toLocaleString()}원). 수납 내역을 확인해 주세요.` }
      }
      const dep = await saveDepositPayment({
        leaseTermId:   data.leaseTermId,
        tenantId:      data.tenantId,
        targetMonth:   firstMonth,
        depositAmount: lease.depositAmount,
        rentAmount:    lease.rentAmount,
        totalPaid:     data.amount,
        payDate:       data.payDate,
        payMethod:     data.payMethod,
        memo:          data.memo,
        cashReceiptIssued: data.cashReceiptIssued,
        cashReceiptIssuedDate: data.cashReceiptIssuedDate,
      })
      if (!dep.ok) return { ok: false, error: dep.error }
    } else if (data.mode === 'prepaid') {
      // 분해 판정은 정본 하나(reservationFeeSplitApplies) — 화면 미리보기와 같은 식이다.
      // 정책 미설정(현행)에서는 항상 false 라 아래 else 가지가 종전과 문자 그대로 같이 돈다.
      const splitApplies = reservationFeeSplitApplies({
        mode: 'prepaid',
        isShortTerm: lease.isShortTerm,
        shortStayMode: parseShortStayPolicy(lease.property?.shortStayPolicy).reservationMode,
        cleaningFee: lease.cleaningFee,
      })
      if (splitApplies) {
        // 분해 수납(운영자 확정 2026-08-19) — 청소비를 먼저 채우고 남은 몫이 입주월 이용료 선납이다.
        // 보증금 record 는 만들지 않는다: 이 돈은 돌려줄 예수금이 아니라 확정 대가 + 선납이다.
        // 청소비 수익 인식일은 **받은 날**이다(기존 '받은 달 수익' 정본과 같은 축).
        // 이 부가수익이 서면 cleaningFeeDeductible 이 퇴실 공제를 자동으로 0 으로 판정한다(계약서 §2-4).
        const split = reservationFeeSplit(data.amount, lease.cleaningFee)
        // 잔여 몫이 그 달 이용료를 넘으면 초과분은 선납으로 남는다(savePayment 의 단기 흡수 규칙).
        // 퇴실 때 기존 완납 초과 환불 흐름이 그대로 처리한다 — 여기서 새 산식을 만들지 않는다.
        let prepaidIds: string[] = []
        if (split.prepaid > 0) {
          const paid = await savePayment({
            leaseTermId:    data.leaseTermId,
            tenantId:       data.tenantId,
            targetMonth:    firstMonth,
            expectedAmount: 0,   // 서버 재계산 — 클라 값 미신뢰
            actualAmount:   split.prepaid,
            payDate:        data.payDate,
            payMethod:      data.payMethod,
            memo:           data.memo,
            forcedTargetMonth: firstMonth,
            cashReceiptIssued: data.cashReceiptIssued,
            cashReceiptIssuedDate: data.cashReceiptIssuedDate,
          })
          prepaidIds = paid.createdIds
        }
        if (split.cleaning > 0) {
          // 두 몫은 한 결제다. DB 트랜잭션으로 묶지 못하는 이유는 선납 몫이 공용 결제 엔진
          // (savePayment — 일할·락인·FIFO)을 타기 때문이다. 그 안의 record 생성을 여기 베끼면
          // 청구액 산식이 둘이 되고, 그게 이 프로젝트가 가장 크게 데인 사고 유형이다.
          // 대신 실패하면 방금 만든 선납을 되돌린다 — 결과는 같은 전부-또는-전무다.
          // (반쪽만 남으면 감지망 축 C 가 울리고 운영자가 손으로 맞춰야 한다.)
          try {
            await createCleaningFeeIncome({
              propertyId, leaseTermId: data.leaseTermId, tenantId: data.tenantId,
              amount: split.cleaning, payDate: data.payDate, payMethod: data.payMethod,
              memo: data.memo, occasion: '예약',
            })
          } catch (err) {
            if (prepaidIds.length > 0) await prisma.paymentRecord.deleteMany({ where: { id: { in: prepaidIds } } })
            throw err
          }
        }
      } else {
        await savePayment({
          leaseTermId:    data.leaseTermId,
          tenantId:       data.tenantId,
          targetMonth:    firstMonth,
          expectedAmount: 0,   // 서버 재계산 — 클라 값 미신뢰
          actualAmount:   data.amount,
          payDate:        data.payDate,
          payMethod:      data.payMethod,
          memo:           data.memo,
          forcedTargetMonth: firstMonth,
          cashReceiptIssued: data.cashReceiptIssued,
          cashReceiptIssuedDate: data.cashReceiptIssuedDate,
        })
      }
    }
    // none: 수납 없음 — 모드만 저장.
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주월 재앵커 — 예약 확정/입실 처리 시 실제 입주월이 선납 record의 targetMonth와 다르면 이동.
// prepaid 모드만 대상(deposit/none은 no-op). 결제 저장은 기존 recalculatePayments 재사용, 신규 수식 없음.
// RESERVED 단계엔 isDeposit=false record가 예약 선납분뿐이라 전량 재앵커가 안전.
//
// 분해 수납(applyToRent)에서도 옮기는 것은 **선납 몫뿐**이다. 청소비 몫은 PaymentRecord 가 아니라
// ExtraIncome 이라 이 함수의 사정권 밖이고, 그게 맞다 — 청소비 수익 인식일은 받은 날이지
// 입주월이 아니다(운영자 확정 2026-08-19, 기존 '받은 달 수익' 정본과 같은 축).
// 입주일을 옮겼다고 이미 인식한 청소비 매출이 다른 달로 따라가면 그 달 결산이 흔들린다.
export async function reanchorReservationPrepaid(leaseTermId: string): Promise<void> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: { reservationDepositMode: true, moveInDate: true, rentAmount: true },
  })
  if (!lease || !lease.moveInDate) return
  const newMonth = `${new Date(lease.moveInDate).getFullYear()}-${String(new Date(lease.moveInDate).getMonth() + 1).padStart(2, '0')}`

  // 익스텐션이 소프트삭제분 자동 제외. 양도인 record는 대상 아님.
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false, isPrevOwner: false },
    select: { id: true, targetMonth: true },
  })
  // 종전에는 reservationDepositMode 가 'prepaid' 일 때만 돌았다. 그런데 이 컬럼은
  // saveReservationDeposit 을 거친 수납에서만 채워져, 기존 경로로 받은 선납은 null 로 남아
  // 재앵커가 통째로 건너뛰어졌다(황인정 5만원이 입주 전월에 묶여 있던 사례, B페이즈).
  // 모드와 무관하게 **입주월보다 앞선 달에 걸린 이용료 record 는 선납**이므로 입주월로 옮긴다.
  // prepaid 모드는 종전처럼 앞뒤 상관없이 전부 모은다(그 모드의 정의가 '첫 달 이용료 선납'이라서).
  const isPrepaid = lease.reservationDepositMode === 'prepaid'
  const stale = records.filter(r => isPrepaid ? r.targetMonth !== newMonth : r.targetMonth < newMonth)
  if (stale.length === 0) return

  const oldMonths = new Set(stale.map(r => r.targetMonth))
  let seqBase = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth: newMonth, deletedAt: undefined } })
  for (const r of stale) {
    seqBase += 1
    await prisma.paymentRecord.update({ where: { id: r.id }, data: { targetMonth: newMonth, seqNo: seqBase } })
  }

  // 이동 후 양쪽 월 재계산(그 달 서버 권위 청구액 기준).
  await recalculatePayments(leaseTermId, newMonth, await serverBillForMonth(leaseTermId, newMonth, lease.rentAmount))
  for (const m of oldMonths) {
    await recalculatePayments(leaseTermId, m, await serverBillForMonth(leaseTermId, m, lease.rentAmount))
  }
  revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
}

// 보증금 '받음(실수납)' **소급** 기록 — 전 원장 등으로 이미 받았으나 입금기록이 없는 보증금을
// 계약상 금액 기준으로 실수납 record(isDeposit=true)로 남긴다.
// 수납관리 보증금 탭의 '받음으로 기록' 버튼, 입주자/예약 폼의 '보증금 실제로 받음' 체크에서 호출.
// 이미 기록된 보증금이 있으면 미기록분(계약액 − 기존 입금)만 채운다.
//
// **소급 기록 전용이다. 지금 받은 돈은 이 함수로 적지 않는다.** 그 자리는 saveDepositPayment
// 정본이고, 초과 수납·이용료 과납 가드가 전부 거기 있다(위 '역할 경계' 주석). 여기는 이미
// 일어난 일을 적는 자리라 가드가 얇고 결제수단 기본값이 '기타'다.
//
// opts.payDate 는 **호출부가 반드시 넘긴다.** 안 넘기면 아래 기본값(오늘)이 박히는데, 그것은
// 버튼을 누른 날이지 돈이 들어온 날이 아니다. 종전에는 호출부 3곳 전부가 안 넘겨 7건이 그렇게
// 쌓였다(신고 98fb6fce — 8/16 계좌이체가 8/24 기타로 남았다).
export async function recordDepositReceived(leaseTermId: string, opts?: {
  payDate?: string
  payMethod?: string
  memo?: string
  amount?: number
}) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { id: true, tenantId: true, depositAmount: true, moveInDate: true },
  })
  if (!lease) throw new Error('계약을 찾을 수 없습니다.')

  const existing = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, isDeposit: true },
    _sum: { actualAmount: true },
  })
  const already = existing._sum.actualAmount ?? 0
  const remaining = opts?.amount ?? Math.max(0, lease.depositAmount - already)
  if (remaining <= 0) throw new Error('이미 보증금 수납이 기록되어 있습니다.')

  const kst = kstYmd()
  const targetMonth = lease.moveInDate
    ? `${new Date(lease.moveInDate).getFullYear()}-${String(new Date(lease.moveInDate).getMonth() + 1).padStart(2, '0')}`
    : `${kst.year}-${String(kst.month).padStart(2, '0')}`
  // 기본 결제일 = 오늘(KST) — 로컬 자정 Date 는 @db.Date 쓰기에서 KST 런타임 시 하루 앞으로 박힌다(2026-08-19 전역 정정과 같은 클래스)
  // 넘어온 날짜도 같은 자로 쓴다. 'YYYY-MM-DD' 에 대해 결과는 종전과 같지만, 문자열이 조금만
  // 달라져도 로컬 자정으로 파싱되는 길이 열려 있었다 — 이제 이 값이 실입금일이라 그 길을 막는다.
  const payDate = opts?.payDate ? ymdToDbDate(opts.payDate) : ymdToDbDate(kstYmdStr())

  const existingCount = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth, deletedAt: undefined } })
  const created = await prisma.paymentRecord.create({
    data: {
      leaseTermId, tenantId: lease.tenantId, propertyId,
      targetMonth, expectedAmount: lease.depositAmount, actualAmount: remaining,
      payDate, payMethod: opts?.payMethod ?? '기타',
      memo: opts?.memo ?? '보증금 수납(받음 기록)',
      seqNo: existingCount + 1, isPaid: false, isDeposit: true, carryOver: 0,
    },
  })
  revalidatePath('/finance'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
  // 만든 record 의 id — 토스트의 적용취소가 되돌릴 대상(§16). 금액 계산에는 관여하지 않는다.
  return { id: created.id, amount: remaining }
}

// 계약 단위 보증금 실입금 기록 — 보증금 패널(DepositStatusPanel)의 '수납 기록' 인라인 폼 진입로.
//
// **새 산식은 없다.** 계약에서 tenantId·계약 보증금·이용료·귀속월을 채워 saveDepositPayment 정본에
// 넘기는 것이 전부다. 형제 진입점 saveReservationDeposit 이 이미 같은 모양이다(모드 확정 후 위임).
//
// 패널이 조회월을 모르기 때문에 이 어댑터가 필요하다. 보증금은 월과 무관한 계약 단위 사실이라
// 패널이 월을 모르는 것이 정상이고, 귀속월 규칙은 이미 두 자리가 쓰는 것과 같다 — 입주월,
// 없으면 KST 이번 달(recordDepositReceived·saveReservationDeposit 과 글자 그대로 동일).
//
// 왜 이 진입로를 세웠나(신고 98fb6fce). 보증금 미수납 사실이 표시되는 자리에 수납 CTA 가 없어서,
// 운영자가 '입주자 정보 수정' 폼의 체크박스로 우회했다. 사실을 보여주는 자리와 그 사실을 고치는
// 자리가 갈려 있으면 사람은 반드시 딴 길을 찾는다.
export async function saveDepositPaymentForLease(input: {
  leaseTermId: string
  amount:      number
  payDate:     string
  payMethod:   string
  memo?:       string
}): Promise<{ ok: true; createdIds: string[] } | { ok: false; error: string }> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: input.leaseTermId, propertyId },
    select: { tenantId: true, depositAmount: true, rentAmount: true, moveInDate: true },
  })
  if (!lease) return { ok: false, error: '계약을 찾을 수 없습니다.' }
  const kst = kstYmd()
  const targetMonth = lease.moveInDate
    ? `${new Date(lease.moveInDate).getFullYear()}-${String(new Date(lease.moveInDate).getMonth() + 1).padStart(2, '0')}`
    : `${kst.year}-${String(kst.month).padStart(2, '0')}`
  return saveDepositPayment({
    leaseTermId:   input.leaseTermId,
    tenantId:      lease.tenantId,
    targetMonth,
    depositAmount: lease.depositAmount,
    rentAmount:    lease.rentAmount,
    totalPaid:     input.amount,
    payDate:       input.payDate,
    payMethod:     input.payMethod,
    memo:          input.memo,
  })
}

// 그 달 서버 권위 청구액 — 일할→락인(기존 record 최대)→할인 (lib/billing 공용 규칙).
// 수납 수정/삭제/보증금 초과분 기록 시 isPaid 재계산·expectedAmount 저장에 사용.
async function serverBillForMonth(leaseTermId: string, mon: string, fallback: number): Promise<number> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      rentAmount: true, status: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
      isShortTerm: true, moveInDate: true,   // 단기 입주월 단일 청구(lib/billing)
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
    },
  })
  if (!lease) return fallback
  const agg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, targetMonth: mon, isDeposit: false, isPrevOwner: false },
    _max: { expectedAmount: true },
  })
  return billForLeaseMonth(lease, mon, agg._max.expectedAmount ?? null)
}

// 수납 기록 수정
export async function updatePayment(
  paymentId: string,
  data: { actualAmount: number; payDate: string; payMethod: string; memo?: string; targetMonth?: string; cashReceiptIssued?: boolean; cashReceiptIssuedDate?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    // 영업장 스코프 검증(감사 잔여, 2026-07-22) — 타 영업장 record id로 수정 불가(멀티테넌트)
    const propertyId = await getPropertyId()
    const record = await prisma.paymentRecord.findFirst({
      where: { id: paymentId, propertyId },
      select: { leaseTermId: true, targetMonth: true, isDeposit: true, cashReceiptIssuedAt: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: record.leaseTermId },
      select: { rentAmount: true },
    })

    // 인플레이션 가드: 한 record의 금액이 임대료를 초과하지 않도록
    // (보증금 record는 제외 — 별도 흐름)
    if (lease && !record.isDeposit && data.actualAmount > lease.rentAmount) {
      return {
        ok: false,
        error: `한 record의 금액은 임대료(${lease.rentAmount.toLocaleString()}원)를 초과할 수 없습니다. 초과분은 별도로 '수납 등록'에서 입력해주세요.`,
      }
    }

    // 귀속월 변경 시 새 월에서 unique seqNo 재할당 + 옛 월 재계산
    const newTargetMonth = data.targetMonth && !record.isDeposit ? data.targetMonth : record.targetMonth
    const targetMonthChanged = newTargetMonth !== record.targetMonth
    const newSeqNo = targetMonthChanged
      ? (await prisma.paymentRecord.count({ where: { leaseTermId: record.leaseTermId, targetMonth: newTargetMonth, deletedAt: undefined } })) + 1
      : undefined

    await prisma.paymentRecord.update({
      where: { id: paymentId },
      data: {
        actualAmount: data.actualAmount,
        payDate:      new Date(data.payDate),
        payMethod:    data.payMethod,
        memo:         data.memo || null,
        ...(targetMonthChanged ? { targetMonth: newTargetMonth, seqNo: newSeqNo } : {}),
        // 현금영수증 — undefined면 미변경(기존 호출이 스탬프를 지우지 않게, 영향검증 필수).
        // 값 결정은 lib/cashReceipt 정본. 날짜를 안 넘기면 기존 발행 시각 보존(감사 흔적),
        // 넘기면 그 날짜로 고친다 — **여기가 발행일 수정 경로다**(운영자 확정 2026-08-24).
        ...(data.cashReceiptIssued === undefined ? {} : {
          cashReceiptIssuedAt: resolveCashReceiptIssuedAt({
            issued: data.cashReceiptIssued,
            issuedDate: data.cashReceiptIssuedDate,
            existing: record.cashReceiptIssuedAt,
          }),
        }),
      },
    })

    if (lease) {
      await recalculatePayments(record.leaseTermId, record.targetMonth,
        await serverBillForMonth(record.leaseTermId, record.targetMonth, lease.rentAmount))
      if (targetMonthChanged) {
        await recalculatePayments(record.leaseTermId, newTargetMonth,
          await serverBillForMonth(record.leaseTermId, newTargetMonth, lease.rentAmount))
      }
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 현금영수증 발행 원터치 토글 — cashReceiptIssuedAt 메타데이터만 갱신(충당·잔액 수식 비관여).
// updatePayment(재계산·인플레이션 가드 경유)를 태우지 않는 전용 경로(오류신고 c0936f89, 표준 트랙 2026-07-14).
// restoreIssuedAt — 적용취소용: 원래 발행 시각 그대로 복원(감사 흔적 보존). 미지정 켬은 기존 시각 보존, 없으면 지금.
// 소프트삭제 record는 findFirst 자동 필터로 걸러져 유령 수정이 성립하지 않는다(적대검증 필수 1).
export async function setCashReceiptIssued(
  paymentId: string, issued: boolean, restoreIssuedAt?: string | null,
): Promise<{ ok: true; prevIssuedAt: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const record = await prisma.paymentRecord.findFirst({
      where: { id: paymentId, propertyId },
      select: { cashReceiptIssuedAt: true, leaseTermId: true, payDate: true, payMethod: true, createdAt: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }
    // 카드 계열은 매출전표가 증빙을 대신한다 — 현금영수증 대상이 아니다(운영자 확인 2026-08-01).
    // 수납 폼에는 이 가드가 있는데 토글에는 없어 카드 record 에도 켤 수 있었다.
    if (issued && record.payMethod && CARD_LIKE_METHODS.includes(record.payMethod)) {
      return { ok: false, error: '카드 결제는 매출전표가 증빙이라 현금영수증 표시 대상이 아닙니다.' }
    }
    // 한 결제가 여러 달로 쪼개져 저장됐으면 형제 record 도 함께 바꾼다. 한 줄만 켜면 합계가 절반만 잡힌다.
    // 결제 식별은 (계약·결제일·수단·생성시각 2초 이내) — payDate 만으로 묶으면 같은 날 따로 입력한
    // 별개 결제까지 섞인다(실측 421호 이종현 2일 차, 520호 김민정 4시간 차).
    const siblings = await prisma.paymentRecord.findMany({
      where: {
        propertyId, leaseTermId: record.leaseTermId, payDate: record.payDate,
        payMethod: record.payMethod, isBillingAdjust: false,
        createdAt: { gte: new Date(record.createdAt.getTime() - 2000), lte: new Date(record.createdAt.getTime() + 2000) },
      },
      select: { id: true, cashReceiptIssuedAt: true },
    })
    const targets = siblings.length > 0 ? siblings : [{ id: paymentId, cashReceiptIssuedAt: record.cashReceiptIssuedAt }]
    for (const t of targets) {
      // 적용취소 복원은 원래 시각을 밀리초까지 되돌린다 — 날짜 정본을 태우면 그 날 자정으로 뭉개진다.
      // 켜기·끄기는 lib/cashReceipt 정본을 지난다(기본 오늘 KST, 기존 값 보존).
      const next = restoreIssuedAt != null && issued
        ? new Date(restoreIssuedAt)
        : resolveCashReceiptIssuedAt({ issued, existing: t.cashReceiptIssuedAt })
      await prisma.paymentRecord.update({ where: { id: t.id }, data: { cashReceiptIssuedAt: next } })
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true, prevIssuedAt: record.cashReceiptIssuedAt ? record.cashReceiptIssuedAt.toISOString() : null }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 월 수납 집계 — 현금영수증 발행 합계·카드 수납 합계(표시 전용, 결제 수식 비관여. 오류신고 c0936f89).
//
// **축이 둘이다**(2026-08-24 정정, 신고 8b9b6c43 재판정).
//   현금영수증 : cashReceiptIssuedAt 이 그 달(KST) — 홈택스에 올라간 날.
//   카드       : payDate 가 그 달 — 매출전표가 결제 시점에 성립한다.
// 종전에는 둘 다 payDate 축이었다. 발행 32건 중 29건이 발행일 != 입금일이라(2026-08-22 하루에
// 18건 7,640,000원 일괄) payDate 축 현금영수증 합계는 홈택스와 맞을 수가 없는 숫자였다.
// 축 판정 자체는 lib/cashReceipt 의 순수 함수 정본이 한다 — 화면·테스트가 같은 식을 본다.
//
// 컷오프도 축을 따라간다. 현금영수증은 국세청에 **발행자 사업자번호**로 귀속되므로 인수 전에 받은
// 돈이라도 현 사업자가 발행했으면 현 사업자 자료다. 그래서 컷오프를 payDate 가 아니라 **발행일**에
// 건다. 실측 해당 0건이라 오늘 값은 어느 규칙이든 같다 — 규칙이 맞는 쪽을 적어 둔다.
//
// 창을 둘로 나눠 두 번 조회한다. 한 번에 OR 로 긁으면 어느 축으로 들어온 행인지 잃어서
// 다시 세어야 하고, 그때 중복 계상을 막는 책임이 호출부로 흩어진다. 버킷 판정이 배타라
// (카드 우선) 한 record 가 두 합계에 동시에 들어가는 일이 구조로 막힌다.
//
// 주의: where에 deletedAt 키를 넣지 말 것 — 소프트삭제 익스텐션 opt-out이 오발동한다(적대검증 필수 3).
export async function getMonthPaymentAggregates(targetMonth: string): Promise<{ cashReceiptSum: number; cashReceiptCount: number; cardSum: number; cardCount: number }> {
  const propertyId = await getPropertyId()
  const [y, m] = targetMonth.split('-').map(Number)
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  // payDate는 UTC 자정(@db.Date) 저장 — 월 경계도 명시적 UTC로 구성(적대검증 필수 3)
  const from = new Date(Date.UTC(y, m - 1, 1))
  const to = new Date(Date.UTC(y, m, 1))
  // cashReceiptIssuedAt 은 @db.Date 가 아니라 **타임스탬프**다. 위 UTC 창을 그대로 쓰면
  // KST 자정 경계에서 하루 밀린다(8월 창이 KST 8/1 09:00 부터가 된다). 정본 창을 쓴다.
  const issuedWindow = kstMonthTsRange(targetMonth)
  // 컷오프는 @db.Date(UTC 자정)라 발행일 축과 재려면 그날 KST 자정으로 옮겨야 한다.
  const cutoffTs = cutoff ? kstDateTimeToUtc(cutoff.toISOString().slice(0, 10)) : null
  const AGG_SELECT = { actualAmount: true, cashReceiptIssuedAt: true, payMethod: true, payDate: true } as const
  const [cardRows, issuedRows] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isPrevOwner: false,
        payDate: { gte: cutoff && cutoff > from ? cutoff : from, lt: to },   // 컷오프 이전 = 양도인 몫(적대검증 필수 2)
      },
      select: AGG_SELECT,
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isPrevOwner: false,
        cashReceiptIssuedAt: {
          gte: cutoffTs && cutoffTs > issuedWindow.gte ? cutoffTs : issuedWindow.gte,
          lt: issuedWindow.lt,
        },
      },
      select: AGG_SELECT,
    }),
  ])
  let cashReceiptSum = 0, cashReceiptCount = 0, cardSum = 0, cardCount = 0
  for (const r of cardRows) {
    const b = paymentAggregateBucket(r)
    if (b.bucket === 'card' && b.month === targetMonth) { cardSum += r.actualAmount; cardCount += 1 }
  }
  for (const r of issuedRows) {
    const b = paymentAggregateBucket(r)
    if (b.bucket === 'cashReceipt' && b.month === targetMonth) { cashReceiptSum += r.actualAmount; cashReceiptCount += 1 }
  }
  return { cashReceiptSum, cashReceiptCount, cardSum, cardCount }
}

// 수납 기록 삭제
export async function deletePayment(paymentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    // 영업장 스코프 검증(감사 잔여, 2026-07-22)
    const propertyId = await getPropertyId()
    const record = await prisma.paymentRecord.findFirst({
      where: { id: paymentId, propertyId },
      select: { leaseTermId: true, targetMonth: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }

    // 소프트삭제 — 조회 익스텐션이 자동 제외. 재계산은 활성분만 보므로 미수·완납 자동 정정. 적용취소는 restorePayment.
    await prisma.paymentRecord.update({ where: { id: paymentId }, data: { deletedAt: new Date() } })

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: record.leaseTermId },
      select: { rentAmount: true },
    })
    if (lease) {
      await recalculatePayments(record.leaseTermId, record.targetMonth,
        await serverBillForMonth(record.leaseTermId, record.targetMonth, lease.rentAmount))
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 수납 기록 삭제 적용취소 — deletedAt 복원 후 재계산(미수·완납 원상 복구)
export async function restorePayment(paymentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    // 영업장 스코프 검증(감사 잔여, 2026-07-22). deletedAt: undefined = 소프트삭제분 포함 조회(복구 대상)
    const propertyId = await getPropertyId()
    const record = await prisma.paymentRecord.findFirst({
      where: { id: paymentId, propertyId, deletedAt: undefined },
      select: { leaseTermId: true, targetMonth: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }
    await prisma.paymentRecord.update({ where: { id: paymentId }, data: { deletedAt: null } })
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: record.leaseTermId },
      select: { rentAmount: true },
    })
    if (lease) {
      await recalculatePayments(record.leaseTermId, record.targetMonth,
        await serverBillForMonth(record.leaseTermId, record.targetMonth, lease.rentAmount))
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ============================================================
// 일괄 수납 — 선택한 호실의 '이번 달' 미수액을 한 번에 전액 수납 처리 (v2.0 §23 선택모드)
// 결제 로직: 각 호실은 기존 savePayment 재사용(FIFO·할인·재계산 동일). 이번 달 한정(forcedTargetMonth).
//   금액은 클라이언트 balance 를 신뢰하지 않고 서버 권위(getRoomPaymentStatus)로 재계산.
//   대상 자동 필터: 비공실 + 미래월 아님 + leaseTermId·tenantId 有 + 이번 달 미수(balance<0).
//   생성된 paymentRecord id 를 모아 반환 → 토스트 '적용취소'에서 batchDeletePayments 로 일괄 취소(v2.0 §16).
// ============================================================
export async function batchRecordRentPayment(input: {
  targetMonth: string
  leaseTermIds: string[]
  payDate: string      // 'YYYY-MM-DD'
  payMethod: string
}): Promise<
  | { ok: true; paidRoomNos: string[]; skippedRoomNos: string[]; totalAmount: number; createdIds: string[] }
  | { ok: false; error: string }
> {
  try {
    await requireEdit()
    if (!input.leaseTermIds?.length) return { ok: false, error: '선택된 호실이 없습니다.' }

    const rows = await getRoomPaymentStatus(input.targetMonth)
    const sel = new Set(input.leaseTermIds)
    const selected = rows.filter(r => r.leaseTermId != null && sel.has(r.leaseTermId))

    const paidRoomNos: string[] = []
    const skippedRoomNos: string[] = []
    const createdIds: string[] = []
    let totalAmount = 0

    for (const r of selected) {
      const owed = Math.max(0, Math.round(-r.balance))   // 이번 달 미수액(balance<0 → 양수)
      const eligible = !r.isVacant && !r.isFutureMonth && !!r.leaseTermId && !!r.tenantId && owed > 0
      if (!eligible) { skippedRoomNos.push(r.roomNo); continue }

      // 생성 전 이번 달 record id 스냅샷 — owed 가 이번 달 미수와 일치하므로 이월 없음(targetMonth만 본다)
      const before = await prisma.paymentRecord.findMany({
        where: { leaseTermId: r.leaseTermId!, targetMonth: input.targetMonth },
        select: { id: true },
      })
      const beforeIds = new Set(before.map(b => b.id))

      await savePayment({
        leaseTermId: r.leaseTermId!,
        tenantId: r.tenantId!,
        targetMonth: input.targetMonth,
        expectedAmount: r.expected,
        actualAmount: owed,
        payDate: input.payDate,
        payMethod: input.payMethod,
        forcedTargetMonth: input.targetMonth,
        memo: '일괄 수납',
      })

      const after = await prisma.paymentRecord.findMany({
        where: { leaseTermId: r.leaseTermId!, targetMonth: input.targetMonth },
        select: { id: true },
      })
      for (const a of after) if (!beforeIds.has(a.id)) createdIds.push(a.id)

      paidRoomNos.push(r.roomNo)
      totalAmount += owed
    }

    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true, paidRoomNos, skippedRoomNos, totalAmount, createdIds }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '일괄 수납 중 오류가 발생했습니다.' }
  }
}

// 일괄 수납 적용취소 — batchRecordRentPayment 가 만든 record 들을 한 번에 삭제(v2.0 §16 적용취소)
export async function batchDeletePayments(
  ids: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!ids?.length) return { ok: true, deleted: 0 }
    let deleted = 0
    for (const id of ids) {
      const res = await deletePayment(id)
      if (res.ok) deleted++
    }
    return { ok: true, deleted }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '일괄 취소 중 오류가 발생했습니다.' }
  }
}

// 과납 초과분 부가수익 처리 적용취소 — 확인창 한 번이 만든 두 테이블 record 를 함께 되돌린다(v2.0 §16).
//
// 반쪽 취소를 만들면 안 되는 자리다. 수납만 지우면 그 달이 미수로 돌아가는데 초과분은 수익에 남는다.
// 운영자가 그 미수를 보고 다시 수납을 넣는 순간 초과분이 이중계상된다 — 안 되돌린 것보다 나쁘다.
// 그래서 쓰기 전에 둘 다 실재하는지 확인하고, 실제 삭제는 $transaction 으로 함께 넘긴다.
// 문법은 undoReservationPrepaidCancel(tenants/actions.ts) 정본을 따른다.
//
// 소프트삭제다. 조회 익스텐션이 자동 제외하고, 필요하면 restorePayment·restoreExtraIncome 로 되살린다.
// intact 는 '아직 아무것도 안 건드렸다'는 뜻이다. 실패 화면 문구가 갈리므로 서버가 알려줘야 한다 —
// 그대로면 사용자가 할 일이 없고, 아니면 수납 내역을 직접 봐야 한다.
//
// extraIncomeId 는 옵셔널이다(2026-08-24). 분해 수납은 부가수익 없이 수납 record 만 만드는 경우가
// 대부분인데(청소비를 보증금 안의 몫으로 받는 영업장) 필수로 두면 그 경우에 이 정본을 못 쓴다.
// 없으면 record 만 되돌린다 — 반쪽 취소가 아니라 애초에 부가수익이 없는 결제다.
export async function undoOverpayExtraIncome(
  recordIds: string[],
  extraIncomeId?: string,
): Promise<{ ok: true } | { ok: false; error: string; intact?: boolean }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!recordIds.length) return { ok: false, error: '되돌릴 대상이 없습니다.', intact: true }

    // 소속 월을 먼저 확보한다 — 삭제 후에는 익스텐션이 걸러서 못 읽는다.
    // 이 조회들은 읽기라 자동 필터가 붙으므로, 이미 지워진 건은 여기서 걸러져 이중 취소도 막힌다.
    const targets = await prisma.paymentRecord.findMany({
      where: { id: { in: recordIds }, propertyId },
      select: { leaseTermId: true, targetMonth: true },
    })
    if (targets.length !== recordIds.length) return { ok: false, error: '수납 기록을 찾을 수 없습니다.', intact: true }
    if (extraIncomeId) {
      const inc = await prisma.extraIncome.findFirst({ where: { id: extraIncomeId, propertyId }, select: { id: true } })
      if (!inc) return { ok: false, error: '부가수익 기록을 찾을 수 없습니다.', intact: true }
    }

    const deletedAt = new Date()
    await prisma.$transaction([
      prisma.paymentRecord.updateMany({ where: { id: { in: recordIds }, propertyId }, data: { deletedAt } }),
      ...(extraIncomeId ? [prisma.extraIncome.updateMany({ where: { id: extraIncomeId, propertyId }, data: { deletedAt } })] : []),
    ])

    // 미수·완납 재계산 — deletePayment 와 같은 규칙. 월별로 격리돼 순서 의존성이 없다.
    const months = new Set(targets.map(t => `${t.leaseTermId}|${t.targetMonth}`))
    for (const key of months) {
      const [ltId, tm] = key.split('|')
      const lease = await prisma.leaseTerm.findUnique({ where: { id: ltId }, select: { rentAmount: true } })
      if (lease) await recalculatePayments(ltId, tm, await serverBillForMonth(ltId, tm, lease.rentAmount))
    }

    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리는 중 오류가 발생했습니다.' }
  }
}

// 납부일 임시 조정
export async function setDueDayOverride(
  leaseTermId: string,
  targetMonth: string,
  overrideDueDay: string,
  reason?: string
) {
  await requireEdit()
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: {
      overrideDueDay:      overrideDueDay || null,
      overrideDueDayMonth: overrideDueDay ? targetMonth : null,
      overrideDueDayReason: reason || null,
    },
  })
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/tenants')
  revalidatePath('/rooms')
  revalidatePath('/dashboard')
}

export async function clearDueDayOverride(leaseTermId: string) {
  await requireEdit()
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: { overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null },
  })
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/tenants')
  revalidatePath('/rooms')
  revalidatePath('/dashboard')
}

// 수납 내역 조회
export async function getTenantLeaseForDashboard(tenantId: string, targetMonth?: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const lease = await prisma.leaseTerm.findFirst({
    where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
    select: {
      id: true,
      rentAmount: true,
      depositAmount: true,
      dueDay: true,
      moveInDate: true,
      paymentTiming: true,
      overrideDueDay: true,
      overrideDueDayMonth: true,
      room: { select: { roomNo: true } },
      tenant: { select: { id: true, name: true } },
      property: { select: { acquisitionDate: true, prevOwnerCutoffDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!lease) return null

  // carryOver = targetMonth 이전까지 누적 (양수=이월 선납, 음수=이월 미수)
  // 모달에서 진짜 미수(이월 + viewMonth 도래 후 미회수)를 표시하기 위함
  let carryOver = 0
  if (targetMonth && lease.moveInDate) {
    const [y, m] = targetMonth.split('-').map(Number)
    // 이 달 1일 — 로컬 자정으로 만들던 시절엔 KST 기기에서 전월 말일로 밀려, 그 날 낸 돈이
    // '이전 달까지 입금'에서 빠지고 이월 미수로 둔갑했다. 창 정본은 lib/kstDate.
    const monthStart = monthDbRange(targetMonth).gte

    // 이전 달까지 입금 합 (보증금·납입일변경 조정 제외)
    const recordsBefore = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, isDeposit: false, payDate: { lt: monthStart } },
      select: { actualAmount: true, memo: true },
    })
    const receivedBefore = recordsBefore
      .filter(r => !r.memo?.startsWith('[납입일변경]'))
      .reduce((s, r) => s + r.actualAmount, 0)

    // 이전 달까지 청구 = max(moveInDate, acquisitionDate)부터 (targetMonth-1)월까지의 월 수 * rentAmount
    const mi = new Date(lease.moveInDate)
    let startY = mi.getFullYear()
    let startM = mi.getMonth() + 1
    const acqRaw = lease.property.acquisitionDate
    if (acqRaw) {
      const acq = new Date(acqRaw)
      const acqY = acq.getFullYear(), acqM = acq.getMonth() + 1
      // acqDate가 moveIn보다 이후면 그 시점부터 청구 (이전 소유자 시기 제외)
      if (acqY > startY || (acqY === startY && acqM > startM)) {
        startY = acqY; startM = acqM
      }
    }
    let billedMonths = 0
    let cy = startY, cmn = startM
    while (cy < y || (cy === y && cmn < m)) {
      billedMonths++
      cmn++; if (cmn > 12) { cmn = 1; cy++ }
    }
    const billedBefore = billedMonths * lease.rentAmount
    carryOver = receivedBefore - billedBefore
  }

  return { ...lease, carryOver }
}

// 풀 입주자 상세 — Prism 셸의 kind='tenant' body 가 사용. quickInfo 대비 contacts 전체 필드·
// lease 전체 필드(청소비·납부방식·전입신고·결제수단·현금영수증·방문경로·희망 호실·계약서 URL)·
// 추가 정보·짧은 결제 요약(분석 탭) 포함.
export async function getTenantDetail(tenantId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, englishName: true, email: true,
      // 현지 표기 이름 — 적어 넣고도 열람에서 볼 곳이 없었다(신고 4aabd1dc). 기본 정보 위젯이 그린다.
      nativeName: true,
      gender: true, nationality: true, job: true,
      birthdate: true, isBasicRecipient: true, smoking: true, memo: true,
      foreignRegNoEnc: true,
      contacts: {
        select: {
          id: true, contactType: true, contactValue: true,
          isPrimary: true, isEmergency: true, isHomeCountry: true,
          emergencyRelation: true, countryCode: true,
        },
      },
      leaseTerms: {
        // CANCELLED 포함 (신고 ad517231). 종전에는 빠져 있어서 **취소된 입주자를 상세로 열면
        // lease 가 undefined 가 되고 계약 정보·상태 위젯·취소 사유가 통째로 안 그려졌다.**
        // 운영자가 "볼 수 있는 곳이 없다"고 한 것이 과장이 아니라 정확한 서술이었다.
        where: { status: { in: ['ACTIVE', 'RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'CANCELLED'] } },
        select: {
          id: true, status: true, isShortTerm: true,
          // 딸려 있는 계약인가 — 계약서 파일 패널이 종속분에는 제 계약서 버튼을 안 낸다(부모 한 장).
          parentLeaseTermId: true,
          shortStayExtensions: true,   // 단기 연장 이력 — 위젯의 연장 이력 줄·적용취소 진입점용
          checkoutProrationUndo: true, // 중도퇴실 환불 스냅샷(refund 키) — 상세의 상시 적용취소 진입점용(§16)
          rentAmount: true, depositAmount: true, cleaningFee: true,
          dueDay: true, paymentTiming: true,
          moveInDate: true, moveOutDate: true, expectedMoveOut: true, inquiryAt: true,
          tourDate: true,   // e1b81629: 투어일 유무로 '문의'/'투어 예정' 파생 라벨 분기
          tourTime: true,   // 투어 예정 시각 — 계약 정보 위젯이 날짜와 한 줄로 적는다(신고 91b72261)
          reservationConfirmedAt: true,   // 신고 9b974be0: 예약 확정 여부 — 상태 전환 위젯의 확정/해제 버튼 분기·확정일 표시

          contactAlertDate: true,   // '연락할 때' 알림 시작일(지정) — 상세 표시용
          moveInFlexible: true,     // 입주 희망일 조절 가능 여부 — 매칭 날짜 게이트의 답을 상세에서도 보게(null=미확인)
          registrationStatus: true, payMethod: true, cashReceipt: true,
          reservationDepositMode: true,   // 예약금 모드 — 예약 취소 반환/몰취 경로 분기용
          // shortStayPolicy — 단기 계약의 예약금 처리가 영업장 공통 기본값보다 앞선다(본문이 같은 정본으로 해석).
          property: { select: { contactLeadDays: true, reservationDepositMode: true, shortStayPolicy: true } },
          visitRoute: true, wishRooms: true, wishConditions: true, contractUrl: true,
          room: { select: { id: true, roomNo: true } },
          paymentRecords: {
            where: { deletedAt: null },
            // 세 플래그가 없으면 보증금이 월세 record 로 취급돼 미납액이 5만원 어긋난다(lib/billing.ts UnpaidRecord).
            // take 도 형제(tenants/actions.ts 60)와 맞춘다 — 건수를 개월수로 착각한 자리다.
            select: {
              id: true, expectedAmount: true, actualAmount: true, isPaid: true, payDate: true, targetMonth: true,
              isDeposit: true, isPrevOwner: true, isBillingAdjust: true,
            },
            orderBy: { targetMonth: 'desc' },
            take: 60,
          },
        },
        // take: 1 을 뺐다(2026-08-13) — 한 사람이 방을 둘 쓰면 상세가 나머지 계약을 아예 못 본다.
        // 메인 계약 선택은 화면이 primaryTenantLease 정본으로 하고, 부계약은 '추가 계약' 줄이 받는다.
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!row) return null
  // 신원번호는 암호문째 내려보내지 않는다. 상세 카드는 마스킹만 그리고, 평문이 필요하면
  // 입주자 정보 화면의 [보기](revealForeignRegNo)로 가야 한다. 그 문만 열람 기록을 남긴다.
  const { foreignRegNoEnc, ...tenant } = row
  const canIdentity = canReadScope(await getMyRole(), 'identity')
  return {
    ...tenant,
    foreignRegNoMasked: canIdentity ? maskStoredForeignRegNo(foreignRegNoEnc, row.id) : null,
    monthlyBilling: await tenantMonthlyBilling(row.leaseTerms),
  }
}

/**
 * 계약이 둘 이상인 사람의 이번 달 청구 합계 — 계약 하나면 null(줄 자체가 안 뜬다).
 *
 * 청구는 계약별로 유지하고 합산은 표시만 한다(운영자 확정 2026-08-13). 그래서 여기서 새로 계산하지
 * 않고 수납 관리 행(getRoomPaymentStatus)의 `expected` 를 그대로 모은다 — 같은 이름의 숫자가 화면마다
 * 다르면 그게 사고다. 양도인 귀속월 0·무청구 퇴실월 0·락인·할인·일할이 전부 그 행에 이미 반영돼 있어,
 * 이 줄과 수납 화면은 문자 그대로 같은 값을 말한다.
 *
 * 무거운 조회를 매번 부르지 않기 위해 계약이 둘 이상일 때만 부른다. 오늘 실데이터로는 그런 입주자가
 * 0명이라 이 함수는 한 번도 안 돌고, 상세 모달의 조회 수도 종전과 같다.
 */
async function tenantMonthlyBilling(
  leases: { id: string; status: string; room: { roomNo: string } | null }[],
): Promise<{ month: string; parts: { leaseId: string; roomNo: string; amount: number }[]; total: number } | null> {
  const billable: string[] = BILLABLE_STATUSES
  const target = leases.filter(l => billable.includes(l.status))
  if (target.length < 2) return null
  if (!canReadScope(await getMyRole(), 'money')) return null

  const kst = kstYmd()
  const month = `${kst.year}-${String(kst.month).padStart(2, '0')}`
  const rows = await getRoomPaymentStatus(month)
  const byLease = new Map(rows.filter(r => r.leaseTermId).map(r => [r.leaseTermId!, r]))
  const parts = target.map(l => ({
    leaseId: l.id,
    roomNo: l.room?.roomNo ?? '',
    amount: byLease.get(l.id)?.expected ?? 0,
  }))
  return { month, parts, total: parts.reduce((s, p) => s + p.amount, 0) }
}

/** 사람 축 조회가 메인 계약 하나만 내려보낼 때 쓰는 마무리 — 화면의 `leaseTerms[0]` 문법을 그대로 유지시킨다. */
function mainLeaseOnly<T extends { status: string; moveInDate?: Date | string | null }>(leases: T[]): T[] {
  const main = primaryTenantLease(leases)
  return main ? [main] : []
}

export async function getTenantQuickInfo(tenantId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, gender: true, nationality: true,
      job: true, birthdate: true, memo: true,
      contacts: { select: { contactType: true, contactValue: true }, take: 3 },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: {
          id: true, status: true, rentAmount: true, depositAmount: true,
          dueDay: true, moveInDate: true, moveOutDate: true, expectedMoveOut: true,
          isShortTerm: true,   // 단기는 '매월 N일' 납부일 표기가 성립하지 않는다(퀵 정보 표시 가드)
          room: { select: { roomNo: true } },
        },
        // 형제(getTenantDetail)와 같은 선 — 잘라 읽지 않고 메인 계약은 정본이 고른다.
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  return row ? { ...row, leaseTerms: mainLeaseOnly(row.leaseTerms) } : row
}

// 단일 lease의 그 달 RoomRow (수납 상태) — 입주자 페이지에서 인라인 표시용
export async function getLeaseSettlementInfo(leaseTermId: string, targetMonth: string): Promise<RoomRow | null> {
  // 금액 읽기 차단(제한 스태프) — 수납 정보면 진입 자체 차단(엔티티 모달 결제 탭도 클라에서 숨김).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const allRows = await getRoomPaymentStatus(targetMonth)
  const found = allRows.find(r => r.leaseTermId === leaseTermId)
  if (found) return found

  // getRoomPaymentStatus 행에 없는 lease 조회용 fallback — 퇴실자(CHECKED_OUT/CANCELLED)의
  // 과거 수납 내역, 그리고 호실 미지정 예약자(RESERVED, roomId null)의 프리즘(오류신고 890bb698).
  // 호실 단위 flatMap이라 roomId null lease는 행이 없어 여기서 직접 lease 정보를 구성한다.
  // 입력·할인·납부일 위젯이 의존하는 필드(depositAmount·cleaningFee·moveInDate 등)는 모두 채우되,
  // 이 함수는 읽기 전용 조회이므로 expected/balance/firstUnpaidMonth 등은 0/false/null로 둔다.
  const propertyId = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    include: {
      tenant: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
      room: true,
      discounts: true,
    },
  })
  if (!lease) return null
  if (!['CHECKED_OUT', 'CANCELLED', 'RESERVED'].includes(lease.status)) return null

  // 예약금 모드 해석 — 영업장 기본값 상속. 호실 미지정 예약자(roomId null)도 모드 인지 표시·수납을 위해.
  const settleProp = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { reservationDepositMode: true, shortStayPolicy: true },
  })
  const fbShortStay = parseShortStayPolicy(settleProp?.shortStayPolicy)

  // RESERVED fallback 도 표시 정본 수렴(신고 50a2a69b) — 입주월 기준 할인 반영 + 조회월 무관 실수납 합.
  let fbExpected = 0
  let fbReservationPaid: { deposit: number; prepaid: number; cleaning: number } | null = null
  if (lease.status === 'RESERVED') {
    const fbMoveInMonth = lease.moveInDate
      ? new Date(lease.moveInDate).toISOString().slice(0, 7)
      : targetMonth
    // 정본 경로(위 RESERVED 분기)와 같은 규칙 — 예약 인상(room.scheduledRent)을 반영한다.
    // 종전에는 원가만 써서, 인상 예약된 방의 예약자가 호실 배정 전후로 다른 금액을 보게 됐다.
    const fbRentUpdMonth = lease.room?.rentUpdateDate ? monthOfDate(lease.room.rentUpdateDate) : null
    const fbBase = (lease.room?.scheduledRent != null && lease.room.scheduledRent > 0 && fbRentUpdMonth && fbMoveInMonth >= fbRentUpdMonth)
      ? lease.room.scheduledRent
      : lease.rentAmount
    fbExpected = discountedRent(lease.discounts ?? [], fbMoveInMonth, fbBase)
    const sums = await prisma.paymentRecord.groupBy({
      by: ['isDeposit'],
      where: { leaseTermId: lease.id, deletedAt: null },
      _sum: { actualAmount: true },
    })
    const fbCleaning = await prisma.extraIncome.aggregate({
      where: { leaseTermId: lease.id, propertyId, ...CLEANING_FEE_RECEIVED_WHERE },
      _sum: { amount: true },
    })
    fbReservationPaid = { deposit: 0, prepaid: 0, cleaning: fbCleaning._sum.amount ?? 0 }
    for (const g of sums) {
      if (g.isDeposit) fbReservationPaid.deposit += g._sum.actualAmount ?? 0
      else fbReservationPaid.prepaid += g._sum.actualAmount ?? 0
    }
  }

  return {
    roomId: lease.roomId ?? '',
    roomNo: lease.room?.roomNo ?? '',
    type: lease.room?.type ?? null,
    floor: lease.room?.floor ?? null,
    windowType: lease.room?.windowType ?? null,
    direction: lease.room?.direction ?? null,
    isVacant: false,
    noMoveInReport: lease.room?.noMoveInReport ?? false,
    tenantId: lease.tenant.id,
    tenantName: lease.tenant.name,
    contact: lease.tenant.contacts[0]?.contactValue ?? null,
    status: lease.status,
    expected: fbExpected,
    dueDay: lease.dueDay,
    isShortTerm: lease.isShortTerm,
    currentPaid: 0,
    carryOver: 0,
    totalPaid: 0,
    balance: 0,
    isPaid: true,
    leaseTermId: lease.id,
    depositAmount: lease.depositAmount,
    cleaningFee: lease.cleaningFee ?? 0,
    accumulatedUnpaid: 0,
    isFutureMonth: false,
    baseRent: lease.room?.baseRent ?? lease.rentAmount,
    prevTenantName: null,
    prevContact: null,
    overrideDueDay: null,
    overrideDueDayMonth: null,
    overrideDueDayReason: null,
    moveInDate: lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null,
    prevPaidThisMonth: false,
    firstUnpaidMonth: null,
    isReservationConfirmed: false,
    latePaidAt: null,
    lastPayDate: null,
    nextDueDate: null,
    nextDueAmount: 0,
    expectedMoveOut: lease.moveOutDate ? new Date(lease.moveOutDate).toISOString().slice(0, 10) : null,
    reservationDepositMode: resolveReservationDepositMode(
      lease.reservationDepositMode, settleProp?.reservationDepositMode, lease.isShortTerm,
      fbShortStay.reservationMode,
    ),
    shortStayReservationMode: fbShortStay.reservationMode,
    shortStayDeposit: fbShortStay.deposit,
    reservationPaid: fbReservationPaid,
    billingAdjusts: billingAdjustsOf(lease.shortStayExtensions),
  }
}

export async function getRoomQuickInfo(roomId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true, roomNo: true, type: true,
      baseRent: true, scheduledRent: true, rentUpdateDate: true,
      windowType: true, direction: true,
      areaPyeong: true, areaM2: true,
      memo: true, isVacant: true,
      photos: {
        select: { id: true, storageUrl: true, fileName: true, driveFileId: true },
        orderBy: { sortOrder: 'asc' },
      },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: { status: true, tenant: { select: { name: true } } },
        // 정렬은 take 로 잘릴 때 점유 계약이 먼저 남게 하는 역할만 한다 — 주 계약은
        // 아래 primaryRoomLease 가 의미로 고른다(호실 카드와 같은 규칙).
        orderBy: { status: 'asc' },
        take: 3,
      },
    },
  })
  if (!room) return null
  // leaseTerms[0] = 그 방의 주 계약. 종전엔 'createdAt desc 첫 계약'이라 최근에 만든 예약이
  // 실거주자를 밀어냈다(503호).
  const primary = primaryRoomLease(room.leaseTerms)
  return { ...room, leaseTerms: primary ? [primary] : [] }
}

// 풀 호실 상세 — Prism 호실 면(어디 페이지서 열든) + room-manage 인라인 상세 공유.
// quickInfo 와 달리 tier·floor·비거주·areaPyeong/M2 까지 포함하고, 상태 라벨/뱃지 정보를 같이 돌려준다.
//
// targetMonth('YYYY-MM') 는 단기 퇴실 도래를 묻는 기준월이다. 호실 카드가 보는 달과 같은 달이라야
// 같은 라벨이 나온다 — 이 인자가 없던 시절엔 402·503호가 카드에선 [퇴실 예정], 모달에선 '거주중'이었다.
export async function getRoomDetail(roomId: string, targetMonth: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true, roomNo: true, type: true, tier: true,
      baseRent: true, scheduledRent: true, rentUpdateDate: true,
      nonResidentRent: true, nonResidentScheduled: true, nonResidentRentDate: true,
      floor: true, windowType: true, direction: true,
      areaPyeong: true, areaM2: true,
      memo: true, isVacant: true, nonResidentVacant: true,
      photos: {
        select: { id: true, storageUrl: true, fileName: true, driveFileId: true },
        orderBy: { sortOrder: 'asc' },
      },
      leaseTerms: {
        // 비거주(NON_RESIDENT)도 조회한다 — 빼 두었더니 창고·사무실처럼 비거주 계약만 있는 방을
        // 모달만 '공실'이라 불렀다(415호·사무실, 카드는 '비거주'). 주 계약 선택은 아래
        // primaryRoomLease 가 하고 거주·예약이 먼저라, 비거주는 그것만 있을 때만 주인이 된다.
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: {
          id: true, status: true, tenantId: true,
          isShortTerm: true, moveInDate: true, expectedMoveOut: true, reservationConfirmedAt: true,
          tenant: { select: { id: true, name: true } },
        },
        // 정렬·take 는 호실 카드(getRooms)와 같은 값이라야 잘림까지 같다 — 정렬은 take 로 잘릴 때
        // 점유 계약이 먼저 남게 하는 역할만 하고, 주 계약은 primaryRoomLease 가 의미로 고른다.
        orderBy: { status: 'asc' },
        take: 3,
      },
    },
  })
  if (!room) return null
  // 날짜는 'YYYY-MM-DD' 문자열로 고정 — 호실 카드(getRooms)와 같은 문법이라야 월 비교·D-day 가 같다.
  const ymd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null
  const leases = room.leaseTerms.map(l => ({ ...l, moveInDate: ymd(l.moveInDate), expectedMoveOut: ymd(l.expectedMoveOut) }))
  // 이 방의 주 계약 — 사는 사람이 먼저다. 종전엔 'createdAt desc 첫 계약'이라 최근에 만든 예약이
  // 실거주자를 밀어냈고, 그래서 카드는 송호준인데 눌러 연 모달은 Arafat 이었다(503호).
  const lease = primaryRoomLease(leases)
  // 예약자는 여기서 안 내려보낸다 — 기본정보의 '예약자' 줄을 없애고 그 사실을 '거주 이력 및 예정'
  // 위젯의 미래 행이 받았다(운영자 지시 2026-08-11). 예약을 고르는 정본은 그 위젯이 쓰는
  // getRoomStayHistory 다. 두 곳이 각자 예약을 고르면 같은 방에서 다른 사람을 말하게 된다.
  // 상태 라벨/뱃지 — 호실 카드와 같은 함수(lib/leaseStatus.roomStatusView)로 만든다.
  const status = roomStatusView(lease, { nonResidentVacant: room.nonResidentVacant, targetMonth })
  // '언제부터 이 방을 줄 수 있나' — 위 leaseTerms 는 take: 3 이라 계산 입력으로 쓸 수 없다.
  // 잘린 한 건이 무기한이면 방은 '모른다'인데 '곧 입주 가능'으로 뒤집힌다. 판정에 필요한 두 필드만
  // take 없이 다시 읽는다. 판정 자체는 lib/leaseStatus 의 roomAvailability 정본(호실 카드·홈 매칭 공유).
  const availabilityLeases = await prisma.leaseTerm.findMany({
    where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: { status: true, expectedMoveOut: true },
  })
  const availability = roomAvailability({ nonResidentVacant: room.nonResidentVacant, leaseTerms: availabilityLeases })
  return {
    ...room,
    leaseTerms: lease ? [lease] : [],
    status,
    availability,
  }
}

// 호실↔입주자(lease)↔수납을 잇는 식별자 — 통합 상세 모달의 교차 네비용.
// 어느 한 id를 주면 연결된 나머지 id들을 해소해 돌려준다.
//
// **앵커는 방이 아니라 사람의 메인 계약이다**(2026-08-13, 1인 다호실 1단계).
//   601호 창고로 들어와도 제목·입주자 면·수납 면은 그 사람의 메인 계약(509호)을 말한다. 앵커가
//   '내가 누른 방'이면 같은 사람이 어느 문으로 들어왔느냐에 따라 다른 사람처럼 보인다 — 실제로
//   김상혁은 입주자 검색으로 들어가면 제목이 '601 · 김상혁'이었고 수납 면이 "이 상태의 입주자는 수납
//   정보를 열 수 없습니다"로 막혔다(601 계약이 아직 문의 단계라). 앵커 선택은 사람 축 정본
//   primaryTenantLease 하나가 한다.
//
//   진입한 방(roomId·roomNo)은 종전 값 그대로 돌려준다 — 호실 면이 '내가 누른 방'을 그리고,
//   앵커 방과 다르면 방 선택기가 둘을 오간다. 제목이 말하는 방은 anchorRoomNo 다.
//
//   entryLeaseTermId 는 **명시적으로 지목된 계약**일 때만 값이 있다. 수납 관리의 행은 계약 단위라
//   601호 행을 누르면 601 수납이 열려야 한다(그 돈은 그 계약에 넣는 돈이다). 방·사람으로 들어온
//   경우에는 null 이고, 그때 수납 면은 앵커(메인 계약)로 열린다.
export type EntityLinks = {
  roomId: string | null
  roomNo: string | null
  tenantId: string | null
  tenantName: string | null
  /** 앵커 — 이 사람의 메인 계약. 제목·입주자 면·수납 면 기본값이 이것을 본다. */
  leaseTermId: string | null
  /** 앵커 계약의 방 번호. 진입 방과 다를 수 있다(부계약 방으로 들어온 경우). */
  anchorRoomNo: string | null
  /** 호출부가 계약을 이름으로 지목했을 때만 값이 있다. 수납 면의 초기 선택. */
  entryLeaseTermId: string | null
  /** 이 사람의 진행 중 계약 — 프리즘 순서(거주·예약·비거주, 그다음 투어 단계). 방 선택기·계약 세그먼트가 쓴다. */
  leases: { id: string; roomId: string | null; roomNo: string | null; status: string }[]
}
export async function getEntityLinks(input: { roomId?: string; tenantId?: string; leaseTermId?: string }): Promise<
  EntityLinks | null
> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const leaseSelect = { id: true, tenantId: true, roomId: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } }
  type LeaseLink = { id: string; tenantId: string; roomId: string | null; room: { roomNo: string } | null; tenant: { name: string } | null }
  const emptyLinks: EntityLinks = {
    roomId: null, roomNo: null, tenantId: null, tenantName: null,
    leaseTermId: null, anchorRoomNo: null, entryLeaseTermId: null, leases: [],
  }

  // 이 사람의 진행 중 계약과 그중 메인 — 세 갈래(계약·사람·방)가 **같은 앵커**를 쓰게 하는 한 자리.
  // 순서 정본은 roomLeaseRowOrder(거주·예약·비거주)다. 투어 단계는 그 함수의 대상이 아니라 뒤에
  // 붙인다 — 빠뜨리면 아직 문의 단계인 부계약 방(601호 창고)이 방 선택기에서 통째로 사라진다.
  const anchorOf = async (tenantId: string) => {
    const rows = await prisma.leaseTerm.findMany({
      where: { tenantId, status: { in: TENANT_LIST_STATUSES } },
      select: { id: true, status: true, moveInDate: true, roomId: true, room: { select: { roomNo: true } } },
    })
    const ranked = roomLeaseRowOrder(rows)
    const rankedIds = new Set(ranked.map(l => l.id))
    const ordered = [...ranked, ...rows.filter(l => !rankedIds.has(l.id))]
    return { ordered, anchor: primaryTenantLease(ordered) ?? null }
  }

  const pack = async (
    lease: LeaseLink | null,
    opts: { roomFallback?: { id: string; roomNo: string } | null; namedLease?: boolean; namedRoom?: boolean } = {},
  ): Promise<EntityLinks> => {
    const tenantId = lease?.tenantId ?? null
    const seedRoomId = lease?.roomId ?? opts.roomFallback?.id ?? null
    const seedRoomNo = lease?.room?.roomNo ?? opts.roomFallback?.roomNo ?? null
    // 진행 중 계약이 하나도 없는 사람(퇴실·취소만)은 종전 추론 그대로다 — 앵커로 삼을 것이 없다.
    const base: EntityLinks = {
      roomId: seedRoomId, roomNo: seedRoomNo,
      tenantId, tenantName: lease?.tenant?.name ?? null,
      leaseTermId: lease?.id ?? null,
      anchorRoomNo: seedRoomNo,
      entryLeaseTermId: opts.namedLease ? (lease?.id ?? null) : null,
      leases: [],
    }
    if (!tenantId) return base
    const { ordered, anchor } = await anchorOf(tenantId)
    if (!anchor) return base
    return {
      // 방을 이름으로 지목하고 들어왔으면 그 방이 호실 면의 방이다(601호로 들어왔으면 601호를 그린다).
      // 사람으로 들어왔으면 지목한 방이 없으므로 앵커 계약의 방이다.
      roomId: opts.namedRoom ? seedRoomId : (anchor.roomId ?? seedRoomId),
      roomNo: opts.namedRoom ? seedRoomNo : (anchor.room?.roomNo ?? seedRoomNo),
      tenantId, tenantName: lease?.tenant?.name ?? null,
      leaseTermId: anchor.id,
      anchorRoomNo: anchor.room?.roomNo ?? null,
      entryLeaseTermId: opts.namedLease ? (lease?.id ?? null) : null,
      leases: ordered.map(l => ({ id: l.id, roomId: l.roomId, roomNo: l.room?.roomNo ?? null, status: l.status })),
    }
  }

  if (input.leaseTermId) {
    // 계약을 이름으로 지목한 진입(수납 관리 행 등) — 그 계약은 수납 면의 초기 선택으로 살아남는다.
    // 앵커까지 그 계약으로 바꾸지는 않는다. 601호 행을 눌러도 제목·입주자 면은 그 사람의 메인 계약이다.
    return pack(
      await prisma.leaseTerm.findUnique({ where: { id: input.leaseTermId }, select: leaseSelect }),
      { namedLease: true, namedRoom: true },
    )
  }
  if (input.tenantId) {
    // 사람만 주어졌을 때의 씨앗 — 앵커가 잡히면 여기서 고른 계약은 안 쓰인다. 진행 중 계약이 하나도
    // 없는 사람(퇴실·취소만)에게만 종전 추론(createdAt desc)이 그대로 남는다.
    const lease = await prisma.leaseTerm.findFirst({ where: { tenantId: input.tenantId }, orderBy: { createdAt: 'desc' }, select: leaseSelect })
    if (lease) return pack(lease)
    const t = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true, name: true } })
    return { ...emptyLinks, tenantId: t?.id ?? null, tenantName: t?.name ?? null }
  }
  if (input.roomId) {
    // 방 하나가 어느 사람을 가리키는가 — 호실 카드·호실 면과 같은 규칙(거주 우선)이라야 한다.
    // 'createdAt desc 한 건'이던 시절엔 최근에 만든 예약이 실거주자를 밀어내, 모달 제목과
    // 하단 입주자·수납 면이 방에 사는 사람이 아니라 예약자를 열었다(503호).
    //
    // 집합은 getRoomDetail 과 **문자 그대로 같아야 한다**. 종전에는 여기만 NON_RESIDENT 가 빠져
    // 있어, 같은 방을 두 함수가 다른 필터로 조회했다. 비거주 계약만 있는 방(415호·사무실)은
    // 호실 면이 비거주자를 정상으로 그리고 거주 이력 위젯도 그 사람으로 가는 링크를 주는데,
    // 바로 아래 나브바의 '입주자 정보' 탭만 회색으로 죽어 있었다(운영자 실기 지적 2026-08-13).
    const leases = await prisma.leaseTerm.findMany({
      where: { roomId: input.roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      // moveInDate — 예약이 둘 이상인 방에서 primaryRoomLease 가 '먼저 들어올 사람'을 고를 수 있게(404호).
      // 안 넘기면 배열 순서로 떨어져 모달 제목이 카드와 다른 사람을 가리킨다(2026-08-10 (7) 클래스).
      orderBy: { status: 'asc' }, take: 3, select: { ...leaseSelect, status: true, moveInDate: true },
    })
    let primary: LeaseLink | null = primaryRoomLease(leases) ?? null
    if (!primary) {
      // 아직 방을 잡지 않은 단계(문의·투어)라도 사람이 붙어 있으면 연결은 있는 것이다.
      // 나브바가 묻는 것은 '누가 이 방에 사는가'가 아니라 '이 방에서 갈 수 있는 사람이 있는가'다.
      // 비활성은 연결된 사람이 **정말 없는** 방만이어야 한다(운영자 지적 2026-08-13).
      // 위 집합과 나눠 묻는 이유: 한 조회로 합치면 enum 오름차순에서 문의·투어가 맨 앞으로 와
      // take 로 거주·비거주를 밀어낸다. 방을 잡은 계약이 있으면 그쪽이 언제나 먼저다.
      primary = await prisma.leaseTerm.findFirst({
        where: { roomId: input.roomId, status: { in: ['WAITING_TOUR', 'TOUR_DONE'] } },
        orderBy: { status: 'desc' },   // 투어 완료가 문의보다 뒤 단계다(enum 순서)
        select: leaseSelect,
      })
    }
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true, roomNo: true } })
    // 방을 이름으로 지목한 진입 — 호실 면은 이 방을 그린다. 앵커(제목·입주자·수납)는 그 사람의 메인 계약이다.
    return pack(primary, { roomFallback: room, namedRoom: true })
  }
  return null
}

export async function getPaymentsByLease(leaseTermId: string, targetMonth: string) {
  // 금액 읽기 차단(제한 스태프) — 납부 내역 진입 자체 차단.
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const propertyId = await getPropertyId()
  // 납부 내역은 payDate 기준 — viewMonth 안에 입금된 모든 record (targetMonth 무관)
  // 창 정본은 lib/kstDate — 로컬 자정으로 잡던 시절엔 KST 기기에서 창이 하루 앞으로 밀려
  // 말일 수납이 그 달 납부 내역에서 빠지고 전월 말일 수납이 딸려 들어왔다.
  const monthWindow = monthDbRange(targetMonth)
  // 3개월 창 — 낸 달과 귀속월이 갈리는 수납을 한 화면에서 보기 위한 **표시 전용** 집합(신고 2c6de978).
  //
  // 축이 둘인 이유. payDate 만 보면 8월에 낸 7월분이 7월 화면에서 사라진다(김민정 건의 정확한 구조).
  // targetMonth 축이 그 미래 결제일을 끌어오므로 미래 창을 따로 열 필요가 없다
  // (시뮬레이션 — 과거3 단독 108건, 과거3+미래1 108건으로 동일).
  //
  // **records 는 절대 건드리지 않는다.** TenantClient 가 그 배열로 총 수납을 직접 계산하고
  // PaymentBody 의 선납 폴백도 거기 걸려 있어, 범위를 넓히면 3개월치가 한 달 총 수납으로 표시된다.
  // windowRecords 는 목록 렌더링 전용이며 어떤 합계에도 넣지 않는다(클라 재계산 금지 원칙).
  const winMonths = [0, 1, 2].map(i => shiftMonth(targetMonth, -i))
  const winWindow = monthsDbRange(shiftMonth(targetMonth, -2), targetMonth)
  const [records, windowRecords, property, lastWithMethod] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { leaseTermId, payDate: monthWindow },
      orderBy: [{ payDate: 'asc' }, { seqNo: 'asc' }],
    }),
    prisma.paymentRecord.findMany({
      where: {
        leaseTermId,
        // 보증금은 DepositStatusPanel 이 계약 단위로 맡는다(2026-08-02 정본). 여기서 또 그리면 중복이다.
        isDeposit: false, isBillingAdjust: false,
        OR: [
          { payDate: winWindow },
          { targetMonth: { in: winMonths } },
        ],
      },
      orderBy: [{ payDate: 'desc' }, { seqNo: 'desc' }],
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { acquisitionDate: true, prevOwnerCutoffDate: true },
    }),
    // #5: 이 입주자(lease)의 가장 최근 납부방법 — 수납 모달 기본값(입주자별). 보증금 제외.
    prisma.paymentRecord.findFirst({
      where: { leaseTermId, isDeposit: false, payMethod: { not: null } },
      orderBy: [{ payDate: 'desc' }, { seqNo: 'desc' }],
      select: { payMethod: true },
    }),
  ])
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  // 보증금 실수납 합 — 조회월 무관 lease 전체("받은 돈은 사실", 신고 50a2a69b). 현황 줄·수납 모달 표시용.
  const depositAgg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, isDeposit: true, deletedAt: null },
    _sum: { actualAmount: true },
  })
  return { records, windowRecords, acquisitionDate: cutoff, lastPayMethod: lastWithMethod?.payMethod ?? null, depositPaidTotal: depositAgg._sum.actualAmount ?? 0 }
}

// 보증금 수납 내역 — 계약 단위. **조회월을 타지 않는다.**
//
// 왜 따로 두나. getPaymentsByLease 는 payDate 로 월 창을 자르는데(발생주의 전환 88f38cb),
// 보증금은 입주할 때 한 번 받고 끝이라 그 달을 지나면 화면에서 통째로 사라진다.
// 운영자 지적 2026-08-02 — "보증금을 언제 얼마 받았는지는 계속 유지되어야 나중에라도
// 퇴실할 때 돌려줘야 하는지, 돌려준다면 얼마인지 확인할 수 있다."
// knowledge/money-display-feedback §1 "받은 돈은 사실이고, 사실은 조회월과 무관하게 보여야 한다"의 구현이다.
//
// getAllPaymentsByLease 를 필터해 쓰지 않는 이유: 그쪽은 건수·합계를 운영자가 이미 신뢰하고 있어
// 조용히 바뀌면 그게 새 신고가 된다. 여기서 별도 집합을 만들어 그 숫자를 동결한다.
export async function getDepositPaymentsByLease(leaseTermId: string) {
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const propertyId = await getPropertyId()
  const [records, lease, property] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { leaseTermId, propertyId, isDeposit: true, isBillingAdjust: false },
      orderBy: [{ payDate: 'asc' }, { seqNo: 'asc' }],
      select: {
        id: true, payDate: true, targetMonth: true, actualAmount: true,
        payMethod: true, memo: true, cashReceiptIssuedAt: true,
      },
    }),
    prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { moveInDate: true } }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { acquisitionDate: true, prevOwnerCutoffDate: true } }),
  ])
  // 인수 전 입주자는 보증금을 양도인이 받았다. 이 앱 원장에 영수 기록이 없는 게 정상이라
  // '미수납'이라고 하면 거짓이다(실측 10건 중 9건이 이 경우). 계약 보증금은 인수 시 승계된 금액이다.
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const preAcquisition = !!(cutoff && lease?.moveInDate && new Date(lease.moveInDate) < cutoff)
  return { records, paidTotal: records.reduce((s, r) => s + r.actualAmount, 0), preAcquisition }
}

// 입주자별 전체 수납 내역 — 모든 달의 납부기록(언제·얼마·귀속월·방식). payDate 최신순.
// 청구 조정 전표(isBillingAdjust)는 수납이 아니라 청구 락 조정용이라 행·합계·건수 모두에서 제외.
export async function getAllPaymentsByLease(leaseTermId: string) {
  // 형제 조회(getPaymentsByLease·getDepositPaymentsByLease·getLeaseSettlementInfo)에는 있는데
  // 여기만 빠져 있었다. 금액 읽기가 차단된 스태프에게 계약 전체 수납액이 노출된다(2026-08-02 조사).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const propertyId = await getPropertyId()
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, propertyId, isBillingAdjust: false },
    orderBy: [{ payDate: 'desc' }, { seqNo: 'desc' }],
    select: {
      id: true, payDate: true, targetMonth: true, seqNo: true,
      expectedAmount: true, actualAmount: true,
      isDeposit: true, isPrevOwner: true, payMethod: true, memo: true,
    },
  })
  // 합계 — 양도인(현 소유주 매출 아님) 제외, 보증금 포함한 실제 수령액
  const total = records.filter(r => !r.isPrevOwner).reduce((s, r) => s + r.actualAmount, 0)
  return { records, total, count: records.length }
}

// ── #14 월세 할인 (입주자별) ────────────────────────────────────────
export type RentDiscountRow = {
  id: string; discountType: string; value: number; scope: string
  startMonth: string | null; endMonth: string | null; memo: string | null
}

export async function getRentDiscounts(leaseTermId: string): Promise<RentDiscountRow[]> {
  await getPropertyId()
  const rows = await prisma.rentDiscount.findMany({
    where: { leaseTermId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, discountType: true, value: true, scope: true, startMonth: true, endMonth: true, memo: true },
  })
  return rows
}

export async function addRentDiscount(data: {
  leaseTermId: string
  discountType: 'amount' | 'percent'
  value: number
  scope: 'permanent' | 'temporary'
  startMonth?: string | null   // 'YYYY-MM'
  endMonth?: string | null
  memo?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    // 본인 영업장 lease 확인 — 기존 할인 목록은 락인 되쓰기의 '변경 전 기준' 계산용
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: data.leaseTermId, propertyId },
      select: { id: true, discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } } },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    if (!(data.value > 0)) return { ok: false, error: '할인 값은 0보다 커야 합니다.' }
    if (data.discountType === 'percent' && data.value > 100) return { ok: false, error: '퍼센트 할인은 100%를 넘을 수 없습니다.' }
    if (data.scope === 'temporary' && !data.startMonth) return { ok: false, error: '일시 할인은 시작 월이 필요합니다.' }
    const created = await prisma.rentDiscount.create({
      data: {
        leaseTermId:  data.leaseTermId,
        discountType: data.discountType,
        value:        data.value,
        scope:        data.scope,
        startMonth:   data.scope === 'temporary' ? (data.startMonth ?? null) : null,
        endMonth:     data.scope === 'temporary' ? (data.endMonth ?? null) : null,
        memo:         data.memo ?? null,
      },
    })
    // 락인 record 정합 — 등록된 할인이 이미 수납이 있는 달에도 즉시 반영되게(신고 70cde9d6)
    await rewriteLockedExpectedForDiscountChange(data.leaseTermId, lease.discounts, [...lease.discounts, {
      discountType: created.discountType, value: created.value, scope: created.scope, startMonth: created.startMonth, endMonth: created.endMonth,
    }])
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/tenants')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteRentDiscount(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    // 본인 영업장 할인만 삭제 (lease→property 확인)
    const d = await prisma.rentDiscount.findUnique({
      where: { id },
      select: {
        leaseTermId: true,
        leaseTerm: { select: { propertyId: true, discounts: { select: { id: true, discountType: true, value: true, scope: true, startMonth: true, endMonth: true } } } },
      },
    })
    if (!d || d.leaseTerm.propertyId !== propertyId) return { ok: false, error: '할인을 찾을 수 없습니다.' }
    await prisma.rentDiscount.delete({ where: { id } })
    // 락인 record 정합 — 삭제 대칭: 구 할인가로 락인된 미결 월을 새 기준값으로 되쓰기(신고 70cde9d6)
    const prev = d.leaseTerm.discounts.map(({ id: _id, ...rest }) => rest)
    const next = d.leaseTerm.discounts.filter(x => x.id !== id).map(({ id: _id, ...rest }) => rest)
    await rewriteLockedExpectedForDiscountChange(d.leaseTermId, prev, next)
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/tenants')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
// 이 방에 배정된 지출(누적) — 방 상세 'ㅇ방 지출' 섹션용.
// 표시일 = 배정일(assignedAt) 우선, 없으면 구매일(date) 폴백 — "이 방에 언제 들어왔나" 기준(2026-07-28 전문가 오더).
export async function getRoomExpenses(roomId: string): Promise<{
  total: number
  items: { id: string; date: string; purchaseDate: string | null; category: string; amount: number; vendor: string | null; memo: string | null; detail: string | null; itemLabel: string | null }[]
}> {
  const propertyId = await getPropertyId()
  const rows = await prisma.expense.findMany({
    where: { propertyId, roomId },
    select: { id: true, date: true, assignedAt: true, category: true, amount: true, vendor: true, memo: true, detail: true, itemLabel: true },
  })
  const items = rows.map(r => {
    const purchase = r.date.toISOString().slice(0, 10)
    const display = r.assignedAt ? r.assignedAt.toISOString().slice(0, 10) : purchase
    return {
      id: r.id, date: display,
      purchaseDate: display !== purchase ? purchase : null,   // 배정일과 다를 때만 구매일 병기
      category: r.category, amount: r.amount, vendor: r.vendor, memo: r.memo, detail: r.detail, itemLabel: r.itemLabel,
    }
  }).sort((a, b) => b.date.localeCompare(a.date))
  return {
    total: items.reduce((s, r) => s + r.amount, 0),
    items,
  }
}


// 이 방의 거주 이력과 예정 — 지나간 RoomStay 구간(endDate null = 현재)에 아직 안 들어온 입실 예약을 잇는다.
//
// 왜 한 목록인가 — 방을 두고 묻는 질문은 언제나 하나다. "이 방은 누가 언제 쓰는가."
// 과거만 있는 목록은 그 절반만 답한다. 402호처럼 8/17 에 들어올 사람이 잡혀 있는데
// 이력에는 지금 사는 사람이 마지막 줄이면, 방을 다시 내줄 수 있는지 화면이 말해 주지 않는다.
// 예약은 RoomStay 구간이 없으므로(실입주 기록만 남긴다) 계약에서 의사 행으로 만들어 얹는다.
//
// 취소(CANCELLED)는 status: 'RESERVED' 조회에서 자연히 빠진다 — 지켜지지 않은 약속은 예정이 아니다.
export async function getRoomStayHistory(roomId: string): Promise<{
  items: {
    id: string; tenantId: string | null; tenantName: string
    startDate: string | null; endDate: string | null
    kind: 'past' | 'current' | 'upcoming'
    /** 예약 확정 여부 — kind='upcoming' 에서만 뜻이 있다. 기본정보에서 없앤 '예약자' 줄의
     *  확정 뱃지가 갖고 있던 사실이라, 여기로 옮겨 오지 않으면 화면에서 통째로 사라진다. */
    confirmed: boolean
  }[]
}> {
  const propertyId = await getPropertyId()
  const [rows, reserved] = await Promise.all([
    prisma.roomStay.findMany({
      // 표시 게이트 — 지나간 이력은 실입주 기록만. 문의·투어 단계 lease 의 구간은 데이터 게이트와 별개로 이중 방어(2026-07-28 오더).
      // RESERVED 는 여기서 계속 빼고 아래 의사 행으로 받는다 — 한 예약이 두 줄이 되면 안 된다.
      where: { propertyId, roomId, leaseTerm: { status: { notIn: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] } } },
      select: {
        id: true, startDate: true, endDate: true, createdAt: true,
        leaseTerm: { select: { tenantId: true, tenant: { select: { name: true } } } },
      },
    }),
    prisma.leaseTerm.findMany({
      where: { propertyId, roomId, status: 'RESERVED' },
      select: { id: true, tenantId: true, moveInDate: true, expectedMoveOut: true, reservationConfirmedAt: true, createdAt: true, tenant: { select: { name: true } } },
    }),
  ])
  const ymd = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null
  type Row = {
    id: string; tenantId: string | null; tenantName: string
    startDate: string | null; endDate: string | null
    kind: 'past' | 'current' | 'upcoming'
    confirmed: boolean
    createdAt: Date
  }
  const items: Row[] = [
    // 시작일이 아직 오지 않은 열린 구간(입주 예정)은 '현재'로 오독되므로 제외.
    ...rows
      .filter(r => !(r.endDate === null && r.startDate && r.startDate.toISOString().slice(0, 10) > kstYmdStr()))
      .map((r): Row => ({
        id: r.id,
        tenantId: r.leaseTerm?.tenantId ?? null,
        tenantName: r.leaseTerm?.tenant?.name ?? '—',
        startDate: ymd(r.startDate),
        endDate: ymd(r.endDate),
        kind: r.endDate === null ? 'current' : 'past',
        confirmed: false,
        createdAt: r.createdAt,
      })),
    ...reserved.map((l): Row => ({
      id: l.id,
      tenantId: l.tenantId,
      tenantName: l.tenant?.name ?? '—',
      startDate: ymd(l.moveInDate),
      endDate: ymd(l.expectedMoveOut),
      kind: 'upcoming',
      // 어휘는 입주자 관리·수납 관리와 같다 — 확정이면 '예약 확정', 아니면 '입실 예약'.
      confirmed: !!l.reservationConfirmedAt,
      createdAt: l.createdAt,
    })),
  ]
  // 정렬은 애플리케이션에서 — DB orderBy 로는 두 출처를 한 줄로 세울 수 없고, Postgres 의 desc 는
  // null 을 맨 앞에 놓는다. 시작일 없는 옛 구간(404호 이지우)이 미래 예약보다 위에 서던 이유다.
  // 키는 '시작일, 없으면 종료일' — 그 사람이 이 방과 얽힌 가장 이른 시점이다. 둘 다 없으면 맨 아래.
  // 같은 날짜끼리는 종전 DB 정렬과 같은 createdAt 내림차순.
  const key = (r: Row) => r.startDate ?? r.endDate
  items.sort((a, b) => {
    const ka = key(a), kb = key(b)
    if (ka !== kb) {
      if (ka == null) return 1
      if (kb == null) return -1
      return ka < kb ? 1 : -1
    }
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
  return { items: items.map(({ createdAt: _createdAt, ...it }) => it) }
}


// 이 방에 접수된 요청 — 등록 시점 호실번호(roomNoSnapshot)가 이 방 번호와 같은 건.
// 이사·퇴실로 입주자가 바뀌어도 '당시 이 방의 요청'이 그대로 남는다. 호실 번호는 서버에서 조회.
export async function getRoomRequests(roomId: string): Promise<{
  items: { id: string; content: string; requestDate: string; resolvedAt: string | null; isUrgent: boolean; tenantName: string | null }[]
}> {
  const propertyId = await getPropertyId()
  const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { roomNo: true } })
  if (!room) return { items: [] }
  const rows = await prisma.tenantRequest.findMany({
    where: { propertyId, deletedAt: null, roomNoSnapshot: room.roomNo },
    orderBy: [{ requestDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, content: true, requestDate: true, resolvedAt: true, isUrgent: true,
      tenant: { select: { name: true } },
    },
  })
  return {
    items: rows.map(r => ({
      id: r.id,
      content: r.content,
      requestDate: r.requestDate.toISOString().slice(0, 10),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      isUrgent: r.isUrgent,
      tenantName: r.tenant?.name ?? null,
    })),
  }
}


// 이 입주자의 이사 이력 — 이 사람의 계약들이 거쳐간 RoomStay 구간 + 호실 번호. 최신 구간이 위.
export async function getTenantMoveHistory(tenantId: string): Promise<{
  items: { id: string; roomNo: string; startDate: string | null; endDate: string | null }[]
}> {
  const propertyId = await getPropertyId()
  const rows = await prisma.roomStay.findMany({
    // 표시 게이트 — 호실 거주 이력과 동일 기준(실입주 구간만, 2026-07-28 오더).
    where: { propertyId, leaseTerm: { tenantId, status: { notIn: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, startDate: true, endDate: true,
      room: { select: { roomNo: true } },
    },
  })
  return {
    // 시작일 미도래 열린 구간(입주 예정) 제외 — 호실 거주 이력과 동일 규칙.
    items: rows.filter(r => !(r.endDate === null && r.startDate && r.startDate.toISOString().slice(0, 10) > kstYmdStr())).map(r => ({
      id: r.id,
      roomNo: r.room.roomNo,
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    })),
  }
}


// 이 입주자의 상태 이력 — TenantStatusLog 를 최신순으로. 신고 ad517231.
//
// 이 테이블은 167건이 쌓여 있는데 **읽는 화면이 하나도 없었다**(설정의 데이터 내보내기가 유일).
// 취소 사유만 따로 꽂으면 같은 테이블의 나머지가 그대로 안 보이므로 이력 전체를 연다.
//
// tenantId 로 묶는다 — leaseTermId 가 없는 옛 로그가 44건 있어서(addTenant 가 안 채웠다)
// 계약으로 묶으면 그 사람들 이력이 통째로 사라진다. 그 근원은 따로 고치고 백필한다.
//
// 무효 처리된 행도 **가져온다**(신고 e000c791). 이 화면이 되살릴 수 있는 유일한 자리라
// 여기서까지 걸러 버리면 적용취소가 토스트 수명 동안만 가능한 반쪽이 된다.
// 대신 목록 본문에는 안 섞고 호출부가 접힌 칸으로 내린다 — 유효한 행만 세는 판정(canRecord)에서도 뺀다.
export async function getTenantStatusHistory(tenantId: string): Promise<{
  canEdit: boolean
  items: { id: string; fromStatus: string; toStatus: string; reason: string | null; changedAt: string
    isCreated: boolean; editable: boolean; canRecord: boolean; deleted: boolean }[]
}> {
  const propertyId = await getPropertyId()
  const role = await getMyRole()
  const rows = await prisma.tenantStatusLog.findMany({
    where: { propertyId, tenantId },
    orderBy: { changedAt: 'desc' },
    select: { id: true, fromStatus: true, toStatus: true, reason: true, changedAt: true, changedById: true, deletedAt: true },
  })
  // 사유를 아직 안 적은 행이 여럿이면 '어디에 적어야 하나'가 화면에 안 나온다.
  // 실측으로 한 번의 퇴실에 퇴실 예정·퇴실 두 행이 생기는 입주자가 11명이다.
  // 기록 진입은 **가장 최근 종료 전이 한 행에만** 연다. 나머지는 이미 적힌 것만 읽고 고친다.
  const latestEndId = rows.find(r => !r.deletedAt && r.fromStatus !== r.toStatus && reasonsForStatus(r.toStatus))?.id ?? null
  return {
    canEdit: canEdit(role),
    items: rows.map(r => {
      // 등록은 전이가 아니다. from === to 만으로는 부족하다 — 같은 상태로 재저장하면(퇴실 예정일만 변경)
      // 사람이 만든 from === to 로그가 생긴다(실측 2건). 등록 로그는 changedById 가 비어 있다.
      const isCreated = r.fromStatus === r.toStatus && r.changedById === null
      // 사유를 받는 전이만 고칠 수 있다(입실 취소·퇴실). '단기 연장' 같은 시스템 라벨은 손대지 않는다 —
      // 이 구분선이 있어야 '이력을 마음대로 고치는 앱'이 되지 않는다.
      // 무효 처리된 행은 사유 편집도 닫는다 — 없던 일로 한 행의 주석을 고칠 이유가 없다.
      const editable = !r.deletedAt && r.fromStatus !== r.toStatus && reasonsForStatus(r.toStatus) !== null
      return {
        id: r.id,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        reason: r.reason,
        changedAt: r.changedAt.toISOString(),
        isCreated,
        editable,
        canRecord: editable && r.id === latestEndId,
        deleted: r.deletedAt !== null,
      }
    }),
  }
}


// 상태 이력의 사유를 고친다 (신고 ad517231 — "수정도 해야하는데").
//
// 감사 기록을 사후에 고치는 셈이라 경계선을 분명히 둔다.
//   fromStatus·toStatus·changedAt·changedById 는 시스템이 관찰한 사실이라 **손대지 않는다.**
//   reason 은 운영자가 붙인 주석이다. 주석 교정은 이력 위조가 아니다.
// 그래서 사유를 받는 전이(입실 취소·퇴실)의 로그만 열어준다.
// 이전 값을 돌려줘서 호출부가 적용취소를 걸 수 있게 한다(§16).
export async function updateStatusLogReason(logId: string, reason: string | null): Promise<
  { ok: true; prev: string | null } | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const row = await prisma.tenantStatusLog.findFirst({
      where: { id: logId, propertyId },
      select: { id: true, fromStatus: true, toStatus: true, reason: true, deletedAt: true },
    })
    if (!row) return { ok: false, error: '이력을 찾을 수 없습니다.' }
    if (row.deletedAt) return { ok: false, error: '무효 처리된 이력입니다. 적용취소한 뒤 수정하세요.' }
    if (row.fromStatus === row.toStatus || !reasonsForStatus(row.toStatus)) {
      return { ok: false, error: '이 이력은 사유를 기록하는 항목이 아닙니다.' }
    }
    const next = (reason ?? '').trim() || null
    await prisma.tenantStatusLog.update({ where: { id: logId }, data: { reason: next } })
    revalidatePath('/tenants')
    return { ok: true, prev: row.reason }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// 상태 이력 무효 처리 (신고 e000c791 — "잘못 입력한게 내역으로 남으니까").
//
// 왜 소프트삭제인가. 조정미 님 사례가 이 기능의 근거다 — 8/7 새벽 다른 사람과 혼동해
// 퇴실 예정으로 바꿨다가 5.5시간 뒤 되돌렸고, 그때 적은 퇴실 사유 '개인 사정'이 이력에 남았다.
// 그 값은 지금은 종료 상태 게이트에 가려 안 보이지만, 이분이 **실제로 퇴실하는 날**
// 목록·카드의 퇴실 사유로 튀어나온다(endReasonText 는 사유가 적힌 최신 한 건을 고른다).
// 그러니 지우기는 해야 하는데, 하드삭제는 '언제 무엇이 있었나'를 함께 지운다 — 그래서 무효 표시다.
//
// 상태 자체는 안 건드린다. 이력은 관찰 기록이고 현재 상태의 정본은 LeaseTerm.status 다.
// 여기서 lease 를 함께 되돌리면 화면에 없는 부작용이 생긴다(확인창 문구도 그렇게 약속한다).
export async function invalidateStatusLog(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    // 영업장 스코프 검증 — 남의 영업장 로그 id 를 실어 보내도 못 건드린다
    const { propertyId, userId } = await requirePropertyAccess()
    const row = await prisma.tenantStatusLog.findFirst({
      where: { id: logId, propertyId },
      select: { id: true, deletedAt: true },
    })
    if (!row) return { ok: false, error: '이력을 찾을 수 없습니다.' }
    if (row.deletedAt) return { ok: false, error: '이미 무효 처리된 이력입니다.' }
    await prisma.tenantStatusLog.update({
      where: { id: logId },
      data: { deletedAt: new Date(), deletedById: userId },
    })
    revalidatePath('/tenants'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// 무효 처리 적용취소 — deletedAt 을 되돌린다. 무효 처리한 계정(deletedById)도 함께 지운다.
// 토스트가 사라진 뒤에도 이력 위젯의 접힌 칸에서 언제든 부를 수 있다(§16 적용취소 상시 보장).
export async function restoreStatusLog(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const row = await prisma.tenantStatusLog.findFirst({
      where: { id: logId, propertyId },
      select: { id: true, deletedAt: true },
    })
    if (!row) return { ok: false, error: '이력을 찾을 수 없습니다.' }
    if (!row.deletedAt) return { ok: false, error: '무효 처리된 이력이 아닙니다.' }
    await prisma.tenantStatusLog.update({
      where: { id: logId },
      data: { deletedAt: null, deletedById: null },
    })
    revalidatePath('/tenants'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// 입주자별 최근 결제수단 — 수납 폼 프리필용(운영자 요청 2026-07-06).
// 특정 입주자는 카드/현금을 고정적으로 쓰므로 '기기에서 마지막으로 쓴 방식'(전역)이 아니라
// 그 입주자의 직전 기록을 따른다. 기록이 없으면 null(호출부가 기기 최근 → 계좌이체 순 폴백).
export async function getTenantLastPayMethod(tenantId: string): Promise<string | null> {
  const propertyId = await getPropertyId()
  const rec = await prisma.paymentRecord.findFirst({
    where: { tenantId, payMethod: { not: null }, isDeposit: false, leaseTerm: { propertyId } },
    orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }],
    select: { payMethod: true },
  })
  return rec?.payMethod ?? null
}
