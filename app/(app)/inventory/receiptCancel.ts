// 소모품 수령 취소의 판정·쓰기 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 수령 취소 정본(cancelReceiptCore)은 재고 화면의 수령 취소·수령일 비움이 같은 가드·같은 조정을 타게 한 한 자리다.
// 비품 전환(2026-10-15 계획서 2단계 F3, 이미 받은 소모품을 재무 수정에서 비품으로)이 이 정본으로 자동 점검을 걷되
// 재무 저장과 **한 트랜잭션**이어야 해서 판정(planReceiptCancel)과 쓰기(applyReceiptCancel)를 나눠 이리로 옮겼다.
// 판정은 트랜잭션 밖에서 읽고, 쓰기는 부르는 쪽 트랜잭션에서 한다. inventory/actions 의 cancelReceiptCore 는 두 함수를
// 그대로 잇는 얇은 껍데기다(가드·조정 규칙은 여기 한 벌, ledgerShift 와 같은 배치).
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { ShiftRow } from '@/lib/stockLedger'
import { buildPurchaseShiftPlan, convertedPurchaseQty, matchedTrackedItemForExpense, applyShiftRows, type LedgerShiftUndo, type InventoryTx } from './ledgerShift'
import { getTrackedCategories } from './categoryConfig'
import {
  INVENTORY_RECEIPT_DENY_UNTRACKED, QTY_FILL_DOMAIN, QTY_FILL_INVALID, canonicalQtyFill, qtyFillShapeOk, type ReceiptQtyFill,
} from './receiptQtyGate'
import { buildAssetDetail } from './assets/aggregate'
import { verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'

// 수령 취소 적용취소 토큰 — 취소가 지운 자동 점검 스냅샷 + 함께 옮긴 조정. §16.
export type ReceiptCancelUndo = {
  expenseId: string
  receivedAtMs: number
  receivedLocationId: string | null
  autoChecks: {
    id: string; trackedItemId: string; dateMs: number; createdAtMs: number
    remainingQty: number; memo: string | null; isReconcile: boolean
    locations: { storageLocationId: string; remainingQty: number; restockedQty: number | null }[]
  }[]
  shift: LedgerShiftUndo | null
}

// 수령 취소 핵심 — undoConfirmReceipt(수령 취소 버튼)와 updateExpenseFromInventory(수령일 비움)가
// 같은 가드·같은 조정을 타야 한다. 한쪽만 막으면 다른 쪽이 뒷문이 된다(클래스 봉합).
//
// adjustFollowing — 수령 이후 점검이 이 수령분을 절대값에 삼킨 경우(구식 수령 288건 포함),
// 그 점검들에서 수령분을 함께 빼고 취소한다. 미지정이면 종전 가드 그대로 거부.
// qtyFill. 수량을 채운 수령의 적용취소면 그 조각. 수령을 무르면서 채운 수량·단위·세부를 원래 값으로 함께 돌린다.
//   지금 행이 채운 값 그대로일 때만 돌린다(그 사이 사람이 수량을 고쳤으면 그 값을 지키고 수령만 무른다).

// 자동 점검에 운영자 실측이 합쳐진 수령의 거부 문장. 비품 전환 미리보기(durableConvert)가 이 값으로 까닭을 가른다.
// 자동 점검 뒤에 다른 점검이 있어 조정 없이는(또는 조정 계획을 못 세워) 수령을 무를 수 없다.
export const RECEIPT_CANCEL_LATER = '수령 이후 재고 점검이 기록되어 되돌릴 수 없습니다. 잘못 수령했다면 재고 점검으로 잔량을 바로잡아 주세요.'
export const RECEIPT_CANCEL_MERGED = '이 수령 기록에 직접 센 재고 점검이 함께 저장되어 있습니다. 되돌리면 그 실측까지 사라지므로 막았습니다. 재고 점검으로 잔량을 바로잡아 주세요.'

// 판정 결과. 쓰기(applyReceiptCancel)가 다시 읽지 않고 이 값으로 쓴다. 자동 점검은 전 칸(위치 내역 포함)이다.
type CancelExp = { id: string; category: string; itemLabel: string | null; qtyUnit: string | null; qtyValue: number | null; specValue: number | null; specUnit: string | null; receivedAt: Date | null; receivedLocationId: string | null; excludeFromInventory: boolean; specText: string | null; detail: string | null }
type CancelAutoCheck = Prisma.StockCheckGetPayload<{ include: { locationBreakdown: true } }>
export type ReceiptCancelPlan = {
  expenseId: string
  propertyId: string
  exp: CancelExp
  autoChecks: CancelAutoCheck[]
  rows: ShiftRow[]
  it: Awaited<ReturnType<typeof matchedTrackedItemForExpense>>
  undo: ReceiptCancelUndo
  fillBack: ReceiptQtyFill | null
}

export async function planReceiptCancel(
  expenseId: string, propertyId: string, opts?: { adjustFollowing?: boolean; qtyFill?: ReceiptQtyFill },
): Promise<{ ok: true; plan: ReceiptCancelPlan | null } | { ok: false; error: string }> {
  const exp = await prisma.expense.findFirst({
    where: { id: expenseId, propertyId },
    select: {
      id: true, category: true, itemLabel: true, qtyUnit: true, qtyValue: true,
      specValue: true, specUnit: true, receivedAt: true, receivedLocationId: true,
      excludeFromInventory: true, specText: true, detail: true,
    },
  })
  if (!exp) return { ok: false, error: '지출을 찾을 수 없습니다.' }
  if (!exp.receivedAt) return { ok: true, plan: null }
  // 소모품(추적 카테고리) 행만 이 길로 수령을 무른다(독립 검수 R-2, 비품 쪽 S1 의 거울). 화면을 연 뒤 카테고리가
  // 비품으로 바뀌면 방에 놓인 비품이 '수령 전인데 자리가 있는' 행이 됐다. 비품 수령은 비품 화면 정본이 맡는다.
  if (!(await getTrackedCategories(propertyId)).includes(exp.category)) return { ok: false, error: INVENTORY_RECEIPT_DENY_UNTRACKED }
  // 수량 채움 조각. 모양·원래 값 범위·서명을 먼저 본다(검수 N-1). 위조면 아무것도 무르지 않는다.
  if (opts?.qtyFill && (!qtyFillShapeOk(opts.qtyFill) || opts.qtyFill.expenseId !== expenseId
    || !verifyUndoBody(QTY_FILL_DOMAIN, propertyId, canonicalQtyFill(opts.qtyFill), opts.qtyFill.sig))) {
    return { ok: false, error: QTY_FILL_INVALID }
  }
  // 자동 점검 이후 다른 점검이 있으면 거부 — 이후 점검이 수령분을 실측에 이미 반영했으므로
  // 자동 점검만 지우면 이중 계상된다. date는 @db.Date 절삭이라 createdAt 기준(undoPartialReceipt와 동일 규칙).
  // 위치 내역은 전 칸으로 읽는다(비품 전환 F3 이 걷은 행을 id·이월 표식까지 바이트 그대로 되살린다). 판정·토큰은 종전 칸만 쓴다.
  const autoChecks = await prisma.stockCheck.findMany({
    where: { sourceExpenseId: expenseId },
    include: { locationBreakdown: true },
  })
  // 자동 점검 안에 **운영자 실측이 머지된** 경우를 먼저 막는다(C페이즈 조사 2026-08-03).
  //
  // 위치별 점검 패널은 6시간 안 같은 날이면 마지막 점검에 합친다. 그 마지막 점검이 자동 수령 점검이면
  // 운영자가 직접 센 값이 그 행 안으로 들어간다. 그 상태에서 수령 취소를 누르면 아래 deleteMany 가
  // 행을 통째로 지워 **실측이 함께 사라진다.** '이후 점검' 가드는 같은 행이라 트립하지 않는다.
  // 실측 2건이 이미 그 상태다(주방세제·김치 2026-07-14).
  // 판정 신호는 보충 실측(restockedQty)이다. StockCheck 에는 updatedAt 이 없어 수정 시각으로는 못 가른다.
  const merged = autoChecks.find(c => c.locationBreakdown.some(lb => (lb.restockedQty ?? 0) > 0))
  if (merged) {
    return { ok: false, error: RECEIPT_CANCEL_MERGED }
  }
  const it = exp.excludeFromInventory ? null : await matchedTrackedItemForExpense(propertyId, exp)
  let rows: ShiftRow[] = []
  // 자동 점검 뒤에 다른 점검이 있는가(이 구매의 자동 점검 카드들에서, 입력 시각 기준).
  const laterCheckExists = async () => !!(await prisma.stockCheck.findFirst({
    where: {
      trackedItemId: { in: [...new Set(autoChecks.map(c => c.trackedItemId))] },
      createdAt: { gt: new Date(Math.max(...autoChecks.map(c => c.createdAt.getTime()))) },
      OR: [{ sourceExpenseId: null }, { sourceExpenseId: { not: expenseId } }],
    },
    select: { id: true },
  }))
  if (opts?.adjustFollowing) {
    // 함께 조정 — 이 수령분을 절대값에 담고 있는 점검(자동 점검 제외)에서 수령분을 뺀다.
    if (it) {
      const qty = convertedPurchaseQty(it, exp)
      const plan = qty > 0
        ? await buildPurchaseShiftPlan(it, propertyId,
            { receivedAtMs: exp.receivedAt.getTime(), qty, storageLocationId: exp.receivedLocationId },
            null, autoChecks.map(c => c.id))
        : { ok: true as const, rows: [] as ShiftRow[] }
      if (!plan.ok) return { ok: false, error: plan.error }
      rows = plan.rows
    } else if (autoChecks.length > 0 && await laterCheckExists()) {
      // 매칭 카드가 없으면(단위가 갈리는 등) 조정 계획을 세울 수 없다. 이후 점검이 있으면 조정 없는 수령 취소와 같이 거부한다.
      // 종전에는 이 갈래가 가드 없이 자동 점검만 지워, 이후 점검이 삼킨 수령분이 원장에 남았다(2단계 검수 R1).
      return { ok: false, error: RECEIPT_CANCEL_LATER }
    }
  } else if (autoChecks.length > 0) {
    if (await laterCheckExists()) return { ok: false, error: RECEIPT_CANCEL_LATER }
  } else if (it) {
    // 자동 점검이 없는 구식 수령(2026-06 이전 경로 등) — 이 수령분을 삼킨 점검이 있으면
    // 종전에는 아무 가드 없이 receivedAt 만 지워져, 재수령 시 그 수량이 이중 가산됐다(뒷문 봉합).
    // 계획 실패(음수·귀속 불가)도 반영 점검이 있다는 뜻이므로 같이 거부한다.
    const qty = convertedPurchaseQty(it, exp)
    if (qty > 0) {
      const plan = await buildPurchaseShiftPlan(it, propertyId,
        { receivedAtMs: exp.receivedAt.getTime(), qty, storageLocationId: exp.receivedLocationId }, null)
      if (!plan.ok || plan.rows.length > 0) {
        return { ok: false, error: '수령 이후 재고 점검이 이 수령분을 이미 반영했습니다. 함께 조정해 취소하거나, 재고 점검으로 잔량을 바로잡아 주세요.' }
      }
    }
  }
  const undo: ReceiptCancelUndo = {
    expenseId,
    receivedAtMs: exp.receivedAt.getTime(),
    receivedLocationId: exp.receivedLocationId,
    autoChecks: autoChecks.map(c => ({
      id: c.id, trackedItemId: c.trackedItemId, dateMs: c.date.getTime(), createdAtMs: c.createdAt.getTime(),
      remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile,
      locations: c.locationBreakdown.map(lb => ({
        storageLocationId: lb.storageLocationId, remainingQty: lb.remainingQty, restockedQty: lb.restockedQty,
      })),
    })),
    shift: null,
  }
  const fillBack = opts?.qtyFill && opts.qtyFill.expenseId === expenseId ? opts.qtyFill : null
  return { ok: true, plan: { expenseId, propertyId, exp, autoChecks, rows, it, undo, fillBack } }
}

// 수령 취소의 쓰기(부르는 쪽 트랜잭션 안에서). 차례는 이후 점검 조정, 자동 점검 삭제, 수령 비움, 채운 수량 되돌림이다.
// 지운 자동 점검과 조정은 plan.undo 에 담긴다(undoCancelReceipt 가 되살린다).
export async function applyReceiptCancel(tx: InventoryTx, plan: ReceiptCancelPlan, opts?: { keepReceived?: boolean }): Promise<ReceiptCancelUndo> {
  const { expenseId, propertyId, exp, rows, it, undo, fillBack } = plan
  if (rows.length > 0 && it) undo.shift = await applyShiftRows(tx, it.id, rows)
  await tx.stockCheck.deleteMany({ where: { sourceExpenseId: expenseId } })
  // 비품 전환(F3)은 수령 시각을 지킨다(비품에서는 원장 뜻이 없다). 그때는 원장 쪽(조정·자동 점검)만 걷는다.
  if (!opts?.keepReceived) await tx.expense.update({ where: { id: expenseId }, data: { receivedAt: null, receivedLocationId: null } })
  if (fillBack) {
    // 채운 값 그대로일 때만(CAS). 원래 수량·단위는 조각 값이지만 모양 검사가 이 동작이 만들 수 있는 값(없음·채운 단위)만
    // 받았다. 세부는 조각 글자를 그대로 쓰지 않는다(검수 N-1). 지금 세부가 채운 자동 형식일 때만 고치고, 되살릴 값은 이 동작이
    // 만들 수 있었던 두 값(수량 없는 자동 형식, 또는 원래부터 채운 형식과 같던 글자) 중에서 고른다. fillDetail 이 자동 형식일
    // 때만 고쳐 썼으므로 이 셈이 원래 값을 정확히 되살린다. 지금 세부가 다르면(사람이 고쳤다) 세부는 그대로 둔다.
    const back = { qtyValue: fillBack.prevQtyValue, qtyUnit: fillBack.prevQtyUnit }
    const same = { id: expenseId, propertyId, qtyValue: fillBack.qtyValue, qtyUnit: fillBack.qtyUnit }
    const row = { itemLabel: exp.itemLabel, specValue: exp.specValue, specUnit: exp.specUnit, specText: exp.specText }
    const filledAuto = buildAssetDetail({ ...row, qtyUnit: fillBack.qtyUnit, qtyValue: fillBack.qtyValue })
    const prevDetail = fillBack.prevDetail === filledAuto ? filledAuto : buildAssetDetail({ ...row, qtyUnit: fillBack.prevQtyUnit, qtyValue: null })
    const full = await tx.expense.updateMany({ where: { ...same, detail: filledAuto }, data: { ...back, detail: prevDetail } })
    if (full.count === 0) await tx.expense.updateMany({ where: same, data: back })
  }
  return undo
}
