// 주문 전체 쇼핑몰 맞춤과 글자 칸 적용취소 토큰 서명(서버 전용). 재무 수정 폼과 소모품 구매 수정이 한 벌로 쓴다.
// 'use server' 파일이 아니다. propertyId 를 인자로 받으므로 액션으로 드러나면 안 된다(호출하는 액션이 영업장 범위를 정한다).
import prisma from '@/lib/prisma'
import { rowChannel } from '@/lib/expenseChannel'
import { signUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import { EXPENSE_FIELD_UNDO_KINDS, canonicalExpenseFieldUndo, type ExpenseFieldUndo, type ExpenseFieldUndoKind, type RecurringVendorChange } from '@/lib/expenseFieldUndo'

/** 글자 칸 일괄 변경 적용취소 토큰에 서버 서명을 붙인다. 운영에서 키가 없으면 토큰을 내지 않는다(화면은 적용취소를 숨긴다). */
export function signFieldUndo(propertyId: string, kind: ExpenseFieldUndoKind, rows: ExpenseFieldUndo['rows'], recurring?: RecurringVendorChange[]): ExpenseFieldUndo | null {
  if (rows.length === 0 && !recurring?.length) return null
  // 항목 줄(고정지출 구매처)은 있을 때만 싣는다. 없으면 종전 토큰과 같은 모양·서명이다.
  const body: Omit<ExpenseFieldUndo, 'sig'> = recurring?.length ? { v: 1, kind, rows, recurring } : { v: 1, kind, rows }
  const sig = signUndoBody(EXPENSE_FIELD_UNDO_KINDS[kind], propertyId, canonicalExpenseFieldUndo(body))
  if (sig === null) return null
  return sig ? { ...body, sig } : body
}

/**
 * 수정 폼 '주문 전체에 적용'. 이 행의 주문 형제(배송비 행 포함, 이 영업장)를 같은 쇼핑몰로 맞추고, 바꾼 형제의 전후 값을 적용취소 토큰으로 돌려준다.
 * 저장(이 행)은 이미 끝났다. 형제 맞춤이 실패해도 저장을 무르지 않는다(토큰 없이 돌아가고 화면은 형제가 그대로라 다시 물을 수 있다).
 */
export async function applyChannelToOrder(propertyId: string, orderId: string, selfId: string, channel: string | null): Promise<ExpenseFieldUndo | null> {
  try {
    const changed = await prisma.$transaction(async tx => {
      const sibs = await tx.expense.findMany({ where: { propertyId, orderId, id: { not: selfId } }, select: { id: true, channel: true, vendor: true } })
      // 형제마다 그 행 구매처와 같은 이름이면 비운 값이 그 행의 몫이다(결정 A, rowChannel).
      const diff = sibs.map(s => ({ ...s, after: rowChannel(channel, s.vendor) })).filter(s => (s.channel ?? null) !== s.after)
      const done: typeof diff = []
      // 토큰에는 조건부 갱신이 실제로 바꾼 행(count 1)만 싣는다. 그사이 바뀐 행이 섞이면 적용취소가 늘 거부된다(독립 검수).
      for (const s of diff) {
        const r = await tx.expense.updateMany({ where: { id: s.id, propertyId, channel: s.channel }, data: { channel: s.after } })
        if (r.count === 1) done.push(s)
      }
      return done
    })
    return signFieldUndo(propertyId, 'channel-order', changed.map(s => ({ id: s.id, changes: [{ field: 'channel', before: s.channel ?? null, after: s.after }] })))
  } catch (e) {
    console.error('[applyChannelToOrder] 주문 전체 쇼핑몰 맞춤 실패(저장 유지)', e)
    return null
  }
}
