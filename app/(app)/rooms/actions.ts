'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { kstYmd } from '@/lib/kstDate'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// ============================================================
type RoomRow = {
  roomId: string; roomNo: string; type: string | null; windowType: string | null
  isVacant: boolean; tenantId: string | null; tenantName: string | null; contact: string | null
  status: string | null; expected: number; dueDay: string | null; currentPaid: number
  carryOver: number; totalPaid: number; balance: number; isPaid: boolean
  leaseTermId: string | null; depositAmount: number; accumulatedUnpaid: number
  isFutureMonth: boolean; baseRent: number; prevTenantName: string | null; prevContact: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | null; prevPaidThisMonth: boolean
  // 첫 미납월 — 누적 미납이 있다면 그 시작월의 dueDay 기준으로 경과일 표시
  firstUnpaidMonth: string | null
}

// 핵심 비즈니스 로직 — GAS의 getRoomPaymentStatus 이관
// ============================================================
export async function getRoomPaymentStatus(targetMonth: string): Promise<RoomRow[]> {
  const propertyId = await getPropertyId()

  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const prevDate  = new Date(yyyy, mm - 2, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

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

  // 조회월 마지막 일 — payDate <= monthEnd인 모든 record를 가져옴
  // (targetMonth 무관 — 미래 월에 귀속된 선납 record도 포함되어야 cash-flow 계산이 일관됨)
  const monthEndForQuery = new Date(yyyy, mm, 0)
  monthEndForQuery.setHours(23, 59, 59, 999)
  const allRecordsThruMonth = await prisma.paymentRecord.findMany({
    where: {
      propertyId,
      isDeposit: false,
      payDate: { lte: monthEndForQuery },
    },
  })

  type LeaseWithOverride = (typeof activeLeases)[number] & {
    overrideDueDay: string | null
    overrideDueDayMonth: string | null
    overrideDueDayReason: string | null
  }

  const buildLeaseRow = (room: typeof rooms[number], lease: LeaseWithOverride, prevTenantName: string | null, prevContact: string | null): RoomRow => {
    const l = lease as LeaseWithOverride
    const expected = lease.rentAmount
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

    if (targetMonth < acqMonthStr) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        windowType: room.windowType ?? null,
        isVacant: false, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected, dueDay: lease.dueDay,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: true,
        leaseTermId: lease.id, depositAmount: lease.depositAmount,
        accumulatedUnpaid: 0, isFutureMonth: false, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
        moveInDate, prevPaidThisMonth: false,
        firstUnpaidMonth: null,
      }
    }

    // ── Cash-flow 기반 누적 계산 (targetMonth 무관, payDate만 사용) ──
    // 회계 귀속월(targetMonth)은 손익 분리에만 쓰이고, 잔액/이월액/총수납은
    // 실제 받은 시점(payDate)으로 계산. 이렇게 하면 4월에 결제한 5월분 record가
    // 4월 보기에서도 5월 보기에서도 일관되게 처리됨.
    const cutoffMonthStr = cutoffDate
      ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
      : acqMonthStr
    const cutoffDay = cutoffDate ? cutoffDate.getDate() : 0
    const acqMonthDueBeforeCutoff = !!(cutoffDate && acqMonthStr === cutoffMonthStr && dueDay < cutoffDay)

    const monthStartDate = new Date(yyyy, mm - 1, 1)
    const monthEndDate = new Date(yyyy, mm, 0)
    monthEndDate.setHours(23, 59, 59, 999)

    const allLeaseRecords = allRecordsThruMonth.filter(p => p.leaseTermId === lease.id)
    // 양도인 몫 (payDate < cutoffDate) — 현 원장 계산에서 제외
    const postCutoffRecords = allLeaseRecords.filter(p => !cutoffDate || new Date(p.payDate) >= cutoffDate)

    // 인수월에 양도인이 받은 금액 / 사용자가 받은 금액 (acqMonthPrePaid 판정용)
    const acqMonthPaidToPrev = cutoffDate
      ? allLeaseRecords
          .filter(p => p.targetMonth === acqMonthStr && new Date(p.payDate) < cutoffDate)
          .reduce((s, p) => s + p.actualAmount, 0)
      : 0
    const acqMonthCurrentOpRecords = postCutoffRecords
      .filter(p => p.targetMonth === acqMonthStr)
      .reduce((s, p) => s + p.actualAmount, 0)
    const acqMonthPrePaid =
      acqMonthPaidToPrev >= expected ||
      (acqMonthDueBeforeCutoff && acqMonthCurrentOpRecords === 0)

    // 청구 가능 월 수: acqMonth부터 viewMonth까지, 양도인 자동 처리 월 제외
    let billableThru = 0
    let billableBefore = 0
    for (let cy = acqYyyy, cmn = acqMm; cy < yyyy || (cy === yyyy && cmn <= mm); ) {
      const ms = `${cy}-${String(cmn).padStart(2, '0')}`
      const skip = ms === acqMonthStr && acqMonthPrePaid
      if (!skip) {
        billableThru++
        if (ms < targetMonth) billableBefore++
      }
      cmn++; if (cmn > 12) { cmn = 1; cy++ }
    }

    // 받은 돈 (payDate 기준 cash-flow)
    const receivedThruMonth = postCutoffRecords.reduce((s, p) => s + p.actualAmount, 0)
    const receivedThisMonth = postCutoffRecords
      .filter(p => new Date(p.payDate) >= monthStartDate && new Date(p.payDate) <= monthEndDate)
      .reduce((s, p) => s + p.actualAmount, 0)
    const receivedBeforeMonth = receivedThruMonth - receivedThisMonth

    const billedThru = billableThru * expected
    const billedBefore = billableBefore * expected

    // 표시 필드
    const cumulativeBalance = receivedThruMonth - billedThru          // 잔액 (누적)
    const displayCarryOver = receivedBeforeMonth - billedBefore       // 이월액 (이전까지 누적)
    const realCurrentPaid = receivedThisMonth                          // 총수납 (이번 달 받은 돈)
    const isPaid = cumulativeBalance >= 0

    // 모달의 "양도인 자동 완납" 플레이스홀더 — 인수월 보기에서 사용자 record 없을 때만
    const prevPaidThisMonth = !!(
      cutoffDate &&
      targetMonth === cutoffMonthStr &&
      acqMonthDueBeforeCutoff &&
      acqMonthCurrentOpRecords === 0
    )

    // 첫 미납월 — 누적 분배: 받은 돈을 acqMonth부터 차례로 채워가며 첫 부족 월 찾기
    let firstUnpaidMonth: string | null = null
    {
      let allocated = 0
      for (let cy = acqYyyy, cmn = acqMm; cy < yyyy || (cy === yyyy && cmn <= mm); ) {
        const ms = `${cy}-${String(cmn).padStart(2, '0')}`
        const skip = ms === acqMonthStr && acqMonthPrePaid
        if (!skip) {
          if (receivedThruMonth - allocated < expected) { firstUnpaidMonth = ms; break }
          allocated += expected
        }
        cmn++; if (cmn > 12) { cmn = 1; cy++ }
      }
    }

    if (isFutureMonth) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        windowType: room.windowType ?? null,
        isVacant: false, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected, dueDay: effectiveDueDay,
        currentPaid: 0, carryOver: displayCarryOver,
        totalPaid: 0, balance: cumulativeBalance,
        isPaid,
        leaseTermId: lease.id, depositAmount: lease.depositAmount,
        accumulatedUnpaid: 0, isFutureMonth: true, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
        moveInDate, prevPaidThisMonth: false,
        firstUnpaidMonth,
      }
    }

    return {
      roomId: room.id, roomNo: room.roomNo, type: room.type,
      windowType: room.windowType ?? null,
      isVacant: false, tenantId: lease.tenant.id,
      tenantName: lease.tenant.name,
      contact: lease.tenant.contacts[0]?.contactValue ?? null,
      status: lease.status, expected, dueDay: overrideIsFullDate ? lease.dueDay : effectiveDueDay,
      currentPaid: realCurrentPaid, carryOver: displayCarryOver,
      totalPaid: realCurrentPaid, balance: cumulativeBalance, isPaid,
      leaseTermId: lease.id, depositAmount: lease.depositAmount,
      accumulatedUnpaid: 0, isFutureMonth: false, baseRent: room.baseRent,
      prevTenantName, prevContact,
      overrideDueDay: l.overrideDueDay ?? null,
      overrideDueDayMonth: l.overrideDueDayMonth ?? null,
      overrideDueDayReason: l.overrideDueDayReason ?? null,
      moveInDate, prevPaidThisMonth,
      firstUnpaidMonth,
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
        windowType: room.windowType ?? null,
        isVacant: true, tenantId: null, tenantName: null,
        contact: null, status: null, expected: 0, dueDay: null,
        currentPaid: 0, carryOver: 0, totalPaid: 0,
        balance: 0, isPaid: false, leaseTermId: null,
        depositAmount: 0, accumulatedUnpaid: 0, isFutureMonth,
        baseRent: room.baseRent,
        prevTenantName: prev?.tenant.name ?? null,
        prevContact: prev?.tenant.contacts[0]?.contactValue ?? null,
        overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null,
        moveInDate: null, prevPaidThisMonth: false,
        firstUnpaidMonth: null,
      }]
    }

    const rows = []
    if (primaryLease) rows.push(buildLeaseRow(room, primaryLease as LeaseWithOverride, null, null))
    if (nonResidentLease) rows.push(buildLeaseRow(room, nonResidentLease as LeaseWithOverride, null, null))
    return rows
  })
}

// 수납 등록 — 과납분은 재귀적으로 다음달 records로 분배 저장
// (한 record의 actualAmount는 절대 expectedAmount를 초과하지 않음)
export async function savePayment(data: {
  leaseTermId: string
  tenantId:    string
  targetMonth: string
  expectedAmount: number
  actualAmount:   number
  payDate:     string
  payMethod:   string
  memo?:       string
}) {
  await requireEdit()
  const propertyId = await getPropertyId()

  let remaining = data.actualAmount
  let currentTm = data.targetMonth
  let isOriginalMonth = true
  const touchedMonths: string[] = []

  // 안전장치: 최대 24개월까지만 분배 (무한루프 방지)
  let safety = 24
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
        : `${data.targetMonth} 과납 이월${data.memo ? ` · ${data.memo}` : ''}`
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
  data: { actualAmount: number; payDate: string; payMethod: string; memo?: string }
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

    await prisma.paymentRecord.update({
      where: { id: paymentId },
      data: {
        actualAmount: data.actualAmount,
        payDate:      new Date(data.payDate),
        payMethod:    data.payMethod,
        memo:         data.memo || null,
      },
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
export async function getTenantLeaseForDashboard(tenantId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  return prisma.leaseTerm.findFirst({
    where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
    select: {
      id: true,
      rentAmount: true,
      depositAmount: true,
      dueDay: true,
      paymentTiming: true,
      overrideDueDay: true,
      overrideDueDayMonth: true,
      room: { select: { roomNo: true } },
      tenant: { select: { id: true, name: true } },
      property: { select: { acquisitionDate: true, prevOwnerCutoffDate: true } },
    },
    orderBy: { createdAt: 'desc' },
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

export async function getPaymentsByLease(leaseTermId: string, targetMonth: string) {
  const propertyId = await getPropertyId()
  const [records, property] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { leaseTermId, targetMonth },
      orderBy: { seqNo: 'asc' },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { acquisitionDate: true, prevOwnerCutoffDate: true },
    }),
  ])
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  return { records, acquisitionDate: cutoff }
}