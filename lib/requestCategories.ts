// 요청·컴플레인 카테고리 정본 — /requests 화면(필터·등록)과 입주자 상세 요청 탭이 공유.
// '기타' 는 기본값에서 뺐다(2026-10-22 독립 검수). 고르는 칸 맨 끝 '기타(직접 입력)' 과 두 줄로 섰다. 칸이 빈(null) 영업장만
// 이 값을 본다. 목록을 저장한 영업장(운영 영업장은 '기타' 를 담아 저장해 둠)은 그대로이고 분류 관리에서 직접 뺀다.
// 이미 '기타' 로 저장된 요청은 글자 그대로 남는다(운영 0건, 2026-10-22 읽기 전용 조회).
export const REQUEST_CATEGORIES = ['시설', '소음', '청결', '편의'] as const
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number]

// Property.requestCategories(콤마 구분)를 목록으로 — 비어 있으면 기본 4종. 서버·클라 공용.
export function parseRequestCategories(raw: string | null | undefined): string[] {
  const list = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : [...REQUEST_CATEGORIES]
}
