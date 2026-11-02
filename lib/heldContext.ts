// 품목 고르기의 '지난 기록 맥락' 을 그 품명과 함께 쥐고, 지금 품명과 같을 때만 내주는 정본(이전 품목 맥락이 다음 품목에 남는 결함 봉합).
//
// 왜 필요한가(2026-11-03 독립 검수 차단 2). 지출 등록의 품목 고르기는 직전 구매 맥락(지난 제품 칩·세부스펙 칩·단위 안내·
// 카테고리 경고)을 상태 하나에 담았다. 품명을 '라면' 에서 '라면 컵' 으로 바꾸면 새 품명은 맥락 조회를 건너뛰어(기존 품목이 아니다)
// 상태가 그대로 남았고, 오뚜기·삼양 칩이 '라면 컵' 아래에 떴다. 비우는 자리를 하나씩 찾아 막는 대신, 맥락에 품명을 함께 싣고
// 읽는 쪽이 지금 품명과 견주게 한다. 비우기를 잊은 경로가 생겨도 다른 품명의 맥락은 보이지 않는다.
export type Held<T> = { label: string; ctx: T } | null

/** 품명과 함께 쥔다. 맥락이 없으면 null(쥘 것이 없다). 품명은 앞뒤 공백을 뗀 글자다. */
export function holdFor<T>(label: string, ctx: T | null | undefined): Held<T> {
  return ctx == null ? null : { label: label.trim(), ctx }
}

/** 지금 품명과 같을 때만 맥락을 내준다. 품명이 비었거나 다르면 null. */
export function contextFor<T>(held: Held<T>, label: string | null | undefined): T | null {
  const l = (label ?? '').trim()
  return held != null && l !== '' && held.label === l ? held.ctx : null
}
