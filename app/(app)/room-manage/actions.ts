'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, deleteFromDrive } from '@/lib/google-drive'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { user, propertyId }
}

// 호실 목록 조회
export async function getRooms() {
  const { propertyId } = await getPropertyId()
  return prisma.room.findMany({
    where: { propertyId },
    include: {
      photos: { orderBy: { sortOrder: 'asc' } },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { id: true, name: true } },
        },
        take: 1,
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
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo = formData.get('memo') as string

  if (!roomNo?.trim()) return { ok: false, error: '호실 번호는 필수입니다.' }

  const existing = await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo: roomNo.trim() } },
  })
  if (existing) return { ok: false, error: `${roomNo}호는 이미 존재합니다.` }

  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null

  const room = await prisma.room.create({
    data: {
      propertyId,
      roomNo:   roomNo.trim(),
      type:     type || null,
      baseRent,
      memo:     memo || null,
      isVacant: true,
      windowType: windowType || null,
      direction:  direction || null,
      areaPyeong,
      areaM2,
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
export async function updateRoom(formData: FormData) {
  await requireEdit()

  const id      = formData.get('id') as string
  const roomNo  = formData.get('roomNo') as string
  const type    = formData.get('type') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo    = formData.get('memo') as string
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null

  // 가격 예약 시스템 필드
  const scheduledRentRaw = formData.get('scheduledRent')
  const scheduledRent    = scheduledRentRaw ? (Number(scheduledRentRaw) || null) : null
  const rentUpdateDateRaw = formData.get('rentUpdateDate') as string
  const rentUpdateDate   = rentUpdateDateRaw ? new Date(rentUpdateDateRaw) : null

  const prevRoom = await prisma.room.findUnique({ where: { id }, select: { baseRent: true } })

  await prisma.room.update({
    where: { id },
    data: {
      roomNo:    roomNo.trim(),
      type:      type || null,
      baseRent,
      memo:      memo || null,
      windowType: windowType || null,
      direction:  direction || null,
      areaPyeong,
      areaM2,
      scheduledRent,
      rentUpdateDate,
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
}

// 호실 삭제
export async function deleteRoom(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()

  const activeLeases = await prisma.leaseTerm.count({
    where: {
      roomId: id,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
    },
  })
  if (activeLeases > 0) return { ok: false, error: '거주중인 입주자가 있어 삭제할 수 없습니다.' }

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

// 호실 사진 업로드 (Google Drive)
// 외부 API(Google Drive)로 큰 버퍼 전송 → 콜드 스타트 합쳐 60초 가까이 걸릴 수 있어 maxDuration 명시
export const maxDuration = 60

export async function uploadRoomPhoto(
  formData: FormData
): Promise<{ ok: true; id: string; driveFileId: string | null; storageUrl: string; fileName: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const roomId = formData.get('roomId') as string
    const file = formData.get('photo') as File

    if (!file || file.size === 0) return { ok: false, error: '파일이 없습니다.' }
    if (!file.type.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop() ?? 'jpg'
    const uniqueName = `room_${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { fileId, thumbnailUrl } = await uploadToDrive(buffer, uniqueName, file.type)

    const lastPhoto = await prisma.roomPhoto.findFirst({
      where: { roomId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const photo = await prisma.roomPhoto.create({
      data: {
        roomId,
        storageUrl: thumbnailUrl,
        driveFileId: fileId,
        fileName: file.name,
        sortOrder: (lastPhoto?.sortOrder ?? 0) + 1,
      },
    })

    revalidatePath('/room-manage')
    return { ok: true, id: photo.id, driveFileId: photo.driveFileId, storageUrl: photo.storageUrl, fileName: photo.fileName }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    // 서버 로그에 에러 원문 출력 (Vercel 로그에서 확인 가능 — Drive 자격증명/네트워크 등 디버깅용)
    console.error('[uploadRoomPhoto] failed:', err)
    const msg = (err as Error).message ?? '업로드 실패'
    return { ok: false, error: `업로드 실패: ${msg}` }
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
      scheduledRent:  { not: null },
      rentUpdateDate: { lte: today },
    },
    select: { id: true, scheduledRent: true },
  })

  if (rooms.length === 0) return { updated: 0 }

  // 각 호실 업데이트 (baseRent 적용 + 예약 필드 초기화 + 활성 계약 rentAmount 동기화)
  await Promise.all(rooms.map(async room => {
    const newRent = room.scheduledRent!

    await prisma.room.update({
      where: { id: room.id },
      data: {
        baseRent:       newRent,
        scheduledRent:  null,
        rentUpdateDate: null,
      },
    })

    // 활성 계약의 rentAmount도 동기화
    await prisma.leaseTerm.updateMany({
      where: {
        roomId: room.id,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
      },
      data: { rentAmount: newRent },
    })
  }))

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')

  return { updated: rooms.length }
}

// ── 단일 호실 즉시 적용 ──────────────────────────────────────────────
// 공실 상태에서 예정 가격을 즉시 baseRent에 반영. 활성 계약이 있으면 rentAmount도 동기화.
export async function applyScheduledRentNow(roomId: string): Promise<{ ok: true; newRent: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { scheduledRent: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (room.scheduledRent == null) return { ok: false, error: '예정 가격이 설정되어 있지 않습니다.' }

    const newRent = room.scheduledRent

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
    return { ok: true, newRent }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}