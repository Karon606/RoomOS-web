'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { LeaseStatus, ContactType, Gender, PaymentTiming, RegistrationStatus, Prisma } from '@prisma/client'
import { requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { recordDepositReceived, reanchorReservationPrepaid } from '@/app/(app)/rooms/actions'
import { discountedRent } from '@/lib/rentDiscount'
import { calcCheckoutProration, calcCheckoutRefund, clampPenaltyPct, type CheckoutProrationResult, type CheckoutRefundResult, type RefundMode } from '@/lib/prorate'
import { parseShortStayPolicy, calcShortStay, stayDaysOf, type ShortStayPolicy } from '@/lib/shortStay'

async function getPropertyId() {
  const { userId, propertyId, role } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId, role }
}

// 입주자 목록 조회
export async function getTenants() {
  const { propertyId, role } = await getPropertyId()

  const tenants = await prisma.tenant.findMany({
    where: { propertyId },
    include: {
      contacts: true,
      leaseTerms: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          room: { select: { id: true, roomNo: true, floor: true } },
          // 취소 단계 부제(어느 단계에서 취소됐나) — 최근 CANCELLED 전이의 fromStatus·사유(e1b81629)
          statusLogs: {
            where: { toStatus: 'CANCELLED' },
            orderBy: { changedAt: 'desc' },
            take: 1,
            select: { fromStatus: true, reason: true },
          },
          paymentRecords: {
            where: { deletedAt: null },
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

  // 금액 읽기 차단(제한 스태프) — 응답 payload에서 이용료·보증금·청소비 제거. 조회 전용 경로라 결제 수식 무관.
  if (!canReadScope(role, 'money')) {
    for (const t of tenants) {
      for (const lt of t.leaseTerms) {
        ;(lt as { rentAmount: number | null }).rentAmount = null
        ;(lt as { depositAmount: number | null }).depositAmount = null
        ;(lt as { cleaningFee: number | null }).cleaningFee = null
      }
    }
  }
  return tenants
}

// 호실 목록 (입주자 등록/수정 시 선택용)
export async function getRoomsForSelect() {
  const { propertyId } = await getPropertyId()
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
    select: {
      id: true, roomNo: true, baseRent: true, scheduledRent: true, nonResidentRent: true, isVacant: true, type: true, floor: true, windowType: true, direction: true, noMoveInReport: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'] } },
        select: { status: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  return rooms.map(({ leaseTerms, ...r }) => ({
    ...r,
    currentLeaseStatus: (leaseTerms[0]?.status ?? null) as string | null,
  }))
}

// 입주자 추가
export async function addTenant(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const email            = formData.get('email') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const smoking = formData.get('smoking') === 'true'
  const roomId           = formData.get('roomId') as string
  const status           = (formData.get('status') as LeaseStatus) || 'ACTIVE'
  const rentAmount       = Number(formData.get('rentAmount')) || 0
  const depositAmount    = Number(formData.get('depositAmount')) || 0
  const cleaningFee      = Number(formData.get('cleaningFee')) || 0
  const dueDay           = formData.get('dueDay') as string
  const moveInDate       = formData.get('moveInDate') as string
  const expectedMoveOut  = formData.get('expectedMoveOut') as string
  const contactAlertDate = formData.get('contactAlertDate') as string | null
  const paymentTiming    = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const contactType      = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue     = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact = formData.get('emergencyContact') as string
  const homeCountryContact = formData.get('homeCountryContact') as string
  const homeCountryCode    = formData.get('homeCountryCode') as string
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
  const wishConditions      = formData.get('wishConditions') as string
  const keepAlertAfterInquiry = formData.get('keepAlertAfterInquiry') === 'true'
  const visitRoute          = formData.get('visitRoute') as string
  const tourDate            = formData.get('tourDate') as string
  const tourTime            = formData.get('tourTime') as string   // 'HH:MM' 또는 ''
  const inquiryAt           = formData.get('inquiryAt') as string
  const reservationConfirmed = formData.get('reservationConfirmed') === 'true'
  const isShortTerm          = formData.get('isShortTerm') === 'true'
  const depositReceived      = formData.get('depositReceived') === '1'

  const isReservedConfirmed = status === 'RESERVED' && reservationConfirmed
  const roomOptionalStatuses = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'] as string[]
  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  if (!roomId && !roomOptionalStatuses.includes(status)) return { ok: false, error: '호실을 선택해주세요.' }
  if (isReservedConfirmed) {
    if (!roomId) return { ok: false, error: '예약 확정 시 호실은 필수입니다.' }
    if (!rentAmount) return { ok: false, error: '예약 확정 시 월 이용료는 필수입니다.' }
    if (!moveInDate) return { ok: false, error: '예약 확정 시 입주 희망일은 필수입니다.' }
  }
  // 청구 발생 상태(unpaid.ts unpaidLeasesRaw 필터와 동일: ACTIVE·CHECKOUT_PENDING·NON_RESIDENT + rentAmount>0)로
  // 저장할 땐 입주일 필수. 비우면 leaseStartMonth가 인수 컷오프월로 앵커되어 과거월이 한꺼번에 미납으로 잡힌다.
  if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(status) && rentAmount > 0 && !moveInDate) {
    return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
  }

  // NON_RESIDENT(명의만)와 실거주자(ACTIVE/RESERVED/CHECKOUT_PENDING)는 같은 방에 공존 가능
  const existingLeases = roomId ? await prisma.leaseTerm.findMany({
    where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: { status: true },
  }) : []
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
    isHomeCountry?: boolean; countryCode?: string | null
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
  if (homeCountryContact) {
    contactsToCreate.push({
      contactType: 'PHONE',
      contactValue: homeCountryContact,
      isPrimary: false,
      isEmergency: false,
      isHomeCountry: true,
      countryCode: homeCountryCode || null,
    })
  }

  const tenant = await prisma.tenant.create({
    data: {
      propertyId,
      name: name.trim(),
      englishName: englishName || null,
      email: email || null,
      birthdate: birthdate ? new Date(birthdate) : null,
      isBasicRecipient,
      smoking,
      memo: memo || null,
      nationality: nationality || null,
      gender,
      job: job || null,
      leaseTerms: {
        create: {
          propertyId,
          roomId: roomId || null,
          status,
          rentAmount,
          depositAmount,
          cleaningFee,
          dueDay: dueDay || null,
          moveInDate: moveInDate ? new Date(moveInDate) : null,
          expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null,
          contactAlertDate: contactAlertDate ? new Date(contactAlertDate) : null,
          tourDate: tourDate ? new Date(tourDate) : null,
          tourTime: tourDate && tourTime ? tourTime : null,   // 날짜 없으면 시간도 무의미
          inquiryAt: inquiryAt ? new Date(inquiryAt) : null,
          reservationConfirmedAt: isReservedConfirmed ? new Date() : null,
          isShortTerm,
          paymentTiming,
          payMethod: payMethod || null,
          cashReceipt: cashReceipt || null,
          registrationStatus,
          contractUrl: contractUrl || null,
          wishRooms: wishRooms || null,
          wishConditions: wishConditions || null,
          keepAlertAfterInquiry,
          visitRoute: visitRoute || null,
        },
      },
      contacts: contactsToCreate.length > 0 ? { create: contactsToCreate } : undefined,
    },
  })

  if (['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(status) && roomId) {
    await prisma.room.update({ where: { id: roomId }, data: { isVacant: false } })
  }
  // NON_RESIDENT, WAITING_TOUR, TOUR_DONE는 isVacant에 영향 없음

  await prisma.tenantStatusLog.create({
    data: { tenantId: tenant.id, fromStatus: 'RESERVED', toStatus: status, propertyId },
  })

  // 보증금 '받음' 체크 시 실수납 record 생성 (예약 확정·신규 입주 시 보증금 수납 기록)
  if (depositReceived && depositAmount > 0) {
    const lease = await prisma.leaseTerm.findFirst({
      where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' }, select: { id: true },
    })
    if (lease) { try { await recordDepositReceived(lease.id) } catch { /* 이미 기록됨 등은 무시 */ } }
  }

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 수정
export async function updateTenant(formData: FormData): Promise<{ ok: true; notice?: string } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId, user } = await getPropertyId()

  const tenantId    = formData.get('tenantId') as string
  const leaseTermId = formData.get('leaseTermId') as string

  // 입주자 기본 정보
  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const email            = formData.get('email') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const smoking = formData.get('smoking') === 'true'
  const memo             = formData.get('memo') as string
  const nationality      = formData.get('nationality') as string
  const gender           = (formData.get('gender') as Gender) || 'UNKNOWN'
  const job              = formData.get('job') as string

  // 연락처
  const contactType       = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue      = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact  = formData.get('emergencyContact') as string
  const homeCountryContact = formData.get('homeCountryContact') as string
  const homeCountryCode    = formData.get('homeCountryCode') as string

  // 계약 정보
  const roomId             = formData.get('roomId') as string
  const status             = formData.get('status') as LeaseStatus
  const rentAmount         = Number(formData.get('rentAmount')) || 0
  const depositAmount      = Number(formData.get('depositAmount')) || 0
  const cleaningFee        = Number(formData.get('cleaningFee')) || 0
  const dueDay             = formData.get('dueDay') as string
  const moveInDate         = formData.get('moveInDate') as string
  const expectedMoveOut    = formData.get('expectedMoveOut') as string | null   // null = 폼에 필드 없음(보존, tourDate/inquiryAt 관행)
  const contactAlertDate   = formData.get('contactAlertDate') as string | null
  const paymentTiming      = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const payMethod          = formData.get('payMethod') as string
  const cashReceipt        = formData.get('cashReceipt') as string
  const registrationStatus = (formData.get('registrationStatus') as RegistrationStatus) || 'NOT_REPORTED'
  const contractUrl        = formData.get('contractUrl') as string
  const wishRooms          = formData.get('wishRooms') as string
  const wishConditions     = formData.get('wishConditions') as string
  const keepAlertAfterInquiry = formData.get('keepAlertAfterInquiry') === 'true'
  const visitRoute         = formData.get('visitRoute') as string
  const tourDate           = formData.get('tourDate') as string | null   // null = 폼에 필드 없음(보존)
  const tourTime           = formData.get('tourTime') as string | null   // null = 폼에 필드 없음(보존)
  const inquiryAt          = formData.get('inquiryAt') as string | null  // null = 폼에 필드 없음(보존)
  const reservationConfirmed = formData.get('reservationConfirmed') === 'true'
  const isShortTerm          = formData.get('isShortTerm') === 'true'
  const depositReceived      = formData.get('depositReceived') === '1'
  const applyScheduledRent = formData.get('applyScheduledRent') as string  // '1' = 즉시 적용, '0' = 보류, 비어있음 = 처리 안함

  const isReservedConfirmed = status === 'RESERVED' && reservationConfirmed
  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  if (isReservedConfirmed) {
    // 호실은 '수정' 시엔 비워둘 수 있게 허용 — 만실에서 입실예정 둘이 방을 맞바꿀 때
    // 잠시 '미지정'으로 파킹했다가 서로의 방으로 재지정하기 위함(새 기능 없이). 신규 등록(addTenant)은 그대로 필수.
    if (!rentAmount) return { ok: false, error: '예약 확정 시 월 이용료는 필수입니다.' }
    if (!moveInDate) return { ok: false, error: '예약 확정 시 입주 희망일은 필수입니다.' }
  }
  // 청구 발생 상태(unpaid.ts unpaidLeasesRaw 필터와 동일: ACTIVE·CHECKOUT_PENDING·NON_RESIDENT + rentAmount>0)로
  // 저장/전환할 땐 입주일 필수. 비우면 leaseStartMonth가 인수 컷오프월로 앵커되어 과거월이 미납으로 잡힌다.
  if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(status) && rentAmount > 0 && !moveInDate) {
    return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
  }

  const currentLease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      roomId: true, status: true, reservationConfirmedAt: true,
      // 퇴실 일할 정산 일관 유지용 — 폼으로 퇴실일/납부일 변경 시 재계산·해제·자동적용 판단
      expectedMoveOut: true, dueDay: true, moveInDate: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  if (!currentLease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  const prevRoomId = currentLease.roomId
  const prevStatus = currentLease.status
  const newRoomId  = roomId || prevRoomId

  // 퇴실 일할 정산 일관 유지 — 편집 폼 경로도 전환 버튼(applyStatusTransition)과 동일 정책.
  // 정산이 적용된 상태에서 퇴실일만 바꾸면 옛 날짜 기준 일할이 잔존하던 문제의 수정.
  const prevMoveOutIso = currentLease.expectedMoveOut ? new Date(currentLease.expectedMoveOut).toISOString().slice(0, 10) : null
  // 신고 aae0ab38: 폼에 퇴실일 필드가 렌더되지 않으면(=null) 이 저장은 퇴실일을 편집하지 않는 것 —
  // 기존값을 '변경 없음'으로 간주해 정산 재계산·초기화가 헛트리거되지 않게 한다.
  const moveOutFieldPresent = expectedMoveOut !== null
  const newMoveOutIso  = moveOutFieldPresent ? (expectedMoveOut || null) : prevMoveOutIso
  let prorationPatch: Record<string, unknown> = {}
  let prorationNotice: string | null = null
  if (status === 'ACTIVE' && prevStatus === 'CHECKOUT_PENDING' && currentLease.checkoutProratedAmount != null) {
    // 거주중 복귀 — 적용돼 있던 퇴실예정일·정산·스냅샷 정리 (전환 버튼과 동일)
    prorationPatch = { expectedMoveOut: null, checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull }
    prorationNotice = '거주중 복귀. 퇴실 예정일과 적용돼 있던 퇴실 일할 정산을 해제했습니다.'
  } else if (newMoveOutIso !== prevMoveOutIso || (dueDay || null) !== (currentLease.dueDay ?? null)) {
    // 퇴실일/납부일이 바뀐 경우에만 — 적용 중이면 재계산, 미적용+퇴실예정이면 자동 적용.
    // (변동 없는 저장은 이 블록을 안 타므로 수동 조정 금액이 보존됨)
    const pr = prorationDataForChange(
      {
        status: prevStatus,
        expectedMoveOut: currentLease.expectedMoveOut,
        rentAmount,
        moveInDate: moveInDate ? moveInDate : currentLease.moveInDate,   // 폼 입력 우선(같이 바뀔 수 있음)
        checkoutProratedAmount: currentLease.checkoutProratedAmount,
        checkoutProratedMonth: currentLease.checkoutProratedMonth,
        checkoutProrationUndo: currentLease.checkoutProrationUndo,
        discounts: currentLease.discounts,
      },
      dueDay || null, newMoveOutIso,
      status === 'CHECKOUT_PENDING',   // 퇴실 예정 상태로 저장할 때만 자동 적용
    )
    prorationPatch = pr.data
    prorationNotice = pr.notice
  }

  // 입주자 정보 수정
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: name.trim(),
      englishName: englishName || null,
      email: email || null,
      birthdate: birthdate ? new Date(birthdate) : null,
      isBasicRecipient,
      smoking,
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

  // 본국 연락처 (외국인 입주자) — upsert
  const existingHome = await prisma.tenantContact.findFirst({
    where: { tenantId, isHomeCountry: true },
  })
  if (homeCountryContact) {
    if (existingHome) {
      await prisma.tenantContact.update({
        where: { id: existingHome.id },
        data: {
          contactType: 'PHONE',
          contactValue: homeCountryContact,
          countryCode: homeCountryCode || null,
        },
      })
    } else {
      await prisma.tenantContact.create({
        data: {
          tenantId,
          contactType: 'PHONE',
          contactValue: homeCountryContact,
          isPrimary: false,
          isEmergency: false,
          isHomeCountry: true,
          countryCode: homeCountryCode || null,
        },
      })
    }
  } else if (existingHome) {
    await prisma.tenantContact.delete({ where: { id: existingHome.id } })
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
      // 신고 aae0ab38: 폼에 퇴실일 필드가 없으면(null) 기존 값 보존 — 예약확정 단기 예약자의 퇴실 예정일 증발 방지.
      // 렌더됐지만 비운 경우('')만 의도적 삭제로 처리(tourDate/inquiryAt 관행).
      ...(moveOutFieldPresent ? { expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null } : {}),
      // 퇴실일이 바뀌면 단기 자동 전환 기록을 리셋 — 연장 후 새 퇴실일 하루 전 재전환(재무장)
      ...(moveOutFieldPresent && ((expectedMoveOut ? new Date(expectedMoveOut).getTime() : null) !== (currentLease.expectedMoveOut?.getTime() ?? null)) ? { autoCheckoutAt: null } : {}),
      contactAlertDate: contactAlertDate ? new Date(contactAlertDate) : null,
      // 폼에 필드가 렌더되지 않은 상태(get()===null)면 기존 값 보존 — 상태 전환이 이력을 지우지 않게.
      // 렌더됐지만 비운 경우('')만 의도적 삭제로 처리.
      ...(tourDate === null ? {} : { tourDate: tourDate ? new Date(tourDate) : null }),
      ...(tourTime === null && tourDate === null ? {} : { tourTime: (tourDate ?? '') && (tourTime ?? '') ? tourTime : null }),
      ...(inquiryAt === null ? {} : { inquiryAt: inquiryAt ? new Date(inquiryAt) : null }),
      reservationConfirmedAt: isReservedConfirmed
        ? (currentLease.reservationConfirmedAt ?? new Date())
        : null,
      isShortTerm,
      paymentTiming,
      roomId: newRoomId ?? null,
      payMethod: payMethod || null,
      cashReceipt: cashReceipt || null,
      registrationStatus,
      contractUrl: contractUrl || null,
      // 호실이 실제로 바뀌면 희망 호실/조건 모두 초기화 (이미 이동했으므로 의미 없음 — 잔여 "{}"가 대시보드에 오탐되던 것 방지)
      wishRooms:      (newRoomId !== prevRoomId && !['CHECKED_OUT', 'CANCELLED'].includes(status)) ? null : (wishRooms || null),
      wishConditions: (newRoomId !== prevRoomId && !['CHECKED_OUT', 'CANCELLED'].includes(status)) ? null : (wishConditions || null),
      keepAlertAfterInquiry,
      visitRoute: visitRoute || null,
      // 퇴실 일할 정산 패치 — 위 expectedMoveOut 값을 덮어쓸 수 있음(거주중 복귀 시 null 등)
      ...prorationPatch,
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

  // 거주중→공실 전환 판정 (scheduledRent 즉시 적용 처리에 사용)
  let vacatedRoomId: string | null = null

  if (newRoomId !== prevRoomId && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) {
      await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
      vacatedRoomId = prevRoomId
    }
  }

  if (isActiveStatus && newRoomId) {
    await prisma.room.update({ where: { id: newRoomId }, data: { isVacant: false } })
  } else if (!isActiveStatus && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) {
      await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
      vacatedRoomId = prevRoomId
    }
  }

  // 거주중→공실 변경 + 호실에 예정 가격 보유 + 사용자가 즉시 적용 선택 시 baseRent 갱신
  if (vacatedRoomId && applyScheduledRent === '1') {
    const room = await prisma.room.findUnique({
      where: { id: vacatedRoomId },
      select: { scheduledRent: true },
    })
    if (room?.scheduledRent != null) {
      await prisma.room.update({
        where: { id: vacatedRoomId },
        data: {
          baseRent:       room.scheduledRent,
          scheduledRent:  null,
          rentUpdateDate: null,
        },
      })
    }
  }

  if (status !== prevStatus) {
    await prisma.tenantStatusLog.create({
      data: {
        tenantId,
        leaseTermId,
        propertyId,
        fromStatus: prevStatus,
        toStatus:   status,
        changedById: user.sub,
      },
    })
  }

  // 보증금 '받음' 체크 시 실수납 record 생성 (미기록분만 채움 — 이미 기록됐으면 무시)
  if (depositReceived && depositAmount > 0) {
    try { await recordDepositReceived(leaseTermId) } catch { /* 이미 기록됨 등은 무시 */ }
  }

  revalidatePath('/tenants')
  revalidatePath('/rooms')
  revalidatePath('/dashboard')
  revalidatePath('/room-manage')
  return prorationNotice ? { ok: true, notice: prorationNotice } : { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 시 보증금 환불 처리:
// 1. DepositRefund 레코드 생성 (반환액 + 미반환액 양쪽 모두 명시 기록)
// 2. 미반환분이 있으면 ExtraIncome(category='보증금', payMethod='보유 보증금')도 생성
//    → 매출 인식 + '보유 보증금' KPI에서 차감 효과
// leaseTermId / tenantId는 환불 이력 추적·표시를 위해 필수
export async function recordDepositReturn(params: {
  leaseTermId: string
  tenantId: string
  depositAmount: number
  returnedAmount: number
  date: string
  tenantName: string
  reason?: string
  memo?: string
  // 신고 9b974be0: 부가수익 detail 문구 분기. 기본은 퇴실, 'reservationCancel'은 예약 취소 몰취.
  context?: 'checkout' | 'reservationCancel'
}): Promise<{ ok: true; refundId: string; extraIncomeId: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!params.leaseTermId || !params.tenantId) return { ok: false, error: '계약/입주자 정보가 누락되었습니다.' }

    const returned  = Math.max(0, Math.min(params.returnedAmount, params.depositAmount))
    const withheld  = Math.max(0, params.depositAmount - returned)
    const refundDate = new Date(params.date)

    // 환불 이력 — 반환·미반환 양쪽 합쳐 한 건으로 기록
    const refund = await prisma.depositRefund.create({
      data: {
        propertyId,
        tenantId:       params.tenantId,
        leaseTermId:    params.leaseTermId,
        date:           refundDate,
        returnedAmount: returned,
        withheldAmount: withheld,
        reason:         params.reason || null,
        memo:           params.memo || null,
      },
    })

    let extraIncomeId: string | null = null
    if (withheld > 0) {
      // 몰취 성격에 따라 카테고리 — 예약 취소 몰취는 위약금(익금), 퇴실 미반환분은 보증금 계정.
      // 세무 자료에서 반환의무 있는 예수보증금(부채)과 실현 위약금 수익이 섞이지 않게(회계 패널 권고).
      const forfeitCategory = params.context === 'reservationCancel' ? '위약금' : '보증금'
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { incomeCategories: true },
      })
      const raw = (property as any)?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
      const cats = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (!cats.includes(forfeitCategory)) {
        await prisma.property.update({
          where: { id: propertyId },
          data: { incomeCategories: [...cats, forfeitCategory].join(',') } as any,
        })
      }

      const inc = await prisma.extraIncome.create({
        data: {
          propertyId,
          date:      refundDate,
          amount:    withheld,
          category:  forfeitCategory,
          detail:    params.context === 'reservationCancel'
            ? `${params.tenantName} 예약 취소 · 예약금 몰취`
            : `${params.tenantName} 퇴실 · 보증금 미반환분`,
          payMethod: '보유 보증금',
          // 입주자 연결 — 수납관리 부가수익에서 누구 건인지 바로 확인
          tenantId:    params.tenantId,
          leaseTermId: params.leaseTermId,
        },
      })
      extraIncomeId = inc.id
    }
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true, refundId: refund.id, extraIncomeId }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 보증금 반환 기록 적용취소 — 반환 이력 + 미반환분 부가수입을 함께 삭제(감사 2026-07-10: 되돌리기 전무 보완)
export async function undoDepositReturn(refundId: string, extraIncomeId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      prisma.depositRefund.deleteMany({ where: { id: refundId, propertyId } }),
      ...(extraIncomeId ? [prisma.extraIncome.deleteMany({ where: { id: extraIncomeId, propertyId } })] : []),
    ])
    revalidatePath('/finance'); revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 신고 9b974be0: 실수납 보증금 합 조회(읽기 전용) — 예약 취소 시 반환·몰취 기준 금액.
// 계약 보증금(lease.depositAmount)이 아니라 실제 받은 예약금(PaymentRecord isDeposit=true 실수납 합)이
// 기준이어야 유령 매출이 안 잡힌다. 소프트삭제는 aggregate 확장으로 자동 필터(where에 deletedAt 금지).
export async function getReceivedDepositTotal(leaseTermId: string): Promise<number> {
  const { propertyId } = await getPropertyId()
  const agg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, propertyId, isDeposit: true },
    _sum: { actualAmount: true },
  })
  return agg._sum.actualAmount ?? 0
}

// prepaid 모드 예약 취소 기준액 — 그 lease의 이용료 선납 실수납 합(isDeposit=false).
// 계약 보증금이 아니라 실제 받은 선납이 반환·몰취 기준. 소프트삭제는 aggregate 확장이 자동 필터(where에 deletedAt 금지).
export async function getReservedPrepaidTotal(leaseTermId: string): Promise<number> {
  const { propertyId } = await getPropertyId()
  const agg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, propertyId, isDeposit: false },
    _sum: { actualAmount: true },
  })
  return agg._sum.actualAmount ?? 0
}

// prepaid 모드 예약 취소 — 이용료 선납 반환/몰취.
//   반환: 선납 record 전량 소프트삭제(매출 자동 소멸).
//   몰취: 소프트삭제 + 몰취분을 ExtraIncome(category '위약금')로 재인식.
// record 소프트삭제와 ExtraIncome 생성을 한 트랜잭션으로 강제해 이중 계상을 차단한다.
export async function recordReservationPrepaidCancel(params: {
  leaseTermId: string
  tenantId: string
  refundAmount: number
  date: string
  tenantName: string
}): Promise<{ ok: true; recordIds: string[]; extraIncomeId: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!params.leaseTermId || !params.tenantId) return { ok: false, error: '계약/입주자 정보가 누락되었습니다.' }

    const records = await prisma.paymentRecord.findMany({
      where: { leaseTermId: params.leaseTermId, propertyId, isDeposit: false },
      select: { id: true, actualAmount: true },
    })
    const total = records.reduce((s, r) => s + r.actualAmount, 0)
    const returned = Math.max(0, Math.min(params.refundAmount, total))
    const withheld = Math.max(0, total - returned)
    const recordIds = records.map(r => r.id)
    const forfeitDate = new Date(params.date)
    const deletedAt = new Date()

    // 몰취분이 있으면 '위약금' 카테고리 보장(없으면 추가) — 트랜잭션 밖 선처리.
    if (withheld > 0) {
      const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { incomeCategories: true } })
      const raw = property?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
      const cats = raw.split(',').map(s => s.trim()).filter(Boolean)
      if (!cats.includes('위약금')) {
        await prisma.property.update({ where: { id: propertyId }, data: { incomeCategories: [...cats, '위약금'].join(',') } })
      }
    }

    const extraIncomeId = await prisma.$transaction(async tx => {
      if (recordIds.length > 0) {
        await tx.paymentRecord.updateMany({ where: { id: { in: recordIds } }, data: { deletedAt } })
      }
      if (withheld > 0) {
        const inc = await tx.extraIncome.create({
          data: {
            propertyId,
            date:      forfeitDate,
            amount:    withheld,
            category:  '위약금',
            detail:    `${params.tenantName} 예약 취소 · 이용료 선납 위약금`,
            payMethod: '예약금 몰취',
            tenantId:    params.tenantId,
            leaseTermId: params.leaseTermId,
          },
        })
        return inc.id as string
      }
      return null
    })

    revalidatePath('/finance'); revalidatePath('/dashboard'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true, recordIds, extraIncomeId }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// prepaid 예약 취소 적용취소 — 소프트삭제한 선납 record 복원 + 몰취 부가수입 삭제(대칭).
export async function undoReservationPrepaidCancel(recordIds: string[], extraIncomeId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      ...(recordIds.length > 0 ? [prisma.paymentRecord.updateMany({ where: { id: { in: recordIds }, propertyId }, data: { deletedAt: null } })] : []),
      ...(extraIncomeId ? [prisma.extraIncome.deleteMany({ where: { id: extraIncomeId, propertyId } })] : []),
    ])
    revalidatePath('/finance'); revalidatePath('/dashboard'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 처리 + 보증금 환불 한 번에
export async function checkoutWithDepositRefund(params: {
  leaseTermId: string
  tenantId: string
  refundAmount: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: params.leaseTermId },
      select: { depositAmount: true, tenant: { select: { name: true } } },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    const checkoutRes = await checkoutTenant(params.leaseTermId, params.tenantId)
    if (!checkoutRes.ok) return checkoutRes

    if (lease.depositAmount > 0) {
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const refundRes = await recordDepositReturn({
        leaseTermId:    params.leaseTermId,
        tenantId:       params.tenantId,
        depositAmount:  lease.depositAmount,
        returnedAmount: Math.max(0, Math.min(params.refundAmount, lease.depositAmount)),
        date:           dateStr,
        tenantName:     lease.tenant.name,
      })
      if (!refundRes.ok) return refundRes
    }
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

  // 입주월 재앵커 — prepaid 예약금이 실제 입주월과 다른 달에 걸려 있으면 이동(deposit/none은 no-op).
  if (lease.status === 'RESERVED') await reanchorReservationPrepaid(leaseTermId)

  if (lease.roomId) {
    await prisma.room.update({
      where: { id: lease.roomId },
      data: { isVacant: false },
    })
  }

  await prisma.tenantStatusLog.create({
    data: {
      tenantId,
      leaseTermId,
      propertyId,
      fromStatus:  lease.status,
      toStatus:    'ACTIVE',
      changedById: user.sub,
    },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 예약 확정 → 거주중 전환 (대시보드 알림에서 사용). 호실이 공실이 아니면 거부.
export async function confirmReservationToActive(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        id: true, status: true, tenantId: true, roomId: true, reservationConfirmedAt: true,
        rentAmount: true, moveInDate: true,
        room: { select: { id: true, roomNo: true, isVacant: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    if (lease.status !== 'RESERVED' || !lease.reservationConfirmedAt) {
      return { ok: false, error: '예약 확정 상태가 아닙니다.' }
    }
    if (!lease.roomId || !lease.room) return { ok: false, error: '확정된 호실 정보가 없습니다.' }

    // 백스톱 — ACTIVE(청구 상태)로 확정하는데 rentAmount>0 이면서 moveInDate가 비면 거부.
    // "확정예약은 moveInDate 있다"는 불변식에만 의존하지 않고 최종 저장값을 직접 검증한다.
    if (lease.rentAmount > 0 && !lease.moveInDate) {
      return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
    }

    // 호실이 공실이 아니면 차단 (다른 거주자가 있는지 확인 — 본인 lease 제외)
    if (!lease.room.isVacant) {
      const others = await prisma.leaseTerm.findMany({
        where: {
          roomId: lease.roomId,
          id: { not: leaseTermId },
          status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] },
        },
        select: { status: true },
      })
      if (others.some(o => o.status === 'ACTIVE')) {
        return { ok: false, error: `${lease.room.roomNo}호는 아직 거주 중인 입주자가 있습니다.` }
      }
      if (others.some(o => o.status === 'CHECKOUT_PENDING')) {
        return { ok: false, error: `${lease.room.roomNo}호는 아직 퇴실 처리가 완료되지 않았습니다.` }
      }
    }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { status: 'ACTIVE' },
    })

    // 입주월 재앵커 — prepaid 예약금을 실제 입주월로(deposit/none은 no-op).
    await reanchorReservationPrepaid(leaseTermId)

    await prisma.room.update({
      where: { id: lease.roomId },
      data: { isVacant: false },
    })

    await prisma.tenantStatusLog.create({
      data: {
        tenantId:    lease.tenantId,
        leaseTermId,
        propertyId,
        fromStatus:  'RESERVED',
        toStatus:    'ACTIVE',
        changedById: user.sub,
      },
    })

    revalidatePath('/dashboard')
    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/room-manage')
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
  if (lease.roomId) {
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
  }

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

// 상태값 → 호실 공실 여부 (null = 호실 상태 변경 안 함)
function roomVacantForStatus(status: string): boolean | null {
  if (['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(status)) return false
  if (['CHECKED_OUT', 'CANCELLED', 'NON_RESIDENT'].includes(status)) return true
  return null  // WAITING_TOUR, TOUR_DONE — 호실 점유 변경 없음
}

// 명시적 상태 전환 — 상태 + 그 전환에 필요한 필드만 변경하고 호실 공실·이력 자동 처리.
// 상세 모달의 전환 버튼(투어 완료/예약 전환/입실 처리/퇴실 예정/퇴실/비거주 전환 등)이 사용.
export async function applyStatusTransition(input: {
  leaseTermId: string
  tenantId: string
  toStatus: string
  moveInDate?: string | null
  expectedMoveOut?: string | null
  moveOutDate?: string | null
  reservationConfirmedAt?: string | null
  rentAmount?: number | null
  reason?: string | null   // 전이 사유(선택) — 취소 사유 수집(e1b81629), TenantStatusLog.reason에 기록
}): Promise<{ ok: true; notice?: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: input.leaseTermId },
      select: {
        roomId: true, status: true, dueDay: true, rentAmount: true, moveInDate: true,
        expectedMoveOut: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    // 신고 9b974be0: 예약 확정 시 월 이용료·입주 희망일 필수(서버 방어). 확정 호출은 값을 새로 넘기지 않고
    // 기존 lease 값으로 확정하므로 lease 쪽 값을 검증한다.
    if (input.reservationConfirmedAt) {
      const rentOk    = input.rentAmount != null ? input.rentAmount > 0 : lease.rentAmount > 0
      const moveInOk  = input.moveInDate ? true : lease.moveInDate != null
      if (!rentOk || !moveInOk) return { ok: false, error: '예약 확정에는 월 이용료와 입주 희망일이 필요합니다.' }
    }

    // 백스톱 — 최종 저장값 기준으로 청구 상태(ACTIVE·CHECKOUT_PENDING·NON_RESIDENT) + rentAmount>0 인데
    // moveInDate가 비면 거부(addTenant/updateTenant 가드와 동일 정책). 무료방 등록 후 상태전환에서 유료·비거주로
    // 넘겨 입주일 없는 청구 계약이 생기면 unpaid.ts가 인수월~오늘 전월을 미납으로 오탐한다.
    const finalStatus     = input.toStatus
    const finalRentAmount = input.rentAmount ?? lease.rentAmount
    const finalMoveInDate = input.moveInDate ?? lease.moveInDate
    if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(finalStatus) && finalRentAmount > 0 && !finalMoveInDate) {
      return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
    }

    const data: Record<string, unknown> = { status: input.toStatus as LeaseStatus }
    if (input.moveInDate !== undefined)             data.moveInDate = input.moveInDate ? new Date(input.moveInDate) : null
    if (input.expectedMoveOut !== undefined)        data.expectedMoveOut = input.expectedMoveOut ? new Date(input.expectedMoveOut) : null
    if (input.moveOutDate !== undefined)            data.moveOutDate = input.moveOutDate ? new Date(input.moveOutDate) : null
    if (input.reservationConfirmedAt !== undefined) data.reservationConfirmedAt = input.reservationConfirmedAt ? new Date(input.reservationConfirmedAt) : null
    if (input.rentAmount != null)                   data.rentAmount = input.rentAmount
    let notice: string | null = null
    // 퇴실예정 취소 등으로 거주중 복귀 시 퇴실예정일 + 퇴실 일할 정산(+롤백 스냅샷) 정리.
    // 신고 aae0ab38: CHECKOUT_PENDING발 복귀일 때만 초기화 — RESERVED발 입실 처리에서는
    // 단기 예약자가 미리 넣은 퇴실 예정일·정산이 지워지지 않도록 보존한다.
    if (input.toStatus === 'ACTIVE' && input.expectedMoveOut === undefined && lease.status === 'CHECKOUT_PENDING') {
      data.expectedMoveOut = null
      data.checkoutProratedAmount = null
      data.checkoutProratedMonth = null
      data.checkoutProrationUndo = Prisma.DbNull
      if (lease.checkoutProratedAmount != null) notice = '거주중 복귀. 적용돼 있던 퇴실 일할 정산을 해제했습니다.'
    } else if (input.expectedMoveOut !== undefined) {
      // 퇴실 예정일 변경 — 적용된 일할 정산이 있으면 무통보 삭제 대신 새 날짜 기준 재계산
      // (updateTenant 폼·changeDueDay 와 동일 정책: prorationDataForChange)
      const pr = prorationDataForChange(
        { ...lease, rentAmount: input.rentAmount ?? lease.rentAmount },
        lease.dueDay, input.expectedMoveOut || null,
        input.toStatus === 'CHECKOUT_PENDING',   // 퇴실 예정으로 전환할 때만 자동 적용
      )
      Object.assign(data, pr.data)
      notice = pr.notice
    }

    await prisma.leaseTerm.update({ where: { id: input.leaseTermId }, data })

    // 입주월 재앵커 — 예약(RESERVED)에서 입실 처리(ACTIVE)로 넘어갈 때 prepaid 예약금을 실제 입주월로 이동.
    // moveInDate가 폼에서 갱신됐을 수 있어 lease.update 후에 실행(deposit/none은 no-op).
    if (lease.status === 'RESERVED' && input.toStatus === 'ACTIVE') await reanchorReservationPrepaid(input.leaseTermId)

    // 호실 공실 처리
    const vac = roomVacantForStatus(input.toStatus)
    if (lease.roomId && vac !== null) {
      if (input.toStatus === 'CHECKED_OUT') {
        // 퇴실 완료 — 예약 가격 있으면 baseRent 적용 (checkoutTenant 와 동일)
        const room = await prisma.room.findUnique({ where: { id: lease.roomId }, select: { scheduledRent: true } })
        await prisma.room.update({
          where: { id: lease.roomId },
          data: { isVacant: true, ...(room?.scheduledRent != null && { baseRent: room.scheduledRent, scheduledRent: null, rentUpdateDate: null }) },
        })
      } else {
        await prisma.room.update({ where: { id: lease.roomId }, data: { isVacant: vac } })
      }
    }

    // 신고 9b974be0: 예약 확정·해제(RESERVED→RESERVED)는 상태 변화가 아니므로 이력 미기록.
    // 확정 시각은 reservationConfirmedAt 컬럼 자체가 기록한다(이력 오염 방지).
    const isReservationToggle = input.toStatus === lease.status && input.reservationConfirmedAt !== undefined
    if (!isReservationToggle) {
      await prisma.tenantStatusLog.create({
        data: {
          tenantId: input.tenantId,
          leaseTermId: input.leaseTermId,
          propertyId,
          fromStatus: lease.status,
          toStatus: input.toStatus as LeaseStatus,
          reason: input.reason || null,
          changedById: user.sub,
        },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/dashboard')
    revalidatePath('/rooms')
    revalidatePath('/room-manage')
    revalidatePath('/finance')
    return notice ? { ok: true, notice } : { ok: true }
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
            where: { deletedAt: null },
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
- 이름: ${tenant.name}, 호실: ${lease?.room?.roomNo ?? '미지정'}호
- 월 이용료: ${lease?.rentAmount.toLocaleString() ?? '—'}원, 납부일: ${lease?.dueDay ?? '미지정'}
- 입주일: ${lease?.moveInDate ? new Date(lease.moveInDate).toLocaleDateString('ko-KR') : '—'}

[수납 이력 (${payments.length}건)]
${paymentLines || '  수납 기록 없음'}

[통계]
- 완납: ${paidCount}/${payments.length}개월
- 총 납부액: ${totalPaid.toLocaleString()}원
- 미납 잔액: ${Math.max(0, unpaid).toLocaleString()}원

분석 결과를 실용적이고 구체적으로 작성해주세요.`

  const ai = await consumeGeminiAccess()
  if (!ai.ok) return `[오류] ${ai.error}`
  const apiKey = ai.apiKey

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

// ── 계약서 OCR (Gemini Vision) ────────────────────────────────────
// 계약서 사진/스캔에서 입주자 등록에 필요한 핵심 필드를 추출.
// 화면/PDF/사진 어떤 형태든 시도. 추출 못 한 필드는 undefined.
export type ContractOcrResult = {
  name?: string
  englishName?: string
  gender?: 'MALE' | 'FEMALE' | 'OTHER'
  nationality?: string
  birthdate?: string         // YYYY-MM-DD
  job?: string
  contactPhone?: string      // 주 연락처
  emergencyName?: string
  emergencyPhone?: string
  emergencyRelation?: string
  roomNo?: string            // '402호' 형태
  rentAmount?: number
  depositAmount?: number
  cleaningFee?: number
  dueDay?: string            // '25' | '말일'
  moveInDate?: string        // YYYY-MM-DD
  contractEnd?: string       // YYYY-MM-DD
}

export async function analyzeContractWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: ContractOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

    const prompt = `이 계약서/임대차 계약 문서를 분석하고 입주자 정보를 JSON 으로만 응답하세요. 다른 설명·마크다운·코드블록 없이 순수 JSON.

JSON 스키마 (모든 필드 선택. 추출 못 한 건 생략):
{
  "name": "한글 이름",
  "englishName": "영문 이름 (외국인이거나 별도 표기 있을 때)",
  "gender": "MALE" | "FEMALE" | "OTHER",
  "nationality": "대한민국 | 베트남 | 우즈베키스탄 ...",
  "birthdate": "YYYY-MM-DD",
  "job": "직업",
  "contactPhone": "010-1234-5678 (주 연락처)",
  "emergencyName": "비상연락처 본인 이름",
  "emergencyPhone": "010-...",
  "emergencyRelation": "부/모/형제/친구 등",
  "roomNo": "402호 (호실 번호)",
  "rentAmount": 370000,       // 정수 원 (월세/월 이용료)
  "depositAmount": 1000000,   // 정수 원 (보증금)
  "cleaningFee": 50000,       // 정수 원 (청소비)
  "dueDay": "25" | "말일",    // 납부일
  "moveInDate": "YYYY-MM-DD", // 입주일
  "contractEnd": "YYYY-MM-DD" // 계약 만료일
}

규칙:
- 숫자는 콤마 제거 후 정수만
- 한국어 계약서 우선. 영어 표기도 인식 가능
- 호실은 "402호" 또는 "402" 형태 그대로
- 계약서로 보이지 않는 이미지: {} 빈 객체 반환`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: 'application/json' },
        }),
      }
    )
    if (!res.ok) return { ok: false, error: `Gemini API 오류 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(cleaned) }
    catch { return { ok: false, error: 'AI 응답을 JSON으로 해석하지 못했습니다.' } }

    const str = (k: string) => typeof parsed[k] === 'string' && parsed[k] ? (parsed[k] as string).trim() : undefined
    const num = (k: string) => typeof parsed[k] === 'number' ? Math.round(parsed[k] as number) : undefined
    const gender = parsed.gender === 'MALE' || parsed.gender === 'FEMALE' || parsed.gender === 'OTHER' ? parsed.gender : undefined

    return {
      ok: true,
      data: {
        name: str('name'),
        englishName: str('englishName'),
        gender,
        nationality: str('nationality'),
        birthdate: str('birthdate'),
        job: str('job'),
        contactPhone: str('contactPhone'),
        emergencyName: str('emergencyName'),
        emergencyPhone: str('emergencyPhone'),
        emergencyRelation: str('emergencyRelation'),
        roomNo: str('roomNo'),
        rentAmount: num('rentAmount'),
        depositAmount: num('depositAmount'),
        cleaningFee: num('cleaningFee'),
        dueDay: str('dueDay'),
        moveInDate: str('moveInDate'),
        contractEnd: str('contractEnd'),
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 신분증/외국인등록증 OCR (Gemini Vision) ────────────────────────
export type IdCardOcrResult = {
  name?: string             // 한글 이름
  englishName?: string      // 외국인등록증 영문 이름
  gender?: 'MALE' | 'FEMALE' | 'OTHER'
  birthdate?: string        // YYYY-MM-DD
  nationality?: string      // '대한민국' | 'VIETNAM' 등 (가능하면 한글)
}

export async function analyzeIdCardWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: IdCardOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

    const prompt = `이 사진이 한국 주민등록증·운전면허증·외국인등록증 중 하나라고 보고 다음 필드를 추출. 순수 JSON 만 응답. 마크다운·코드블록 X.

JSON 스키마 (모든 필드 선택, 추출 못 한 건 생략):
{
  "name": "한글 이름",                  // 외국인등록증은 한글 표기 또는 없음
  "englishName": "ROMAN/ENGLISH NAME",  // 외국인등록증·여권형
  "gender": "MALE" | "FEMALE" | "OTHER",
  "birthdate": "YYYY-MM-DD",            // 주민번호 앞 6자리 또는 별도 표기
  "nationality": "대한민국 | 베트남 | 우즈베키스탄 ..."
}

규칙:
- 한국 주민번호 앞 6자리(YYMMDD)를 봤다면, 7번째 숫자가 1·2 → 19YY, 3·4 → 20YY, 5·6 → 19YY(외국인), 7·8 → 20YY(외국인)
- 외국인등록증의 영문 이름은 ROMAN 으로 정확히 (성/이름 그대로)
- 신분증으로 보이지 않으면 {} 빈 객체`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 600, responseMimeType: 'application/json' },
        }),
      }
    )
    if (!res.ok) return { ok: false, error: `Gemini API 오류 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(cleaned) }
    catch { return { ok: false, error: 'AI 응답을 JSON으로 해석하지 못했습니다.' } }

    const str = (k: string) => typeof parsed[k] === 'string' && parsed[k] ? (parsed[k] as string).trim() : undefined
    const gender = parsed.gender === 'MALE' || parsed.gender === 'FEMALE' || parsed.gender === 'OTHER' ? parsed.gender : undefined
    return {
      ok: true,
      data: {
        name: str('name'),
        englishName: str('englishName'),
        gender,
        birthdate: str('birthdate'),
        nationality: str('nationality'),
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 삭제 — 계약·수납(매출) 이력까지 연쇄 영구 삭제되므로,
// 이력이 있으면 1차 호출은 건수를 알려주며 거부하고 force 재호출에서만 실제 삭제(정보 동의 단계).
export async function deleteTenant(tenantId: string, opts?: { force?: boolean }): Promise<
  { ok: true } | { ok: false; error: string; needsForce?: boolean; leases?: number; payments?: number }
> {
  try {
    await requireEdit()

    // 이력 확인 — 복구 불가 삭제임을 건수와 함께 동의받는다
    if (!opts?.force) {
      const [leases, payments] = await Promise.all([
        prisma.leaseTerm.count({ where: { tenantId } }),
        prisma.paymentRecord.count({ where: { tenantId } }),
      ])
      if (payments > 0 || leases > 0) {
        return {
          ok: false, needsForce: true, leases, payments,
          error: `계약 ${leases}건·수납 기록 ${payments}건이 함께 영구 삭제됩니다.`,
        }
      }
    }

    // 활성 계약이 있으면 해당 호실을 공실로 전환 (단, 다른 입주자/비거주자가 남아있으면 제외)
    const activeLeases = await prisma.leaseTerm.findMany({
      where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { roomId: true },
    })
    for (const { roomId } of activeLeases) {
      if (!roomId) continue
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
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, content: true, requestDate: true,
      targetDate: true, resolvedAt: true, createdAt: true,
      tenant: { select: { name: true } },
    },
  })
}

export async function getAllRequestsForProperty() {
  const { propertyId } = await getPropertyId()
  return prisma.tenantRequest.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: [{ resolvedAt: 'asc' }, { isUrgent: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, content: true, requestDate: true,
      targetDate: true, resolvedAt: true, resolutionMemo: true,
      category: true, isUrgent: true, createdAt: true,
      tenantId: true, commonPlace: true,
      tenant: {
        select: {
          id: true, name: true,
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
            orderBy: { status: 'asc' },
            take: 1,
            select: { room: { select: { roomNo: true } } },
          },
        },
      },
    },
  })
}

export async function createTenantRequest(data: {
  tenantId?: string | null
  content: string
  requestDate: string
  targetDate: string | null
  category?: string | null
  isUrgent?: boolean
  commonPlace?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!data.content.trim()) return { ok: false, error: '내용을 입력해주세요.' }
    await prisma.tenantRequest.create({
      data: {
        tenantId:    data.tenantId ?? null,
        propertyId,
        content:     data.content.trim(),
        requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
        targetDate:  data.targetDate  ? new Date(data.targetDate)  : null,
        category:    data.category?.trim() || null,
        isUrgent:    data.isUrgent ?? false,
        commonPlace: data.commonPlace?.trim() || null,
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function getActiveTenantsForRequests() {
  const { propertyId } = await getPropertyId()
  return prisma.tenant.findMany({
    where: {
      propertyId,
      leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } } },
    },
    select: {
      id: true, name: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        orderBy: { status: 'asc' },
        take: 1,
        select: { room: { select: { roomNo: true } } },
      },
    },
    orderBy: { name: 'asc' },
  })
}

export async function resolveTenantRequest(id: string, memo?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolutionMemo: memo?.trim() || null,
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 요청 완료 해제 — 실수로 완료 처리한 요청을 미완료로 복귀(감사 2026-07-10: 삭제만 있던 문제)
export async function unresolveTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getPropertyId()
    await prisma.tenantRequest.update({ where: { id }, data: { resolvedAt: null } })
    revalidatePath('/tenants'); revalidatePath('/requests'); revalidatePath('/dashboard')
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
): Promise<{ ok: true; notice?: string; undo: DueDayChangeUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        dueDay: true, rentAmount: true, tenantId: true, status: true, moveInDate: true,
        // 퇴실 일할 정산 재계산용 — 납부일이 바뀌면 일할 기간(납부일~퇴실일)도 달라짐
        expectedMoveOut: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    // 적용된 퇴실 일할 정산이 있으면 새 납부일 기준으로 재계산 (updateTenant·전환 버튼과 동일 정책).
    // 납입일 변경은 '자동 적용' 대상이 아님(false) — 이미 적용된 정산만 새 납부일로 재계산.
    const pr = prorationDataForChange(
      lease,
      newDueDay.trim() || null,
      lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      false,
    )

    // 되돌리기 스냅샷 — 납입일·일할 정산 필드 원값(감사 2026-07-10: 되돌리기 전무 보완)
    const undoSnap: DueDayChangeUndo = {
      leaseTermId,
      prevDueDay: lease.dueDay,
      prevProration: {
        checkoutProratedAmount: lease.checkoutProratedAmount,
        checkoutProratedMonth: lease.checkoutProratedMonth,
        checkoutProrationUndo: lease.checkoutProrationUndo,
      },
      adjustRecordId: null,
    }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { dueDay: newDueDay.trim(), ...pr.data },
    })

    if (adjustAmount !== 0) {
      const maxSeq = await prisma.paymentRecord.aggregate({
        where: { leaseTermId, targetMonth, deletedAt: undefined },
        _max: { seqNo: true },
      })
      const seqNo = (maxSeq._max.seqNo ?? 0) + 1
      const isRefund = adjustAmount > 0
      const absAmt = Math.abs(adjustAmount)
      const typeLabel = isRefund ? '과입금' : '추가납부'

      const adj = await prisma.paymentRecord.create({
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
      undoSnap.adjustRecordId = adj.id
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    return pr.notice ? { ok: true, notice: pr.notice, undo: undoSnap } : { ok: true, undo: undoSnap }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 납입일 변경 적용취소 — 납입일·일할 정산 필드 원복 + 생성된 조정 기록 삭제
export type DueDayChangeUndo = {
  leaseTermId: string
  prevDueDay: string | null
  prevProration: { checkoutProratedAmount: number | null; checkoutProratedMonth: string | null; checkoutProrationUndo: unknown }
  adjustRecordId: string | null
}

export async function undoChangeDueDay(u: DueDayChangeUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: u.leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.leaseTerm.update({ where: { id: u.leaseTermId }, data: {
        dueDay: u.prevDueDay,
        checkoutProratedAmount: u.prevProration.checkoutProratedAmount,
        checkoutProratedMonth: u.prevProration.checkoutProratedMonth,
        checkoutProrationUndo: u.prevProration.checkoutProrationUndo == null ? Prisma.DbNull : (u.prevProration.checkoutProrationUndo as Prisma.InputJsonValue),
      } }),
      ...(u.adjustRecordId ? [prisma.paymentRecord.deleteMany({ where: { id: u.adjustRecordId, propertyId } })] : []),
    ])
    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 퇴실 정산(일할) ──────────────────────────────────────────────────
// 선납 모델에서 퇴실 예정일이 기간 중간이면 마지막(퇴실) 달 청구를 사용 일수만큼 일할로 줄인다.
// 미리보기(previewCheckoutProration)로 금액을 확인한 뒤 setCheckoutProration 으로 확정·기록(lock).
// 확정 시 lease.checkoutProratedAmount/Month 에 저장 → 청구 엔진이 그 달 청구를 이 값으로 덮어씀.
// (rooms getRoomPaymentStatus · dashboard unpaid.ts · dashboard page.tsx 셋 다 동일하게 참조)

export type CheckoutProrationPreview =
  | { ok: true; calc: CheckoutProrationResult; currentDueDay: string | null }
  | { ok: false; error: string }

export async function previewCheckoutProration(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
): Promise<CheckoutProrationPreview> {
  try {
    await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        dueDay: true, rentAmount: true, moveInDate: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    const moveOutMonth = expectedMoveOut.slice(0, 7)
    const monthlyRent = discountedRent(lease.discounts, moveOutMonth, lease.rentAmount)
    const calc = calcCheckoutProration(monthlyRent, lease.dueDay, expectedMoveOut, ymdOf(lease.moveInDate))
    if (!calc) return { ok: false, error: '퇴실일이 납부일 이전이라 마지막 기간을 사용하지 않습니다. 별도 정산 없이 그 달 청구가 자동으로 0원 처리되므로 일할 적용이 필요 없습니다.' }
    return { ok: true, calc, currentDueDay: lease.dueDay }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 적용취소(롤백)용 직전 스냅샷 형태
type CheckoutProrationUndo = {
  prevStatus: LeaseStatus
  prevExpectedMoveOut: string | null   // ISO 'YYYY-MM-DD' or null
  prevAmount: number | null
  prevMonth: string | null
  // 적용/재계산이 설정한 값 — 적용취소 시 '그 후 수동 수정 여부' 감지용 (구버전 스냅샷엔 없음)
  appliedMoveOut?: string | null
  appliedAmount?: number | null
}

// 적용된 일할 정산의 일관 유지 — 퇴실일/납부일이 바뀌는 모든 경로(고객관리 편집 폼 updateTenant,
// 전환 버튼 applyStatusTransition, 납입일 영구 변경 changeDueDay)가 이 헬퍼로 같은 결과를 낸다.
// (경로마다 정산이 잔존/무통보 삭제되던 불일치 해소 — 2026-06-11 점검 후속)
// 반환: leaseTerm.update 에 합칠 data 조각 + 사용자 안내문.
// Date|string|null → 'YYYY-MM-DD' (DB @db.Date 는 UTC 자정 저장이라 toISOString 슬라이스가 정확)
function ymdOf(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

function prorationDataForChange(
  lease: {
    status: LeaseStatus
    expectedMoveOut: Date | string | null
    rentAmount: number
    moveInDate: Date | string | null
    checkoutProratedAmount: number | null
    checkoutProratedMonth: string | null
    checkoutProrationUndo: unknown
    discounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[]
  },
  newDueDay: string | null,
  newExpectedMoveOut: string | null,   // 'YYYY-MM-DD' | null
  autoApply: boolean,                  // 미적용 상태에서도 자동 적용(퇴실 예정 전환·편집)일 때 true
): { data: Record<string, unknown>; notice: string | null } {
  const wasApplied = lease.checkoutProratedAmount != null
  // 퇴실 예정 해제 — 적용분 있으면 정산도 함께 해제
  if (!newExpectedMoveOut) {
    if (!wasApplied) return { data: {}, notice: null }
    return {
      data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      notice: '퇴실 예정이 해제되어 적용돼 있던 퇴실 일할 정산도 함께 해제했습니다.',
    }
  }
  // 미적용 + 자동적용 대상 아님(거주중 납입일 변경 등) → 손대지 않음
  if (!wasApplied && !autoApply) return { data: {}, notice: null }

  const moveOutMonth = newExpectedMoveOut.slice(0, 7)
  const monthlyRent = discountedRent(lease.discounts, moveOutMonth, lease.rentAmount)
  const calc = calcCheckoutProration(monthlyRent, newDueDay, newExpectedMoveOut, ymdOf(lease.moveInDate))
  if (!calc) {
    // 퇴실일 ≤ 납부일 → 그 달 자동 0원(일할 불필요). 기존 적용분만 해제.
    if (!wasApplied) return { data: {}, notice: null }
    return {
      data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      notice: '퇴실일이 납부일 이전이 되어 마지막 달 청구가 자동으로 0원 처리됩니다. 기존 일할 정산은 해제했습니다.',
    }
  }
  // 적용취소 스냅샷 — 이미 적용 중이면 기존 스냅샷(최초 적용 직전) 유지, 신규 자동적용이면 현재 상태 기록.
  const prevUndo = lease.checkoutProrationUndo
  const undoBase: CheckoutProrationUndo = (prevUndo && typeof prevUndo === 'object')
    ? (prevUndo as CheckoutProrationUndo)
    : {
        prevStatus: lease.status,
        prevExpectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
        prevAmount: lease.checkoutProratedAmount ?? null,
        prevMonth: lease.checkoutProratedMonth ?? null,
      }
  const undo: CheckoutProrationUndo = { ...undoBase, appliedMoveOut: newExpectedMoveOut, appliedAmount: calc.amount }
  return {
    data: {
      checkoutProratedAmount: calc.amount,
      checkoutProratedMonth: calc.moveOutMonth,
      checkoutProrationUndo: undo,
    },
    notice: wasApplied
      ? `적용돼 있던 퇴실 일할 정산을 변경된 조건으로 재계산했습니다 · ${calc.daysUsed}일치 ${calc.amount.toLocaleString()}원.`
      : `퇴실 일할 정산을 자동 적용했습니다. ${calc.daysUsed}일치 ${calc.amount.toLocaleString()}원. (금액 조정은 '퇴실 정산'에서)`,
  }
}

// 퇴실 환불 미리보기 — 환경설정 '퇴실 환불 규정'으로 환불액 내역 산출(읽기전용 표시용).
// 선납액 = 퇴실 달에 낸 금액(보증금·양도인 제외). 사용일수 = 일할 daysUsed(퇴실일<납부일이면 0).
export type CheckoutRefundPreview =
  | { ok: true; refund: CheckoutRefundResult; prepaidAmount: number; defaultPenaltyPct: number }
  | { ok: false; error: string }

export async function previewCheckoutRefund(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
  mode: RefundMode = 'legal',
  penaltyPct?: number | null,  // 사람별 위약금율(%) — 미지정 시 영업장 기본값, 서버에서 0~10 캡
): Promise<CheckoutRefundPreview> {
  try {
    const { propertyId } = await getPropertyId()
    const [lease, prop] = await Promise.all([
      prisma.leaseTerm.findFirst({
        where: { id: leaseTermId, propertyId },
        select: {
          dueDay: true, rentAmount: true, moveInDate: true,
          discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        },
      }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { refundPenaltyPct: true } }),
    ])
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    // 영업장 기본 위약금율(공정위 10% 캡) — 사람별 입력이 있으면 그 값을, 없으면 기본값을 캡 안에서 적용
    const defaultPenaltyPct = clampPenaltyPct(prop?.refundPenaltyPct)
    const effectivePct = clampPenaltyPct(penaltyPct ?? defaultPenaltyPct)
    const moveOutMonth = expectedMoveOut.slice(0, 7)
    const monthlyRent = discountedRent(lease.discounts, moveOutMonth, lease.rentAmount)
    const paidAgg = await prisma.paymentRecord.aggregate({
      where: { leaseTermId, targetMonth: moveOutMonth, isDeposit: false, isPrevOwner: false },
      _sum: { actualAmount: true },
    })
    const prepaidAmount = Math.max(0, paidAgg._sum.actualAmount ?? 0)
    const prorate = calcCheckoutProration(monthlyRent, lease.dueDay, expectedMoveOut, ymdOf(lease.moveInDate))
    const daysUsed = prorate ? prorate.daysUsed : 0   // 퇴실일 < 납부일이면 그 기간 미사용 = 0
    const refund = calcCheckoutRefund({ prepaidAmount, monthlyRent, daysUsed, mode, penaltyPct: effectivePct })
    return { ok: true, refund, prepaidAmount, defaultPenaltyPct }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setCheckoutProration(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
  manualAmount?: number,    // 운영자 수동 조정값 — 없으면 자동 일할액 사용 (봐주기·특이 케이스)
): Promise<{ ok: true; calc: CheckoutProrationResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        status: true, tenantId: true, dueDay: true, rentAmount: true, moveInDate: true,
        expectedMoveOut: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
        checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    const moveOutMonth = expectedMoveOut.slice(0, 7)
    const monthlyRent = discountedRent(lease.discounts, moveOutMonth, lease.rentAmount)
    const calc = calcCheckoutProration(monthlyRent, lease.dueDay, expectedMoveOut, ymdOf(lease.moveInDate))
    if (!calc) return { ok: false, error: '퇴실일이 납부일 이전이라 마지막 기간을 사용하지 않습니다. 별도 정산 없이 그 달 청구가 자동으로 0원 처리되므로 일할 적용이 필요 없습니다.' }
    // 수동 조정값이 있으면 그 값으로(0 이상 정수), 없으면 자동 일할액. undo 의 appliedAmount 도 이 값으로 기록.
    const finalAmount = (manualAmount != null && Number.isFinite(manualAmount) && manualAmount >= 0) ? Math.round(manualAmount) : calc.amount

    // 적용취소용 직전 스냅샷 — 이미 정산이 적용돼 있으면(재정산) 기존 스냅샷(최초 적용 직전)을 유지해
    // '적용취소' 한 번으로 정산 이전(거주중 등) 원상태까지 되돌아가게 한다.
    const undoBase: CheckoutProrationUndo = (lease.checkoutProrationUndo as CheckoutProrationUndo | null) ?? {
      prevStatus: lease.status,
      prevExpectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      prevAmount: lease.checkoutProratedAmount ?? null,
      prevMonth: lease.checkoutProratedMonth ?? null,
    }
    // 적용이 설정한 값 기록 — 이후 수동 수정 감지(적용취소가 수동 수정을 덮어쓰지 않게)
    const undo: CheckoutProrationUndo = { ...undoBase, appliedMoveOut: expectedMoveOut, appliedAmount: finalAmount }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: {
        status: 'CHECKOUT_PENDING',
        expectedMoveOut: new Date(expectedMoveOut),
        checkoutProratedAmount: finalAmount,
        checkoutProratedMonth: calc.moveOutMonth,
        checkoutProrationUndo: undo,
      },
    })
    // 상태 전환 로그 — ACTIVE→CHECKOUT_PENDING 등 변경 시에만 남김
    if (lease.status !== 'CHECKOUT_PENDING') {
      await prisma.tenantStatusLog.create({
        data: {
          tenantId: lease.tenantId, leaseTermId, propertyId,
          fromStatus: lease.status, toStatus: 'CHECKOUT_PENDING', changedById: user.sub,
        },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/room-manage')
    return { ok: true, calc }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 일할 정산 '적용취소'(롤백) — 적용 직전 스냅샷으로 상태·퇴실예정일·일할액을 한 번에 복원.
// 스냅샷이 없으면(과거 적용분 등) 일할액만 제거(풀 청구 복귀)하는 안전 폴백.
export async function clearCheckoutProration(
  leaseTermId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        status: true, tenantId: true, checkoutProrationUndo: true,
        expectedMoveOut: true, checkoutProratedAmount: true,
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    const undo = lease.checkoutProrationUndo as CheckoutProrationUndo | null
    // 적용 이후 수동 수정(퇴실일 변경 등) 감지 — 스냅샷 복원이 그 수정을 덮어쓰지 않게,
    // 수정이 있었으면 일할액만 제거하고 현재 상태·퇴실일은 유지한다.
    const curMoveOut = lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null
    const manuallyChanged = !!undo && undo.appliedMoveOut !== undefined
      && (curMoveOut !== undo.appliedMoveOut || lease.checkoutProratedAmount !== undo.appliedAmount)
    if (undo && manuallyChanged) {
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      })
    } else if (undo) {
      // 완전 복원 — 적용 직전 상태로
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: {
          status: undo.prevStatus,
          expectedMoveOut: undo.prevExpectedMoveOut ? new Date(undo.prevExpectedMoveOut) : null,
          checkoutProratedAmount: undo.prevAmount,
          checkoutProratedMonth: undo.prevMonth,
          checkoutProrationUndo: Prisma.DbNull,
        },
      })
      // 상태가 실제로 되돌아가면 전환 로그 남김 (예: CHECKOUT_PENDING → ACTIVE)
      if (undo.prevStatus !== lease.status) {
        await prisma.tenantStatusLog.create({
          data: {
            tenantId: lease.tenantId, leaseTermId, propertyId,
            fromStatus: lease.status, toStatus: undo.prevStatus, changedById: user.sub,
          },
        })
      }
    } else {
      // 폴백 — 스냅샷 없으면 일할액만 제거(상태·퇴실예정 유지)
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: { checkoutProratedAmount: null, checkoutProratedMonth: null },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/room-manage')
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
    // 소프트삭제 — 적용취소(restoreTenantRequest) 가능. 모든 조회는 deletedAt:null 필터로 제외.
    await prisma.tenantRequest.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function restoreTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/tenants')
    revalidatePath('/requests')
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
      if (lease.roomId) {
        await prisma.room.update({ where: { id: lease.roomId }, data: { isVacant: false } })
      }
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

// ── 계약서 파일 (서명된 PDF / 스캔 본) ─────────────────────────────────

export type ContractFileRow = {
  id: string
  driveFileId: string
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  createdAt: Date
  viewUrl: string
}

export async function getContractFiles(tenantId: string): Promise<ContractFileRow[]> {
  const { propertyId } = await getPropertyId()
  const rows = await prisma.contractFile.findMany({
    where: { tenantId, propertyId, deletedAt: null },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, driveFileId: true, fileName: true, source: true, signedAt: true, createdAt: true },
  })
  return rows.map(r => ({
    ...r,
    viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
  }))
}

export async function deleteContractFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { trashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.contractFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    // 소프트삭제 — Drive는 휴지통으로(복구 가능), DB는 deletedAt 표시. 적용취소는 restoreContractFile.
    try { await trashInDrive(file.driveFileId) } catch { /* Drive 정리 실패 무시 */ }
    await prisma.contractFile.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

export async function restoreContractFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { untrashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.contractFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    try { await untrashInDrive(file.driveFileId) } catch { /* Drive 복구 실패 무시 */ }
    await prisma.contractFile.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복구에 실패했습니다.' }
  }
}

// 스캔 업로드 — 종이로 서명받은 계약서를 사진/PDF로 첨부
const MAX_SCAN_BYTES = 25 * 1024 * 1024  // 25MB

export async function createContractScanUploadSession(input: {
  tenantId: string
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_SCAN_BYTES) return { ok: false, error: `파일 크기는 ${MAX_SCAN_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId, propertyId }, select: { id: true } })
    if (!tenant) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    const { createDriveResumableSession } = await import('@/lib/google-drive')
    const ext = input.fileName.split('.').pop() ?? 'bin'
    const uniqueName = `contract_scan_${input.tenantId}_${Date.now()}.${ext}`
    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName, mimeType: input.mimeType, fileSize: input.fileSize, origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeContractScan(input: {
  tenantId: string
  driveFileId: string
  fileName: string
  signedAt?: string  // YYYY-MM-DD, 없으면 오늘
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { setDrivePublicReadable, deleteFromDrive } = await import('@/lib/google-drive')
    const tenant = await prisma.tenant.findFirst({
      where: { id: input.tenantId, propertyId },
      include: {
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { id: true },
        },
      },
    })
    if (!tenant) {
      try { await deleteFromDrive(input.driveFileId) } catch {}
      return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    }
    await setDrivePublicReadable(input.driveFileId)
    const lease = tenant.leaseTerms[0] ?? null
    const created = await prisma.contractFile.create({
      data: {
        propertyId,
        tenantId: tenant.id,
        leaseTermId: lease?.id ?? null,
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        source: 'UPLOADED',
        signedAt: input.signedAt ? new Date(`${input.signedAt}T00:00:00`) : new Date(),
      },
      select: { id: true },
    })
    revalidatePath('/tenants')
    return { ok: true, id: created.id }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (input.driveFileId) {
      try { const { deleteFromDrive } = await import('@/lib/google-drive'); await deleteFromDrive(input.driveFileId) } catch {}
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

// ── 일괄 편집
export async function batchUpdateTenants(
  tenantIds: string[],
  data: {
    // Tenant 필드
    nationality?: string | null
    gender?: string
    // LeaseTerm 필드 (가장 최근 활성·예약 계약에 적용)
    depositAmount?: number
    dueDay?: string | null
    status?: string
  },
): Promise<{ ok: true; tenantCount: number; leaseCount: number; undo: BatchTenantsUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (tenantIds.length === 0) return { ok: false, error: '선택된 입주자가 없습니다.' }

    const tenantFields: Record<string, unknown> = {}
    if ('nationality' in data) tenantFields.nationality = data.nationality
    if ('gender' in data && data.gender) tenantFields.gender = data.gender

    const leaseFields: Record<string, unknown> = {}
    if ('depositAmount' in data && data.depositAmount != null) leaseFields.depositAmount = data.depositAmount
    if ('dueDay' in data) leaseFields.dueDay = data.dueDay
    if ('status' in data && data.status) leaseFields.status = data.status

    let tenantCount = 0
    let leaseCount = 0

    // 되돌리기 스냅샷 — 덮어쓰기 전 원값(감사 백로그 2026-07-10, 일괄 수납 undo와 동일 패턴)
    const undo: BatchTenantsUndo = { tenants: [], leases: [] }

    if (Object.keys(tenantFields).length > 0) {
      const before = await prisma.tenant.findMany({
        where: { id: { in: tenantIds }, propertyId },
        select: { id: true, nationality: true, gender: true },
      })
      undo.tenants = before.map(b => ({ id: b.id, fields: Object.fromEntries(Object.keys(tenantFields).map(k => [k, (b as Record<string, unknown>)[k] ?? null])) }))
      const r = await prisma.tenant.updateMany({
        where: { id: { in: tenantIds }, propertyId },
        data: tenantFields,
      })
      tenantCount = r.count
    }

    if (Object.keys(leaseFields).length > 0) {
      const before = await prisma.leaseTerm.findMany({
        where: {
          tenantId: { in: tenantIds },
          status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'] },
        },
        select: { id: true, depositAmount: true, dueDay: true, status: true },
      })
      undo.leases = before.map(b => ({ id: b.id, fields: Object.fromEntries(Object.keys(leaseFields).map(k => [k, (b as Record<string, unknown>)[k] ?? null])) }))
      const r = await prisma.leaseTerm.updateMany({
        where: {
          tenantId: { in: tenantIds },
          status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'] },
        },
        data: leaseFields,
      })
      leaseCount = r.count
    }

    if (tenantCount === 0 && leaseCount === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
    revalidatePath('/tenants')
    revalidatePath('/rooms')
    return { ok: true, tenantCount, leaseCount, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 단기 입실 요금 시뮬레이션용 — 방 목록(월세·사용중 여부). 등록 없이 견적만 낼 때 방 선택 → 월세 자동.
export async function getRoomsForQuote(): Promise<{
  rooms: { id: string; roomNo: string; baseRent: number; type: string | null; windowType: string | null; tier: string | null; occupied: boolean }[]
  shortStay: ShortStayPolicy   // 단기 입실 정책 — 시뮬이 이 수치로 계산(영업장별 템플릿)
}> {
  const { propertyId } = await getPropertyId()
  const [rooms, prop] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      orderBy: { roomNo: 'asc' },
      select: {
        id: true, roomNo: true, baseRent: true, type: true, windowType: true, tier: true,
        leaseTerms: { where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } }, select: { id: true }, take: 1 },
      },
    }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { shortStayPolicy: true } }),
  ])
  return {
    rooms: rooms.map(r => ({ id: r.id, roomNo: r.roomNo, baseRent: r.baseRent, type: r.type, windowType: r.windowType, tier: r.tier, occupied: r.leaseTerms.length > 0 })),
    shortStay: parseShortStayPolicy(prop?.shortStayPolicy),
  }
}

// ── 단기 연장 (운영자 승인 2026-07-20) ─────────────────────────────────────
// 규칙(knowledge/short-stay-policy.md): 누적 재계산 — 최초 입주일~새 퇴실일 전체를 calcShortStay로
// 재계산하고 추가 납부 = 새 사용료 - 기존 rentAmount. 청소비는 입실 1회(연장 미청구).
// 30일(thresholdDays) 초과는 단기 정책 밖 → 월 계약 전환 안내(여기서는 거부).
// 금액은 반드시 서버가 정책·DB에서 재산출 — 클라 값 신뢰 금지(락인 expectedAmount가 영구 청구 기준).

type ShortStayExtensionSnapshot = {
  at: string
  prevRentAmount: number
  newRentAmount: number
  prevExpectedMoveOut: string | null
  newExpectedMoveOut: string
  prevStatus: string
  prevAutoCheckoutAt: string | null
  prevProration: { amount: number | null; month: string | null; undo: unknown } | null
  markerRecordId: string
  undoneAt: string | null
}

export type ShortStayExtensionPreview =
  | {
      ok: true
      tenantName: string; roomNo: string | null
      moveInDate: string; currentOut: string | null
      currentRent: number; cleaningFee: number
      newOut: string; stayDays: number; units: number; contractDays: number
      newRent: number; diff: number
      cappedAtMonth: boolean; roundedUp: boolean
      thresholdDays: number
    }
  | { ok: false; error: string; overThreshold?: boolean }

// 연장 대상 lease 로드 + 새 퇴실일 기준 누적 견적 — preview·extend 공용(단일 계산 경로)
async function loadExtensionQuote(propertyId: string, leaseTermId: string, newOutYmd: string) {
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: {
      id: true, status: true, isShortTerm: true, rentAmount: true, cleaningFee: true,
      moveInDate: true, expectedMoveOut: true, autoCheckoutAt: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      shortStayExtensions: true, tenantId: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true, baseRent: true } },
      property: { select: { shortStayPolicy: true } },
    },
  })
  const fail = (error: string, overThreshold?: boolean) => ({ ok: false as const, error, overThreshold })
  if (!lease) return fail('계약을 찾을 수 없습니다.')
  if (!lease.isShortTerm) return fail('단기 계약이 아닙니다.')
  if (!['ACTIVE', 'CHECKOUT_PENDING'].includes(lease.status)) return fail('거주 중(또는 퇴실 예정) 상태에서만 연장할 수 있습니다.')
  if (!lease.moveInDate) return fail('입주일이 없어 누적 요금을 계산할 수 없습니다.')
  if (!lease.room) return fail('호실이 배정되지 않아 표준가를 찾을 수 없습니다.')

  const moveInYmd = ymdOf(lease.moveInDate)!
  const currentOutYmd = ymdOf(lease.expectedMoveOut)
  // 같은 날짜는 허용 — 수정 폼에서 퇴실일만 먼저 저장한 뒤 "재계산 정리"로 들어오는 경로
  // (요금은 그대로인데 기간만 늘어난 상태를 누적 요금으로 맞춘다). 과거로 당기는 건 단축이라 범위 밖.
  if (currentOutYmd && newOutYmd < currentOutYmd) return fail('연장은 현 퇴실 예정일 이후 날짜만 선택할 수 있습니다.')
  if (!currentOutYmd && newOutYmd <= moveInYmd) return fail('퇴실일은 입주일 이후여야 합니다.')

  const policy = parseShortStayPolicy(lease.property.shortStayPolicy)
  if (!policy.enabled) return fail('이 영업장은 단기 입실 정책이 꺼져 있습니다. 설정에서 먼저 켜 주세요.')
  const stayDays = stayDaysOf(moveInYmd, newOutYmd)
  if (stayDays == null) return fail('날짜가 올바르지 않습니다.')
  const quote = calcShortStay(policy, lease.room.baseRent, stayDays)
  if (!quote) return fail(`단기 정책 범위(${policy.thresholdDays}일)를 넘습니다. 월 계약으로 전환해 주세요.`, true)

  return { ok: true as const, lease, policy, quote, moveInYmd, currentOutYmd, stayDays }
}

export async function previewShortStayExtension(leaseTermId: string, newOutYmd: string): Promise<ShortStayExtensionPreview> {
  const { propertyId } = await getPropertyId()
  const r = await loadExtensionQuote(propertyId, leaseTermId, newOutYmd)
  if (!r.ok) return { ok: false, error: r.error, overThreshold: r.overThreshold }
  const { lease, quote, moveInYmd, currentOutYmd } = r
  return {
    ok: true,
    tenantName: lease.tenant.name, roomNo: lease.room?.roomNo ?? null,
    moveInDate: moveInYmd, currentOut: currentOutYmd,
    currentRent: lease.rentAmount, cleaningFee: lease.cleaningFee,
    newOut: newOutYmd, stayDays: r.stayDays, units: quote.units, contractDays: quote.contractDays,
    newRent: quote.baseAmount, diff: quote.baseAmount - lease.rentAmount,
    cappedAtMonth: quote.cappedAtMonth, roundedUp: quote.roundedUp,
    thresholdDays: r.policy.thresholdDays,
  }
}

/**
 * 단기 연장 확정 — 한 트랜잭션으로:
 * rentAmount(새 누적 사용료)·expectedMoveOut 갱신, ACTIVE 복귀, autoCheckoutAt 리셋(새 D-1 재무장),
 * 퇴실 일할 필드 클리어(일할이 락인보다 우선이라 남으면 연장 청구가 무시됨 — 적대검증 P0-1),
 * 입주월 마커 record(expectedAmount=새 누적)로 청구 락 인상, isPaid 재계산, 이력 스냅샷 적립.
 * expectedCurrentOutYmd는 클라가 본 현 퇴실일 — 조건부 선점(updateMany)의 멱등 토큰(이중 제출·동시 수정 방어).
 */
export async function extendShortStay(
  leaseTermId: string,
  newOutYmd: string,
  expectedCurrentOutYmd: string | null,
): Promise<{ ok: true; diff: number; newRent: number; inMonth: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { user, propertyId } = await getPropertyId()
    const r = await loadExtensionQuote(propertyId, leaseTermId, newOutYmd)
    if (!r.ok) return { ok: false, error: r.error }
    const { lease, quote, moveInYmd, currentOutYmd } = r

    if (currentOutYmd !== expectedCurrentOutYmd) return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    if (quote.baseAmount <= lease.rentAmount) {
      return { ok: false, error: '새 누적 요금이 기존 이용료 이하입니다. 수동 협의 금액이면 수정 폼에서 직접 조정해 주세요.' }
    }

    const inMonth = moveInYmd.slice(0, 7)
    const nowIso = new Date().toISOString()

    await prisma.$transaction(async tx => {
      // 마커 record — 입주월 앵커(예약 선납 reanchor와 동일 관례). 청구 락을 새 누적으로 인상.
      // seqNo는 소프트삭제분 포함 count(@@unique 충돌 방지 — savePayment 관례).
      const seqNo = await tx.paymentRecord.count({
        where: { leaseTermId, targetMonth: inMonth, deletedAt: undefined },
      })
      const marker = await tx.paymentRecord.create({
        data: {
          leaseTermId, tenantId: lease.tenantId, propertyId,
          targetMonth: inMonth,
          expectedAmount: quote.baseAmount,
          actualAmount: 0,
          payDate: new Date(),
          seqNo: seqNo + 1,
          isPaid: false, carryOver: 0,
          memo: `[단기연장] ${quote.units}주 · ${lease.rentAmount.toLocaleString()}→${quote.baseAmount.toLocaleString()} · 퇴실 ${currentOutYmd ?? '미정'}→${newOutYmd}`,
        },
      })

      const snapshot: ShortStayExtensionSnapshot = {
        at: nowIso,
        prevRentAmount: lease.rentAmount, newRentAmount: quote.baseAmount,
        prevExpectedMoveOut: currentOutYmd, newExpectedMoveOut: newOutYmd,
        prevStatus: lease.status,
        prevAutoCheckoutAt: lease.autoCheckoutAt ? lease.autoCheckoutAt.toISOString() : null,
        prevProration: (lease.checkoutProratedAmount != null || lease.checkoutProratedMonth != null || lease.checkoutProrationUndo != null)
          ? { amount: lease.checkoutProratedAmount, month: lease.checkoutProratedMonth, undo: lease.checkoutProrationUndo }
          : null,
        markerRecordId: marker.id,
        undoneAt: null,
      }
      const prevList = Array.isArray(lease.shortStayExtensions) ? lease.shortStayExtensions : []

      // 조건부 선점 — 읽은 시점의 퇴실일·상태 그대로일 때만 갱신(크론·동시 조작·이중 제출 차단)
      const updated = await tx.leaseTerm.updateMany({
        where: {
          id: leaseTermId, propertyId, isShortTerm: true,
          status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] },
          expectedMoveOut: lease.expectedMoveOut,
          rentAmount: lease.rentAmount,
        },
        data: {
          rentAmount: quote.baseAmount,
          expectedMoveOut: new Date(newOutYmd),   // 'YYYY-MM-DD' → UTC 자정, @db.Date 절삭(기존 저장 관행)
          status: 'ACTIVE',
          autoCheckoutAt: null,   // 새 퇴실일 D-1에 크론 재무장
          checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull,
          shortStayExtensions: [...prevList, snapshot] as Prisma.InputJsonValue,
        },
      })
      if (updated.count !== 1) throw new Error('CONFLICT')

      if (lease.status === 'CHECKOUT_PENDING') {
        await tx.tenantStatusLog.create({
          data: { tenantId: lease.tenantId, leaseTermId, propertyId, fromStatus: 'CHECKOUT_PENDING', toStatus: 'ACTIVE', changedById: user.sub, reason: '단기 연장' },
        })
      }

      // 입주월 isPaid 재계산 — 청구가 새 누적으로 올라 기존 완납 record가 미완납이 될 수 있음
      const records = await tx.paymentRecord.findMany({
        where: { leaseTermId, targetMonth: inMonth, isDeposit: false },
        orderBy: { payDate: 'asc' },
      })
      let cumulative = 0
      for (const rec of records) {
        cumulative += rec.actualAmount
        await tx.paymentRecord.update({ where: { id: rec.id }, data: { isPaid: cumulative >= quote.baseAmount } })
      }
    })

    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
    return { ok: true, diff: quote.baseAmount - lease.rentAmount, newRent: quote.baseAmount, inMonth }
  } catch (err) {
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '연장 처리 중 오류가 발생했습니다.' }
  }
}

/**
 * 단기 연장 적용취소 — 마지막 미취소 스냅샷으로 원복(v2.0 §16).
 * 가드: 연장 이후 계약이 또 수정됐거나, 입주월 이용료 수납 합이 이전 누적을 초과하면 차단.
 * 원복: lease 필드 복원 + 마커 소프트삭제 + 연장 이후 생성 record의 락(expectedAmount) 되쓰기 + isPaid 재계산.
 * (마커만 지우면 차액 수납·0원 record가 새 누적을 락으로 물고 남는다 — 적대검증 P1-1)
 */
export async function undoShortStayExtension(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { user, propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, status: true, rentAmount: true, expectedMoveOut: true, tenantId: true,
        moveInDate: true, shortStayExtensions: true,
      },
    })
    if (!lease || !lease.moveInDate) return { ok: false, error: '계약을 찾을 수 없습니다.' }
    const list = (Array.isArray(lease.shortStayExtensions) ? lease.shortStayExtensions : []) as ShortStayExtensionSnapshot[]
    const idx = list.map(e => e.undoneAt).lastIndexOf(null)
    if (idx < 0) return { ok: false, error: '되돌릴 연장이 없습니다.' }
    const entry = list[idx]

    if (lease.rentAmount !== entry.newRentAmount || ymdOf(lease.expectedMoveOut) !== entry.newExpectedMoveOut) {
      return { ok: false, error: '연장 이후 계약이 수정되어 적용취소할 수 없습니다. 수정 폼에서 직접 되돌려 주세요.' }
    }
    const inMonth = ymdOf(lease.moveInDate)!.slice(0, 7)
    const paidAgg = await prisma.paymentRecord.aggregate({
      where: { leaseTermId, targetMonth: inMonth, isDeposit: false },
      _sum: { actualAmount: true },
    })
    if ((paidAgg._sum.actualAmount ?? 0) > entry.prevRentAmount) {
      return { ok: false, error: '연장 차액 수납이 이미 기록되어 적용취소할 수 없습니다. 수납 기록을 먼저 삭제해 주세요.' }
    }

    await prisma.$transaction(async tx => {
      const updated = await tx.leaseTerm.updateMany({
        where: { id: leaseTermId, propertyId, rentAmount: entry.newRentAmount },
        data: {
          rentAmount: entry.prevRentAmount,
          expectedMoveOut: entry.prevExpectedMoveOut ? new Date(entry.prevExpectedMoveOut) : null,
          status: entry.prevStatus as LeaseStatus,
          autoCheckoutAt: entry.prevAutoCheckoutAt ? new Date(entry.prevAutoCheckoutAt) : null,
          checkoutProratedAmount: entry.prevProration?.amount ?? null,
          checkoutProratedMonth: entry.prevProration?.month ?? null,
          checkoutProrationUndo: (entry.prevProration?.undo ?? Prisma.DbNull) as Prisma.InputJsonValue,
          shortStayExtensions: list.map((e, i) => i === idx ? { ...e, undoneAt: new Date().toISOString() } : e) as Prisma.InputJsonValue[],
        },
      })
      if (updated.count !== 1) throw new Error('CONFLICT')

      // 마커 소프트삭제 + 연장 시점 이후 생성된 입주월 record의 락 되쓰기(이전 누적으로)
      await tx.paymentRecord.updateMany({
        where: { id: entry.markerRecordId, leaseTermId },
        data: { deletedAt: new Date() },
      })
      await tx.paymentRecord.updateMany({
        where: { leaseTermId, targetMonth: inMonth, isDeposit: false, createdAt: { gte: new Date(entry.at) }, expectedAmount: { gt: entry.prevRentAmount } },
        data: { expectedAmount: entry.prevRentAmount },
      })
      if (lease.status !== entry.prevStatus) {
        await tx.tenantStatusLog.create({
          data: { tenantId: lease.tenantId, leaseTermId, propertyId, fromStatus: lease.status as LeaseStatus, toStatus: entry.prevStatus as LeaseStatus, changedById: user.sub, reason: '단기 연장 적용취소' },
        })
      }
      // isPaid 재계산 — 이전 누적 기준
      const records = await tx.paymentRecord.findMany({
        where: { leaseTermId, targetMonth: inMonth, isDeposit: false },
        orderBy: { payDate: 'asc' },
      })
      let cumulative = 0
      for (const rec of records) {
        cumulative += rec.actualAmount
        await tx.paymentRecord.update({ where: { id: rec.id }, data: { isPaid: cumulative >= entry.prevRentAmount } })
      }
    })

    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
    return { ok: true }
  } catch (err) {
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '적용취소 중 오류가 발생했습니다.' }
  }
}


// 입주자 일괄 수정 적용취소 — 항목별 원값 복원(v2.0 §16)
export type BatchTenantsUndo = {
  tenants: { id: string; fields: Record<string, unknown> }[]
  leases: { id: string; fields: Record<string, unknown> }[]
}

export async function undoBatchUpdateTenants(u: BatchTenantsUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      ...u.tenants.map(x => prisma.tenant.updateMany({ where: { id: x.id, propertyId }, data: x.fields as never })),
      ...u.leases.map(x => prisma.leaseTerm.updateMany({ where: { id: x.id, propertyId }, data: x.fields as never })),
    ])
    revalidatePath('/tenants'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}
