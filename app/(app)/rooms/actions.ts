'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'

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
}

// 핵심 비즈니스 로직 — GAS의 getRoomPaymentStatus 이관
// ============================================================
export async function getRoomPaymentStatus(targetMonth: string): Promise<RoomRow[]> {
  const propertyId = await getPropertyId()

  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const prevDate  = new Date(yyyy, mm - 2, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  // 조회 시점 필터 — 미래 월은 미납 표시 안 함
  const now          = new Date()
  const isFutureMonth = new Date(yyyy, mm - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1)

  // 영업장 인수 날짜 조회
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true },
  })
  const acquisitionDate = property?.acquisitionDate ?? null
  console.log('[DEBUG] acquisitionDate:', acquisitionDate, 'acqMonth:', acquisitionDate ? `${new Date(acquisitionDate).getFullYear()}-${String(new Date(acquisitionDate).getMonth()+1).padStart(2,'0')}` : null, 'targetMonth:', targetMonth)

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

  const payments = await prisma.paymentRecord.findMany({ where: { propertyId, targetMonth } })

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

  // 인수일부터 전월까지 전체 수납 이력 (누적 잔액 계산용)
  const acqMonthForQuery = acquisitionDate
    ? `${new Date(acquisitionDate).getFullYear()}-${String(new Date(acquisitionDate).getMonth() + 1).padStart(2, '0')}`
    : '2000-01'
  const allPrevPayments = await prisma.paymentRecord.findMany({
    where: {
      propertyId,
      targetMonth: { gte: acqMonthForQuery, lt: targetMonth },
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
    const dueDay = effectiveDueDay ? Number(effectiveDueDay) : 1

    const acqDate     = acquisitionDate ? new Date(acquisitionDate) : null
    const acqDay      = acqDate ? acqDate.getDate() : 1
    const acqYyyy     = acqDate ? acqDate.getFullYear() : 2000
    const acqMm       = acqDate ? acqDate.getMonth() + 1 : 1
    const acqMonthStr = `${acqYyyy}-${String(acqMm).padStart(2, '0')}`

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
      }
    }

    const isDueBefore = dueDay < acqDay
    const prevOperatorPortion = 0
    const allPrevPaidForCurrentOp = allPrevPayments
      .filter(p => p.leaseTermId === lease.id)
      .reduce((s, p) => s + p.actualAmount, 0) - prevOperatorPortion

    const [prevYyyy2, prevMm2] = prevMonth.split('-').map(Number)
    let prevMonthsOwed = (prevYyyy2 - acqYyyy) * 12 + (prevMm2 - acqMm) + 1
    if (isDueBefore) prevMonthsOwed -= 1
    prevMonthsOwed = Math.max(0, prevMonthsOwed)

    const carryBalance = allPrevPaidForCurrentOp - expected * prevMonthsOwed

    if (isFutureMonth) {
      return {
        roomId: room.id, roomNo: room.roomNo, type: room.type,
        windowType: room.windowType ?? null,
        isVacant: false, tenantId: lease.tenant.id,
        tenantName: lease.tenant.name,
        contact: lease.tenant.contacts[0]?.contactValue ?? null,
        status: lease.status, expected, dueDay: effectiveDueDay,
        currentPaid: 0, carryOver: carryBalance,
        totalPaid: 0, balance: carryBalance,
        isPaid: carryBalance >= 0,
        leaseTermId: lease.id, depositAmount: lease.depositAmount,
        accumulatedUnpaid: 0, isFutureMonth: true, baseRent: room.baseRent,
        prevTenantName, prevContact,
        overrideDueDay: l.overrideDueDay ?? null,
        overrideDueDayMonth: l.overrideDueDayMonth ?? null,
        overrideDueDayReason: l.overrideDueDayReason ?? null,
      }
    }

    const currentPaidRaw = payments
      .filter(p => p.leaseTermId === lease.id)
      .reduce((s, p) => s + p.actualAmount, 0)
    const displayBalance = currentPaidRaw - expected
    const isPaid = currentPaidRaw >= expected

    return {
      roomId: room.id, roomNo: room.roomNo, type: room.type,
      windowType: room.windowType ?? null,
      isVacant: false, tenantId: lease.tenant.id,
      tenantName: lease.tenant.name,
      contact: lease.tenant.contacts[0]?.contactValue ?? null,
      status: lease.status, expected, dueDay: effectiveDueDay,
      currentPaid: currentPaidRaw, carryOver: carryBalance,
      totalPaid: currentPaidRaw, balance: displayBalance, isPaid,
      leaseTermId: lease.id, depositAmount: lease.depositAmount,
      accumulatedUnpaid: 0, isFutureMonth: false, baseRent: room.baseRent,
      prevTenantName, prevContact,
      overrideDueDay: l.overrideDueDay ?? null,
      overrideDueDayMonth: l.overrideDueDayMonth ?? null,
      overrideDueDayReason: l.overrideDueDayReason ?? null,
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
      }]
    }

    const rows = []
    if (primaryLease) rows.push(buildLeaseRow(room, primaryLease as LeaseWithOverride, null, null))
    if (nonResidentLease) rows.push(buildLeaseRow(room, nonResidentLease as LeaseWithOverride, null, null))
    return rows
  })
}

// 수납 등록
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
  // 같은 달 기존 수납 수 (회차 계산)
  const existingCount = await prisma.paymentRecord.count({
    where: {
      leaseTermId: data.leaseTermId,
      targetMonth: data.targetMonth,
    },
  })

  await prisma.paymentRecord.create({
    data: {
      leaseTermId:    data.leaseTermId,
      tenantId:       data.tenantId,
      propertyId,
      targetMonth:    data.targetMonth,
      expectedAmount: data.expectedAmount,
      actualAmount:   data.actualAmount,
      payDate:        new Date(data.payDate),
      payMethod:      data.payMethod,
      memo:           data.memo ?? null,
      seqNo:          existingCount + 1,
      isPaid:         false, // recalculate 후 업데이트
      carryOver:      0,
    },
  })

  // 완납 여부 재계산
  await recalculatePayments(data.leaseTermId, data.targetMonth, data.expectedAmount)
}

// 수납 재계산 — GAS의 recalculatePayments 이관
async function recalculatePayments(
  leaseTermId: string,
  targetMonth: string,
  expectedAmount: number
) {
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth },
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
}

export async function clearDueDayOverride(leaseTermId: string) {
  await requireEdit()
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: { overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null },
  })
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/tenants')
}

// 수납 내역 조회
export async function getPaymentsByLease(leaseTermId: string, targetMonth: string) {
  return prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth },
    orderBy: { seqNo: 'asc' },
  })
}