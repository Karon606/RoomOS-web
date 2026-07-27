// 요청·컴플레인 카테고리 정본 — /requests 화면(필터·등록)과 입주자 상세 요청 탭이 공유.
export const REQUEST_CATEGORIES = ['시설', '소음', '청결', '편의', '기타'] as const
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number]

// Property.requestCategories(콤마 구분)를 목록으로 — 비어 있으면 기본 5종. 서버·클라 공용.
export function parseRequestCategories(raw: string | null | undefined): string[] {
  const list = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : [...REQUEST_CATEGORIES]
}
