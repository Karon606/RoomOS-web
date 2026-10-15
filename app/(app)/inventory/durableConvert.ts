// 소모품에서 비품으로 바꾸는 저장(F1·F3)의 조회·검증·되돌림 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 판정과 문구는 순수층(./assets/conversionPlan)이다. 여기는 그 판정에 넣을 영업장 사실을 모으고(loadDurableConvertFacts),
// 재무 저장(addExpense·updateExpense)이 받은 전환 요청을 같은 판정으로 다시 확인하고(verifyDurableConvert), 지울 빈 자동
// 카드를 고르고(emptyAutoCards), 토큰 하나로 전환을 되돌린다(applyDurableConvertUndo). 재무 저장 트랜잭션 안에서 돌아야 해서
// 서버 액션 파일 밖에 둔다(ledgerShift·receiptCancel·trackedItemSnapshot 과 같은 배치).
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { parseOptionList } from '@/lib/optionLists'
import { getTrackedCategories } from './categoryConfig'
import { revertShiftRows, type InventoryTx } from './ledgerShift'
import { planReceiptCancel, RECEIPT_CANCEL_MERGED } from './receiptCancel'
import { trackedItemDeleteSnapshot, restoreTrackedItemTx, type TrackedItemDeleteUndo } from './trackedItemSnapshot'
import {
  conversionPlan, DURABLE_CONVERT_UNDO_INVALID, DURABLE_CONVERT_UNDO_STALE,
  type ConvertFacts, type ConvertInput, type ConvertPlan, type DurableConvertUndo, type AutoCheckSnap, type ReceiptFact,
} from './assets/conversionPlan'

/**
 * 판정에 넣을 영업장 사실. labels 는 저장하려는 품명들, excludeExpenseId 는 수정 폼이면 그 지출(이력에서 뺀다).
 * 비품 물품 빈도는 비품 화면 모집단(assets durableExpenseWhere)의 물품 갈래와 같은 축이다(품명 있음·배송비 아님·추적 밖·재고 제외 아님).
 * 수정하는 지출이 받은 소모품이면 수령 취소 미리보기(receipt)도 싣는다. 화면과 서버가 같은 사실로 F3 막힘을 가른다.
 */
export async function loadDurableConvertFacts(propertyId: string, labels: string[], excludeExpenseId?: string | null): Promise<ConvertFacts> {
  const trackedCats = await getTrackedCategories(propertyId)
  const names = [...new Set(labels.map(l => l.trim()).filter(Boolean))]
  const durableGoods = { propertyId, itemLabel: { not: null }, isShipping: false, category: { notIn: trackedCats }, excludeFromInventory: false }
  const [hist, counts, labelCounts, prop, editing] = await Promise.all([
    names.length
      ? prisma.expense.findMany({
          where: { propertyId, itemLabel: { in: names }, category: { in: trackedCats }, isShipping: false, ...(excludeExpenseId ? { id: { not: excludeExpenseId } } : {}) },
          select: { itemLabel: true }, distinct: ['itemLabel'],
        })
      : Promise.resolve([] as { itemLabel: string | null }[]),
    prisma.expense.groupBy({ by: ['category'], where: durableGoods, _count: { _all: true } }),
    // 그 품명들의 비품 카테고리 빈도(검수 R7, 품명에 비품 이력이 있으면 그 카테고리가 먼저다)
    names.length
      ? prisma.expense.groupBy({ by: ['itemLabel', 'category'], where: { ...durableGoods, itemLabel: { in: names } }, _count: { _all: true } })
      : Promise.resolve([] as { itemLabel: string | null; category: string; _count: { _all: number } }[]),
    prisma.property.findUnique({ where: { id: propertyId }, select: { expenseCategories: true } }),
    excludeExpenseId ? prisma.expense.findFirst({ where: { id: excludeExpenseId, propertyId }, select: { receivedAt: true, category: true } }) : Promise.resolve(null),
  ])
  const receipt = editing?.receivedAt && trackedCats.includes(editing.category) ? await receiptConvertPreview(excludeExpenseId!, propertyId) : null
  return {
    trackedCats,
    trackedHistoryLabels: hist.map(h => h.itemLabel).filter((v): v is string => !!v),
    durableCounts: counts.map(c => ({ category: c.category, count: c._count._all })),
    labelDurableCounts: labelCounts.filter(c => c.itemLabel).map(c => ({ label: c.itemLabel!, category: c.category, count: c._count._all })),
    // 영업장 지출 카테고리 목록(조회 화면 getExpenseCategories 와 같은 해석 정본)
    propertyCategories: parseOptionList('expenseCategories', (prop as { expenseCategories?: string | null } | null)?.expenseCategories),
    receipt,
  }
}

/**
 * 재무 저장이 받은 전환 요청이 화면과 같은 판정인가. from 은 '그대로 저장'이면 쓰였을 카테고리, to 는 폼이 실어 온 카테고리,
 * kind 는 화면이 본 종류(F1·F3, 검수 R5). 서버가 지금 사실로 판정을 다시 돌려 바꿀 수 있는 판정이고 종류와 대상 카테고리가
 * 같을 때만 그 판정을 돌려준다. 아니면 null(거부). 막힌 판정(blocked)은 '비품으로 저장'을 주지 않으므로 받지 않는다.
 */
export async function verifyDurableConvert(
  propertyId: string,
  req: { from: string; to: string; kind: string | null; items: ConvertInput['items']; received: boolean; original: ConvertInput['original']; excludeExpenseId?: string | null },
): Promise<Extract<ConvertPlan, { kind: 'F1' | 'F3' }> | null> {
  const facts = await loadDurableConvertFacts(propertyId, req.items.map(i => i.label), req.excludeExpenseId)
  const plan = conversionPlan({ category: req.from, items: req.items, received: req.received, original: req.original }, facts)
  if ((plan.kind !== 'F1' && plan.kind !== 'F3') || plan.kind !== req.kind || plan.target !== req.to) return null
  return plan
}

/**
 * 이미 받은 소모품(F3)의 수령 자동 점검을 걷을 수 있는가(정본 수령 취소 판정 그대로, 쓰기 없음).
 * 조정 없이 걷히면 그대로. 안 되면 정본의 함께 조정(adjustFollowing)으로 다시 본다. 되면 '조정 필요'(needsAdjust)와 그 수를 준다.
 * 저장은 화면이 실은 조정 표식대로 정본을 부르므로, 수가 0 이어도 조정이 필요하면 표식을 실어야 한다(검수 R1 X8).
 * 실측이 자동 점검에 합쳐졌으면 'merged', 조정으로도 안 되면(매칭 카드 없음·계획 불성립) 'ledger'.
 */
export async function receiptConvertPreview(expenseId: string, propertyId: string): Promise<ReceiptFact> {
  const plain = await planReceiptCancel(expenseId, propertyId)
  if (plain.ok) return { blocked: null, needsAdjust: false, adjustChecks: 0 }
  if (plain.error === RECEIPT_CANCEL_MERGED) return { blocked: 'merged', needsAdjust: false, adjustChecks: 0 }
  const adjusted = await planReceiptCancel(expenseId, propertyId, { adjustFollowing: true })
  if (adjusted.ok) return { blocked: null, needsAdjust: true, adjustChecks: adjusted.plan?.rows.length ?? 0 }
  return { blocked: adjusted.error === RECEIPT_CANCEL_MERGED ? 'merged' : 'ledger', needsAdjust: false, adjustChecks: 0 }
}

/**
 * 전환으로 쓸모가 없어지는 빈 자동 카드(계획서 B2). (category, label) 카드 중 점검·입수·폐기가 없고(이 지출의 수령 자동 점검은
 * 함께 걷으니 뺀다) 그 품명의 다른 구매도 없는 것만 스냅샷을 뜬다. 비지 않은 카드는 그대로 두고 이름만 돌려준다(보고용).
 * 지우기는 부르는 쪽 트랜잭션에서 deleteMany(같은 비어 있음 조건, CAS)로 한다.
 */
export async function emptyAutoCards(propertyId: string, category: string, labels: string[], expenseIds: string[]): Promise<{ snapshots: TrackedItemDeleteUndo[]; kept: string[] }> {
  const names = [...new Set(labels.map(l => l.trim()).filter(Boolean))]
  if (!names.length) return { snapshots: [], kept: [] }
  const cards = await prisma.trackedItem.findMany({ where: { propertyId, category, label: { in: names } }, include: { locations: true, checkDrafts: true } })
  const snapshots: TrackedItemDeleteUndo[] = []
  const kept: string[] = []
  for (const c of cards) {
    const [checks, adds, disps, others] = await Promise.all([
      prisma.stockCheck.count({ where: { trackedItemId: c.id, OR: [{ sourceExpenseId: null }, { sourceExpenseId: { notIn: expenseIds } }] } }),
      prisma.stockAddition.count({ where: { trackedItemId: c.id } }),
      prisma.stockDisposal.count({ where: { trackedItemId: c.id } }),
      prisma.expense.count({ where: { propertyId, category: c.category, itemLabel: c.label, id: { notIn: expenseIds } } }),
    ])
    if (checks + adds + disps + others === 0) snapshots.push(await trackedItemDeleteSnapshot(propertyId, c))
    else kept.push(c.label)
  }
  return { snapshots, kept }
}

/**
 * 빈 자동 카드를 지운다(부르는 쪽 트랜잭션). 그 사이 기록이 붙었으면 안 지운다. 지운 카드의 스냅샷만 돌려준다(토큰에 실을 것).
 * 점검·입수·폐기는 삭제 조건(관계 없음)으로, 그 품명의 다른 구매는 트랜잭션 안에서 다시 센다(검수 참고, 고른 뒤 생긴 구매).
 */
export async function deleteEmptyCardsTx(tx: InventoryTx, propertyId: string, snapshots: TrackedItemDeleteUndo[], expenseIds: string[]): Promise<TrackedItemDeleteUndo[]> {
  const done: TrackedItemDeleteUndo[] = []
  for (const s of snapshots) {
    const others = await tx.expense.count({ where: { propertyId, category: s.item.category, itemLabel: s.item.label, id: { notIn: expenseIds } } })
    if (others > 0) continue
    const r = await tx.trackedItem.deleteMany({
      where: { id: s.item.id, propertyId, stockChecks: { none: {} }, additions: { none: {} }, disposals: { none: {} } },
    })
    if (r.count === 1) done.push(s)
  }
  return done
}

/** F3 이 걷는 수령 자동 점검을 바이트 그대로 되살릴 스냅샷(전 칸, 위치 내역 id·이월 표식 포함). */
export function autoCheckSnaps(rows: Prisma.StockCheckGetPayload<{ include: { locationBreakdown: true } }>[]): AutoCheckSnap[] {
  return rows.map(c => ({
    id: c.id, trackedItemId: c.trackedItemId, date: c.date.toISOString(), createdAt: c.createdAt.toISOString(),
    remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile, sourceExpenseId: c.sourceExpenseId,
    locations: c.locationBreakdown.map(l => ({
      id: l.id, storageLocationId: l.storageLocationId, remainingQty: l.remainingQty, restockedQty: l.restockedQty,
      fromHubQty: l.fromHubQty, fromLocationId: l.fromLocationId, carried: l.carried,
    })),
  }))
}

export class DurableConvertUndoError extends Error {
  constructor(message: string) { super(message); this.name = 'DurableConvertUndoError' }
}

/**
 * 전환 되돌림(부르는 쪽 트랜잭션). 서명·모양은 부르는 쪽이 먼저 봤다. 여기서는 범위와 CAS 를 본다.
 *   - from 은 지금 추적 카테고리, to 는 아니다. 카드는 추적 카테고리 카드다(무관한 카드·카테고리로 못 쓴다).
 *   - 행마다 '전환 직후 그대로인가'를 조건으로 걸고 전환이 바꾼 칸만 되돌린다. 하나라도 어긋나면 전부 되감는다(STALE).
 * F1 은 카테고리와 자리 두 칸(예정 호실을 대상 호실로), F3 은 카테고리와 배정 세 칸·이력 줄·자동 점검·조정·카드다.
 */
export async function applyDurableConvertUndo(tx: InventoryTx, propertyId: string, undo: DurableConvertUndo, trackedCats: string[]): Promise<void> {
  const INVALID = new DurableConvertUndoError(DURABLE_CONVERT_UNDO_INVALID)
  const STALE = new DurableConvertUndoError(DURABLE_CONVERT_UNDO_STALE)
  if (!trackedCats.includes(undo.from) || trackedCats.includes(undo.to)) throw INVALID
  if (undo.cards.some(c => !trackedCats.includes(c.item.category))) throw INVALID
  const ids = [...undo.rows.map(r => r.id), ...(undo.placed ? [undo.placed.id] : [])]
  if ((await tx.expense.count({ where: { id: { in: ids }, propertyId } })) !== ids.length) throw INVALID

  // 품목 칸(품명·수량·단위·규격)도 전환 직후 그대로여야 한다. 바뀌었으면 되살릴 소모품 원장과 어긋난다(검수 R3).
  const facetsOf = (n: DurableConvertUndo['rows'][number]['now']) => ({ itemLabel: n.itemLabel, qtyValue: n.qtyValue, qtyUnit: n.qtyUnit, specValue: n.specValue, specUnit: n.specUnit })
  for (const r of undo.rows) {
    const u = await tx.expense.updateMany({
      where: { id: r.id, propertyId, category: undo.to, receivedAt: null, disposedAt: null, roomId: null, targetRoomId: r.targetRoomId, assignedLocationId: null, isCommonAsset: false, ...facetsOf(r.now) },
      data: { category: undo.from, roomId: r.targetRoomId, targetRoomId: null },
    })
    if (u.count !== 1) throw STALE
  }
  if (undo.placed) {
    const p = undo.placed
    const u = await tx.expense.updateMany({
      where: {
        id: p.id, propertyId, category: undo.to, receivedAt: { not: null }, disposedAt: null,
        roomId: p.roomId, assignedAt: new Date(p.assignedAt), assignedLocationId: null, isCommonAsset: false, ...facetsOf(p.now),
      },
      data: {
        category: undo.from,
        assignedAt: p.prev.assignedAt ? new Date(p.prev.assignedAt) : null,
        assignedLocationId: p.prev.assignedLocationId, isCommonAsset: p.prev.isCommonAsset,
      },
    })
    if (u.count !== 1) throw STALE
  }
  // 카드를 먼저 되살린다(자동 점검이 그 카드에 붙는다).
  for (const c of undo.cards) {
    const r = await restoreTrackedItemTx(tx, propertyId, c)
    if (r === 'foreign') throw INVALID
    if (r === 'clash') throw STALE
  }
  // 걷은 자동 점검을 바이트 그대로(같은 id·입력 시각·위치 내역 id·이월 표식). 품목은 이 영업장 카드여야 한다.
  for (const c of undo.checks) {
    if ((await tx.trackedItem.count({ where: { id: c.trackedItemId, propertyId } })) !== 1) throw INVALID
    if (await tx.stockCheck.findUnique({ where: { id: c.id }, select: { id: true } })) throw STALE
    await tx.stockCheck.create({
      data: {
        id: c.id, trackedItemId: c.trackedItemId, date: new Date(c.date), createdAt: new Date(c.createdAt),
        remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile, sourceExpenseId: c.sourceExpenseId,
      },
    })
    if (c.locations.length) {
      await tx.stockCheckLocation.createMany({
        data: c.locations.map(l => ({
          id: l.id, stockCheckId: c.id, storageLocationId: l.storageLocationId, remainingQty: l.remainingQty,
          restockedQty: l.restockedQty, fromHubQty: l.fromHubQty, fromLocationId: l.fromLocationId, carried: l.carried,
        })),
      })
    }
  }
  if (undo.shift) {
    if ((await tx.trackedItem.count({ where: { id: undo.shift.trackedItemId, propertyId } })) !== 1) throw INVALID
    await revertShiftRows(tx, undo.shift)
  }
  if (undo.logIds.length) await tx.assetAssignmentLog.deleteMany({ where: { id: { in: undo.logIds }, propertyId } })
}
