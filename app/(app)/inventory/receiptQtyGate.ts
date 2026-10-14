// 소모품 수령의 수량 관문 순수층. 수량이 빈 추적 구매는 수량을 채운 뒤에만 받는다. 진리표는 scripts/test-asset-receipt.ts.
//
// 왜 필요한가(2026-10-14 냉장고 유령수령). confirmReceipt 는 수량이 비면 품목 카드를 찾지 않아 자동 점검을 만들지
// 않았다. receivedAt 만 찍히고 재고 원장에는 아무것도 안 들어가 verify:db check-item-category-split 축 3 이
// 빨개졌다. 막기만 하면 운영이 멈추므로 화면 셋(재고 수령 대기·상세 구매 수령·구매 수정 수령일)이 수량을 먼저
// 묻고, 서버는 끝내 비면 거부한다. 판정은 여기 한 자리이고 서버와 화면이 같은 것을 부른다.
import { buildAssetDetail } from './assets/aggregate'

export const RECEIPT_QTY_REQUIRED = '구매 수량이 비어 있어 재고에 넣을 수 없습니다. 도착 수량을 적고 수령해 주세요.'
// 한 번에 여러 건을 받는 서버 경로(confirmAllPending)는 칸이 없어 묻지 못한다. 하나라도 비면 시작하지 않는다.
export const receiptQtyRequiredMany = (n: number) =>
  `구매 수량이 빈 구매 ${n}건이 있어 한 번에 수령하지 않습니다. 재고 화면에서 도착 수량을 적고 수령해 주세요.`

export type QtyGateRow = {
  category: string
  itemLabel: string | null
  excludeFromInventory: boolean
  isShipping: boolean
  qtyValue: number | null
}

/** 수량이 없는가. 0 이하도 없음이다. confirmReceipt 가 자동 점검을 건너뛰던 조건(qtyValue && qtyValue > 0)과 같은 셈.
 *  화면은 수령 대기 목록(추적 품목만 담긴다)에서 이 하나로 물을 구매를 가린다(서버 판정과 같은 셈). */
export function qtyMissing(qtyValue: number | null | undefined): boolean {
  return !(qtyValue != null && qtyValue > 0)
}

/** 수령 전에 수량을 받아야 하는 구매인가. 추적 카테고리 품목이고, 재고 제외·배송비가 아니며, 수량이 없다.
 *  축은 유령수령 그물(check-item-category-split 축 3)과 같다. */
export function receiptNeedsQty(row: QtyGateRow, trackedCats: readonly string[]): boolean {
  if (!row.itemLabel || row.excludeFromInventory || row.isShipping) return false
  if (!trackedCats.includes(row.category)) return false
  return qtyMissing(row.qtyValue)
}

/** 화면이 보낸 채울 수량. 0보다 큰 유한수만 받고 소수 셋째 자리로 맞춘다(지출 수량 칸과 같은 셈). 아니면 null. */
export function normalizeFillQty(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || !(n > 0)) return null
  return Math.round(n * 1000) / 1000
}

/** 채울 수량 단위. 구매에 적힌 단위가 먼저, 없으면 품목 카드 단위. 둘 다 없으면 비운다(지어내지 않는다). */
export function fillQtyUnit(expenseQtyUnit: string | null, cardQtyUnit: string | null): string | null {
  return expenseQtyUnit || cardQtyUnit || null
}

type DetailRow = { itemLabel: string | null; specValue: number | null; specUnit: string | null; specText?: string | null; qtyUnit: string | null }
/** 수량을 채울 때의 세부 문자열. 지금 문자열이 자동 형식("[품명] 규격")과 같을 때만 수량을 덧붙여 다시 만든다.
 *  사람이 고쳐 적은 세부는 건드리지 않는다. */
export function fillDetail(prevDetail: string | null, row: DetailRow, qty: number, unit: string | null): string | null {
  const auto = buildAssetDetail({ ...row, qtyValue: null })
  if (prevDetail !== auto) return prevDetail
  return buildAssetDetail({ ...row, qtyUnit: unit, qtyValue: qty })
}

/** 수량을 채운 수령의 적용취소 조각. 되돌릴 때 원래 빈 수량·단위·세부로 함께 돌린다. */
export type ReceiptQtyFill = {
  expenseId: string
  qtyValue: number            // 채운 수량
  qtyUnit: string | null      // 채운 단위
  detail: string | null       // 채운 뒤 세부
  prevQtyValue: number | null // 원래 값(대개 null, 0 이하였으면 그 값)
  prevQtyUnit: string | null
  prevDetail: string | null
}
