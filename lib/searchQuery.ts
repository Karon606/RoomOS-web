// 전역 통합 검색 질의 게이트·종류 판정 — 서버 액션과 클라이언트가 동일 규칙을 공유(2중 방어)

export type SearchQueryKind = 'room' | 'phone' | 'text'

export type NormalizedQuery = {
  q: string          // trim + 64자 캡
  qDigits: string    // 숫자만
  roomCore: string   // '305호' → '305' (roomNo 저장값 비교용)
  kind: SearchQueryKind
  valid: boolean     // 미달 시 클라이언트는 호출 안 함, 서버는 빈 결과 반환
}

/**
 * 질의 정규화. 숫자 전용은 1자부터(방번호 '3'), 그 외 2자부터.
 * 숫자 5자리 이상 = phone(전화 뒷자리 습관), 1~4자리 = room. 자동 라우팅은 없고 그룹 표시 순서만 바꾼다.
 */
export function normalizeSearchQuery(raw: string): NormalizedQuery {
  const q = raw.trim().slice(0, 64)
  const qDigits = q.replace(/\D/g, '')
  const roomCore = q.replace(/호$/, '')
  // 구분자(하이픈·공백·괄호·점)만 섞인 숫자도 숫자 질의로 — '010-9218-7935' 붙여넣기 대응
  const stripped = roomCore.replace(/[\s().-]/g, '')
  const digitsOnly = /^\d+$/.test(stripped) && stripped.length > 0
  const kind: SearchQueryKind = digitsOnly ? (qDigits.length >= 5 ? 'phone' : 'room') : 'text'
  const valid = digitsOnly ? qDigits.length >= 1 : q.length >= 2
  return { q, qDigits, roomCore, kind, valid }
}
