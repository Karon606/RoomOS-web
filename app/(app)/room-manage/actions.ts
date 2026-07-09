'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import {
  createDriveResumableSession,
  setDrivePublicReadable,
  buildDriveThumbnailUrl,
  deleteFromDrive,
} from '@/lib/google-drive'

async function getPropertyId() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId }
}

// 호실 목록 조회
export async function getRooms() {
  const { propertyId } = await getPropertyId()
  return prisma.room.findMany({
    where: { propertyId },
    include: {
      photos: { orderBy: { sortOrder: 'asc' } },
      leaseTerms: {
        // NON_RESIDENT 포함 — 창고·사무실 점유 표시(방 nonResidentVacant 설정과 연동, 2026-07-06)
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: {
          id: true,
          status: true,
          tenantId: true,
          tenant: { select: { id: true, name: true } },
        },
        // ACTIVE > CHECKOUT_PENDING > RESERVED 우선순위 정렬
        // (예약자보다 거주자가 호실의 '주' 점유자)
        orderBy: { status: 'asc' },
        take: 2,   // 거주 계약 + 비거주 계약 동시 존재 대비
      },
    },
    orderBy: { roomNo: 'asc' },
  })
}

// 호실 추가
export async function addRoom(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const roomNo = formData.get('roomNo') as string
  const type = formData.get('type') as string
  const tier = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo = formData.get('memo') as string

  if (!roomNo?.trim()) return { ok: false, error: '호실 번호는 필수입니다.' }

  const existing = await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo: roomNo.trim() } },
  })
  if (existing) return { ok: false, error: `${roomNo}호는 이미 존재합니다.` }

  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null

  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  const room = await prisma.room.create({
    data: {
      propertyId,
      roomNo:   roomNo.trim(),
      type:     type || null,
      tier:     tier || null,
      baseRent,
      memo:     memo || null,
      isVacant: true,
      floor,
      windowType: windowType || null,
      direction:  direction || null,
      areaPyeong,
      areaM2,
      nonResidentRent,
      nonResidentScheduled,
      nonResidentRentDate,
    },
  })

  revalidatePath('/room-manage')
  return { ok: true, id: room.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 수정
export async function updateRoom(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit()

  const id      = formData.get('id') as string
  const roomNo  = formData.get('roomNo') as string
  const type    = formData.get('type') as string
  const tier    = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo    = formData.get('memo') as string
  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null
  // 방 특성 (2026-07-06) — 체크박스: 켜짐 '1', 꺼짐 미전송
  const noMoveInReport    = formData.get('noMoveInReport') === '1'
  const nonResidentVacant = formData.get('nonResidentVacant') !== '0'   // 기본 켜짐(공실로 표시)

  // 가격 예약 시스템 필드
  const scheduledRentRaw = formData.get('scheduledRent')
  const scheduledRent    = scheduledRentRaw ? (Number(scheduledRentRaw) || null) : null
  const rentUpdateDateRaw = formData.get('rentUpdateDate') as string
  const rentUpdateDate   = rentUpdateDateRaw ? new Date(rentUpdateDateRaw) : null

  // 예약 인상/인하: 적용일 없는 예약은 청구(effectiveBaseRent)도 적용 스케줄러도 동작 안 함(영구 방치).
  // → 예약 이용료와 적용 예정일은 반드시 함께 입력(둘 다 있거나 둘 다 없거나).
  if ((scheduledRent != null) !== (rentUpdateDate != null)) {
    return { ok: false, error: '예약 이용료와 적용 예정일은 함께 입력해야 합니다. (적용일이 없으면 인상·인하가 적용되지 않습니다)' }
  }

  // 비거주 이용료 필드
  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  const prevRoom = await prisma.room.findUnique({ where: { id }, select: { baseRent: true } })

  await prisma.room.update({
    where: { id },
    data: {
      roomNo:    roomNo.trim(),
      type:      type || null,
      tier:      tier || null,
      baseRent,
      memo:      memo || null,
      floor,
      windowType: windowType || null,
      direction:  direction || null,
      noMoveInReport,
      nonResidentVacant,
      areaPyeong,
      areaM2,
      scheduledRent,
      rentUpdateDate,
      nonResidentRent,
      nonResidentScheduled,
      nonResidentRentDate,
    },
  })

  // baseRent 변경 시 활성 계약의 rentAmount 동기화
  if (prevRoom && prevRoom.baseRent !== baseRent) {
    await prisma.leaseTerm.updateMany({
      where: {
        roomId: id,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
      },
      data: { rentAmount: baseRent },
    })
  }

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')
  return { ok: true }
}

// 호실 삭제 — 과거 계약·수납(매출) 기록까지 연쇄 영구 삭제되므로,
// 이력이 있으면 1차 호출은 건수를 알려주며 거부하고 force 재호출에서만 실제 삭제(정보 동의 단계).
export async function deleteRoom(id: string, opts?: { force?: boolean }): Promise<
  { ok: true } | { ok: false; error: string; needsForce?: boolean; leases?: number; payments?: number }
> {
  try {
  await requireEdit()

  const activeLeases = await prisma.leaseTerm.count({
    where: {
      roomId: id,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
    },
  })
  if (activeLeases > 0) return { ok: false, error: '거주중인 입주자가 있어 삭제할 수 없습니다.' }

  // 과거 이력 확인 — 복구 불가 삭제임을 건수와 함께 동의받는다
  const pastLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))
  if (pastLeaseIds.length > 0 && !opts?.force) {
    const payments = await prisma.paymentRecord.count({ where: { leaseTermId: { in: pastLeaseIds } } })
    return {
      ok: false, needsForce: true, leases: pastLeaseIds.length, payments,
      error: `과거 계약 ${pastLeaseIds.length}건·수납 기록 ${payments}건이 함께 영구 삭제됩니다.`,
    }
  }

  // Drive 파일 정리
  const photos = await prisma.roomPhoto.findMany({ where: { roomId: id }, select: { driveFileId: true } })
  await Promise.allSettled(
    photos.filter(p => p.driveFileId).map(p => deleteFromDrive(p.driveFileId!))
  )

  // 과거 계약 기록 정리 (LeaseTerm → Room FK에 cascade 없어서 수동 처리)
  // 삭제 순서: TenantStatusLog → LeaseTerm (PaymentRecord는 LeaseTerm cascade로 자동 삭제)
  const oldLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))

  if (oldLeaseIds.length > 0) {
    await prisma.tenantStatusLog.deleteMany({ where: { leaseTermId: { in: oldLeaseIds } } })
    await prisma.leaseTerm.deleteMany({ where: { id: { in: oldLeaseIds } } })
  }

  await prisma.room.delete({ where: { id } })
  revalidatePath('/room-manage')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 사진 업로드 — 클라이언트 직접 업로드 방식 (Vercel 페이로드 한도 우회)
// 흐름: createPhotoUploadSession → 클라이언트가 Drive에 직접 PUT → finalizeRoomPhoto

const MAX_PHOTO_BYTES = 50 * 1024 * 1024 // 50MB

export async function createPhotoUploadSession(input: {
  roomId: string
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.roomId) return { ok: false, error: '호실 정보가 없습니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_PHOTO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }

    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `room_${input.roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[createPhotoUploadSession] failed:', err)
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeRoomPhoto(input: {
  roomId: string
  driveFileId: string
  fileName: string
}): Promise<{ ok: true; id: string; driveFileId: string; storageUrl: string; fileName: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }

    // 링크 있는 사람 누구나 열람 가능하도록 권한 설정
    await setDrivePublicReadable(input.driveFileId)

    const lastPhoto = await prisma.roomPhoto.findFirst({
      where: { roomId: input.roomId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const photo = await prisma.roomPhoto.create({
      data: {
        roomId: input.roomId,
        storageUrl: buildDriveThumbnailUrl(input.driveFileId, 400),
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        sortOrder: (lastPhoto?.sortOrder ?? 0) + 1,
      },
    })

    revalidatePath('/room-manage')
    return {
      ok: true,
      id: photo.id,
      driveFileId: photo.driveFileId!,
      storageUrl: photo.storageUrl,
      fileName: photo.fileName ?? input.fileName,
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[finalizeRoomPhoto] failed:', err)
    // DB 저장 실패 시 Drive 파일은 정리 (orphan 방지)
    if (input.driveFileId) {
      try { await deleteFromDrive(input.driveFileId) } catch { /* 정리 실패는 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

// 호실 사진 삭제 (Google Drive)
export async function deleteRoomPhoto(photoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()

    const photo = await prisma.roomPhoto.findUnique({ where: { id: photoId } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }

    if (photo.driveFileId) {
      await deleteFromDrive(photo.driveFileId)
    }

    await prisma.roomPhoto.delete({ where: { id: photoId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── [Trigger B] 예약된 가격 일괄 적용 ────────────────────────────────
// 호실의 rentUpdateDate가 오늘 이전이면 baseRent를 scheduledRent로 업데이트하고 예약 필드 초기화.
// 호실 관리 페이지 로드 시 자동 실행되며, API 라우트(/api/cron/apply-rents)에서도 호출됨.
export async function applyScheduledRents() {
  const { propertyId } = await getPropertyId()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 날짜가 오늘 이전이고 scheduledRent가 있는 호실 조회
  const rooms = await prisma.room.findMany({
    where: {
      propertyId,
      OR: [
        { scheduledRent: { not: null }, rentUpdateDate: { lte: today } },
        { nonResidentScheduled: { not: null }, nonResidentRentDate: { lte: today } },
      ],
    },
    select: {
      id: true,
      scheduledRent: true,
      rentUpdateDate: true,
      nonResidentScheduled: true,
      nonResidentRentDate: true,
    },
  })

  if (rooms.length === 0) return { updated: 0 }

  // 각 호실 업데이트 (baseRent 적용 + 예약 필드 초기화 + 활성 계약 rentAmount 동기화)
  await Promise.all(rooms.map(async room => {
    const data: Record<string, unknown> = {}

    if (room.scheduledRent != null && room.rentUpdateDate && room.rentUpdateDate <= today) {
      data.baseRent      = room.scheduledRent
      data.scheduledRent = null
      data.rentUpdateDate = null
    }
    if (room.nonResidentScheduled != null && room.nonResidentRentDate && room.nonResidentRentDate <= today) {
      data.nonResidentRent      = room.nonResidentScheduled
      data.nonResidentScheduled = null
      data.nonResidentRentDate  = null
    }
    if (Object.keys(data).length === 0) return

    await prisma.room.update({ where: { id: room.id }, data })

    if (data.baseRent != null) {
      await prisma.leaseTerm.updateMany({
        where: { roomId: room.id, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        data: { rentAmount: data.baseRent as number },
      })
    }
  }))

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')

  return { updated: rooms.length }
}

// ── 단일 호실 즉시 적용 ──────────────────────────────────────────────
// 공실 상태에서 예정 가격을 즉시 baseRent에 반영. 활성 계약이 있으면 rentAmount도 동기화.
export type ScheduledRentUndo = {
  roomId: string; prevBaseRent: number; prevScheduledRent: number; prevRentUpdateDate: string | null
  leases: { id: string; prevRentAmount: number }[]
}

export async function applyScheduledRentNow(roomId: string): Promise<{ ok: true; newRent: number; undo: ScheduledRentUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { baseRent: true, scheduledRent: true, rentUpdateDate: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (room.scheduledRent == null) return { ok: false, error: '예정 가격이 설정되어 있지 않습니다.' }

    const newRent = room.scheduledRent
    // 되돌리기 스냅샷 — 적용 전 월세·예약 필드·활성 계약별 rentAmount (감사 2026-07-10)
    const leases = await prisma.leaseTerm.findMany({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { id: true, rentAmount: true },
    })
    const undo: ScheduledRentUndo = {
      roomId, prevBaseRent: room.baseRent, prevScheduledRent: newRent,
      prevRentUpdateDate: room.rentUpdateDate ? room.rentUpdateDate.toISOString() : null,
      leases: leases.map(l => ({ id: l.id, prevRentAmount: l.rentAmount })),
    }

    await prisma.room.update({
      where: { id: roomId },
      data: {
        baseRent:       newRent,
        scheduledRent:  null,
        rentUpdateDate: null,
      },
    })

    await prisma.leaseTerm.updateMany({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      data: { rentAmount: newRent },
    })

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, newRent, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 예정 가격 즉시 적용 적용취소 — 월세·예약 필드·계약별 금액을 스냅샷으로 복원
export async function undoApplyScheduledRent(u: ScheduledRentUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: u.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.room.update({ where: { id: u.roomId }, data: {
        baseRent: u.prevBaseRent, scheduledRent: u.prevScheduledRent,
        rentUpdateDate: u.prevRentUpdateDate ? new Date(u.prevRentUpdateDate) : null,
      } }),
      ...u.leases.map(l => prisma.leaseTerm.update({ where: { id: l.id }, data: { rentAmount: l.prevRentAmount } })),
    ])
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 일괄 편집
export async function batchUpdateRooms(
  roomIds: string[],
  data: {
    type?: string | null
    tier?: string | null
    baseRent?: number
    scheduledRent?: number | null
    rentUpdateDate?: Date | string | null
    windowType?: string | null
    direction?: string | null
  },
): Promise<{ ok: true; count: number; skippedNegotiated?: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (roomIds.length === 0) return { ok: false, error: '선택된 호실이 없습니다.' }
    if (Object.keys(data).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }

    // 예약 이용료는 적용 예정일과 함께여야 함(적용일 없으면 인상·인하가 적용 안 됨). 예약 삭제 시 적용일도 함께 제거.
    if (data.scheduledRent != null && data.rentUpdateDate == null) {
      return { ok: false, error: '예약 이용료를 설정하려면 적용 예정일도 함께 지정해야 합니다.' }
    }
    if (data.scheduledRent === null) data.rentUpdateDate = null
    if (typeof data.rentUpdateDate === 'string') data.rentUpdateDate = new Date(data.rentUpdateDate)

    // baseRent 동기화 판정용 — 변경 전 기준가 확보 (updateMany 가 덮어쓰기 전에)
    const prevRents = data.baseRent != null
      ? await prisma.room.findMany({ where: { id: { in: roomIds }, propertyId }, select: { id: true, baseRent: true } })
      : []

    const r = await prisma.room.updateMany({
      where: { id: { in: roomIds }, propertyId },
      data,
    })

    // baseRent 변경 시 활성 계약의 rentAmount 동기화 — 단, 계약별 협의 임대료
    // (방 기준가와 다르게 설정된 rentAmount)는 덮어쓰지 않는다. 일괄 변경이
    // 개별 협의가를 흔적 없이 지우던 문제 방지.
    let skippedNegotiated = 0
    if (data.baseRent != null) {
      for (const room of prevRents) {
        const synced = await prisma.leaseTerm.updateMany({
          where: {
            roomId: room.id,
            status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
            rentAmount: room.baseRent,   // 기준가 그대로 쓰던 계약만 따라감
          },
          data: { rentAmount: data.baseRent },
        })
        const total = await prisma.leaseTerm.count({
          where: { roomId: room.id, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        })
        skippedNegotiated += total - synced.count
      }
    }

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, count: r.count, skippedNegotiated }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}