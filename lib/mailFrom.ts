// 발신 주소 정본 — 도메인 상수·로컬파트 정규화·주소 조립을 여기 한 곳에서만 한다.
//
// 왜 순수 모듈인가. 이 값을 쓰는 자리가 셋이다 — 저장(환경설정 폼 패치)·발송(lib/mailSend)·
// 표시(메일 확인 화면의 '보내는 사람'). 셋이 각자 조립하면 화면이 보여준 주소와 실제로 나간
// 주소가 갈린다. lib/mailSend 는 서버 전용이라(RESEND_API_KEY 를 읽는다) 화면이 임포트할 수
// 없어서, 규칙만 담은 순수 모듈을 따로 세운다.
//
// **도메인은 고정이다.** 메일 서버는 SPF/DKIM/DMARC 로 "이 도메인에서 보낼 권한이 있다"를
// 증명한 도메인만 발송을 허용한다. stayeum.com 이 그 인증을 지났고, 다른 도메인(지메일·개인
// 도메인)으로 보내려면 그 도메인마다 인증이 필요하다. 그래서 영업장이 정하는 것은 앞부분뿐이다.
//
// **발신 주소 때문에 메일이 안 나가는 경로를 만들지 않는다.** 저장값이 이상하면(구버전 행·DB
// 직접 조작) 조립 함수가 no-reply 로 떨어뜨린다 — 그것이 오늘까지의 전 발송과 같은 동작이라
// 회귀 위험이 0이고, 서류가 전달되는 것이 발신 주소보다 중요하다. 폴백 사실은 확인 화면이
// 그대로 보여준다(표시도 이 함수를 지나므로 운영자가 보내기 전에 눈으로 본다).

export const MAIL_FROM_DOMAIN = 'stayeum.com'
export const MAIL_FROM_DEFAULT_LOCAL = 'no-reply'
/** RFC 상한은 64자지만 30이면 영업장 식별에 충분하고 모바일 한 줄에 들어온다. */
export const MAIL_FROM_LOCAL_MAX = 30

/**
 * 시스템·역할 주소로 예약된 이름 — 영업장이 가져갈 수 없다.
 * RFC 2142 역할 주소에 플랫폼 정체성(stayeum)과 기본값(no-reply)을 더했다. 이 이름들이
 * 영업장 소유가 되면 반송 처리·도메인 관리 메일이 엉뚱한 곳으로 가거나, 받는 사람이
 * 플랫폼 공식 메일로 오인한다.
 */
const RESERVED = new Set([
  'no-reply', 'noreply', 'postmaster', 'abuse', 'admin', 'administrator', 'root', 'security',
  'support', 'help', 'info', 'contact', 'billing', 'sales', 'hostmaster', 'webmaster',
  'mailer-daemon', 'dmarc', 'bounce', 'bounces', 'stayeum',
])

/**
 * 로컬파트 정규화 — 저장 전과 발송 전이 같은 규칙을 지난다.
 *
 * '@' 뒤를 잘라 버리는 것은 손을 받아주기 위해서다. 운영자가 전체 주소를 붙여넣어도
 * 앞부분만 남고, 화면의 접미 표시가 결과를 그대로 보여준다.
 * 허용 문자 집합이 곧 보안선이다 — CR/LF·따옴표·꺾쇠가 원천 차단되므로 발신 헤더에
 * 다른 줄을 끼워 넣는 길이 문자 수준에서 막힌다.
 */
export function normalizeMailFromLocal(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .trim()
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAIL_FROM_LOCAL_MAX)
    .replace(/^\.+|\.+$/g, '')
}

/** 예약된 이름인가 — 정규화된 값을 넣는다. */
export function isReservedMailLocal(local: string): boolean {
  return RESERVED.has(local)
}

/**
 * 완성된 발신 주소 — 발송과 화면 표시가 반드시 이 함수 하나를 쓴다.
 * 정규화 후 비거나 예약어면 no-reply 로 폴백한다(위 머리 주석의 실패 원칙).
 */
export function buildMailFromAddress(local: string | null | undefined): string {
  const n = normalizeMailFromLocal(local)
  const use = !n || isReservedMailLocal(n) ? MAIL_FROM_DEFAULT_LOCAL : n
  return `${use}@${MAIL_FROM_DOMAIN}`
}
