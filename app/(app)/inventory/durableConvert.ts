// 소모품에서 비품으로 바꾸는 저장(F1·F3)의 조회·검증·되돌림 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 판정과 문구는 순수층(./assets/conversionPlan)이다. 여기는 그 판정에 넣을 영업장 사실을 모으고(loadDurableConvertFacts),
// 재무 저장(addExpense·updateExpense)이 받은 전환 요청을 같은 판정으로 다시 확인하고(verifyDurableConvert), 지울 빈 자동
// 카드를 고르고(emptyAutoCards), 토큰 하나로 전환을 되돌린다(applyDurableConvertUndo). 재무 저장 트랜잭션 안에서 돌아야 해서
// 서버 액션 파일 밖에 둔다(ledgerShift·receiptCancel·trackedItemSnapshot 과 같은 배치).
import prisma from '@/lib/prisma'
import { parseOptionList } from '@/lib/optionLists'
import { getTrackedCategories } from './categoryConfig'
import type { InventoryTx } from './ledgerShift'
import { trackedItemDeleteSnapshot, restoreTrackedItemTx, type TrackedItemDeleteUndo } from './trackedItemSnapshot'
import {
  conversionPlan, DURABLE_CONVERT_UNDO_INVALID, DURABLE_CONVERT_UNDO_STALE,
  type ConvertFacts, type ConvertInput, type ConvertPlan, type DurableConvertUndo,
} from './assets/conversionPlan'

/**
 * 판정에 넣을 영업장 사실. labels 는 저장하려는 품명들, excludeExpenseId 는 수정 폼이면 그 지출(이력에서 뺀다).
 * 비품 물품 빈도는 비품 화면 모집단(assets durableExpenseWhere)의 물품 갈래와 같은 축이다(품명 있음·배송비 아님·추적 밖·재고 제외 아님).
 */
export async function loadDurableConvertFacts(propertyId: string, labels: string[], excludeExpenseId?: string | null): Promise<ConvertFacts> {
  const trackedCats = await getTrackedCategories(propertyId)
  const names = [...new Set(labels.map(l => l.trim()).filter(Boolean))]
  const [hist, counts, prop] = await Promise.all([
    names.length
      ? prisma.expense.findMany({
          where: { propertyId, itemLabel: { in: names }, category: { in: trackedCats }, isShipping: false, ...(excludeExpenseId ? { id: { not: excludeExpenseId } } : {}) },
          select: { itemLabel: true }, distinct: ['itemLabel'],
        })
      : Promise.resolve([] as { itemLabel: string | null }[]),
    prisma.expense.groupBy({
      by: ['category'],
      where: { propertyId, itemLabel: { not: null }, isShipping: false, category: { notIn: trackedCats }, excludeFromInventory: false },
      _count: { _all: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { expenseCategories: true } }),
  ])
  return {
    trackedCats,
    trackedHistoryLabels: hist.map(h => h.itemLabel).filter((v): v is string => !!v),
    durableCounts: counts.map(c => ({ category: c.category, count: c._count._all })),
    // 영업장 지출 카테고리 목록(조회 화면 getExpenseCategories 와 같은 해석 정본)
    propertyCategories: parseOptionList('expenseCategories', (prop as { expenseCategories?: string | null } | null)?.expenseCategories),
  }
}

/**
 * 재무 저장이 받은 전환 요청이 화면과 같은 판정인가. from 은 '그대로 저장'이면 쓰였을 카테고리, to 는 폼이 실어 온 카테고리.
 * 서버가 지금 사실로 판정을 다시 돌려 묻는 판정이고 대상 카테고리가 같을 때만 그 판정을 돌려준다. 아니면 null(거부).
 */
export async function verifyDurableConvert(
  propertyId: string,
  req: { from: string; to: string; items: ConvertInput['items']; received: boolean; original: ConvertInput['original']; excludeExpenseId?: string | null },
): Promise<Exclude<ConvertPlan, { kind: 'none' }> | null> {
  const facts = await loadDurableConvertFacts(propertyId, req.items.map(i => i.label), req.excludeExpenseId)
  const plan = conversionPlan({ category: req.from, items: req.items, received: req.received, original: req.original }, facts)
  if (plan.kind === 'none' || plan.target !== req.to) return null
  return plan
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

/** 빈 자동 카드를 지운다(부르는 쪽 트랜잭션). 그 사이 기록이 붙었으면 안 지운다. 지운 카드의 스냅샷만 돌려준다(토큰에 실을 것). */
export async function deleteEmptyCardsTx(tx: InventoryTx, propertyId: string, snapshots: TrackedItemDeleteUndo[]): Promise<TrackedItemDeleteUndo[]> {
  const done: TrackedItemDeleteUndo[] = []
  for (const s of snapshots) {
    const r = await tx.trackedItem.deleteMany({
      where: { id: s.item.id, propertyId, stockChecks: { none: {} }, additions: { none: {} }, disposals: { none: {} } },
    })
    if (r.count === 1) done.push(s)
  }
  return done
}

export class DurableConvertUndoError extends Error {
  constructor(message: string) { super(message); this.name = 'DurableConvertUndoError' }
}

/**
 * 전환 되돌림(부르는 쪽 트랜잭션). 서명·모양은 부르는 쪽이 먼저 봤다. 여기서는 범위와 CAS 를 본다.
 *   - from 은 지금 추적 카테고리, to 는 아니다. 카드는 추적 카테고리 카드다(무관한 카드·카테고리로 못 쓴다).
 *   - 행마다 '전환 직후 그대로인가'를 조건으로 걸고 전환이 바꾼 칸만 되돌린다. 하나라도 어긋나면 전부 되감는다(STALE).
 * F1 은 카테고리와 자리 두 칸(예정 호실을 대상 호실로)과 지운 카드다.
 */
export async function applyDurableConvertUndo(tx: InventoryTx, propertyId: string, undo: DurableConvertUndo, trackedCats: string[]): Promise<void> {
  const INVALID = new DurableConvertUndoError(DURABLE_CONVERT_UNDO_INVALID)
  const STALE = new DurableConvertUndoError(DURABLE_CONVERT_UNDO_STALE)
  if (!trackedCats.includes(undo.from) || trackedCats.includes(undo.to)) throw INVALID
  if (undo.cards.some(c => !trackedCats.includes(c.item.category))) throw INVALID
  const ids = [...undo.rows.map(r => r.id), ...(undo.placed ? [undo.placed.id] : [])]
  if ((await tx.expense.count({ where: { id: { in: ids }, propertyId } })) !== ids.length) throw INVALID

  for (const r of undo.rows) {
    const u = await tx.expense.updateMany({
      where: { id: r.id, propertyId, category: undo.to, receivedAt: null, disposedAt: null, roomId: null, targetRoomId: r.targetRoomId, assignedLocationId: null, isCommonAsset: false },
      data: { category: undo.from, roomId: r.targetRoomId, targetRoomId: null },
    })
    if (u.count !== 1) throw STALE
  }
  // 받은 소모품 전환(F3) 되돌림은 다음 묶음이다. 지금은 F1 토큰만 받는다.
  if (undo.kind !== 'F1') throw INVALID
  // 카드를 먼저 되살린다(자동 점검이 그 카드에 붙는다).
  for (const c of undo.cards) {
    const r = await restoreTrackedItemTx(tx, propertyId, c)
    if (r === 'foreign') throw INVALID
    if (r === 'clash') throw STALE
  }
}
