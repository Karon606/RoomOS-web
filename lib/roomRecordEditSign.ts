// 작업 이력 한 건 수정의 적용취소 토큰 서명·스냅샷 짓기(server-only). 모양 정본은 lib/roomRecordEditUndo, 서명 키는 현금영수증 정본을 쓴다.
import 'server-only'

import { signUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import {
  ROOM_RECORD_EDIT_UNDO_DOMAIN, canonicalRoomRecordEditUndo,
  type RoomRecordEditUndo, type ExpenseSnap,
} from '@/lib/roomRecordEditUndo'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/** 지출 행에서 토큰 스냅샷을 짓는다. 칸은 EXPENSE_SNAP_FIELDS 와 같다. */
export function expenseSnapOf(e: {
  id: string; date: Date; amount: number; vendor: string | null; detail: string | null; itemLabel: string | null
  payMethod: string | null; financialAccountId: string | null; financeName: string | null; settleStatus: string; updatedAt: Date
}): ExpenseSnap {
  return {
    id: e.id, date: ymd(e.date), amount: e.amount, vendor: e.vendor, detail: e.detail, itemLabel: e.itemLabel,
    payMethod: e.payMethod, financialAccountId: e.financialAccountId, financeName: e.financeName, settleStatus: e.settleStatus,
    updatedAt: e.updatedAt.toISOString(),
  }
}
/** 토큰에 실을 지출 칸 select. */
export const EXPENSE_SNAP_SELECT = {
  id: true, date: true, amount: true, vendor: true, detail: true, itemLabel: true,
  payMethod: true, financialAccountId: true, financeName: true, settleStatus: true, updatedAt: true,
} as const

/**
 * 토큰에 서버 서명을 붙인다. 운영에서 서명 키가 없으면 null(적용취소를 내지 않는다, 화면이 버튼을 숨긴다).
 * 개발·하네스에서 키가 없으면 서명 없이 낸다(구조 검사에 맡긴다, cashReceiptLine signUndoBody 와 같은 계약).
 */
export function signRoomRecordEdit(propertyId: string, u: Omit<RoomRecordEditUndo, 'sig' | 'v'>): RoomRecordEditUndo | null {
  const body: Omit<RoomRecordEditUndo, 'sig'> = { v: 1, ...u }
  const sig = signUndoBody(ROOM_RECORD_EDIT_UNDO_DOMAIN, propertyId, canonicalRoomRecordEditUndo(body))
  if (sig === null) return null
  return { ...body, ...(sig ? { sig } : {}) }
}
