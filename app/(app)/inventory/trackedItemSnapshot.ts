// 재고 품목 삭제의 스냅샷·되살림 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 품목(카드)을 지우는 자리는 셋이다. 기록 없는 품목 삭제(deleteTrackedItemIfEmpty), '같이 변경'의 카드 정리
// (syncTrackedItemCategory), 비품 전환의 빈 자동 카드 정리(2026-10-15 계획서 2단계, finance updateExpense).
// 셋째가 재무 쪽 저장 트랜잭션 안에서 돌아야 해서 inventory/actions(서버 액션 파일, async 서버 액션만 내보낸다)에서
// 이리로 옮겼다. 모양을 자리마다 따로 들면 되살리는 쪽과 한쪽만 어긋난다(ledgerShift 와 같은 배치).
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { InventoryTx } from './ledgerShift'

// 품목 삭제 적용취소 스냅샷 — 기록이 없는 품목만 지워지므로 되살릴 것은 그 품목 행과, 행이 지워질 때 FK 로 함께 지워지는
// 셋(위치 연결 · 점검 임시저장 · 병합 추천 규칙)뿐이다(DB 실측: tracked_items 를 참조하는 FK 여섯은 전부 ON DELETE CASCADE,
// 그중 점검·입수·폐기는 0건이라 삭제가 통과했다). **같은 id 로** 되살린다 — 병합 되돌리기 기록(targetItemId, FK 없음)과
// 화면이 쥔 id 가 그대로 이어진다.
export type TrackedItemDeleteUndo = {
  item: {
    id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null
    alertThresholdDays: number; reorderMemo: string | null; purchaseUrl: string | null; trackUnit: string
    hubLocationId: string | null; isArchived: boolean; sortOrder: number | null; memo: string | null; createdAt: string
  }
  locations: { storageLocationId: string; closedAt: string | null }[]
  drafts: { locationId: string | null; data: Prisma.InputJsonValue }[]
  mergeRules: { category: string; sourceLabel: string; normLabel: string; kind: string }[]
}

// 삭제 직전 스냅샷 한 벌. 품목을 지우는 자리가 같은 모양을 쓴다.
export type TrackedItemWithLinks = Prisma.TrackedItemGetPayload<{ include: { locations: true; checkDrafts: true } }>
export async function trackedItemDeleteSnapshot(propertyId: string, it: TrackedItemWithLinks): Promise<TrackedItemDeleteUndo> {
  const rules = await prisma.trackedItemMergeRule.findMany({ where: { propertyId, targetItemId: it.id } })
  return {
    item: {
      id: it.id, category: it.category, label: it.label, specUnit: it.specUnit, qtyUnit: it.qtyUnit,
      alertThresholdDays: it.alertThresholdDays, reorderMemo: it.reorderMemo, purchaseUrl: it.purchaseUrl, trackUnit: it.trackUnit,
      hubLocationId: it.hubLocationId, isArchived: it.isArchived, sortOrder: it.sortOrder, memo: it.memo, createdAt: it.createdAt.toISOString(),
    },
    locations: it.locations.map(l => ({ storageLocationId: l.storageLocationId, closedAt: l.closedAt ? l.closedAt.toISOString() : null })),
    drafts: it.checkDrafts.map(d => ({ locationId: d.locationId, data: d.data as Prisma.InputJsonValue })),
    mergeRules: rules.map(r => ({ category: r.category, sourceLabel: r.sourceLabel, normLabel: r.normLabel, kind: r.kind })),
  }
}

export type RestoreTrackedItemResult = 'restored' | 'exists' | 'foreign' | 'clash'
// 되살림 결과의 화면 문장(종전 undoDeleteTrackedItem 의 문장 그대로).
export const RESTORE_TRACKED_ITEM_FOREIGN = '적용취소 정보가 유효하지 않습니다.'
export const RESTORE_TRACKED_ITEM_CLASH = '같은 이름의 품목이 이미 있어 되살릴 수 없습니다.'

/**
 * 스냅샷을 같은 id 로 되살린다(부르는 쪽 트랜잭션 안에서). 영업장은 스냅샷이 아니라 부르는 쪽이 세션에서 정한 값이다.
 * - 같은 id 가 이 영업장에 이미 있으면 'exists'(멱등), 다른 영업장 것이면 'foreign'(쓰지 않는다).
 * - 그 사이 같은 이름(카테고리+라벨) 품목이 생겼으면 'clash'(유니크 충돌, 두 카드가 한 품명을 다투게 된다).
 * - 위치·창고는 이 영업장에 지금 있는 위치만 잇는다(그 사이 지운 위치는 건너뛴다).
 */
export async function restoreTrackedItemTx(tx: InventoryTx, propertyId: string, undo: TrackedItemDeleteUndo): Promise<RestoreTrackedItemResult> {
  const same = await tx.trackedItem.findUnique({ where: { id: undo.item.id }, select: { propertyId: true } })
  if (same) return same.propertyId === propertyId ? 'exists' : 'foreign'
  const clash = await tx.trackedItem.findUnique({
    where: { propertyId_category_label: { propertyId, category: undo.item.category, label: undo.item.label } }, select: { id: true },
  })
  if (clash) return 'clash'
  const wantLocIds = [...new Set([...undo.locations.map(l => l.storageLocationId), ...(undo.item.hubLocationId ? [undo.item.hubLocationId] : []), ...undo.drafts.flatMap(d => d.locationId ? [d.locationId] : [])])]
  const liveLocIds = new Set((await tx.storageLocation.findMany({ where: { propertyId, id: { in: wantLocIds } }, select: { id: true } })).map(l => l.id))
  const i = undo.item
  await tx.trackedItem.create({
    data: {
      id: i.id, propertyId, category: i.category, label: i.label, specUnit: i.specUnit, qtyUnit: i.qtyUnit,
      alertThresholdDays: i.alertThresholdDays, reorderMemo: i.reorderMemo, purchaseUrl: i.purchaseUrl, trackUnit: i.trackUnit,
      hubLocationId: i.hubLocationId && liveLocIds.has(i.hubLocationId) ? i.hubLocationId : null,
      isArchived: i.isArchived, sortOrder: i.sortOrder, memo: i.memo, createdAt: new Date(i.createdAt),
    },
  })
  const links = undo.locations.filter(l => liveLocIds.has(l.storageLocationId))
  if (links.length > 0) {
    await tx.trackedItemLocation.createMany({ data: links.map(l => ({ trackedItemId: i.id, storageLocationId: l.storageLocationId, closedAt: l.closedAt ? new Date(l.closedAt) : null })) })
  }
  for (const d of undo.drafts) {
    if (d.locationId && !liveLocIds.has(d.locationId)) continue
    await tx.stockCheckDraft.create({ data: { trackedItemId: i.id, locationId: d.locationId, data: d.data } })
  }
  if (undo.mergeRules.length > 0) {
    await tx.trackedItemMergeRule.createMany({ data: undo.mergeRules.map(r => ({ propertyId, category: r.category, sourceLabel: r.sourceLabel, normLabel: r.normLabel, targetItemId: i.id, kind: r.kind })), skipDuplicates: true })
  }
  return 'restored'
}
