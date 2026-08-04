'use server'

// 방 청소 이력 — 등록·완료·적용취소 (2026-08-05, 신고 b21e4e98).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다. 상태 관리 문제라
// **회계에 접점이 0이다.** 이 파일은 ExtraIncome 도 Expense 도 만들지 않는다.
// 비용 연결은 2단계이고, 그때도 Expense 를 만들어 id 를 걸 뿐 금액을 여기 복사하지 않는다.
//
// 적용하는 모든 기능에는 적용취소가 있어야 한다는 원칙에 따라 완료·건너뜀은 되돌릴 수 있다.
// 삭제는 소프트삭제다.

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'

export type CleaningReason = 'CHECKOUT' | 'AFTER_WORK' | 'DURING_STAY' | 'OTHER'
export type CleaningStatus = 'PLANNED' | 'DONE' | 'SKIPPED'
export type CleaningPerformer = 'SELF' | 'VENDOR' | 'THIRD_PARTY'

export const CLEANING_REASON_LABEL: Record<CleaningReason, string> = {
  CHECKOUT: '퇴실 청소', AFTER_WORK: '공사·도배 후', DURING_STAY: '입실 중 요청', OTHER: '기타',
}
export const CLEANING_PERFORMER_LABEL: Record<CleaningPerformer, string> = {
  SELF: '직접', VENDOR: '업체', THIRD_PARTY: '제3자',
}

export type CleaningRow = {
  id: string
  roomId: string
  roomNo: string
  reason: CleaningReason
  status: CleaningStatus
  scheduledDate: string | null
  doneDate: string | null
  performer: CleaningPerformer | null
  performerName: string | null
  memo: string | null
}

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/** 그 방의 청소 이력 — 최근 것부터. */
export async function getRoomCleanings(roomId: string): Promise<CleaningRow[]> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: { roomId, propertyId, deletedAt: null },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, reason: true, status: true, scheduledDate: true, doneDate: true,
      performer: true, performerName: true, memo: true, room: { select: { roomNo: true } },
    },
  })
  return rows.map(r => ({
    id: r.id, roomId: r.roomId, roomNo: r.room.roomNo,
    reason: r.reason as CleaningReason, status: r.status as CleaningStatus,
    scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
    performer: (r.performer as CleaningPerformer | null) ?? null,
    performerName: r.performerName, memo: r.memo,
  }))
}

/** 영업장 전체의 '아직 안 끝난' 청소 — 호실 카드 배지·필터가 쓴다. roomId 를 키로 돌려준다. */
export async function getOpenCleaningsByRoom(): Promise<Record<string, { status: CleaningStatus; scheduledDate: string | null }>> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: { propertyId, deletedAt: null, status: 'PLANNED' },
    select: { roomId: true, status: true, scheduledDate: true },
  })
  const out: Record<string, { status: CleaningStatus; scheduledDate: string | null }> = {}
  for (const r of rows) out[r.roomId] = { status: r.status as CleaningStatus, scheduledDate: ymd(r.scheduledDate) }
  return out
}

export async function createCleaning(input: {
  roomId: string
  reason: CleaningReason
  scheduledDate?: string | null
  leaseTermId?: string | null
  memo?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const row = await prisma.roomCleaning.create({
      data: {
        propertyId, roomId: input.roomId,
        leaseTermId: input.leaseTermId ?? null,
        reason: input.reason,
        scheduledDate: input.scheduledDate ? new Date(`${input.scheduledDate}T00:00:00`) : null,
        memo: input.memo?.trim() || null,
      },
      select: { id: true },
    })
    revalidatePath('/room-manage')
    return { ok: true, id: row.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '등록에 실패했습니다.' }
  }
}

/** 완료 처리. 되돌리면 예정으로 돌아간다 — 되돌리기가 없으면 오탭 한 번에 이력이 굳는다. */
export async function completeCleaning(input: {
  id: string
  doneDate: string
  performer: CleaningPerformer
  performerName?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id: input.id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({
      where: { id: input.id },
      data: {
        status: 'DONE',
        doneDate: new Date(`${input.doneDate}T00:00:00`),
        performer: input.performer,
        performerName: input.performerName?.trim() || null,
      },
    })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '처리에 실패했습니다.' }
  }
}

/** 완료·건너뜀을 예정으로 되돌린다. */
export async function reopenCleaning(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({
      where: { id },
      data: { status: 'PLANNED', doneDate: null, performer: null, performerName: null },
    })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

/** 안 하기로 함. 목록에서 지우지 않고 상태로 남긴다 — 지우면 왜 안 했는지가 사라진다. */
export async function skipCleaning(id: string, memo?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { status: 'SKIPPED', memo: memo?.trim() || undefined } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '처리에 실패했습니다.' }
  }
}

export async function deleteCleaning(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

/** 삭제 적용취소. */
export async function restoreCleaning(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}
