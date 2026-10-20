// 지출 주문 묶기(mergeExpensesIntoOrder)의 적용취소 토큰 모양과 되돌림 계획 정본(순수). 서명·적용은 finance/actions 가 한다.
//
// 왜 (2026-10-19 운영자 승인, 신고 a0636f36). 주문 묶기는 선택한 지출을 한 주문으로 옮기고, 비워진 주문의 배송비 행을 대상 주문으로
// 옮긴 뒤 빈 주문을 지운다. 되돌릴 길이 없었다(§16 원칙 위반). 묶기 직전 모양을 쥐고 있다가 지금이 '묶은 직후' 그대로일 때만
// 되돌린다. 지운 주문은 스냅샷으로 같은 id 로 되살리고, 묶기가 새로 만든 주문은 비면 지운다.
// 'use server' 파일이 아니다.

export const ORDER_MERGE_UNDO_DOMAIN = 'expense-order-merge-v1'

export type OrderSnap = {
  id: string; code: string; externalOrderNo: string | null; shippingType: string | null; shippingMemo: string | null; createdAt: string
}
export type OrderMergeUndo = {
  v: 1
  targetOrderId: string
  createdTarget: boolean
  /** 옮긴 행(품목·배송비)과 묶기 전 주문. null = 주문 없던 행. */
  moved: { id: string; before: string | null }[]
  /** 묶기가 지운 빈 주문(같은 id 로 되살린다). */
  deletedOrders: OrderSnap[]
  sig?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

export function canonicalOrderMergeUndo(u: Omit<OrderMergeUndo, 'sig'>): string {
  return JSON.stringify({
    v: 1, targetOrderId: u.targetOrderId, createdTarget: u.createdTarget,
    moved: [...u.moved].sort((a, b) => a.id.localeCompare(b.id)).map(m => ({ id: m.id, before: m.before })),
    deletedOrders: [...u.deletedOrders].sort((a, b) => a.id.localeCompare(b.id)).map(o => ({
      id: o.id, code: o.code, externalOrderNo: o.externalOrderNo, shippingType: o.shippingType, shippingMemo: o.shippingMemo, createdAt: o.createdAt,
    })),
  })
}

export function parseOrderMergeUndo(raw: unknown): OrderMergeUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || !isUuid(u.targetOrderId) || typeof u.createdTarget !== 'boolean' || !Array.isArray(u.moved) || !Array.isArray(u.deletedOrders)) return null
  if (u.moved.length === 0 || u.moved.length > 2000 || u.deletedOrders.length > 500) return null
  const seen = new Set<string>()
  const moved: OrderMergeUndo['moved'] = []
  for (const m of u.moved as unknown[]) {
    const mm = m as Record<string, unknown>
    if (!mm || !isUuid(mm.id) || seen.has(mm.id) || !(mm.before === null || isUuid(mm.before))) return null
    if (mm.before === u.targetOrderId) return null   // 원래 대상 주문에 있던 행은 옮긴 행이 아니다
    seen.add(mm.id)
    moved.push({ id: mm.id, before: mm.before as string | null })
  }
  const deletedOrders: OrderSnap[] = []
  const del = new Set<string>()
  for (const o of u.deletedOrders as unknown[]) {
    const oo = o as Record<string, unknown>
    if (!oo || !isUuid(oo.id) || del.has(oo.id) || oo.id === u.targetOrderId || typeof oo.code !== 'string' || typeof oo.createdAt !== 'string') return null
    if (!strOrNull(oo.externalOrderNo) || !strOrNull(oo.shippingType) || !strOrNull(oo.shippingMemo)) return null
    if (Number.isNaN(Date.parse(oo.createdAt))) return null
    del.add(oo.id)
    deletedOrders.push({ id: oo.id, code: oo.code, externalOrderNo: oo.externalOrderNo as string | null, shippingType: oo.shippingType as string | null, shippingMemo: oo.shippingMemo as string | null, createdAt: oo.createdAt })
  }
  // 되살릴 주문은 옮긴 행 중 누군가의 원래 주문이어야 한다(엉뚱한 주문을 만들지 않는다).
  if (deletedOrders.some(o => !moved.some(m => m.before === o.id))) return null
  return { v: 1, targetOrderId: u.targetOrderId as string, createdTarget: u.createdTarget, moved, deletedOrders, ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

/**
 * 되돌림 계획. 옮긴 행이 지금도 전부 대상 주문에 있어야 하고(nowOrderOf), 되살릴 주문 id 가 지금 비어 있어야 한다(liveOrderIds 에 없음).
 * 하나라도 어긋나면 null(전부 안 함). 대상 주문이 묶기가 새로 만든 것이고 되돌린 뒤 남는 행이 없으면 지운다(dropTarget).
 */
export function planOrderMergeUndo(
  u: OrderMergeUndo,
  nowOrderOf: ReadonlyMap<string, string | null>,
  liveOrderIds: ReadonlySet<string>,
  targetRowIds: readonly string[],
): { restoreOrders: OrderSnap[]; moves: { id: string; to: string | null }[]; dropTarget: boolean } | null {
  for (const m of u.moved) if (nowOrderOf.get(m.id) !== u.targetOrderId) return null
  for (const o of u.deletedOrders) if (liveOrderIds.has(o.id)) return null
  const movedIds = new Set(u.moved.map(m => m.id))
  const remain = targetRowIds.filter(id => !movedIds.has(id))
  return {
    restoreOrders: u.deletedOrders,
    moves: u.moved.map(m => ({ id: m.id, to: m.before })),
    dropTarget: u.createdTarget && remain.length === 0,
  }
}
