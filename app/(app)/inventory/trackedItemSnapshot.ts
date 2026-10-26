// 재고 품목 삭제의 스냅샷·되살림 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 품목(카드)을 지우는 자리는 넷이다. 기록 없는 품목 삭제(deleteTrackedItemIfEmpty), '같이 변경'의 카드 정리
// (syncTrackedItemCategory), 비품 전환의 빈 자동 카드 정리(2026-10-15 계획서 2단계, finance updateExpense),
// 지출 쓰기 뒤 고아 카드 정리(retireTrackedItemIfOrphan, 2026-10-26 신고 f3866bca).
// 셋째·넷째가 재무 쪽 저장 트랜잭션 안에서 돌아야 해서 inventory/actions(서버 액션 파일, async 서버 액션만 내보낸다)에서
// 이리로 옮겼다. 모양을 자리마다 따로 들면 되살리는 쪽과 한쪽만 어긋난다(ledgerShift 와 같은 배치).
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { InventoryTx } from './ledgerShift'
// 카테고리 이동 토큰 서명(현금영수증·비품 전환과 한 벌, 용도 domain 으로 가른다).
import { signUndoBody, verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'

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
// db 는 부르는 쪽 트랜잭션을 받는다(고아 카드 정리가 트랜잭션 안에서 뜬다). 없으면 전역 클라이언트다.
export type TrackedItemWithLinks = Prisma.TrackedItemGetPayload<{ include: { locations: true; checkDrafts: true } }>
export async function trackedItemDeleteSnapshot(propertyId: string, it: TrackedItemWithLinks, db: InventoryTx = prisma): Promise<TrackedItemDeleteUndo> {
  const rules = await db.trackedItemMergeRule.findMany({ where: { propertyId, targetItemId: it.id } })
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

// ── 카드에 걸린 지출로 셀 것. 재고 계산에 들어가는 구매만이다(재고 제외·배송비 행은 뺀다).
//    품목 삭제 판정(actions itemRecordCounts)과 고아 카드 정리(retireTrackedItemIfOrphan)가 이 한 조건을 쓴다.
//    종전 품목 삭제 판정은 재고 제외 지출까지 세서, 서비스 지출에 잘못 선 카드(옥상 폐기물처리, 재고 제외 지출 2건)를
//    지울 길이 없었다(2026-10-26 운영자 승인, 신고 f3866bca).
export function includedExpenseWhere(propertyId: string, category: string, label: string) {
  return { propertyId, category, itemLabel: label, excludeFromInventory: false, isShipping: false }
}

// ── 운영자가 손질한 카드인가. 구매 링크·발주 메모·메모·알림 임계값(기본 7 아님) 넷 중 하나라도 있으면 그렇다.
//    손질한 카드는 자동 정리하지 않는다(독립 검수 R5, 2026-10-27). 지운 뒤 적용취소 토스트를 놓치면 손으로 넣은 값이 사라진다.
//    사용자 순서(sortOrder)는 손질 신호가 아니다(재검수 B-1). 카테고리 안에서 끌어 저장하면 그 카테고리 전 카드에 붙어(운영 실측
//    숨기지 않은 카드 30장 중 25장) 넣으면 자동 정리와 감지가 사실상 꺼진다. 스냅샷·되살림은 sortOrder 를 그대로 되살린다.
//    감지 스크립트 check-tracked-orphans 가 같은 네 칸을 본다(바꾸면 함께).
export const DEFAULT_ALERT_THRESHOLD_DAYS = 7
export function cardHandTouched(it: { purchaseUrl: string | null; reorderMemo: string | null; memo: string | null; alertThresholdDays: number }): boolean {
  const filled = (v: string | null) => !!v && v.trim() !== ''
  return filled(it.purchaseUrl) || filled(it.reorderMemo) || filled(it.memo) || it.alertThresholdDays !== DEFAULT_ALERT_THRESHOLD_DAYS
}

/**
 * 고아 카드 정리(부르는 쪽 트랜잭션 안에서). 지출을 지우거나 재고에서 빼거나 품명·카테고리를 옮긴 뒤 부른다.
 * 그 품명(카테고리 + 라벨) 카드가 재고에 들어가는 지출 0 이고 점검·입수·폐기·위치 연결·점검 임시저장도 0 일 때만 지운다.
 * 숨긴 카드는 그대로 둔다(숨김은 운영자가 '이 묶음은 다시 만들지 말라'고 남긴 표식이라, 지우면 시드가 되살린다).
 * 운영자가 손질한 카드(cardHandTouched)도 그대로 둔다.
 * 지운 카드의 스냅샷(품목 삭제와 같은 모양, undoDeleteTrackedItem 이 같은 id 로 되살린다)을 돌려주고, 안 지웠으면 null 이다.
 * 영업장은 부르는 쪽이 지출 행에서 읽은 값이다(화면 값을 받지 않는다).
 */
export async function retireTrackedItemIfOrphan(tx: InventoryTx, propertyId: string, category: string, label: string | null | undefined): Promise<TrackedItemDeleteUndo | null> {
  if (!label) return null
  const it = await tx.trackedItem.findUnique({
    where: { propertyId_category_label: { propertyId, category, label } },
    include: { locations: true, checkDrafts: true },
  })
  if (!it || it.isArchived || cardHandTouched(it) || it.locations.length > 0 || it.checkDrafts.length > 0) return null
  const [expenses, checks, adds, disps] = await Promise.all([
    tx.expense.count({ where: includedExpenseWhere(propertyId, category, label) }),
    tx.stockCheck.count({ where: { trackedItemId: it.id } }),
    tx.stockAddition.count({ where: { trackedItemId: it.id } }),
    tx.stockDisposal.count({ where: { trackedItemId: it.id } }),
  ])
  if (expenses + checks + adds + disps > 0) return null
  const snap = await trackedItemDeleteSnapshot(propertyId, it, tx)
  // 지우는 조건에 '기록 없음'을 다시 건다(CAS). 고른 뒤 붙은 기록이 있으면 안 지운다.
  const r = await tx.trackedItem.deleteMany({
    where: {
      id: it.id, propertyId, isArchived: false, updatedAt: it.updatedAt,
      stockChecks: { none: {} }, additions: { none: {} }, disposals: { none: {} }, locations: { none: {} }, checkDrafts: { none: {} },
    },
  })
  return r.count === 1 ? snap : null
}

// ── 지출 카테고리 이동 토큰(독립 검수 B2, 2026-10-27). 카테고리를 바꾼 지출 수정이 저장 **전** (카테고리, 품명)과 저장 뒤 값을
//    서버 서명으로 돌려준다. 저장 뒤 화면이 '같이 변경 / 지출만'을 물을 때 이 값만 넘긴다(두 액션 모두 토큰만 받는다, 재검수 권고 1).
//    종전에는 화면이 저장 전 품명을 모르는 서버에 '옛 카테고리'만 넘겨, 품명까지 함께 바꾼 저장에서 새 품명으로 옛 카드를 찾다 못 찾았다.
//    서버에 서명 키가 없으면(운영 설정 누락) 토큰은 서명 없이 나간다. 그때도 물음은 뜨고 '같이 변경'은 그 값으로 돌지만(종전과 같은 신뢰),
//    카드를 지우는 '지출만' 정리는 하지 않는다(재검수 권고 5).
export const CARD_MOVE_TOKEN_DOMAIN = 'expense-category-move'
/** 토큰이 서명 대조에서 떨어졌거나 그 사이 지출이 바뀌었을 때의 말(앞으로 가는 조작이라 적용취소 문형을 쓰지 않는다). */
export const CARD_MOVE_STALE = '지출 정보가 최신이 아닙니다. 새로고침 후 다시 시도해 주세요.'
export type CategoryMoveToken = {
  v: 1; expenseId: string
  fromCategory: string; fromLabel: string
  toCategory: string; toLabel: string | null
  sig?: string
}
function canonicalCategoryMove(t: CategoryMoveToken): string {
  return JSON.stringify([t.v, t.expenseId, t.fromCategory, t.fromLabel, t.toCategory, t.toLabel])
}
/** 이 서버에 서명 키가 있는가. */
export function categoryMoveSigningAvailable(propertyId: string): boolean {
  return typeof signUndoBody(CARD_MOVE_TOKEN_DOMAIN, propertyId, '') === 'string'
}
/** 토큰. 키가 있으면 서명을 붙이고, 없으면 서명 없이 낸다(물음은 늘 뜬다). */
export function signCategoryMove(propertyId: string, body: Omit<CategoryMoveToken, 'sig'>): CategoryMoveToken {
  const t: CategoryMoveToken = { v: 1, expenseId: body.expenseId, fromCategory: body.fromCategory, fromLabel: body.fromLabel, toCategory: body.toCategory, toLabel: body.toLabel }
  const sig = signUndoBody(CARD_MOVE_TOKEN_DOMAIN, propertyId, canonicalCategoryMove(t))
  return typeof sig === 'string' ? { ...t, sig } : t
}
/** 화면에서 돌아온 토큰을 모양으로 거르고 서명을 대조한다. 모양이 틀리면 null, verified 는 키가 있고 서명이 맞을 때만 참. */
export function readCategoryMove(propertyId: string, raw: unknown): { token: CategoryMoveToken; verified: boolean } | null {
  const t = raw as Partial<CategoryMoveToken> | null
  const str = (v: unknown) => typeof v === 'string' && v !== ''
  if (!t || t.v !== 1 || !str(t.expenseId) || !str(t.fromCategory) || !str(t.fromLabel) || !str(t.toCategory) || !(t.toLabel === null || str(t.toLabel))) return null
  const token: CategoryMoveToken = { v: 1, expenseId: t.expenseId!, fromCategory: t.fromCategory!, fromLabel: t.fromLabel!, toCategory: t.toCategory!, toLabel: t.toLabel ?? null }
  const verified = categoryMoveSigningAvailable(propertyId) && verifyUndoBody(CARD_MOVE_TOKEN_DOMAIN, propertyId, canonicalCategoryMove(token), t.sig)
  return { token, verified }
}

// ── '같이 변경' 갈라 만들기 토큰(2026-10-27 재검수 권고 2, 운영자 결정 대기 추천안). 옛 카테고리에 같은 품명의 다른 재고 구매가 남아
//    옛 카드는 그대로 두고, 옮긴 지출 몫으로 새 카테고리에 카드를 새로 만든 경우 그 카드를 되돌리는 토큰이다. 서명이 없으면 화면이
//    아무 카드 id 나 넣어 재고 구매가 걸린 카드를 지울 수 있다(품목 삭제 판정은 재고 구매가 있으면 거부한다).
export const CARD_SPLIT_TOKEN_DOMAIN = 'expense-card-split'
export type CardSplitUndo = { v: 1; cardId: string; expenseId: string; sig?: string }
const canonicalCardSplit = (t: CardSplitUndo) => JSON.stringify([t.v, t.cardId, t.expenseId])
export function signCardSplit(propertyId: string, body: Omit<CardSplitUndo, 'sig'>): CardSplitUndo | null {
  const t: CardSplitUndo = { v: 1, cardId: body.cardId, expenseId: body.expenseId }
  const sig = signUndoBody(CARD_SPLIT_TOKEN_DOMAIN, propertyId, canonicalCardSplit(t))
  if (sig === null) return null
  return sig ? { ...t, sig } : t
}
export function readCardSplit(propertyId: string, raw: unknown): CardSplitUndo | null {
  const t = raw as Partial<CardSplitUndo> | null
  if (!t || t.v !== 1 || typeof t.cardId !== 'string' || !t.cardId || typeof t.expenseId !== 'string' || !t.expenseId) return null
  const body: CardSplitUndo = { v: 1, cardId: t.cardId, expenseId: t.expenseId }
  return verifyUndoBody(CARD_SPLIT_TOKEN_DOMAIN, propertyId, canonicalCardSplit(body), t.sig) ? body : null
}
