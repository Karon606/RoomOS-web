// 로그인 후 복귀 경로(returnTo)를 내부 상대경로로만 제한하는 오픈 리다이렉트 방어 헬퍼.

const DEFAULT_RETURN = '/property-select'

/**
 * raw 가 안전한 내부 상대경로인지 판정한다.
 * 허용: '/' 로 시작하는 단일 슬래시 내부 경로(쿼리·해시 포함 가능).
 * 차단: 절대 URL(스킴 포함) · '//'(프로토콜 상대) · '/\\'(백슬래시, 브라우저가 //로 정규화) ·
 *       제어문자(개행·탭 등 — 브라우저가 URL에서 제거해 스킴 우회에 악용됨).
 */
export function isInternalPath(raw: string | null | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false
  if (!raw.startsWith('/')) return false
  if (raw.startsWith('//') || raw.startsWith('/\\')) return false
  // 제어문자(0x00~0x1F, 0x7F) 차단
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

/**
 * returnTo 는 URL 쿼리로 조작 가능하므로, 리다이렉트에 쓰기 전 반드시 이 함수로 정제한다.
 * 내부 상대경로가 아니면 안전한 기본 경로로 대체한다.
 */
export function safeReturnTo(raw: string | null | undefined, fallback: string = DEFAULT_RETURN): string {
  return isInternalPath(raw) ? raw : fallback
}
