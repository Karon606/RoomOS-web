// 지출 목록 카테고리 1차 필터의 정본(선택지 구성 · 행 판정 · 합계 라벨 · 섞인 주문 메타)
//
// 운영자 요청(2026-10-23 '추천대로'): "그 달 지출에서 지출 카테고리별로 내역을 필터링해서 확인할 수 있게".
// 종전에는 카테고리가 필터 패널 select 안에 있어 걸려 있어도 접히면 안 보였고, ?cat= 값이 설정 목록에 없으면
// select 가 '전체'로 보이면서 목록은 걸러지는 결함이 있었다. 고른 값은 언제나 선택지에 선다(expenseCategoryChoices).
// 화면(FinanceClient)은 판정을 손으로 다시 쓰지 않는다. 감지망 scripts/test-expense-category-filter.ts.

export const ALL_CATEGORIES = 'all'

/** 이 행이 고른 카테고리에 드는가. 'all' 이면 언제나 참이다(목록·예정 행·도래 없음·다른 달분 흔적이 같은 식을 쓴다). */
export function matchesExpenseCategory(category: string, selected: string): boolean {
  return selected === ALL_CATEGORIES || category === selected
}

/**
 * 1차 필터 선택지('전체' 뒤에 서는 카테고리들).
 * 이 달에 행이 있는 카테고리를 영업장 설정 순서대로, 설정 목록 밖 옛 카테고리는 그 뒤에 가나다순으로 둔다.
 * 고른 값은 행이 없어도(다른 달로 넘어왔거나 ?cat= 로 들어온 값) 선택지에 넣는다. 빠지면 컨트롤이 '전체'로
 * 보이면서 목록은 걸러지는 거짓 화면이 된다.
 */
export function expenseCategoryChoices(settingOrder: readonly string[], rowCategories: Iterable<string>, selected: string): string[] {
  const present = new Set<string>()
  for (const c of rowCategories) if (c) present.add(c)
  if (selected !== ALL_CATEGORIES && selected) present.add(selected)
  const inSetting = settingOrder.filter((c, i) => present.has(c) && settingOrder.indexOf(c) === i)
  const known = new Set(inSetting)
  const outside = [...present].filter(c => !known.has(c)).sort((a, b) => a.localeCompare(b, 'ko'))
  return [...inSetting, ...outside]
}

/** 합계 라벨 머리. 필터가 없으면 종전 글자 그대로다(바이트 불변). '(예정 제외)' 꼬리는 화면이 붙인다. */
export function expenseTotalLabel(selected: string): string {
  return selected === ALL_CATEGORIES ? '실제 지출 합계' : `${selected} 합계`
}

/** 필터가 걸렸을 때 합계 아래 캡션. 건수는 걸러진 지출 기록 수, 금액은 이 달 전 카테고리 합이다. */
export function categoryFilterCaption(count: number, monthTotal: number, fmt: (n: number) => string): string {
  return `${count}건 · 이 달 전체 ${fmt(monthTotal)}`
}

/**
 * 주문별 보기 묶음 칩. 카테고리 필터로 주문의 일부 품목만 남으면 '주문 3건 중 2건', 다 남으면 종전 '주문 N품목'.
 * 품목 수는 배송비 행을 뺀 수다(배송비 행은 그 행의 카테고리로 따로 걸러진다). 품목 없이 배송비만 남으면 '주문 3건 중 배송비'.
 */
export function orderGroupChip(orderItemCount: number, shownItemCount: number): string {
  if (shownItemCount >= orderItemCount) return `주문 ${shownItemCount}품목`
  if (shownItemCount === 0) return `주문 ${orderItemCount}건 중 배송비`
  return `주문 ${orderItemCount}건 중 ${shownItemCount}건`
}
