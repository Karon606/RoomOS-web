'use server'

// 영업장 관리 메모(PropertyNote) 읽기·추가·수정·삭제와 각 적용취소 서버 액션. 호실 관리 '관리 메모' 창이 부른다.
//
// 신고 d1e5fecc, 2026-11-02 운영자 승인. 열람은 영업장 구성원 누구나(STAFF 포함), 쓰기는 편집 권한(requireEdit).
// 모든 읽기·쓰기는 세션 영업장 행만(where { id, propertyId }) 다룬다. 화면에서 온 id 는 그 영업장 안에서만 찾는다.
// 쓰기와 되돌림은 전부 조건부(CAS)다. 수정·삭제는 연 순간의 updatedAt 그대로일 때만, 적용취소는 토큰이 기억한 버전 그대로일 때만 쓴다.
// 정리·검증·문장은 lib/propertyNote 정본(화면의 저장 막힘 이유와 같은 함수).

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import {
  normalizeNoteInput, sameNoteInput, NOTE_CHANGED, NOTE_UNDO_CONFLICT, NOTE_NOT_FOUND,
  type PropertyNoteRow, type NoteCreateUndo, type NoteEditUndo, type NoteDeleteUndo,
} from '@/lib/propertyNote'

type Fail = { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const errorOf = (err: unknown, fallback: string): Fail => ({ ok: false, error: (err as Error)?.message || fallback })
/** 화면에서 돌아온 ISO 시각. 꼴이 아니면 null(그러면 어떤 행과도 안 맞아 거부된다). */
const tsOf = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const rowOf = (n: { id: string; title: string; body: string; tag: string | null; sortOrder: number; updatedAt: Date }): PropertyNoteRow =>
  ({ id: n.id, title: n.title, body: n.body, tag: n.tag, sortOrder: n.sortOrder, updatedAt: n.updatedAt.toISOString() })
const NOTE_SELECT = { id: true, title: true, body: true, tag: true, sortOrder: true, updatedAt: true } as const

/** 이 영업장의 살아 있는 메모 전부(차례대로). STAFF 도 읽는다. */
export async function getPropertyNotes(): Promise<{ ok: true; notes: PropertyNoteRow[] } | Fail> {
  try {
    const { propertyId } = await requirePropertyAccess()
    const notes = await prisma.propertyNote.findMany({
      where: { propertyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: NOTE_SELECT,
    })
    return { ok: true, notes: notes.map(rowOf) }
  } catch (err) { return errorOf(err, '관리 메모를 불러오지 못했습니다.') }
}

/** 추가. 맨 끝 차례로. 적용취소 토큰은 만든 직후 버전이다. */
export async function createPropertyNote(raw: { title?: unknown; body?: unknown; tag?: unknown }):
  Promise<{ ok: true; note: PropertyNoteRow; undo: NoteCreateUndo } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const v = normalizeNoteInput(raw)
    if (!v.ok) return v
    const last = await prisma.propertyNote.aggregate({ where: { propertyId, deletedAt: null }, _max: { sortOrder: true } })
    const n = await prisma.propertyNote.create({
      data: { propertyId, ...v.value, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: NOTE_SELECT,
    })
    return { ok: true, note: rowOf(n), undo: { id: n.id, updatedAt: n.updatedAt.toISOString() } }
  } catch (err) { return errorOf(err, '관리 메모를 저장하지 못했습니다.') }
}

/** 추가 적용취소. 만든 직후 그대로인 그 한 장에만 삭제 도장을 찍는다(소프트삭제, 그사이 고쳤으면 거부, 독립 검수 R3). */
export async function undoCreatePropertyNote(u: NoteCreateUndo): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const at = tsOf(u?.updatedAt)
    if (!u || typeof u.id !== 'string' || !UUID.test(u.id) || !at) return { ok: false, error: NOTE_UNDO_CONFLICT }
    const { count } = await prisma.propertyNote.updateMany({ where: { id: u.id, propertyId, deletedAt: null, updatedAt: at }, data: { deletedAt: new Date() } })
    return count === 1 ? { ok: true } : { ok: false, error: NOTE_UNDO_CONFLICT }
  } catch (err) { return errorOf(err, '적용취소에 실패했습니다.') }
}

/** 수정. 연 순간의 버전(expectedUpdatedAt) 그대로일 때만. 고친 게 없으면 아무것도 안 쓴다(undo null). */
export async function updatePropertyNote(raw: { id: string; expectedUpdatedAt: string; title?: unknown; body?: unknown; tag?: unknown }):
  Promise<{ ok: true; undo: NoteEditUndo | null } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    if (typeof raw?.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: NOTE_NOT_FOUND }
    const v = normalizeNoteInput(raw)
    if (!v.ok) return v
    const expected = tsOf(raw.expectedUpdatedAt)
    const cur = await prisma.propertyNote.findFirst({ where: { id: raw.id, propertyId, deletedAt: null }, select: NOTE_SELECT })
    if (!cur) return { ok: false, error: NOTE_NOT_FOUND }
    if (!expected || cur.updatedAt.getTime() !== expected.getTime()) return { ok: false, error: NOTE_CHANGED }
    const before = { title: cur.title, body: cur.body, tag: cur.tag }
    if (sameNoteInput(before, v.value)) return { ok: true, undo: null }
    const { count } = await prisma.propertyNote.updateMany({ where: { id: cur.id, propertyId, deletedAt: null, updatedAt: cur.updatedAt }, data: v.value })
    if (count !== 1) return { ok: false, error: NOTE_CHANGED }
    const after = await prisma.propertyNote.findFirst({ where: { id: cur.id, propertyId }, select: { updatedAt: true } })
    return { ok: true, undo: { id: cur.id, before, afterUpdatedAt: after!.updatedAt.toISOString() } }
  } catch (err) { return errorOf(err, '관리 메모를 저장하지 못했습니다.') }
}

/** 수정 적용취소. 저장 직후 그대로일 때만 저장 직전 모습 전체로(그사이 바뀌면 거부). */
export async function undoUpdatePropertyNote(u: NoteEditUndo): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const at = tsOf(u?.afterUpdatedAt)
    if (!u || typeof u.id !== 'string' || !UUID.test(u.id) || !at) return { ok: false, error: NOTE_UNDO_CONFLICT }
    // 되돌릴 값도 같은 정본으로 거른다. 토큰은 서명이 없어 화면이 고쳐 보낼 수 있다(편집 권한이면 어차피 적을 수 있는 값이라 경계는 아니다).
    const v = normalizeNoteInput(u.before ?? {})
    if (!v.ok) return { ok: false, error: NOTE_UNDO_CONFLICT }
    const { count } = await prisma.propertyNote.updateMany({ where: { id: u.id, propertyId, deletedAt: null, updatedAt: at }, data: v.value })
    return count === 1 ? { ok: true } : { ok: false, error: NOTE_UNDO_CONFLICT }
  } catch (err) { return errorOf(err, '적용취소에 실패했습니다.') }
}

/** 삭제. 소프트삭제 도장. 연 순간의 버전 그대로일 때만. 토큰은 그 도장이다. */
export async function deletePropertyNote(raw: { id: string; expectedUpdatedAt: string }): Promise<{ ok: true; undo: NoteDeleteUndo } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    if (typeof raw?.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: NOTE_NOT_FOUND }
    const expected = tsOf(raw.expectedUpdatedAt)
    if (!expected) return { ok: false, error: NOTE_CHANGED }
    const now = new Date()
    const { count } = await prisma.propertyNote.updateMany({ where: { id: raw.id, propertyId, deletedAt: null, updatedAt: expected }, data: { deletedAt: now } })
    if (count !== 1) {
      const live = await prisma.propertyNote.findFirst({ where: { id: raw.id, propertyId, deletedAt: null }, select: { id: true } })
      return { ok: false, error: live ? NOTE_CHANGED : NOTE_NOT_FOUND }
    }
    return { ok: true, undo: { id: raw.id, deletedAt: now.toISOString() } }
  } catch (err) { return errorOf(err, '관리 메모를 삭제하지 못했습니다.') }
}

/** 삭제 적용취소. 그 삭제 도장 그대로일 때만 되살린다. */
export async function restorePropertyNote(u: NoteDeleteUndo): Promise<{ ok: true } | Fail> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const at = tsOf(u?.deletedAt)
    if (!u || typeof u.id !== 'string' || !UUID.test(u.id) || !at) return { ok: false, error: NOTE_UNDO_CONFLICT }
    const { count } = await prisma.propertyNote.updateMany({ where: { id: u.id, propertyId, deletedAt: at }, data: { deletedAt: null } })
    return count === 1 ? { ok: true } : { ok: false, error: NOTE_UNDO_CONFLICT }
  } catch (err) { return errorOf(err, '적용취소에 실패했습니다.') }
}
