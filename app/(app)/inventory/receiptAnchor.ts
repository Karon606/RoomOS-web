// 점검이 하나도 없는 카드에 이미 받은 구매를 첫 점검(앵커)으로 앉히는 공용층. 'use server' 아님(서버 전용)
//
// 왜(2026-11-02, 신고 573b2e06). 받은 구매가 새 카드로 넘어오면(시드가 카드를 새로 세움 · 병합 확인의 '새 품목으로 등록' ·
// 점검 0 카드로 합치기) 그 카드는 점검이 없어 **잔량이 영원히 비어** 있었다. 수령 확인이 무위치 카드에 만드는 총량 점검
// (inventory/actions confirmReceipt 무위치 분기)과 지난 수령분 백필(scripts/backfill-locationless-receipts.ts)이 같은 증상을
// 막는 문법이고, 이것은 그 문법을 카드가 생기는 자리에 붙인 것이다.
//
// 규칙(승인 범위). 받는 카드에 점검·입수·폐기가 **하나도 없을 때만** 만든다. 점검이 있는 카드에 절대값 앵커를 박으면
// 운영자가 센 값을 덮는다. 그 경우의 잔량은 overview 정본이 이미 계산한다.
// 앵커의 근거는 가장 최근 수령 지출(sourceExpenseId)이다. 그 수령을 취소하면 기존 계약대로 앵커도 함께 지워진다.
import { specMultiplier } from '@/lib/units'
import type { InventoryTx } from './ledgerShift'

export async function ensureReceiptAnchor(
  tx: InventoryTx,
  item: { id: string; propertyId: string; category: string; label: string; trackUnit: string; specUnit: string | null; qtyUnit: string | null },
): Promise<string | null> {
  const [checks, adds, disps] = await Promise.all([
    tx.stockCheck.count({ where: { trackedItemId: item.id } }),
    tx.stockAddition.count({ where: { trackedItemId: item.id } }),
    tx.stockDisposal.count({ where: { trackedItemId: item.id } }),
  ])
  if (checks > 0 || adds > 0 || disps > 0) return null
  // 받은 구매. 잔량 산식 sumPurchases 와 같은 조건(재고 제외·배송비 빼고, 수량 단위 느슨 매칭)
  const purchases = await tx.expense.findMany({
    where: {
      propertyId: item.propertyId, category: item.category, itemLabel: item.label,
      NOT: { receivedAt: null }, excludeFromInventory: false, isShipping: false,
      ...(item.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: item.qtyUnit }] } : {}),
    },
    select: { id: true, qtyValue: true, specValue: true, specUnit: true, receivedAt: true },
    orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
  })
  if (!purchases.length) return null
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
  const total = purchases.reduce((s, r) => {
    const q = r.qtyValue ?? 0
    if (!useSpec) return s + q
    const spec = specMultiplier(r.specValue, r.specUnit, item.specUnit)
    return spec != null ? s + q * spec : s + q
  }, 0)
  if (!(total > 0)) return null
  const anchor = purchases[0]
  const row = await tx.stockCheck.create({
    data: {
      trackedItemId: item.id,
      date: anchor.receivedAt!,
      remainingQty: total,
      // 백필과 같은 메모다. '[수령 자동] ' 접두는 이력 카드가 한 구매의 수령 반영(읽기 전용)으로 읽으므로 쓰지 않는다(lib/stockCheckKind).
      memo: `[수령 자동·백필] 수령 ${purchases.length}건 합산`,
      sourceExpenseId: anchor.id,
    },
    select: { id: true },
  })
  return row.id
}
