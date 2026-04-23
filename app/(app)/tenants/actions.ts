'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { LeaseStatus, ContactType, Gender, PaymentTiming, RegistrationStatus } from '@prisma/client'
import { requireEdit } from '@/lib/role'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { user, propertyId }
}

// 입주자 목록 조회
export async function getTenants() {
  const { propertyId } = await getPropertyId()

  return prisma.tenant.findMany({
    where: { propertyId },
    include: {
      contacts: true,
      leaseTerms: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          room: { select: { id: true, roomNo: true } },
          paymentRecords: {
            orderBy: { targetMonth: 'desc' },
            take: 12,
            select: {
              id: true, targetMonth: true,
              expectedAmount: true, actualAmount: true,
              isPaid: true, payDate: true, payMethod: true, memo: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

// 호실 목록 (입주자 등록/수정 시 선택용)
export async function getRoomsForSelect() {
  const { propertyId } = await getPropertyId()
  return prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
    select: { id: true, roomNo: true, baseRent: true, isVacant: true, type: true, windowType: true, direction: true },
  })
}

// 입주자 추가
export async function addTenant(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const roomId           = formData.get('roomId') as string
  const status           = (formData.get('status') as LeaseStatus) || 'ACTIVE'
  const rentAmount       = Number(formData.get('rentAmount')) || 0
  const depositAmount    = Number(formData.get('depositAmount')) || 0
  const cleaningFee      = Number(formData.get('cleaningFee')) || 0
  const dueDay           = formData.get('dueDay') as string
  const moveInDate       = formData.get('moveInDate') as string
  const expectedMoveOut  = formData.get('expectedMoveOut') as string
  const paymentTiming    = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const contactType      = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue     = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact = formData.get('emergencyContact') as string
  const memo             = formData.get('memo') as string
  const nationality      = formData.get('nationality') as string
  const gender           = (formData.get('gender') as Gender) || 'UNKNOWN'
  const job              = formData.get('job') as string
  // LeaseTerm extras
  const payMethod           = formData.get('payMethod') as string
  const cashReceipt         = formData.get('cashReceipt') as string
  const registrationStatus  = (formData.get('registrationStatus') as RegistrationStatus) || 'NOT_REPORTED'
  const contractUrl         = formData.get('contractUrl') as string
  const wishRooms           = formData.get('wishRooms') as string
  const visitRoute          = formData.get('visitRoute') as string

  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  if (!roomId) return { ok: false, error: '호실을 선택해주세요.' }

  // NON_RESIDENT(명의만)와 실거주자(ACTIVE/RESERVED/CHECKOUT_PENDING)는 같은 방에 공존 가능
  const existingLeases = await prisma.leaseTerm.findMany({
    where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: { status: true },
  })
  const hasActiveResident = existingLeases.some(l => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(l.status))
  const hasNonResident    = existingLeases.some(l => l.status === 'NON_RESIDENT')
  const incomingIsResident = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(status)
  const incomingIsNonResident = status === 'NON_RESIDENT'

  if (incomingIsResident && hasActiveResident) return { ok: false, error: '해당 호실에 이미 거주 중인 입주자가 있습니다.' }
  if (incomingIsNonResident && hasNonResident) return { ok: false, error: '해당 호실에 이미 비거주자(명의)가 등록되어 있습니다.' }
  if (!incomingIsResident && !incomingIsNonResident && existingLeases.length > 0) return { ok: false, error: '해당 호실에 이미 입주자가 있습니다.' }

  const contactsToCreate: {
    contactType: ContactType; contactValue: string; isPrimary: boolean;
    isEmergency: boolean; emergencyRelation?: string
  }[] = []
  if (contactValue) {
    contactsToCreate.push({ contactType, contactValue, isPrimary: true, isEmergency: false })
  }
  if (emergencyContact) {
    contactsToCreate.push({
      contactType: 'PHONE',
      contactValue: emergencyContact,
      isPrimary: false,
      isEmergency: true,
      emergencyRelation: emergencyRelation || undefined,
    })
  }

  const tenant = await prisma.tenant.create({
    data: {
      propertyId,
      name: name.trim(),
      englishName: englishName || null,
      birthdate: birthdate ? new Date(birthdate) : null,
      isBasicRecipient,
      memo: memo || null,
      nationality: nationality || null,
      gender,
      job: job || null,
      leaseTerms: {
        create: {
          propertyId,
          roomId,
          status,
          rentAmount,
          depositAmount,
          cleaningFee,
          dueDay: dueDay || null,
          moveInDate: moveInDate ? new Date(moveInDate) : null,
          expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null,
          paymentTiming,
          payMethod: payMethod || null,
          cashReceipt: cashReceipt || null,
          registrationStatus,
          contractUrl: contractUrl || null,
          wishRooms: wishRooms || null,
          visitRoute: visitRoute || null,
        },
      },
      contacts: contactsToCreate.length > 0 ? { create: contactsToCreate } : undefined,
    },
  })

  if (['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(status)) {
    await prisma.room.update({ where: { id: roomId }, data: { isVacant: false } })
  }
  // NON_RESIDENT는 isVacant에 영향 없음

  await prisma.tenantStatusLog.create({
    data: { tenantId: tenant.id, fromStatus: 'RESERVED', toStatus: status, propertyId },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 수정
export async function updateTenant(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId, user } = await getPropertyId()

  const tenantId    = formData.get('tenantId') as string
  const leaseTermId = formData.get('leaseTermId') as string

  // 입주자 기본 정보
  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const memo             = formData.get('memo') as string
  const nationality      = formData.get('nationality') as string
  const gender           = (formData.get('gender') as Gender) || 'UNKNOWN'
  const job              = formData.get('job') as string

  // 연락처
  const contactType       = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue      = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact  = formData.get('emergencyContact') as string

  // 계약 정보
  const roomId             = formData.get('roomId') as string
  const status             = formData.get('status') as LeaseStatus
  const rentAmount         = Number(formData.get('rentAmount')) || 0
  const depositAmount      = Number(formData.get('depositAmount')) || 0
  const cleaningFee        = Number(formData.get('cleaningFee')) || 0
  const dueDay             = formData.get('dueDay') as string
  const moveInDate         = formData.get('moveInDate') as string
  const expectedMoveOut    = formData.get('expectedMoveOut') as string
  const paymentTiming      = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const payMethod          = formData.get('payMethod') as string
  const cashReceipt        = formData.get('cashReceipt') as string
  const registrationStatus = (formData.get('registrationStatus') as RegistrationStatus) || 'NOT_REPORTED'
  const contractUrl        = formData.get('contractUrl') as string
  const wishRooms          = formData.get('wishRooms') as string
  const visitRoute         = formData.get('visitRoute') as string

  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }

  const currentLease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, status: true },
  })
  if (!currentLease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  const prevRoomId = currentLease.roomId
  const prevStatus = currentLease.status
  const newRoomId  = roomId || prevRoomId

  // 입주자 정보 수정
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: name.trim(),
      englishName: englishName || null,
      birthdate: birthdate ? new Date(birthdate) : null,
      isBasicRecipient,
      memo: memo || null,
      nationality: nationality || null,
      gender,
      job: job || null,
    },
  })

  // 주 연락처 수정
  if (contactValue) {
    const existing = await prisma.tenantContact.findFirst({
      where: { tenantId, isPrimary: true },
    })
    if (existing) {
      await prisma.tenantContact.update({
        where: { id: existing.id },
        data: { contactType, contactValue },
      })
    } else {
      await prisma.tenantContact.create({
        data: { tenantId, contactType, contactValue, isPrimary: true, isEmergency: false },
      })
    }
  }

  // 비상 연락처 수정
  const existingEmergency = await prisma.tenantContact.findFirst({
    where: { tenantId, isEmergency: true },
  })
  if (emergencyContact) {
    if (existingEmergency) {
      await prisma.tenantContact.update({
        where: { id: existingEmergency.id },
        data: {
          contactType: 'PHONE',
          contactValue: emergencyContact,
          emergencyRelation: emergencyRelation || null,
        },
      })
    } else {
      await prisma.tenantContact.create({
        data: {
          tenantId,
          contactType: 'PHONE',
          contactValue: emergencyContact,
          isPrimary: false,
          isEmergency: true,
          emergencyRelation: emergencyRelation || null,
        },
      })
    }
  } else if (existingEmergency) {
    await prisma.tenantContact.delete({ where: { id: existingEmergency.id } })
  }

  // 계약 수정
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: {
      status,
      rentAmount,
      depositAmount,
      cleaningFee,
      dueDay: dueDay || null,
      moveInDate: moveInDate ? new Date(moveInDate) : null,
      expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null,
      paymentTiming,
      roomId: newRoomId,
      payMethod: payMethod || null,
      cashReceipt: cashReceipt || null,
      registrationStatus,
      contractUrl: contractUrl || null,
      // 호실이 실제로 바뀌면 희망 호실 초기화 (이미 이동했으므로 의미 없음)
      wishRooms: (newRoomId !== prevRoomId && !['CHECKED_OUT', 'CANCELLED'].includes(status)) ? null : (wishRooms || null),
      visitRoute: visitRoute || null,
    },
  })

  // 호실 공실 상태 업데이트 (NON_RESIDENT는 isVacant에 영향 없음)
  const isActiveStatus  = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(status)
  const wasActiveStatus = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(prevStatus)

  const hasOtherActiveInRoom = async (roomId: string, excludeLeaseTermId: string) => {
    const count = await prisma.leaseTerm.count({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] }, id: { not: excludeLeaseTermId } },
    })
    return count > 0
  }

  if (newRoomId !== prevRoomId && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
  }

  if (isActiveStatus && newRoomId) {
    await prisma.room.update({ where: { id: newRoomId }, data: { isVacant: false } })
  } else if (!isActiveStatus && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
  }

  if (status !== prevStatus) {
    await prisma.tenantStatusLog.create({
      data: {
        tenantId,
        leaseTermId,
        propertyId,
        fromStatus: prevStatus,
        toStatus:   status,
        changedById: user.id,
      },
    })
  }

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입실 처리 (입실예정 → 거주중)
export async function moveInTenant(leaseTermId: string, tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId, user } = await getPropertyId()

  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, status: true },
  })
  if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: { status: 'ACTIVE' },
  })

  await prisma.room.update({
    where: { id: lease.roomId },
    data: { isVacant: false },
  })

  await prisma.tenantStatusLog.create({
    data: {
      tenantId,
      leaseTermId,
      propertyId,
      fromStatus:  lease.status,
      toStatus:    'ACTIVE',
      changedById: user.id,
    },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 처리
export async function checkoutTenant(leaseTermId: string, tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, status: true },
  })
  if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: { status: 'CHECKED_OUT', moveOutDate: new Date() },
  })

  // [Trigger A] 퇴실 완료 시 예약된 가격이 있으면 baseRent에 적용하고 예약 필드 초기화
  const room = await prisma.room.findUnique({
    where: { id: lease.roomId },
    select: { scheduledRent: true },
  })
  await prisma.room.update({
    where: { id: lease.roomId },
    data: {
      isVacant: true,
      ...(room?.scheduledRent != null && {
        baseRent:      room.scheduledRent,
        scheduledRent: null,
        rentUpdateDate: null,
      }),
    },
  })

  await prisma.tenantStatusLog.create({
    data: {
      tenantId,
      leaseTermId,
      fromStatus: lease.status,
      toStatus:   'CHECKED_OUT',
      propertyId,
    },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// Gemini 수납 분석
export async function analyzeTenantWithGemini(tenantId: string): Promise<string> {
  await getPropertyId()

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      leaseTerms: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          room: { select: { roomNo: true } },
          paymentRecords: {
            orderBy: { targetMonth: 'asc' },
            select: {
              targetMonth: true, expectedAmount: true, actualAmount: true,
              isPaid: true, payDate: true, payMethod: true,
            },
          },
        },
      },
    },
  })

  if (!tenant) return '[오류] 입주자를 찾을 수 없습니다.'

  const lease = tenant.leaseTerms[0]
  const payments = lease?.paymentRecords ?? []
  const totalExpected = payments.reduce((s, p) => s + p.expectedAmount, 0)
  const totalPaid     = payments.reduce((s, p) => s + p.actualAmount, 0)
  const paidCount     = payments.filter(p => p.isPaid).length
  const unpaid        = totalExpected - totalPaid

  const paymentLines = payments.map(p => {
    const diff = p.isPaid && p.payDate
      ? (() => {
          const [y, m] = p.targetMonth.split('-').map(Number)
          const dueDay = lease?.dueDay
          const dueDayNum = dueDay?.includes('말') ? new Date(y, m, 0).getDate() : parseInt(dueDay?.replace(/[^0-9]/g, '') || '1')
          const dueDate = new Date(y, m - 1, dueDayNum)
          const paid = new Date(p.payDate)
          const diffDays = Math.round((paid.getTime() - dueDate.getTime()) / 86400000)
          return diffDays <= 0 ? `${Math.abs(diffDays)}일 조기` : `${diffDays}일 지연`
        })()
      : null
    return `  - ${p.targetMonth}: 예정 ${p.expectedAmount.toLocaleString()}원, 납부 ${p.actualAmount.toLocaleString()}원 (${p.isPaid ? `완납${diff ? ` / ${diff}` : ''}` : '미납'})`
  }).join('\n')

  const prompt = `당신은 공간 대여 관리 전문 AI입니다. 아래 입주자의 수납 데이터를 분석하고 한국어로 3~5문장으로 수납 패턴, 건전성, 관리 제안을 알려주세요.

[입주자 정보]
- 이름: ${tenant.name}, 호실: ${lease?.room.roomNo ?? '미지정'}호
- 월 이용료: ${lease?.rentAmount.toLocaleString() ?? '—'}원, 납부일: ${lease?.dueDay ?? '미지정'}
- 입주일: ${lease?.moveInDate ? new Date(lease.moveInDate).toLocaleDateString('ko-KR') : '—'}

[수납 이력 (${payments.length}건)]
${paymentLines || '  수납 기록 없음'}

[통계]
- 완납: ${paidCount}/${payments.length}개월
- 총 납부액: ${totalPaid.toLocaleString()}원
- 미납 잔액: ${Math.max(0, unpaid).toLocaleString()}원

분석 결과를 실용적이고 구체적으로 작성해주세요.`

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return '[오류] Gemini API 키가 설정되지 않았습니다.'

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  )

  if (!res.ok) return `[오류] Gemini API 응답 실패 (${res.status})`
  const json = await res.json()
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'AI 분석 결과를 가져올 수 없습니다.'
}

// 입주자 삭제
export async function deleteTenant(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()

    // 활성 계약이 있으면 해당 호실을 공실로 전환 (단, 다른 입주자/비거주자가 남아있으면 제외)
    const activeLeases = await prisma.leaseTerm.findMany({
      where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { roomId: true },
    })
    for (const { roomId } of activeLeases) {
      const remaining = await prisma.leaseTerm.findFirst({
        where: { roomId, tenantId: { not: tenantId }, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      })
      if (!remaining) {
        await prisma.room.update({ where: { id: roomId }, data: { isVacant: true } })
      }
    }

    await prisma.tenant.delete({ where: { id: tenantId } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 입주자 요청사항 ──────────────────────────────────────────────

export async function getTenantRequests(tenantId: string) {
  await getPropertyId()
  return prisma.tenantRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, content: true, requestDate: true,
      targetDate: true, resolvedAt: true, createdAt: true,
      tenant: { select: { name: true } },
    },
  })
}

export async function createTenantRequest(data: {
  tenantId: string
  content: string
  requestDate: string
  targetDate: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!data.content.trim()) return { ok: false, error: '내용을 입력해주세요.' }
    await prisma.tenantRequest.create({
      data: {
        tenantId:    data.tenantId,
        propertyId,
        content:     data.content.trim(),
        requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
        targetDate:  data.targetDate  ? new Date(data.targetDate)  : null,
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function resolveTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.update({
      where: { id },
      data: { resolvedAt: new Date() },
    })
    revalidatePath('/tenants')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 납입일 영구 변경 + 일할 조정 기록 생성
export async function changeDueDay(
  leaseTermId: string,
  newDueDay: string,
  targetMonth: string,
  adjustAmount: number, // 양수 = 과입금(환불), 음수 = 추가납부 필요
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: { dueDay: true, rentAmount: true, tenantId: true },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { dueDay: newDueDay.trim() },
    })

    if (adjustAmount !== 0) {
      const maxSeq = await prisma.paymentRecord.aggregate({
        where: { leaseTermId, targetMonth },
        _max: { seqNo: true },
      })
      const seqNo = (maxSeq._max.seqNo ?? 0) + 1
      const isRefund = adjustAmount > 0
      const absAmt = Math.abs(adjustAmount)
      const typeLabel = isRefund ? '과입금' : '추가납부'

      await prisma.paymentRecord.create({
        data: {
          leaseTermId,
          tenantId:      lease.tenantId,
          propertyId,
          targetMonth,
          expectedAmount: 0,
          actualAmount:   adjustAmount,
          isPaid:         isRefund,
          payDate:        new Date(),
          seqNo,
          memo: `[납입일변경] ${lease.dueDay ?? '?'}일→${newDueDay} 변경, 일할 ${absAmt.toLocaleString()}원 (${typeLabel})`,
        },
      })
    }

    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.delete({ where: { id } })
    revalidatePath('/tenants')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입실 예정 → 거주중 자동 전환 (입주일 도래 시)
export async function autoTransitionReserved() {
  try {
    const { propertyId } = await getPropertyId()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const dueLeases = await prisma.leaseTerm.findMany({
      where: { propertyId, status: 'RESERVED', moveInDate: { lte: today } },
      select: { id: true, roomId: true, tenantId: true },
    })
    if (dueLeases.length === 0) return

    for (const lease of dueLeases) {
      await prisma.leaseTerm.update({ where: { id: lease.id }, data: { status: 'ACTIVE' } })
      await prisma.room.update({ where: { id: lease.roomId }, data: { isVacant: false } })
      await prisma.tenantStatusLog.create({
        data: { tenantId: lease.tenantId, leaseTermId: lease.id, propertyId, fromStatus: 'RESERVED', toStatus: 'ACTIVE' },
      })
    }
    revalidatePath('/tenants')
    revalidatePath('/rooms')
  } catch {
    // 페이지 로드 중 호출되므로 실패해도 무시
  }
}
