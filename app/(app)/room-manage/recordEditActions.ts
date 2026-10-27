'use server'

// 작업 이력 한 건 수정의 적용취소(§16) 서버 액션 — 작업·청소·점검·작업에 걸린 지출 한 줄 수정이 돌려준 서명 토큰으로 저장 직전 모습을 되돌린다.
//
// 2026-10-27 승인 계획 2단계. 수정 Modal 저장 토스트의 [적용취소] 가 이 하나를 부른다. 상시 진입점은 같은 [수정] 이다(고쳐 쓰는 것이 곧 되돌림).
// 규칙(lib/roomRecordEditUndo 머리말). 서명이 맞고, 기록과 함께 고친 지출이 지금도 '쓴 직후' 그대로일 때만 전부 되돌린다(하나라도 다르면 아무것도 안 한다).
// 수정이 새로 만든 지출이면 되돌림이 그 지출을 지운다(Expense 에는 소프트삭제 칸이 없다. 쓴 직후 그대로인 것만 지운다).
// 모든 읽기·쓰기는 이 영업장 행만(where { id, propertyId }).

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { ymdToDbDate } from '@/lib/kstDate'
import { verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import { expenseSnapOf, EXPENSE_SNAP_SELECT } from '@/lib/roomRecordEditSign'
import {
  ROOM_RECORD_EDIT_UNDO_DOMAIN, canonicalRoomRecordEditUndo, parseRoomRecordEditUndo, snapMatches,
  ROOM_RECORD_EDIT_UNDO_INVALID, ROOM_RECORD_EDIT_UNDO_CONFLICT,
  type RecordSnap, type ExpenseSnap,
} from '@/lib/roomRecordEditUndo'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const toDate = (v: RecordSnap[string]) => (typeof v === 'string' ? ymdToDbDate(v) : null)
const str = (v: RecordSnap[string]) => (typeof v === 'string' ? v : null)

class EditUndoConflict extends Error {}

export async function undoRoomRecordEdit(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const u = parseRoomRecordEditUndo(raw)
    if (!u) return { ok: false, error: ROOM_RECORD_EDIT_UNDO_INVALID }
    if (!verifyUndoBody(ROOM_RECORD_EDIT_UNDO_DOMAIN, propertyId, canonicalRoomRecordEditUndo(u), u.sig)) return { ok: false, error: ROOM_RECORD_EDIT_UNDO_INVALID }
    const { before, after } = u

    await prisma.$transaction(async tx => {
      const conflict = (): never => { throw new EditUndoConflict(ROOM_RECORD_EDIT_UNDO_CONFLICT) }
      // ① 확인 — 쓰기 전에 기록과 지출이 모두 '쓴 직후' 그대로인지 본다. 하나라도 다르면 아무것도 안 쓴다.
      const exp = u.expense
        ? await tx.expense.findFirst({ where: { id: u.expense.after.id, propertyId }, select: { ...EXPENSE_SNAP_SELECT, roomWorkId: true } })
        : null
      if (u.expense && (!exp || !snapMatches(expenseSnapOf(exp), u.expense.after))) conflict()
      // 지출 한 줄 수정은 그 작업에 걸린 줄만 되돌린다.
      if (u.kind === 'work-expense' && exp?.roomWorkId !== u.id) conflict()
      const w = u.kind === 'work' || u.kind === 'work-expense'
        ? await tx.roomWork.findFirst({
          where: { id: u.id, propertyId, deletedAt: null },
          select: { id: true, kind: true, scheduledDate: true, doneDate: true, performer: true, performerName: true, memo: true, estimateAmount: true },
        })
        : null
      if ((u.kind === 'work' || u.kind === 'work-expense') && !w) conflict()
      if (u.kind === 'work' && !snapMatches({ kind: w!.kind, scheduledDate: ymd(w!.scheduledDate), doneDate: ymd(w!.doneDate), performer: w!.performer, performerName: w!.performerName, memo: w!.memo, estimateAmount: w!.estimateAmount }, after)) conflict()
      const c = u.kind === 'cleaning'
        ? await tx.roomCleaning.findFirst({
          where: { id: u.id, propertyId, deletedAt: null },
          select: { reason: true, scheduledDate: true, doneDate: true, performer: true, performerName: true, memo: true, expenseId: true, fromCleaningFund: true, leaseTermId: true },
        })
        : null
      const relink = str(before.expenseId)
      if (u.kind === 'cleaning') {
        if (!c || !snapMatches({ ...c, scheduledDate: ymd(c.scheduledDate), doneDate: ymd(c.doneDate) }, after)) conflict()
        // 비용 0 으로 끊은 연결을 되살리는데 그 지출이 그사이 지워졌으면 끊긴 링크가 된다. 되살리지 않는다.
        if (relink && relink !== str(after.expenseId) && !u.expense && !(await tx.expense.findFirst({ where: { id: relink, propertyId }, select: { id: true } }))) conflict()
      }
      const i = u.kind === 'inspection'
        ? await tx.roomInspection.findFirst({ where: { id: u.id, propertyId, deletedAt: null }, select: { scheduledDate: true, memo: true } })
        : null
      if (u.kind === 'inspection' && (!i || !snapMatches({ scheduledDate: ymd(i.scheduledDate), memo: i.memo }, after))) conflict()

      // ② 쓰기 — 기록을 쓰기 전 모습으로.
      if (u.kind === 'work') {
        await tx.roomWork.updateMany({
          where: { id: u.id, propertyId },
          data: {
            kind: str(before.kind) ?? w!.kind, scheduledDate: toDate(before.scheduledDate), doneDate: toDate(before.doneDate),
            performer: str(before.performer), performerName: str(before.performerName), memo: str(before.memo),
            estimateAmount: Number.isInteger(before.estimateAmount) ? Number(before.estimateAmount) : null,
          },
        })
      } else if (u.kind === 'cleaning') {
        await tx.roomCleaning.updateMany({
          where: { id: u.id, propertyId },
          data: {
            reason: str(before.reason) ?? c!.reason, scheduledDate: toDate(before.scheduledDate), doneDate: toDate(before.doneDate),
            performer: str(before.performer), performerName: str(before.performerName), memo: str(before.memo),
            expenseId: relink, fromCleaningFund: before.fromCleaningFund === true, leaseTermId: str(before.leaseTermId),
          },
        })
      } else if (u.kind === 'inspection') {
        await tx.roomInspection.updateMany({ where: { id: u.id, propertyId }, data: { scheduledDate: toDate(before.scheduledDate), memo: str(before.memo) } })
      }
      // 함께 고친 지출 — 고친 줄은 쓰기 전 칸으로, 이 수정이 만든 줄은 지운다(쓴 직후 그대로인 것만 여기까지 온다).
      if (u.expense && exp) {
        const b: ExpenseSnap | null = u.expense.before
        if (b) {
          await tx.expense.updateMany({
            where: { id: b.id, propertyId },
            data: {
              date: toDate(b.date) ?? exp.date,
              amount: Number.isInteger(b.amount) ? Number(b.amount) : exp.amount,
              vendor: str(b.vendor),
              detail: str(b.detail),
              itemLabel: str(b.itemLabel),
              payMethod: str(b.payMethod),
              financialAccountId: str(b.financialAccountId),
              financeName: str(b.financeName),
              settleStatus: b.settleStatus === 'UNSETTLED' ? 'UNSETTLED' : 'SETTLED',
            },
          })
        } else {
          await tx.expense.deleteMany({ where: { id: u.expense.after.id, propertyId } })
        }
      }
    })
    revalidatePath('/room-manage'); if (u.expense || u.kind === 'cleaning') revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (err instanceof EditUndoConflict) return { ok: false, error: err.message }
    return { ok: false, error: (err as Error).message ?? '적용취소에 실패했습니다.' }
  }
}
