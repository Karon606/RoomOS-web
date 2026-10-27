'use server'

// 방 점검(퇴실 점검·청소 검수·입실 전 점검) 조회·항목 체크·완료·적용취소 서버 액션 (2026-10-27, 신고 2911c217).
//
// 신고는 "퇴실·청소 뒤 확인할 것을 때맞춰 띄워 달라" 였다. 519호 입실 고객이 청소가 덜 됐고 외부 신발장에 남의 신발이 있다고
// 항의했다. 청소 완료가 완료일·수행자·비용만 받는 사건이라 결과를 확인할 자리가 없었다.
//
// 모든 쓰기는 이 영업장 행만 고른다(where { id, propertyId }). 모든 쓰기에 적용취소가 있다.
//   항목 결과 ↔ 이전 결과(setInspectionItemResult 가 이전 값을 돌려준다) · 항목 더하기 ↔ 항목 삭제 · 항목 삭제 ↔ 되살리기(스냅샷)
//   완료·안 함 ↔ 예정으로 되돌리기 · 삭제(소프트) ↔ 복원 · 손수 등록 ↔ 삭제.
// 끝냈거나 안 하기로 한 점검의 항목은 못 고친다(INSPECTION_LOCKED). 기록이 굳은 뒤에 결과가 조용히 바뀌지 않게 한다.
//
// 만드는 길은 둘이다. 퇴실·청소 완료가 부르는 자동 생성(lib/roomInspectionEnsure, 화면이 못 부른다)과 여기 손수 등록(빈 방용).
// 회계에 접점이 없다.

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { ymdToDbDate } from '@/lib/kstDate'
import { assertNotFuture } from '@/lib/completionDate'
import { normalizeCategoryInput } from '@/lib/categoryInput'
import { withParticle } from '@/lib/koParticle'
import { createRoomInspection, openMoveInInspectionSummary } from '@/lib/roomInspectionEnsure'
import { signRoomRecordEdit } from '@/lib/roomRecordEditSign'
import { ROOM_RECORD_STALE, type RoomRecordEditUndo } from '@/lib/roomRecordEditUndo'
import {
  INSPECTION_STAGES, INSPECTION_RESULTS, INSPECTION_SOURCES, INSPECTION_STAGE_LABEL,
  INSPECTION_GONE, INSPECTION_ITEM_GONE, INSPECTION_LOCKED, INSPECTION_LABEL_MAX,
  type InspectionRow, type InspectionItemRow, type InspectionStage, type InspectionStatus,
  type InspectionItemResult, type InspectionItemSource, type InspectionItemSnapshot, type InspectionItemPrev,
} from './inspectionConstants'

type Fail = { ok: false; error: string }
const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const errorOf = (err: unknown, fallback: string): Fail => ({ ok: false, error: (err as Error)?.message || fallback })

/**
 * 점검 행 조회 공통부. 방 하나든 영업장 전체든 같은 모양이다(청소 loadCleaningRows 와 같은 이유).
 * 항목은 안 싣고 수만 센다. 결과별 수는 한 번의 groupBy 로 센다.
 */
async function loadInspectionRows(where: { propertyId: string; roomId?: string }, opts: { includeDeleted?: boolean } = {}): Promise<InspectionRow[]> {
  const rows = await prisma.roomInspection.findMany({
    where: { ...where, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, leaseTermId: true, cleaningId: true, stage: true, status: true,
      scheduledDate: true, doneDate: true, memo: true, deletedAt: true, updatedAt: true,
      room: { select: { roomNo: true } },
    },
  })
  const ids = rows.map(r => r.id)
  const groups = ids.length
    ? await prisma.roomInspectionItem.groupBy({ by: ['inspectionId', 'result'], where: { propertyId: where.propertyId, inspectionId: { in: ids } }, _count: { _all: true } })
    : []
  const tally = new Map<string, { total: number; checked: number; ng: number }>()
  for (const g of groups) {
    const t = tally.get(g.inspectionId) ?? { total: 0, checked: 0, ng: 0 }
    t.total += g._count._all
    if (g.result !== 'PENDING') t.checked += g._count._all
    if (g.result === 'NG') t.ng += g._count._all
    tally.set(g.inspectionId, t)
  }
  return rows.map(r => ({
    id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, leaseTermId: r.leaseTermId, cleaningId: r.cleaningId,
    stage: r.stage as InspectionStage, status: r.status as InspectionStatus,
    scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate), memo: r.memo, updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    ...(tally.get(r.id) ?? { total: 0, checked: 0, ng: 0 }),
  }))
}

/** 방 하나의 점검. includeDeleted 는 방 모달 편집 모드의 '삭제된 기록 보기'(§16 2순위 진입점)가 쓴다. */
export async function getRoomInspections(roomId: string, opts: { includeDeleted?: boolean } = {}): Promise<InspectionRow[]> {
  const { propertyId } = await requirePropertyAccess()
  return loadInspectionRows({ propertyId, roomId }, opts)
}

/** 영업장 전체 점검. 호실 관리 '작업' 뷰와 카드 배지가 같은 한 벌을 쓴다. 삭제분도 함께 싣는다(그 화면의 '삭제됨' 이 복원 문이다). */
export async function getPropertyInspections(): Promise<InspectionRow[]> {
  const { propertyId } = await requirePropertyAccess()
  return loadInspectionRows({ propertyId }, { includeDeleted: true })
}

/** 한 점검의 항목(펼칠 때 읽는다). 삭제된 점검도 읽는다(복원 전에 무엇이었는지 볼 수 있게). */
export async function getInspectionItems(inspectionId: string): Promise<InspectionItemRow[]> {
  const { propertyId } = await requirePropertyAccess()
  const items = await prisma.roomInspectionItem.findMany({
    where: { inspectionId, propertyId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, label: true, sortOrder: true, source: true, result: true, note: true, checkedAt: true },
  })
  return items.map(i => ({
    id: i.id, label: i.label, sortOrder: i.sortOrder, source: i.source as InspectionItemSource,
    result: i.result as InspectionItemResult, note: i.note, checkedAt: i.checkedAt ? i.checkedAt.toISOString() : null,
  }))
}

/** 그 방의 열린 입실 전 점검 진행(입주자 상태 위젯의 '입실 처리' 앞 안내 줄). 없으면 null. */
export async function getOpenMoveInInspection(roomId: string): Promise<{ id: string; checked: number; total: number } | null> {
  const { propertyId } = await requirePropertyAccess()
  return openMoveInInspectionSummary(propertyId, roomId)
}

/**
 * 손수 등록(방 모달(호실 상세) 작업 이력의 '점검 등록', 2026-10-27 운영자 결정 ①). 배포 전에 이미 빈 방처럼 자동 생성이 안 지나간 방을 위한 문이다.
 * 같은 방에 같은 단계의 열린 점검이 있으면 막는다(자동 생성과 같은 판정). 적용취소는 삭제(deleteInspection)다.
 */
export async function createInspection(input: { roomId: string; stage: InspectionStage; scheduledDate?: string | null }): Promise<{ ok: true; id: string; itemCount: number } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    if (!INSPECTION_STAGES.includes(input.stage)) return { ok: false, error: '점검 단계를 골라 주세요.' }
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const open = await prisma.roomInspection.findFirst({
      where: { propertyId, roomId: input.roomId, stage: input.stage, status: 'PLANNED', deletedAt: null },
      select: { id: true },
    })
    if (open) return { ok: false, error: `이 호실에는 아직 안 끝난 ${withParticle(INSPECTION_STAGE_LABEL[input.stage], '이/가')} 있습니다. 그 점검을 마치거나 안 하기로 한 뒤 등록하면 됩니다.` }
    const date = input.scheduledDate ? ymdToDbDate(input.scheduledDate) : null
    if (date && Number.isNaN(date.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    const made = await createRoomInspection(propertyId, { roomId: input.roomId, stage: input.stage, scheduledDate: date })
    revalidatePath('/room-manage')
    return { ok: true, id: made.id, itemCount: made.itemCount }
  } catch (err) { return errorOf(err, '등록에 실패했습니다.') }
}

/** 항목을 고칠 수 있는가. 그 영업장의 살아 있는 예정 점검의 항목이어야 한다. */
async function editableItem(propertyId: string, itemId: string) {
  const cur = await prisma.roomInspectionItem.findFirst({
    where: { id: itemId, propertyId },
    select: { id: true, inspectionId: true, label: true, sortOrder: true, source: true, expenseId: true, result: true, note: true, checkedAt: true },
  })
  if (!cur) return { ok: false as const, error: INSPECTION_ITEM_GONE }
  const insp = await prisma.roomInspection.findFirst({ where: { id: cur.inspectionId, propertyId, deletedAt: null }, select: { status: true } })
  if (!insp) return { ok: false as const, error: INSPECTION_GONE }
  if (insp.status !== 'PLANNED') return { ok: false as const, error: INSPECTION_LOCKED }
  return { ok: true as const, cur }
}

/**
 * 항목 결과 하나를 바로 저장한다(§27.1 단일 값 즉시 반영). 이전 값을 돌려준다(토스트 적용취소).
 *
 * checkedAt 은 결과를 누른 시각이라 로그다(완료일과 다른 축, check-completion-date-axis ALLOW). 결과를 '미확인'으로 되돌리면 비운다.
 * 적용취소는 restoreCheckedAt 에 이전 시각을 실어 보낸다. 서버는 지금보다 앞선 올바른 시각만 받는다.
 * note 를 안 보내면(undefined) 메모는 그대로다. 문제(NG)를 지워도 메모는 남긴다(다시 문제로 돌리면 쓴 말이 돌아온다).
 */
export async function setInspectionItemResult(input: {
  itemId: string
  result: InspectionItemResult
  note?: string | null
  restoreCheckedAt?: string | null
}): Promise<{ ok: true; prev: InspectionItemPrev; item: InspectionItemRow } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    if (!INSPECTION_RESULTS.includes(input.result)) return { ok: false, error: '결과를 확인하지 못했습니다.' }
    const got = await editableItem(propertyId, input.itemId)
    if (!got.ok) return { ok: false, error: got.error }
    const cur = got.cur
    const note = input.note === undefined ? cur.note : (input.note?.trim().slice(0, 500) || null)
    const restoreAt = input.restoreCheckedAt ? new Date(input.restoreCheckedAt) : null
    const restoreOk = !!restoreAt && !Number.isNaN(restoreAt.getTime()) && restoreAt.getTime() <= Date.now()
    let saved: { checkedAt: Date | null }
    if (input.result === 'PENDING') {
      saved = await prisma.roomInspectionItem.update({ where: { id: cur.id, propertyId }, data: { result: input.result, note, checkedAt: null }, select: { checkedAt: true } })
    } else if (restoreOk) {
      saved = await prisma.roomInspectionItem.update({ where: { id: cur.id, propertyId }, data: { result: input.result, note, checkedAt: restoreAt }, select: { checkedAt: true } })
    } else {
      saved = await prisma.roomInspectionItem.update({ where: { id: cur.id, propertyId }, data: { result: input.result, note, checkedAt: new Date() }, select: { checkedAt: true } })
    }
    // 항목 쓰기는 화면을 다시 그리지 않는다(독립 검수 R1). 행이 들고 있는 항목을 서버 응답으로 바로 고치고, 수·배지는
    // 점검 상태 쓰기(완료·안 함·삭제·되살림)나 다음 조회 때 맞춰진다. 체크마다 영업장 전체 목록을 다시 읽던 비용을 걷는다.
    return {
      ok: true,
      prev: { result: cur.result as InspectionItemResult, note: cur.note, checkedAt: cur.checkedAt ? cur.checkedAt.toISOString() : null },
      item: {
        id: cur.id, label: cur.label, sortOrder: cur.sortOrder, source: cur.source as InspectionItemSource,
        result: input.result, note, checkedAt: saved.checkedAt ? saved.checkedAt.toISOString() : null,
      },
    }
  } catch (err) { return errorOf(err, '저장에 실패했습니다.') }
}

/** 손수 항목 더하기(공유기·셋탑처럼 목록에 없는 것). 맨 끝에 선다. 적용취소는 removeInspectionItem 이다. */
export async function addInspectionItem(input: { inspectionId: string; label: string }): Promise<{ ok: true; item: InspectionItemRow } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const label = normalizeCategoryInput(input.label).slice(0, INSPECTION_LABEL_MAX)
    if (!label) return { ok: false, error: '항목 이름을 적어 주세요.' }
    const insp = await prisma.roomInspection.findFirst({ where: { id: input.inspectionId, propertyId, deletedAt: null }, select: { status: true } })
    if (!insp) return { ok: false, error: INSPECTION_GONE }
    if (insp.status !== 'PLANNED') return { ok: false, error: INSPECTION_LOCKED }
    const last = await prisma.roomInspectionItem.findFirst({ where: { inspectionId: input.inspectionId, propertyId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const row = await prisma.roomInspectionItem.create({
      data: { inspectionId: input.inspectionId, propertyId, label, sortOrder: (last?.sortOrder ?? -1) + 1, source: 'MANUAL' },
      select: { id: true, sortOrder: true },
    })
    return { ok: true, item: { id: row.id, label, sortOrder: row.sortOrder, source: 'MANUAL', result: 'PENDING', note: null, checkedAt: null } }
  } catch (err) { return errorOf(err, '추가에 실패했습니다.') }
}

/**
 * 항목 빼기(그 방에 없는 비품, 잘못 더한 항목). 항목 표에는 소프트삭제 칸이 없어 지우고, 되살릴 스냅샷을 돌려준다(토스트 적용취소).
 * 영업장 목록에서는 안 빠진다. 다음 점검에도 그 항목이 서면 분류 관리에서 목록을 고치면 된다.
 */
export async function removeInspectionItem(itemId: string): Promise<{ ok: true; snapshot: InspectionItemSnapshot } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const got = await editableItem(propertyId, itemId)
    if (!got.ok) return { ok: false, error: got.error }
    const cur = got.cur
    await prisma.roomInspectionItem.delete({ where: { id: cur.id, propertyId } })
    return {
      ok: true,
      snapshot: {
        inspectionId: cur.inspectionId, label: cur.label, sortOrder: cur.sortOrder, source: cur.source as InspectionItemSource,
        expenseId: cur.expenseId, result: cur.result as InspectionItemResult, note: cur.note,
        checkedAt: cur.checkedAt ? cur.checkedAt.toISOString() : null,
      },
    }
  } catch (err) { return errorOf(err, '삭제에 실패했습니다.') }
}

/**
 * 항목 빼기 적용취소. 스냅샷은 화면을 거쳐 왔으므로 칸마다 다시 본다. 점검은 이 영업장의 살아 있는 예정 점검이어야 하고,
 * 비품 행 id 는 이 영업장 지출일 때만 남긴다(표시용이라 아니면 비운다). 확인 시각은 지금보다 앞선 올바른 시각만 받는다.
 */
export async function restoreInspectionItem(snapshot: InspectionItemSnapshot): Promise<{ ok: true; item: InspectionItemRow } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const insp = await prisma.roomInspection.findFirst({ where: { id: snapshot.inspectionId, propertyId, deletedAt: null }, select: { status: true } })
    if (!insp) return { ok: false, error: INSPECTION_GONE }
    if (insp.status !== 'PLANNED') return { ok: false, error: INSPECTION_LOCKED }
    const label = normalizeCategoryInput(snapshot.label).slice(0, INSPECTION_LABEL_MAX)
    if (!label) return { ok: false, error: '되살릴 항목을 확인하지 못했습니다.' }
    const source: InspectionItemSource = INSPECTION_SOURCES.includes(snapshot.source) ? snapshot.source : 'MANUAL'
    const result: InspectionItemResult = INSPECTION_RESULTS.includes(snapshot.result) ? snapshot.result : 'PENDING'
    const sortOrder = Number.isInteger(snapshot.sortOrder) ? snapshot.sortOrder : 0
    const expenseOk = !!snapshot.expenseId && UUID.test(snapshot.expenseId)
      && !!(await prisma.expense.findFirst({ where: { id: snapshot.expenseId, propertyId }, select: { id: true } }))
    const at = snapshot.checkedAt ? new Date(snapshot.checkedAt) : null
    const checkedAt = result !== 'PENDING' && at && !Number.isNaN(at.getTime()) && at.getTime() <= Date.now() ? at : null
    const note = snapshot.note?.trim().slice(0, 500) || null
    const row = await prisma.roomInspectionItem.create({
      data: { inspectionId: snapshot.inspectionId, propertyId, label, sortOrder, source, expenseId: expenseOk ? snapshot.expenseId : null, result, checkedAt, note },
      select: { id: true },
    })
    return { ok: true, item: { id: row.id, label, sortOrder, source, result, note, checkedAt: checkedAt ? checkedAt.toISOString() : null } }
  } catch (err) { return errorOf(err, '되살리지 못했습니다.') }
}

/** 살아 있는 점검을 이 영업장 안에서 찾는다. */
async function liveInspection(propertyId: string, id: string) {
  return prisma.roomInspection.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true, status: true, roomId: true, stage: true } })
}

/**
 * 이 점검을 예정으로 세우면 같은 방·같은 단계의 예정 점검이 둘이 되는가(독립 검수 R7). 되면 손수 등록과 같은 정본 문형의 까닭을 준다.
 * 열린 할 일이 둘 서면 '청소 필요' 처럼 숫자가 실제보다 커지고, 어느 쪽을 체크해야 하는지 갈린다.
 */
async function openSiblingError(propertyId: string, row: { id: string; roomId: string; stage: string }): Promise<string | null> {
  const other = await prisma.roomInspection.findFirst({
    where: { propertyId, roomId: row.roomId, stage: row.stage, status: 'PLANNED', deletedAt: null, id: { not: row.id } },
    select: { id: true },
  })
  if (!other) return null
  const label = INSPECTION_STAGE_LABEL[row.stage as InspectionStage] ?? '점검'
  return `이 호실에는 아직 안 끝난 ${withParticle(label, '이/가')} 있습니다. 그 점검을 마치거나 안 하기로 한 뒤 되돌리면 됩니다.`
}

/**
 * 점검 완료. 완료일은 운영자가 고른다(lib/completionDate, 미래 거부 두 겹). 적용취소는 reopenInspection 이다.
 * 확인 안 한 항목이 남아 있어도 막지 않는다(화면이 확인창으로 한 번 묻는다). 그 항목은 미확인 그대로 남는다.
 */
export async function completeInspection(input: { id: string; doneDate: string }): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId, userId } = await requirePropertyAccess()
    const cur = await liveInspection(propertyId, input.id)
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    if (cur.status !== 'PLANNED') return { ok: false, error: '이미 완료했거나 안 하기로 한 점검입니다.' }
    const fg = assertNotFuture(input.doneDate)
    if (!fg.ok) return { ok: false, error: fg.reason }
    const doneDate = ymdToDbDate(input.doneDate)
    if (Number.isNaN(doneDate.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    await prisma.roomInspection.update({ where: { id: cur.id, propertyId }, data: { status: 'DONE', doneDate, doneBy: userId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) { return errorOf(err, '처리에 실패했습니다.') }
}

/** 완료·안 함을 예정으로 되돌린다(§16 적용취소). 항목 결과는 그대로 둔다. */
export async function reopenInspection(id: string): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await liveInspection(propertyId, id)
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    const clash = await openSiblingError(propertyId, cur)
    if (clash) return { ok: false, error: clash }
    await prisma.roomInspection.update({ where: { id: cur.id, propertyId }, data: { status: 'PLANNED', doneDate: null, doneBy: null } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) { return errorOf(err, '되돌리기에 실패했습니다.') }
}

/**
 * 점검 **한 건** 수정(2026-10-27 승인 계획 2단계). 행 [수정] → Modal 폼이 부른다. 예정 점검은 예정일(비울 수 있다)과 메모,
 * 끝낸 점검(완료·안 함)은 메모만 고친다(항목 판정은 행 안에서 그대로, 끝낸 점검의 항목 잠금도 그대로다).
 * 열었을 때의 updatedAt 과 지금이 다르면 거부한다(조건부 쓰기). 저장 직전 모습을 서명 토큰으로 돌려준다(undoRoomRecordEdit).
 */
export async function updateInspection(input: {
  id: string; expectedUpdatedAt: string; scheduledDate?: string | null; memo?: string | null
}): Promise<{ ok: true; undo: RoomRecordEditUndo | null } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomInspection.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: { id: true, status: true, scheduledDate: true, memo: true, updatedAt: true },
    })
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    if (cur.updatedAt.toISOString() !== input.expectedUpdatedAt) return { ok: false, error: ROOM_RECORD_STALE }
    const memo = input.memo?.trim() || null
    if (memo && memo.length > 500) return { ok: false, error: '메모는 500자까지 적습니다.' }
    let scheduledDate = cur.scheduledDate
    if (input.scheduledDate !== undefined && ymd(cur.scheduledDate) !== (input.scheduledDate || null)) {
      if (cur.status !== 'PLANNED') return { ok: false, error: '끝낸 점검은 메모만 고칩니다. 날짜를 고치려면 완료나 안 함을 먼저 적용취소합니다.' }
      scheduledDate = input.scheduledDate ? ymdToDbDate(input.scheduledDate) : null
      if (scheduledDate && Number.isNaN(scheduledDate.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    }
    const w = await prisma.roomInspection.updateMany({
      where: { id: cur.id, propertyId, deletedAt: null, updatedAt: cur.updatedAt },
      data: { scheduledDate, memo },
    })
    if (w.count !== 1) return { ok: false, error: ROOM_RECORD_STALE }
    revalidatePath('/room-manage')
    return {
      ok: true,
      undo: signRoomRecordEdit(propertyId, {
        kind: 'inspection', id: cur.id,
        before: { scheduledDate: ymd(cur.scheduledDate), memo: cur.memo },
        after: { scheduledDate: ymd(scheduledDate), memo },
      }),
    }
  } catch (err) { return errorOf(err, '수정에 실패했습니다.') }
}

/** 안 하기로 함. 지우지 않고 상태로 남긴다(청소 '안 하기로' 와 같은 문법). 적용취소는 reopenInspection 이다. */
export async function skipInspection(id: string): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await liveInspection(propertyId, id)
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    if (cur.status !== 'PLANNED') return { ok: false, error: '이미 완료했거나 안 하기로 한 점검입니다.' }
    await prisma.roomInspection.update({ where: { id: cur.id, propertyId }, data: { status: 'SKIPPED' } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) { return errorOf(err, '처리에 실패했습니다.') }
}

/** 삭제(소프트). 항목은 그대로 남아 복원하면 함께 돌아온다. 적용취소는 restoreInspection 이다. */
export async function deleteInspection(id: string): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await liveInspection(propertyId, id)
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    await prisma.roomInspection.update({ where: { id: cur.id, propertyId }, data: { deletedAt: new Date() } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) { return errorOf(err, '삭제에 실패했습니다.') }
}

/** 삭제 적용취소. */
export async function restoreInspection(id: string): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomInspection.findFirst({ where: { id, propertyId, deletedAt: { not: null } }, select: { id: true, status: true, roomId: true, stage: true } })
    if (!cur) return { ok: false, error: INSPECTION_GONE }
    // 되살릴 것이 예정 점검이면 같은 방·같은 단계의 예정 점검과 겹치지 않아야 한다(R7). 끝낸 점검은 겹쳐도 된다(기록이다).
    if (cur.status === 'PLANNED') {
      const clash = await openSiblingError(propertyId, cur)
      if (clash) return { ok: false, error: clash }
    }
    await prisma.roomInspection.update({ where: { id: cur.id, propertyId }, data: { deletedAt: null } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) { return errorOf(err, '복원에 실패했습니다.') }
}
