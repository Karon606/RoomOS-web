// 병합 결정이 대상 카드를 '단위 무시'(looseMatch)로 바꿔야 하는지 판정.
//
// 왜 필요한가. 재고 부착 판정(seedTrackedItemsFromExpenses)은
// (카테고리·품명·규격값·규격단위·수량단위) 5튜플 동치다. 병합은 지출의 itemLabel 만 대상 카드
// 라벨로 고쳤기 때문에, 수량단위가 다른 구매는 라벨을 고쳐도 튜플이 계속 어긋나 **영원히 미부착**으로
// 남았다. "병합 처리 완료" 토스트 뒤에도 '재고에 못 붙은 구매' 배너가 그대로였던 신고 5ba35bfc.
//
// 지출의 qtyUnit 을 카드 값으로 덮어쓰는 길은 막았다 — '개 30 = 박스 1' 이면 수량이 왜곡된다.
// 대신 카드끼리 병합(mergeTrackedItems)이 이미 쓰는 길 그대로 대상 카드의 qtyUnit 을 null 로 만들어
// 단위를 안 보고 합산한다. 되돌릴 수 있게 원래 단위는 적용취소 payload 에 싣는다.
export function shouldLoosenTargetUnit(
  groupQtyUnit: string | null | undefined,
  targetQtyUnit: string | null | undefined,
): boolean {
  if (targetQtyUnit == null) return false   // 이미 단위 무시 카드 — 바꿀 것이 없다
  return (groupQtyUnit ?? null) !== targetQtyUnit
}
