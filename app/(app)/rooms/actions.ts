'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireEdit, getMyRole } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { kstYmd, kstYmdStr } from '@/lib/kstDate'
import { FIFO_MAX_ALLOCATE_MONTHS } from '@/lib/appConfig'
import { discountedRent } from '@/lib/rentDiscount'
import { CARD_LIKE_METHODS } from '@/lib/paymentMethods'
import { billForLeaseMonth, isAfterMoveOutMonth, isCheckoutNoBillingMonthFor, resolveDueDateForMonth, monthOfDate } from '@/lib/billing'
import { resolveReservationDepositMode } from '@/lib/reservationDeposit'
import { CLEANING_FEE_CATEGORY } from '@/lib/incomeCategories'
import { effectiveDueRawForMonth } from '@/lib/dueDate'

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
  // 예약금 처리 모드 해석값 'deposit'|'prepaid'|'none' — 예약자 수납/표시 분기용(RESERVED 행·조회 fallback에서만 채움)
  reservationDepositMode?: string | null
  // 예약(RESERVED) 실수납 합 — 조회월 무관 lease 전체("받은 돈은 사실", 신고 50a2a69b). 비예약 행은 null.
  reservationPaid?: { deposit: number; prepaid: number } | null
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
      select: { acquisitionDate: true, prevOwnerCutoffDate: true, reservationDepositMode: true },
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
  const reservedPaidMap = new Map<string, { deposit: number; prepaid: number }>()
  for (const g of reservedPaidRows) {
    const cur = reservedPaidMap.get(g.leaseTermId) ?? { deposit: 0, prepaid: 0 }
    if (g.isDeposit) cur.deposit += g._sum.actualAmount ?? 0
    else cur.prepaid += g._sum.actualAmount ?? 0
    reservedPaidMap.set(g.leaseTermId, cur)
  }

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
    const rentUpdMonth = room.rentUpdateDate ? monthOfDate(room.rentUpdateDate) : null
    const baseForMonth = (room.scheduledRent != null && room.scheduledRent > 0 && rentUpdMonth && targetMonth >= rentUpdMonth)
      ? room.scheduledRent
      : lease.rentAmount
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
      const reservedBase = (room.scheduledRent != null && room.scheduledRent > 0 && rentUpdMonth && moveInMonth >= rentUpdMonth)
        ? room.scheduledRent
        : lease.rentAmount
      const reservedExpected = discountedRent(leaseDiscounts, moveInMonth, reservedBase)
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, noMoveInReport: room.noMoveInReport, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: 'RESERVED', expected: reservedExpected, dueDay: lease.dueDay,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: true,
        reservationPaid: reservedPaidMap.get(lease.id) ?? { deposit: 0, prepaid: 0 },
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
          lease.reservationDepositMode, property?.reservationDepositMode, lease.isShortTerm,
        ),
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
        { rentAmount: lease.rentAmount, checkoutProratedAmount: proratedAmt, checkoutProratedMonth: proratedMonth, discounts: leaseDiscounts,
          isShortTerm: lease.isShortTerm, moveInDate: lease.moveInDate,   // 단기 입주월 단일 청구
          room: { scheduledRent: room.scheduledRent, rentUpdateDate: room.rentUpdateDate } },
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
      billingAdjusts: billingAdjustsOf(lease.shortStayExtensions),
    }
  }

  return rooms.flatMap(room => {
    const roomLeases = activeLeases.filter(l => l.roomId === room.id)
    const primaryLease = roomLeases.find(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))
    const nonResidentLease = roomLeases.find(l => l.status === 'NON_RESIDENT')

    if (!primaryLease && !nonResidentLease) {
      const prev = prevLeases.find(l => l.roomId === room.id)
      return [{
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: true, noMoveInReport: room.noMoveInReport, tenantId: null, tenantName: null,
        contact: null, status: null, expected: 0, dueDay: null,
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

    const rows = []
    if (primaryLease) rows.push(buildLeaseRow(room, primaryLease as LeaseWithOverride, null, null))
    if (nonResidentLease) rows.push(buildLeaseRow(room, nonResidentLease as LeaseWithOverride, null, null))
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
      isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing)
      expectedMoveOut: true,
      checkoutProratedAmount: true,
      checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true } },   // 예약 인상 — 미래월 청구 반영
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
  // 현금영수증 발행 표시(메타데이터, 충당·잔액 수식 비관여) — 원본 월 record에만 스탬프
  cashReceiptIssued?: boolean
}): Promise<SavePaymentResult> {
  await requireEdit()
  const propertyId = await getPropertyId()

  // 월별 청구액을 서버에서 직접 계산(일할→락인→할인, lib/billing 공용 규칙).
  // 클라이언트가 보낸 expectedAmount(할인 미반영 원금일 수 있음)를 그대로 record 에 락인하면
  // 읽기 엔진의 [저장 청구액 우선] 규칙이 할인을 무효화한다 — lease 조회 실패 시에만 fallback.
  const billingLease = await prisma.leaseTerm.findUnique({
    where: { id: data.leaseTermId },
    select: {
      rentAmount: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
      isShortTerm: true, moveInDate: true,   // 단기 입주월 단일 청구(lib/billing)
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      // 예약 인상 — 미래월 선납 시 인상가로 락인되도록('7월 이용료부터' 반영)
      room: { select: { scheduledRent: true, rentUpdateDate: true } },
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

  // 안전장치: 무한루프 방지 — appConfig.FIFO_MAX_ALLOCATE_MONTHS (60개월 = 5년)
  let safety = FIFO_MAX_ALLOCATE_MONTHS
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
      const memo = isOriginalMonth
        ? (data.memo ?? null)
        : `${startTm} 과납 이월${data.memo ? ` · ${data.memo}` : ''}`
      await prisma.paymentRecord.create({
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
          cashReceiptIssuedAt: (data.cashReceiptIssued && isOriginalMonth && portion > 0) ? new Date() : null,
        },
      })
      touchedMonths.push(currentTm)
      if (portion > 0) allocations.push({ targetMonth: currentTm, amount: portion })
    }

    remaining -= portion
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
  return { inputMonth: data.targetMonth, startMonth: startTm, allocations }
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
      isShortTerm: true,   // 단기 입주월 단일 청구(lib/billing)
      expectedMoveOut: true,
      checkoutProratedAmount: true,
      checkoutProratedMonth: true,
      // 무청구 퇴실월 판정용 — 그 달 만기를 알아야 한다(임시조정 포함)
      dueDay: true,
      overrideDueDay: true,
      overrideDueDayMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true } },   // 예약 인상 — 미래월 청구 반영
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
      payDate:        new Date(`${targetMonth}-01T00:00:00`),
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
}) {
  await requireEdit()
  const propertyId = await getPropertyId()

  // 예약금 부분 수납 대응 (오류신고 9b974be0·63bf23bc): 실제 받은 금액을 계약 보증금 상한으로 기록.
  // 예: 계약 보증금 30만에 예약금 10만만 받으면 보증금 record 는 10만으로 남는다(초과분은 아래 이용료 분리).
  const depositActual = Math.min(data.totalPaid, data.depositAmount)
  // RESERVED(예약) 단계 수납이면 기본 메모를 '예약금'으로 — leaseTermId 로 status 만 조회.
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: data.leaseTermId, propertyId },
    select: { status: true },
  })
  const defaultDepositMemo = lease?.status === 'RESERVED' ? '예약금' : '보증금'

  const existingCount = await prisma.paymentRecord.count({
    where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth, deletedAt: undefined },
  })

  await prisma.paymentRecord.create({
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
      cashReceiptIssuedAt: data.cashReceiptIssued ? new Date() : null,
    },
  })

  const excess = data.totalPaid - data.depositAmount
  if (excess > 0) {
    // 초과분은 이용료 record — expectedAmount 는 그 달 실제 청구액(할인·일할 반영)으로 락인
    const monthBill = await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount)
    await prisma.paymentRecord.create({
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
        cashReceiptIssuedAt: data.cashReceiptIssued ? new Date() : null,
      },
    })
  }

  await recalculatePayments(
    data.leaseTermId, data.targetMonth,
    await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount),
  )
  revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const feeActual = Math.max(0, Math.min(data.totalPaid, data.cleaningFee))
    if (feeActual <= 0) return { ok: false, error: '청소비 금액이 올바르지 않습니다.' }

    // 영업장 수입 카테고리에 '청소비' 보장 — 없으면 재무 화면 필터에 안 뜬다
    const property = await prisma.property.findUnique({
      where: { id: propertyId }, select: { incomeCategories: true },
    })
    const cats = (property?.incomeCategories ?? '').split(',').map(c => c.trim()).filter(Boolean)
    if (!cats.includes(CLEANING_FEE_CATEGORY)) {
      await prisma.property.update({
        where: { id: propertyId },
        data: { incomeCategories: [...cats, CLEANING_FEE_CATEGORY].join(',') },
      })
    }

    const tenant = await prisma.tenant.findFirst({ where: { id: data.tenantId, propertyId }, select: { name: true } })
    await prisma.extraIncome.create({
      data: {
        propertyId,
        date:      new Date(data.payDate),
        amount:    feeActual,
        category:  CLEANING_FEE_CATEGORY,
        detail:    `${tenant?.name ?? '입실자'} 입실 · 청소비${data.memo ? ` · ${data.memo}` : ''}`,
        payMethod: data.payMethod,
        tenantId:    data.tenantId,
        leaseTermId: data.leaseTermId,
      },
    })

    // 초과분은 이용료 record — 기존 경로와 동일한 락인 규칙
    const excess = data.totalPaid - feeActual
    if (excess > 0) {
      const existingCount = await prisma.paymentRecord.count({
        where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth, deletedAt: undefined },
      })
      const monthBill = await serverBillForMonth(data.leaseTermId, data.targetMonth, data.rentAmount)
      await prisma.paymentRecord.create({
        data: {
          leaseTermId: data.leaseTermId, tenantId: data.tenantId, propertyId,
          targetMonth: data.targetMonth,
          expectedAmount: monthBill, actualAmount: excess,
          payDate: new Date(data.payDate), payMethod: data.payMethod,
          memo: null, seqNo: existingCount + 1, isPaid: false, carryOver: 0,
          cashReceiptIssuedAt: data.cashReceiptIssued ? new Date() : null,
        },
      })
      await recalculatePayments(data.leaseTermId, data.targetMonth, monthBill)
    }
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '청소비 수납 중 오류가 발생했습니다.' }
  }
}

// 예약금 수납 진입점 — 모드 인지. 기존 결제 엔진(saveDepositPayment·savePayment) 재사용, 신규 수식 0.
//   deposit: 현행 보증금 대체 그대로(isDeposit=true).
//   prepaid: savePayment(forcedTargetMonth=입주 예정월, isDeposit=false)로 첫 청구월 이용료 선납.
//            expectedAmount는 savePayment가 서버 재계산하므로 클라 값을 신뢰하지 않는다(0 전달).
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: data.leaseTermId, propertyId },
      select: { depositAmount: true, rentAmount: true, moveInDate: true },
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
      await saveDepositPayment({
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
      })
    } else if (data.mode === 'prepaid') {
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
      })
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

// 보증금 '받음(실수납)' 기록 — 전 원장 등으로 이미 받았으나 입금기록이 없는 보증금을
// 계약상 금액 기준으로 실수납 record(isDeposit=true)로 남긴다.
// finance 보증금 요약의 '받음으로 기록' 버튼, 입주자/예약 폼의 '수납 완료' 체크에서 호출.
// 이미 기록된 보증금이 있으면 미기록분(계약액 − 기존 입금)만 채운다.
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
  const payDate = opts?.payDate ? new Date(opts.payDate) : new Date(kst.year, kst.month - 1, kst.day)

  const existingCount = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth, deletedAt: undefined } })
  await prisma.paymentRecord.create({
    data: {
      leaseTermId, tenantId: lease.tenantId, propertyId,
      targetMonth, expectedAmount: lease.depositAmount, actualAmount: remaining,
      payDate, payMethod: opts?.payMethod ?? '기타',
      memo: opts?.memo ?? '보증금 수납(받음 기록)',
      seqNo: existingCount + 1, isPaid: false, isDeposit: true, carryOver: 0,
    },
  })
  revalidatePath('/finance'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
}

// 그 달 서버 권위 청구액 — 일할→락인(기존 record 최대)→할인 (lib/billing 공용 규칙).
// 수납 수정/삭제/보증금 초과분 기록 시 isPaid 재계산·expectedAmount 저장에 사용.
async function serverBillForMonth(leaseTermId: string, mon: string, fallback: number): Promise<number> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      rentAmount: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
      isShortTerm: true, moveInDate: true,   // 단기 입주월 단일 청구(lib/billing)
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true } },   // 예약 인상 — 미래월 청구 반영
    },
  })
  if (!lease) return fallback
  const agg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, targetMonth: mon, isDeposit: false, isPrevOwner: false },
    _max: { expectedAmount: true },
  })
  return billForLeaseMonth(lease, mon, agg._max.expectedAmount ?? null)
}

// 수납 재계산 — GAS의 recalculatePayments 이관
async function recalculatePayments(
  leaseTermId: string,
  targetMonth: string,
  expectedAmount: number
) {
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth, isDeposit: false },
    orderBy: { payDate: 'asc' },
  })

  let cumulative = 0
  for (const record of records) {
    cumulative += record.actualAmount
    const isPaid = cumulative >= expectedAmount

    await prisma.paymentRecord.update({
      where: { id: record.id },
      data:  { isPaid },
    })
  }
}

// 수납 기록 수정
export async function updatePayment(
  paymentId: string,
  data: { actualAmount: number; payDate: string; payMethod: string; memo?: string; targetMonth?: string; cashReceiptIssued?: boolean }
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
        // 켤 때 기존 발행 시각은 보존(감사 흔적), 끌 때만 null.
        ...(data.cashReceiptIssued === undefined ? {} : { cashReceiptIssuedAt: data.cashReceiptIssued ? (record.cashReceiptIssuedAt ?? new Date()) : null }),
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
      select: { cashReceiptIssuedAt: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }
    const next = !issued ? null
      : restoreIssuedAt != null ? new Date(restoreIssuedAt)
      : (record.cashReceiptIssuedAt ?? new Date())
    await prisma.paymentRecord.update({ where: { id: paymentId }, data: { cashReceiptIssuedAt: next } })
    revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/tenants'); revalidatePath('/finance')
    return { ok: true, prevIssuedAt: record.cashReceiptIssuedAt ? record.cashReceiptIssuedAt.toISOString() : null }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 월 수납 집계 — 현금영수증 발행 합계·카드 수납 합계(표시 전용, 결제 수식 비관여. 오류신고 c0936f89).
// 기준: payDate가 그 달(현금주의, 보증금 포함) + 양도인 정산·컷오프 이전 제외(getRoomPaymentStatus와 동일 규칙).
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
  const rows = await prisma.paymentRecord.findMany({
    where: {
      propertyId,
      isPrevOwner: false,
      payDate: { gte: cutoff && cutoff > from ? cutoff : from, lt: to },   // 컷오프 이전 = 양도인 몫(적대검증 필수 2)
    },
    select: { actualAmount: true, cashReceiptIssuedAt: true, payMethod: true },
  })
  let cashReceiptSum = 0, cashReceiptCount = 0, cardSum = 0, cardCount = 0
  for (const r of rows) {
    // 카드 계열(신용카드·결제선생) 동일 취급 — 운영자 지시 2026-07-14
    const isCard = !!r.payMethod && CARD_LIKE_METHODS.includes(r.payMethod)
    // 카드는 매출전표가 증빙을 대신하므로 현금영수증 합계에 넣지 않는다(운영자 확인 2026-08-01:
    // "카드결제했기 때문에 자동 발행이겠지"). 종전에는 두 if 가 배타가 아니라 카드 건에 현금영수증
    // 체크가 있으면 같은 금액이 양쪽에 계상돼 세무 대사용 숫자가 틀어졌다(520호 172,000원).
    if (isCard) { cardSum += r.actualAmount; cardCount += 1 }
    else if (r.cashReceiptIssuedAt) { cashReceiptSum += r.actualAmount; cashReceiptCount += 1 }
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
  roomIds: string[]
  payDate: string      // 'YYYY-MM-DD'
  payMethod: string
}): Promise<
  | { ok: true; paidRoomNos: string[]; skippedRoomNos: string[]; totalAmount: number; createdIds: string[] }
  | { ok: false; error: string }
> {
  try {
    await requireEdit()
    if (!input.roomIds?.length) return { ok: false, error: '선택된 호실이 없습니다.' }

    const rows = await getRoomPaymentStatus(input.targetMonth)
    const sel = new Set(input.roomIds)
    const selected = rows.filter(r => sel.has(r.roomId))

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
    const monthStart = new Date(y, m - 1, 1)

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

// 풀 고객 상세 — Prism 셸의 kind='tenant' body 가 사용. quickInfo 대비 contacts 전체 필드·
// lease 전체 필드(청소비·납부방식·전입신고·결제수단·현금영수증·방문경로·희망 호실·계약서 URL)·
// 추가 정보·짧은 결제 요약(분석 탭) 포함.
export async function getTenantDetail(tenantId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, englishName: true, email: true,
      gender: true, nationality: true, job: true,
      birthdate: true, isBasicRecipient: true, smoking: true, memo: true,
      contacts: {
        select: {
          id: true, contactType: true, contactValue: true,
          isPrimary: true, isEmergency: true, isHomeCountry: true,
          emergencyRelation: true, countryCode: true,
        },
      },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: {
          id: true, status: true, isShortTerm: true,
          shortStayExtensions: true,   // 단기 연장 이력 — 위젯의 연장 이력 줄·적용취소 진입점용
          checkoutProrationUndo: true, // 중도퇴실 환불 스냅샷(refund 키) — 상세의 상시 적용취소 진입점용(§16)
          rentAmount: true, depositAmount: true, cleaningFee: true,
          dueDay: true, paymentTiming: true,
          moveInDate: true, moveOutDate: true, expectedMoveOut: true, inquiryAt: true,
          tourDate: true,   // e1b81629: 투어일 유무로 '문의'/'투어 예정' 파생 라벨 분기
          reservationConfirmedAt: true,   // 신고 9b974be0: 예약 확정 여부 — 상태 전환 위젯의 확정/해제 버튼 분기·확정일 표시

          contactAlertDate: true,   // 잠재고객 연락 알림 시작일(지정) — 상세 표시용
          registrationStatus: true, payMethod: true, cashReceipt: true,
          reservationDepositMode: true,   // 예약금 모드 — 예약 취소 반환/몰취 경로 분기용
          property: { select: { contactLeadDays: true, reservationDepositMode: true } },
          visitRoute: true, wishRooms: true, wishConditions: true, contractUrl: true,
          room: { select: { id: true, roomNo: true } },
          paymentRecords: {
            where: { deletedAt: null },
            select: { id: true, expectedAmount: true, actualAmount: true, isPaid: true, payDate: true, targetMonth: true },
            orderBy: { targetMonth: 'desc' },
            take: 24,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
}

export async function getTenantQuickInfo(tenantId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  return prisma.tenant.findUnique({
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
          room: { select: { roomNo: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
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
    select: { reservationDepositMode: true },
  })

  // RESERVED fallback 도 표시 정본 수렴(신고 50a2a69b) — 입주월 기준 할인 반영 + 조회월 무관 실수납 합.
  let fbExpected = 0
  let fbReservationPaid: { deposit: number; prepaid: number } | null = null
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
    fbReservationPaid = { deposit: 0, prepaid: 0 }
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
    ),
    reservationPaid: fbReservationPaid,
    billingAdjusts: billingAdjustsOf(lease.shortStayExtensions),
  }
}

export async function getRoomQuickInfo(roomId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  return prisma.room.findUnique({
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
        select: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
}

// 풀 호실 상세 — Prism 호실 면(어디 페이지서 열든) + room-manage 인라인 상세 공유.
// quickInfo 와 달리 tier·floor·비거주·areaPyeong/M2 까지 포함하고, 상태 라벨/뱃지 정보를 같이 돌려준다.
export async function getRoomDetail(roomId: string) {
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
      memo: true, isVacant: true,
      photos: {
        select: { id: true, storageUrl: true, fileName: true, driveFileId: true },
        orderBy: { sortOrder: 'asc' },
      },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: {
          id: true, status: true, tenantId: true,
          tenant: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  if (!room) return null
  // 상태 라벨/뱃지 — RoomManageClient.getRoomStatus 와 동일 로직
  const lease = room.leaseTerms[0]
  let status: { label: string; badge: { tone: 'movein' | 'exit'; label: string } | null }
  if (!lease)                              status = { label: '공실',     badge: null }
  else if (lease.status === 'RESERVED')         status = { label: '입실 예약', badge: { tone: 'movein', label: '입실 예약' } }
  else if (lease.status === 'CHECKOUT_PENDING') status = { label: '퇴실 예정', badge: { tone: 'exit',   label: '퇴실 예정' } }
  else                                          status = { label: '거주중',   badge: null }
  return { ...room, status }
}

// 호실↔고객(lease)↔수납을 잇는 식별자 — 통합 상세 모달의 교차 네비용.
// 어느 한 id를 주면 연결된 나머지 id들을 해소해 돌려준다.
export async function getEntityLinks(input: { roomId?: string; tenantId?: string; leaseTermId?: string }): Promise<
  { roomId: string | null; roomNo: string | null; tenantId: string | null; tenantName: string | null; leaseTermId: string | null } | null
> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const leaseSelect = { id: true, tenantId: true, roomId: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } }
  type LeaseLink = { id: string; tenantId: string; roomId: string | null; room: { roomNo: string } | null; tenant: { name: string } | null }
  const pack = (lease: LeaseLink | null, roomFallback?: { id: string; roomNo: string } | null) => ({
    roomId: lease?.roomId ?? roomFallback?.id ?? null,
    roomNo: lease?.room?.roomNo ?? roomFallback?.roomNo ?? null,
    tenantId: lease?.tenantId ?? null,
    tenantName: lease?.tenant?.name ?? null,
    leaseTermId: lease?.id ?? null,
  })
  if (input.leaseTermId) {
    return pack(await prisma.leaseTerm.findUnique({ where: { id: input.leaseTermId }, select: leaseSelect }))
  }
  if (input.tenantId) {
    const lease = await prisma.leaseTerm.findFirst({ where: { tenantId: input.tenantId }, orderBy: { createdAt: 'desc' }, select: leaseSelect })
    if (lease) return pack(lease)
    const t = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true, name: true } })
    return { roomId: null, roomNo: null, tenantId: t?.id ?? null, tenantName: t?.name ?? null, leaseTermId: null }
  }
  if (input.roomId) {
    const lease = await prisma.leaseTerm.findFirst({
      where: { roomId: input.roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      orderBy: { createdAt: 'desc' }, select: leaseSelect,
    })
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true, roomNo: true } })
    return pack(lease, room)
  }
  return null
}

export async function getPaymentsByLease(leaseTermId: string, targetMonth: string) {
  // 금액 읽기 차단(제한 스태프) — 납부 내역 진입 자체 차단.
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const propertyId = await getPropertyId()
  // 납부 내역은 payDate 기준 — viewMonth 안에 입금된 모든 record (targetMonth 무관)
  const [y, m] = targetMonth.split('-').map(Number)
  const monthStart = new Date(y, m - 1, 1)
  const monthEnd = new Date(y, m, 0); monthEnd.setHours(23, 59, 59, 999)
  const [records, property, lastWithMethod] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { leaseTermId, payDate: { gte: monthStart, lte: monthEnd } },
      orderBy: [{ payDate: 'asc' }, { seqNo: 'asc' }],
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
  return { records, acquisitionDate: cutoff, lastPayMethod: lastWithMethod?.payMethod ?? null, depositPaidTotal: depositAgg._sum.actualAmount ?? 0 }
}

// 고객별 전체 수납 내역 — 모든 달의 납부기록(언제·얼마·귀속월·방식). payDate 최신순.
// 청구 조정 전표(isBillingAdjust)는 수납이 아니라 청구 락 조정용이라 행·합계·건수 모두에서 제외.
export async function getAllPaymentsByLease(leaseTermId: string) {
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

// 할인 변경 → 락인 record 정합 되쓰기 (신고 70cde9d6 근본 수정, 운영자 승인 2026-07-20)
// 부분 납부로 그 달 청구액이 record에 락인된 뒤 할인을 등록·삭제하면, 락인이 할인 fallback을 이겨
// 미납이 원금 기준으로 계속 표시됐다. 할인 변경 시 "변경 전 기준값 그대로 락인된" 현재월 이후
// record만 새 기준값으로 되쓰고 완납을 재계산한다. 협의 락인(기준값과 다른 금액)·일할 월·단기는 불변.
async function rewriteLockedExpectedForDiscountChange(
  leaseTermId: string,
  prevDiscounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[],
  nextDiscounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[],
) {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      isShortTerm: true, rentAmount: true, checkoutProratedMonth: true,
      room: { select: { scheduledRent: true, rentUpdateDate: true } },
    },
  })
  if (!lease || lease.isShortTerm) return
  // 월 하한 제거(크리티컬 신고 50a2a69b 후속) — 입주월이 이미 지난 예약 선납 락도 되쓰기 대상.
  // 안전장치는 아래 '기준값 그대로 락인된 record만' 조건이 담당(협의 락인·일할 월·단기는 여전히 불변).
  const recs = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false, isPrevOwner: false, deletedAt: null },
    select: { id: true, targetMonth: true, expectedAmount: true },
  })
  const months = [...new Set(recs.map(r => r.targetMonth))]
  for (const mon of months) {
    if (lease.checkoutProratedMonth === mon) continue   // 일할 정산 권위 월 — 불변
    const base = { rentAmount: lease.rentAmount, room: lease.room }
    const before = billForLeaseMonth({ ...base, discounts: prevDiscounts }, mon, null)
    const after  = billForLeaseMonth({ ...base, discounts: nextDiscounts }, mon, null)
    if (before === after) continue
    const monthRecs = recs.filter(r => r.targetMonth === mon)
    const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    if (lockedMax !== before) continue   // 협의 락인 등 기준값과 다른 금액 — 손대지 않음
    const targets = monthRecs.filter(r => r.expectedAmount === lockedMax).map(r => r.id)
    await prisma.paymentRecord.updateMany({ where: { id: { in: targets } }, data: { expectedAmount: after } })
    await recalculatePayments(leaseTermId, mon, after)
  }
}

// 인상 예약 변경 → 락인 record 정합 되쓰기 (A페이즈 2026-08-01)
// 할인에는 rewriteLockedExpectedForDiscountChange 가 있는데 인상 예약에는 같은 장치가 없었다.
// 그래서 인상 적용월이 이미 선납돼 락인돼 있으면 billForLeaseMonth 가 락인을 우선해
// **인상분이 영원히 미청구·미수 미인식**으로 남았다(할인 사고 70cde9d6 의 정확한 반대편).
// 안전장치는 할인 쪽과 동일 — '변경 전 기준값 그대로 락인된' record 만 되쓰고,
// 협의 락인(기준값과 다른 금액)·퇴실 일할 월·단기는 손대지 않는다.
export async function rewriteLockedExpectedForRentSchedule(
  roomId: string,
  prev: { scheduledRent: number | null; rentUpdateDate: Date | null },
  next: { scheduledRent: number | null; rentUpdateDate: Date | null },
) {
  const beforeRoom = { scheduledRent: prev.scheduledRent, rentUpdateDate: prev.rentUpdateDate }
  const afterRoom  = { scheduledRent: next.scheduledRent, rentUpdateDate: next.rentUpdateDate }
  // 이 방의 청구 대상 계약 전부(퇴실·취소 제외)
  const leases = await prisma.leaseTerm.findMany({
    where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: {
      id: true, isShortTerm: true, rentAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  for (const lease of leases) {
    if (lease.isShortTerm) continue
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, isDeposit: false, isPrevOwner: false, deletedAt: null },
      select: { id: true, targetMonth: true, expectedAmount: true },
    })
    const months = [...new Set(recs.map(r => r.targetMonth))]
    for (const mon of months) {
      if (lease.checkoutProratedMonth === mon) continue   // 일할 정산 권위 월 — 불변
      const base = { rentAmount: lease.rentAmount, discounts: lease.discounts }
      const before = billForLeaseMonth({ ...base, room: beforeRoom }, mon, null)
      const after  = billForLeaseMonth({ ...base, room: afterRoom }, mon, null)
      if (before === after) continue
      const monthRecs = recs.filter(r => r.targetMonth === mon)
      const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
      if (lockedMax !== before) continue   // 협의 락인 등 기준값과 다른 금액 — 손대지 않음
      const targets = monthRecs.filter(r => r.expectedAmount === lockedMax).map(r => r.id)
      await prisma.paymentRecord.updateMany({ where: { id: { in: targets } }, data: { expectedAmount: after } })
      await recalculatePayments(lease.id, mon, after)
    }
  }
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


// 이 방의 거주 이력 — RoomStay 구간(endDate null = 현재) + 그 구간의 입주자명. 최신 구간이 위.
export async function getRoomStayHistory(roomId: string): Promise<{
  items: { id: string; tenantName: string; startDate: string | null; endDate: string | null }[]
}> {
  const propertyId = await getPropertyId()
  const rows = await prisma.roomStay.findMany({
    // 표시 게이트 — 거주 이력은 실입주 기록만. 문의·투어·예약 단계 lease 의 구간은 데이터 게이트와 별개로 이중 방어(2026-07-28 오더).
    where: { propertyId, roomId, leaseTerm: { status: { notIn: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, startDate: true, endDate: true,
      leaseTerm: { select: { tenant: { select: { name: true } } } },
    },
  })
  return {
    // 시작일이 아직 오지 않은 열린 구간(입주 예정)은 '현재'로 오독되므로 제외.
    items: rows.filter(r => !(r.endDate === null && r.startDate && r.startDate.toISOString().slice(0, 10) > kstYmdStr())).map(r => ({
      id: r.id,
      tenantName: r.leaseTerm?.tenant?.name ?? '—',
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    })),
  }
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


// 고객별 최근 결제수단 — 수납 폼 프리필용(운영자 요청 2026-07-06).
// 특정 고객은 카드/현금을 고정적으로 쓰므로 '기기에서 마지막으로 쓴 방식'(전역)이 아니라
// 그 고객의 직전 기록을 따른다. 기록이 없으면 null(호출부가 기기 최근 → 계좌이체 순 폴백).
export async function getTenantLastPayMethod(tenantId: string): Promise<string | null> {
  const propertyId = await getPropertyId()
  const rec = await prisma.paymentRecord.findFirst({
    where: { tenantId, payMethod: { not: null }, isDeposit: false, leaseTerm: { propertyId } },
    orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }],
    select: { payMethod: true },
  })
  return rec?.payMethod ?? null
}
