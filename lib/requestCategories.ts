// 요청·컴플레인 카테고리 정본 — /requests 화면(필터·등록)과 입주자 상세 요청 탭이 공유.
export const REQUEST_CATEGORIES = ['시설', '소음', '청결', '편의', '기타'] as const
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number]
