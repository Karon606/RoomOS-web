// 크기가 다른 새 구매를 하위 이름으로 나눠 결정 대기로 세우는 서버 한 벌. 'use server' 아님(서버 전용)
//
// 왜(신고 573b2e06, 운영자 결정 2026-11-02 '다른 제품은 따로 둔다, 묻는 기능은 남긴다'). 이름·수량 단위가 같으면 크기가 다른 구매도
// 원래 카드에 붙는다. 화면이 물을 수 있으면 묻고(./finance/sizeIdentityAsk), 답이 없이 서버로 온 새 구매(대기 영수증 승인처럼 물을
// 자리가 없던 경로, 옛 화면)는 여기서 '{품명} {규격}' 으로 나눈다. 그러면 같은 이름 카드가 없어 시드가 비슷한 이름 카드를 후보로
// 결정 대기('재고에 못 붙은 구매')에 세운다. 판정은 화면과 같은 정본 lib/sizeIdentity 하나다.
//
// 새로 만든 지출만 본다(이미 붙어 있던 지출은 옮기지 않는다). 그래서 이력은 그 지출들을 뺀 같은 이름 구매의 규격이다.
// 받기 전 행만 만든다(지출 등록·대기 영수증 승인은 수령 전). 받은 구매의 이름을 바꾸면 원장 조정이 따라야 해 여기서 하지 않는다.
// keepLabels 는 '같은 품목으로' 라고 답한 품명. 그 품명은 나누지 않는다.
import prisma from '@/lib/prisma'
import { sizeIdentityAsks, sizeText } from '@/lib/sizeIdentity'
import { attachedToCard } from './seedLabel'

export async function splitSizeNewPurchases(propertyId: string, expenseIds: string[], keepLabels: string[] = []): Promise<string[]> {
  if (!expenseIds.length) return []
  const keep = new Set(keepLabels.map(l => l.trim()))
  const rows = await prisma.expense.findMany({
    where: { id: { in: expenseIds }, propertyId, receivedAt: null, excludeFromInventory: false, isShipping: false, itemLabel: { not: null } },
    select: { id: true, category: true, itemLabel: true, specValue: true, specUnit: true, qtyUnit: true },
  })
  const moved: string[] = []
  for (const r of rows) {
    const label = r.itemLabel!
    if (keep.has(label.trim())) continue
    const card = await prisma.trackedItem.findFirst({
      where: { propertyId, category: r.category, label, isArchived: false },
      select: { trackUnit: true, specUnit: true, qtyUnit: true },
    })
    if (!card || !attachedToCard(card, r.qtyUnit)) continue
    // 이력은 지출 등록 물음(getSizeIdentityInfo)과 같은 술어다. 이번에 만든 행은 뺀다.
    const hist = await prisma.expense.groupBy({
      by: ['specValue', 'specUnit'],
      where: {
        propertyId, category: r.category, itemLabel: label, isShipping: false, excludeFromInventory: false,
        specValue: { not: null, gt: 0 }, specUnit: { not: null }, id: { notIn: expenseIds },
      },
      _count: { _all: true },
    })
    const history = hist.map(h => ({ value: h.specValue as number, unit: (h.specUnit as string).trim(), count: h._count._all }))
    if (!sizeIdentityAsks({ label, specValue: r.specValue, specUnit: r.specUnit, qtyUnit: r.qtyUnit }, card, history)) continue
    const next = `${label} ${sizeText(r.specValue as number, (r.specUnit ?? '').trim())}`
    const c = await prisma.expense.updateMany({ where: { id: r.id, propertyId, itemLabel: label, receivedAt: null }, data: { itemLabel: next } })
    if (c.count === 1) moved.push(next)
  }
  return [...new Set(moved)]
}

// 화면이 실은 '같은 품목으로' 답(JSON 품명 배열)을 읽는다. 모양이 틀리면 답 없음.
export function parseSizeKeep(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
  } catch { return [] }
}
