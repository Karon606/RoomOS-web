'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireEdit } from '@/lib/role'
import { kstYmd } from '@/lib/kstDate'
import { FIFO_MAX_ALLOCATE_MONTHS } from '@/lib/appConfig'
import { discountedRent } from '@/lib/rentDiscount'

async function getPropertyId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// ============================================================
type RoomRow = {
  roomId: string; roomNo: string; type: string | null; floor: string | null; windowType: string | null; direction: string | null
  isVacant: boolean; tenantId: string | null; tenantName: string | null; contact: string | null
  status: string | null; expected: number; dueDay: string | null; currentPaid: number
  carryOver: number; totalPaid: number; balance: number; isPaid: boolean
  leaseTermId: string | null; depositAmount: number; cleaningFee: number; accumulatedUnpaid: number
  isFutureMonth: boolean; baseRent: number; prevTenantName: string | null; prevContact: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | null; prevPaidThisMonth: boolean
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
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const acquisitionDate = property?.acquisitionDate ?? null
  // 양도인 귀속 기준일 — 별도 설정 없으면 인수일과 동일
  const cutoffDate: Date | null = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate)
    : acquisitionDate ? new Date(acquisitionDate) : null


  const rooms = await prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
  })

  const activeLeases = await prisma.leaseTerm.findMany({
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
  })

  // 공실 방의 직전 입주자 (CHECKED_OUT, moveOutDate 최신순)
  const prevLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: { in: ['CHECKED_OUT', 'CANCELLED'] } },
    orderBy: { moveOutDate: 'desc' },
    include: {
      tenant: {
        include: { contacts: { where: { isPrimary: true }, take: 1 } },
      },
    },
  })

  // 발생주의(귀속월) 모델:
  // - 잔액/이월액/총수납/firstUnpaidMonth/매출 → targetMonth 기준
  //   (4/30 dueDay인데 5/1 입금 + targetMonth=4월 → 4월 페이지에서 완납으로 인식)
  // - 지연납부 라벨(latePaidAt)만 payDate를 보조로 사용
  // 인수일 이전 양도인 record는 별도 처리. [납입일변경] 메모는 payDate에 무관하게 항상 조회되어야 함.
  const allRecordsThruMonth = await prisma.paymentRecord.findMany({
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
  })

  type LeaseWithOverride = (typeof activeLeases)[number] & {
    overrideDueDay: string | null
    overrideDueDayMonth: string | null
    overrideDueDayReason: string | null
  }

  const buildLeaseRow = (room: typeof rooms[number], lease: LeaseWithOverride, prevTenantName: string | null, prevContact: string | null): RoomRow => {
    const l = lease as LeaseWithOverride
    // #14 월세 할인 — 그 달 청구액 = rentAmount - 할인(월별). 단위테스트된 lib/rentDiscount 헬퍼 사용.
    const leaseDiscounts = (lease as { discounts?: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[] }).discounts ?? []
    const expected = discountedRent(leaseDiscounts, targetMonth, lease.rentAmount)
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
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: 'RESERVED', expected: lease.rentAmount, dueDay: lease.dueDay,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: true,
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
      }
    }

    if (targetMonth < acqMonthStr) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
        isVacant: false, tenantId: lease.tenant.id,
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
    const billForMonth = (ms: string): number => {
      const locked = lockedExpectedByMonth.get(ms)
      return locked && locked > 0 ? locked : discountedRent(leaseDiscounts, ms, lease.rentAmount)
    }

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
    const loopStartYyyy = useLeaseStart ? lsYyyy   : acqYyyy
    const loopStartMm   = useLeaseStart ? lsMm     : acqMm

    let pastBillable = 0
    let billedBeforeSum = 0   // #14 과거월 청구 합 — 월별 할인 반영(곱셈 대신 합산)
    for (let cy = loopStartYyyy, cmn = loopStartMm; cy < yyyy || (cy === yyyy && cmn < mm); ) {
      const ms = `${cy}-${String(cmn).padStart(2, '0')}`
      const skip = (ms === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(ms)
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
    // 선납 모델: dueDay = 다음 서비스 기간 시작점. CHECKOUT_PENDING + expectedMoveOut ≤ dueDay이면
    // 그 dueDay분 서비스를 사용하지 않으므로 납부 의무 없음 (502호: 5/6 dueDay지만 5/6 이전 퇴실)
    const checkoutNoBilling = !!(
      lease.status === 'CHECKOUT_PENDING' &&
      lease.expectedMoveOut &&
      _viewDueDate &&
      new Date(lease.expectedMoveOut).getTime() <= _viewDueDate.getTime()
    )
    // viewMonth 청구액 (인수월 양도인 처리 / 미래월 / 퇴실 무청구이면 0)
    const skipViewMonthBilled = (targetMonth === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(targetMonth) || isFutureMonth || checkoutNoBilling
    const viewBilled = skipViewMonthBilled ? 0 : expected
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
        const skip = (ms === acqMonthStr && acqMonthPrePaid) || prevOwnerMonths.has(ms)
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
        .filter(p => p.targetMonth === targetMonth && new Date(p.payDate) > dueDate)
        .map(p => new Date(p.payDate))
      if (lateRecords.length > 0) {
        const latest = new Date(Math.max(...lateRecords.map(d => d.getTime())))
        latePaidAt = `${latest.getFullYear()}-${String(latest.getMonth() + 1).padStart(2, '0')}-${String(latest.getDate()).padStart(2, '0')}`
      }
    }

    // 실제 최근 납부일 — 현 원장(postCutoff) record 중 가장 늦은 payDate
    const lastPayDate: string | null = (() => {
      if (postCutoffRecords.length === 0) return null
      const latest = new Date(Math.max(...postCutoffRecords.map(p => new Date(p.payDate).getTime())))
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
        isVacant: false, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected, dueDay: effectiveDueDay,
        currentPaid: 0, carryOver: displayCarryOver,
        totalPaid: 0, balance: cumulativeBalance,
        isPaid,
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
      }
    }

    return {
      roomId: room.id, roomNo: room.roomNo, type: room.type,
      floor: room.floor ?? null, windowType: room.windowType ?? null, direction: room.direction ?? null,
      isVacant: false, tenantId: lease.tenant.id,
      tenantName: lease.tenant.name,
      contact: lease.tenant.contacts[0]?.contactValue ?? null,
      status: lease.status, expected, dueDay: overrideIsFullDate ? lease.dueDay : effectiveDueDay,
      currentPaid: realCurrentPaid, carryOver: displayCarryOver,
      totalPaid: realCurrentPaid, balance: cumulativeBalance, isPaid,
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
        isVacant: true, tenantId: null, tenantName: null,
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
  expectedAmount: number,
  viewMonth: string,
): Promise<string> {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      moveInDate: true,
      dueDay: true,
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
      select: { actualAmount: true, payDate: true, isPrevOwner: true },
    })

    // 양도인 정산 월은 미수월 후보에서 제외
    if (records.some(r => r.isPrevOwner)) { cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue }

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
      if (totalPaid >= expectedAmount || acqMonthAutoPaid) {
        cmn++; if (cmn > 12) { cmn = 1; cy++ }
        continue
      }
      if (totalPaid < expectedAmount) return ms
    } else {
      // 일반 월: 모든 record 합산 (양도인 record는 인수월에만 발생하므로 여긴 영향 없음)
      const received = records.reduce((s, r) => s + r.actualAmount, 0)
      if (received < expectedAmount) return ms
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
}): Promise<SavePaymentResult> {
  await requireEdit()
  const propertyId = await getPropertyId()

  let remaining = data.actualAmount
  // forcedTargetMonth 명시 시 FIFO 우회, 아니면 가장 오래된 미수월부터 시작
  let currentTm = data.forcedTargetMonth
    ? data.forcedTargetMonth
    : await findFirstUnpaidMonth(data.leaseTermId, data.expectedAmount, data.targetMonth)
  const startTm = currentTm
  let isOriginalMonth = true
  const touchedMonths: string[] = []
  const allocations: { targetMonth: string; amount: number }[] = []

  // 안전장치: 무한루프 방지 — appConfig.FIFO_MAX_ALLOCATE_MONTHS (60개월 = 5년)
  let safety = FIFO_MAX_ALLOCATE_MONTHS
  while (remaining > 0 && safety-- > 0) {
    const existing = await prisma.paymentRecord.aggregate({
      where: { leaseTermId: data.leaseTermId, targetMonth: currentTm, isDeposit: false },
      _sum:  { actualAmount: true },
    })
    const alreadyPaid      = existing._sum.actualAmount ?? 0
    const remainingThisMon = Math.max(0, data.expectedAmount - alreadyPaid)
    const portion          = Math.min(remaining, remainingThisMon)

    // portion이 0이어도 원본 월에 한 번은 record를 남겨야 0원 입력이 흔적 남음
    // (이 케이스는 원본 월이 이미 완납인 상태에서 추가 입력한 경우 — 다음 달로 이월)
    if (portion > 0 || (isOriginalMonth && remaining === 0)) {
      const seqNo = await prisma.paymentRecord.count({
        where: { leaseTermId: data.leaseTermId, targetMonth: currentTm },
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
          expectedAmount: data.expectedAmount,
          actualAmount:   portion,
          payDate:        new Date(data.payDate),
          payMethod:      data.payMethod,
          memo,
          seqNo:          seqNo + 1,
          isPaid:         false,
          carryOver:      0,
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

  // 영향받은 모든 월에 대해 isPaid 재계산
  for (const tm of touchedMonths) {
    await recalculatePayments(data.leaseTermId, tm, data.expectedAmount)
  }

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

  // 모든 record 합산 by targetMonth
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false },
    select: { targetMonth: true, actualAmount: true, payDate: true, isPrevOwner: true },
  })
  const prevOwnerMonths = new Set(records.filter(r => r.isPrevOwner).map(r => r.targetMonth))
  const paidByMonth: Record<string, number> = {}
  for (const r of records) {
    if (r.isPrevOwner) continue
    if (cutoffDate && new Date(r.payDate) < cutoffDate) continue
    paidByMonth[r.targetMonth] = (paidByMonth[r.targetMonth] ?? 0) + r.actualAmount
  }

  const expected = lease.rentAmount
  const out: TargetMonthOption[] = []
  let cy = startY, cmn = startM
  while (cy < endY || (cy === endY && cmn <= endM)) {
    const ms = `${cy}-${String(cmn).padStart(2, '0')}`
    if (prevOwnerMonths.has(ms)) { cmn++; if (cmn > 12) { cmn = 1; cy++ }; continue }
    const paid = paidByMonth[ms] ?? 0
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

  const seqNo = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth } })
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
}) {
  await requireEdit()
  const propertyId = await getPropertyId()

  const existingCount = await prisma.paymentRecord.count({
    where: { leaseTermId: data.leaseTermId, targetMonth: data.targetMonth },
  })

  await prisma.paymentRecord.create({
    data: {
      leaseTermId:    data.leaseTermId,
      tenantId:       data.tenantId,
      propertyId,
      targetMonth:    data.targetMonth,
      expectedAmount: data.depositAmount,
      actualAmount:   data.depositAmount,
      payDate:        new Date(data.payDate),
      payMethod:      data.payMethod,
      memo:           data.memo ?? '보증금',
      seqNo:          existingCount + 1,
      isPaid:         false,
      isDeposit:      true,
      carryOver:      0,
    },
  })

  const excess = data.totalPaid - data.depositAmount
  if (excess > 0) {
    await prisma.paymentRecord.create({
      data: {
        leaseTermId:    data.leaseTermId,
        tenantId:       data.tenantId,
        propertyId,
        targetMonth:    data.targetMonth,
        expectedAmount: data.rentAmount,
        actualAmount:   excess,
        payDate:        new Date(data.payDate),
        payMethod:      data.payMethod,
        memo:           null,
        seqNo:          existingCount + 2,
        isPaid:         false,
        carryOver:      0,
      },
    })
  }

  await recalculatePayments(data.leaseTermId, data.targetMonth, data.rentAmount)
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

  const existingCount = await prisma.paymentRecord.count({ where: { leaseTermId, targetMonth } })
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
  data: { actualAmount: number; payDate: string; payMethod: string; memo?: string; targetMonth?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const record = await prisma.paymentRecord.findUnique({
      where: { id: paymentId },
      select: { leaseTermId: true, targetMonth: true, isDeposit: true },
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
      ? (await prisma.paymentRecord.count({ where: { leaseTermId: record.leaseTermId, targetMonth: newTargetMonth } })) + 1
      : undefined

    await prisma.paymentRecord.update({
      where: { id: paymentId },
      data: {
        actualAmount: data.actualAmount,
        payDate:      new Date(data.payDate),
        payMethod:    data.payMethod,
        memo:         data.memo || null,
        ...(targetMonthChanged ? { targetMonth: newTargetMonth, seqNo: newSeqNo } : {}),
      },
    })

    if (lease) {
      await recalculatePayments(record.leaseTermId, record.targetMonth, lease.rentAmount)
      if (targetMonthChanged) {
        await recalculatePayments(record.leaseTermId, newTargetMonth, lease.rentAmount)
      }
    }
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 수납 기록 삭제
export async function deletePayment(paymentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const record = await prisma.paymentRecord.findUnique({
      where: { id: paymentId },
      select: { leaseTermId: true, targetMonth: true },
    })
    if (!record) return { ok: false, error: '수납 기록을 찾을 수 없습니다.' }

    await prisma.paymentRecord.delete({ where: { id: paymentId } })

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: record.leaseTermId },
      select: { rentAmount: true },
    })
    if (lease) {
      await recalculatePayments(record.leaseTermId, record.targetMonth, lease.rentAmount)
    }
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
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
      id: true, name: true, englishName: true,
      gender: true, nationality: true, job: true,
      birthdate: true, isBasicRecipient: true, memo: true,
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
          rentAmount: true, depositAmount: true, cleaningFee: true,
          dueDay: true, paymentTiming: true,
          moveInDate: true, moveOutDate: true, expectedMoveOut: true, inquiryAt: true,
          registrationStatus: true, payMethod: true, cashReceipt: true,
          visitRoute: true, wishRooms: true, wishConditions: true, contractUrl: true,
          room: { select: { id: true, roomNo: true } },
          paymentRecords: {
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
  const allRows = await getRoomPaymentStatus(targetMonth)
  const found = allRows.find(r => r.leaseTermId === leaseTermId)
  if (found) return found

  // 활성 lease가 아니면 (CHECKED_OUT / CANCELLED) — 퇴실자의 과거 수납 내역 조회용 fallback.
  // getRoomPaymentStatus는 활성 lease만 가져오므로 여기서 직접 lease 정보를 구성한다.
  // 입력·할인·납부일 위젯이 의존하는 필드는 모두 채우되, 새로운 수납이 의미 없는 상태이므로
  // expected/balance/firstUnpaidMonth 등은 0/false/null로 둔다.
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
  if (!['CHECKED_OUT', 'CANCELLED'].includes(lease.status)) return null

  return {
    roomId: lease.roomId ?? '',
    roomNo: lease.room?.roomNo ?? '',
    type: lease.room?.type ?? null,
    floor: lease.room?.floor ?? null,
    windowType: lease.room?.windowType ?? null,
    direction: lease.room?.direction ?? null,
    isVacant: false,
    tenantId: lease.tenant.id,
    tenantName: lease.tenant.name,
    contact: lease.tenant.contacts[0]?.contactValue ?? null,
    status: lease.status,
    expected: 0,
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
  else if (lease.status === 'RESERVED')         status = { label: '예약',     badge: { tone: 'movein', label: '입실 예정' } }
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
  return { records, acquisitionDate: cutoff, lastPayMethod: lastWithMethod?.payMethod ?? null }
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
    // 본인 영업장 lease 확인
    const lease = await prisma.leaseTerm.findFirst({ where: { id: data.leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    if (!(data.value > 0)) return { ok: false, error: '할인 값은 0보다 커야 합니다.' }
    if (data.discountType === 'percent' && data.value > 100) return { ok: false, error: '퍼센트 할인은 100%를 넘을 수 없습니다.' }
    if (data.scope === 'temporary' && !data.startMonth) return { ok: false, error: '일시 할인은 시작 월이 필요합니다.' }
    await prisma.rentDiscount.create({
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
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
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
    const d = await prisma.rentDiscount.findUnique({ where: { id }, select: { leaseTerm: { select: { propertyId: true } } } })
    if (!d || d.leaseTerm.propertyId !== propertyId) return { ok: false, error: '할인을 찾을 수 없습니다.' }
    await prisma.rentDiscount.delete({ where: { id } })
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
// 이 방에 배정된 지출(누적) — 방 상세 'ㅇ방 지출' 섹션용.
export async function getRoomExpenses(roomId: string): Promise<{
  total: number
  items: { id: string; date: string; category: string; amount: number; vendor: string | null; memo: string | null }[]
}> {
  const propertyId = await getPropertyId()
  const rows = await prisma.expense.findMany({
    where: { propertyId, roomId },
    orderBy: { date: 'desc' },
    select: { id: true, date: true, category: true, amount: true, vendor: true, memo: true },
  })
  return {
    total: rows.reduce((s, r) => s + r.amount, 0),
    items: rows.map(r => ({ id: r.id, date: r.date.toISOString().slice(0, 10), category: r.category, amount: r.amount, vendor: r.vendor, memo: r.memo })),
  }
}
