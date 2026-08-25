// 서류 메일 문안 정본 — 제목·본문·HTML 프레임을 여기 한 곳에서만 짓는다(신고 44501308 2단계,
// 영업장별 커스터마이즈 2026-08-25 운영자 승인). **서버 전용** — sanitize-html 을 들고 있어
// 클라이언트가 임포트하면 번들이 부푼다. 화면은 서버 액션이 렌더한 결과만 받는다.
//
// 문안을 코드 안에 흩지 않는 이유는 하나다. 이 글은 운영자가 손님에게 하는 말이라 운영자가
// 고칠 수 있어야 하고, 고칠 자리가 여럿이면 어느 것이 실제로 나가는 말인지 알 수 없게 된다.
// 고칠 자리는 환경설정 '서류 메일 문안' 카드 하나(Property.docMailTemplate)이고, 발송 직전
// 수정은 그 한 통에만 적용된다(저장 안 됨). 미리보기와 실발송은 반드시 같은 renderDocMail
// 하나가 만든다 — 두 벌이면 화면이 거짓말을 하게 된다.
//
// **제목과 본문 첫 줄은 잠금화면에 떠도 되는 문장이어야 한다.** 메일 제목은 미리보기로 뜨고,
// 첫 줄도 대부분의 메일 앱이 함께 노출한다. 그래서 제목에는 {이름} 을 지원하지 않는다(도메인
// 패널 확정). {호실} 은 아예 없다 — 사람의 사실을 본문에 적지 않는 원칙에 더해, 서류 묶음이
// 여러 계약(호실)에 걸칠 수 있어 값 자체가 모호하다.
//
// 프레임(헤더·첨부 상자·푸터)은 모든 영업장이 공유하고 본문 영역만 영업장이 바꾼다.
// 첨부 상자는 실제 첨부 파일명에서 그린다 — 손으로 쓰게 두면 봉투와 내용물이 어긋난다.
// HTML 은 테이블+인라인 CSS, 웹폰트·외부 이미지 의존 금지(수신함이 막는다). 색은 브랜드
// 가이드 §26 인쇄 토큰의 hex 를 그대로 쓴다(메일에는 CSS 변수가 없다).

import sanitizeHtml from 'sanitize-html'

/** 영업장별 문안(Property.docMailTemplate). 칸별 null = 그 칸만 내장 기본 유지 —
 *  제목만 바꾼 영업장은 본문 개선(내장 기본 수정 배포)을 계속 받는다. */
export type DocMailTemplate = {
  mode: 'text' | 'html'
  subject: string | null
  bodyText: string | null
  /** 비거나 null 이면 자동 문의 안내(전화 있으면 번호, 없으면 회신 안내)가 들어간다. */
  closingText: string | null
  /** 고급 모드 본문(저장 시 새니타이즈된 것). 렌더 때 한 번 더 통과시킨다. */
  bodyHtml: string | null
}

export const DOC_MAIL_DEFAULT: DocMailTemplate = {
  mode: 'text', subject: null, bodyText: null, closingText: null, bodyHtml: null,
}

/** 내장 기본 문안 — 환경설정 카드의 placeholder·복원 값과 렌더 폴백이 같이 쓴다. */
export const DOC_MAIL_DEFAULT_SUBJECT = '[{영업장명}] 서류를 보내 드립니다'
export const DOC_MAIL_DEFAULT_BODY = '안녕하세요. {영업장명}입니다.\n\n요청하신 서류를 첨부해 보내 드립니다.'

/** 크기 상한 — bodyHtml 30000자는 Gmail 102KB 클리핑(프레임·base64 여유 포함) 안쪽이다. */
export const DOC_MAIL_LIMITS = { subject: 150, bodyText: 4000, closingText: 1000, bodyHtml: 30000 } as const

// 변수는 문자 템플릿({이름} {호수} …)과 같은 단괄호 문법 — 운영자가 이미 익힌 문법을 재사용한다.
// 제목에 {이름} 이 없는 것은 잠금화면 원칙(위 머리 주석)이다.
export const DOC_MAIL_SUBJECT_VARS = ['{영업장명}'] as const
export const DOC_MAIL_BODY_VARS = ['{영업장명}', '{이름}', '{서류목록}'] as const

/**
 * 지원 목록에 없는 {변수} 를 찾는다 — 저장 게이트가 이걸로 저장을 막는다(오타 변수가
 * 그대로 발송되는 사고 방어). 지원 변수는 발송 시점에 값이 항상 있으므로 발송 단계 차단은 없다.
 * 한글·영숫자 변수 꼴만 본다 — 고급 모드 HTML 의 인라인 CSS 중괄호({color:#333})는 콜론·샵이
 * 섞여 있어 이 꼴에 안 걸린다.
 */
export function findUnknownVars(text: string, scope: 'subject' | 'body'): string[] {
  const allowed: readonly string[] = scope === 'subject' ? DOC_MAIL_SUBJECT_VARS : DOC_MAIL_BODY_VARS
  const found = text.match(/\{[가-힣A-Za-z0-9_]{1,20}\}/g) ?? []
  return [...new Set(found.filter(v => !allowed.includes(v)))]
}

/** DB Json 을 관대하게 읽는다 — 깨진 값이면 통째로 기본으로 폴백해 발송 실패를 만들지 않는다
 *  (lib/shortStay.parseShortStayPolicy 와 같은 방식). */
export function parseDocMailTemplate(raw: unknown): DocMailTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DOC_MAIL_DEFAULT
  const o = raw as Record<string, unknown>
  const str = (v: unknown, cap: number): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.slice(0, cap) : null
  const bodyHtml = str(o.bodyHtml, DOC_MAIL_LIMITS.bodyHtml)
  return {
    // html 모드는 본문 HTML 이 실제로 있을 때만 성립 — 빈 HTML 로 빈 메일이 나가는 길을 막는다.
    mode: o.mode === 'html' && bodyHtml ? 'html' : 'text',
    subject: str(o.subject, DOC_MAIL_LIMITS.subject),
    bodyText: str(o.bodyText, DOC_MAIL_LIMITS.bodyText),
    closingText: str(o.closingText, DOC_MAIL_LIMITS.closingText),
    bodyHtml,
  }
}

// ── 새니타이즈 (서버 전용) ─────────────────────────────────────────────
// 손수 짠 정규식 새니타이저는 우회 클래스가 문서화된 실패 축이라 sanitize-html 에 맡긴다.
// 저장 시 한 번, 렌더 시 한 번 더 통과시킨다(DB 직접 조작·구버전 행 방어).
// img 까지 막는 것은 "외부 이미지 의존 금지" 제약 그대로다(수신함이 어차피 막는다).

// style 값 화이트리스트 — url( 이 끼면 통째로 버린다(외부 리소스 적재 금지).
const SAFE_STYLE = /^(?!.*url\s*\()[\s\S]{1,200}$/i
const STYLE_PROPS = [
  'color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-align',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-collapse',
  'line-height', 'width', 'height', 'max-width', 'text-decoration', 'word-break', 'vertical-align',
]

export function sanitizeDocMailHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: [
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'p', 'br', 'div', 'span',
      'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'hr', 'blockquote',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'width', 'height', 'bgcolor'],
      td: ['style', 'align', 'width', 'height', 'bgcolor', 'colspan', 'rowspan'],
      th: ['style', 'align', 'width', 'height', 'bgcolor', 'colspan', 'rowspan'],
      table: ['style', 'align', 'width', 'height', 'bgcolor', 'cellpadding', 'cellspacing', 'border'],
      a: ['href', 'style'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedStyles: { '*': Object.fromEntries(STYLE_PROPS.map(p => [p, [SAFE_STYLE]])) },
    disallowedTagsMode: 'discard',
  })
}

// ── 렌더 (미리보기 = 실발송, 같은 함수) ─────────────────────────────────
// §26 인쇄 토큰의 hex — 메일에는 CSS 변수가 없어 lib/printTokens 값을 그대로 박는다.
const INK = '#1F1A17'
const INK_MUTED = '#6B5D4F'
const TC = '#A03C2E'
const LABEL_BG = '#F2ECE3'
const RULE = '#D8CFC4'
// 시스템 한글 스택만 — 웹폰트는 수신함 대부분이 막는다.
const FONT = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',AppleGothic,sans-serif"

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** 변수 치환 — 이스케이프한 값을 넣는다(값이 태그를 만들 수 없다). 순서: 이스케이프 후 치환. */
function fillVars(text: string, vars: Record<string, string>): string {
  let out = text
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(k, v)
  return out
}

/** 고급 모드 plain text 병행 — 태그를 걷어낸 텍스트. 수신함 목록 미리보기·접근성 몫이다. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/tr|\/li|\/h[1-3]|\/div|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type DocMailData = {
  propertyName: string
  propertyPhone: string | null
  tenantName: string
  /** 화면에 선 서류 종류 이름 그대로(lib/docBundle 의 DOC_TYPE_TITLE) — {서류목록} 값. */
  docTitles: string[]
  /** 실제 첨부 파일명(lib/docShareQueue 정본이 만든 것) — 첨부 상자가 그린다. */
  attachmentNames: string[]
}

/**
 * 메일 한 통을 만든다 — 제목·plain text·HTML 을 한 번에. 환경설정 미리보기, 발송 직전
 * 미리보기, 실발송이 전부 이 함수 하나를 지난다.
 *
 * draft(발송 직전 1회성 수정)를 반영하려면 tpl 의 subject·bodyText 를 바꿔 넘긴다 —
 * 수정본도 같은 프레임·같은 치환을 지나므로 미리보기가 거짓말을 못 한다.
 */
function docMailVars(data: DocMailData): Record<string, string> {
  return {
    '{영업장명}': data.propertyName,
    '{이름}': data.tenantName,
    '{서류목록}': data.docTitles.join(', '),
  }
}

/** 확인 화면 본문 칸 프리필 — 본문 블록(치환 완료)만. 렌더와 같은 치환을 지나므로
 *  운영자가 보는 글자가 곧 나가는 글자다. HTML 모드는 편집을 잠그므로 빈 값. */
export function renderDocMailBodyPrefill(tpl: DocMailTemplate, data: DocMailData): string {
  if (tpl.mode === 'html') return ''
  return fillVars(tpl.bodyText ?? DOC_MAIL_DEFAULT_BODY, docMailVars(data))
}

export function renderDocMail(tpl: DocMailTemplate, data: DocMailData): {
  subject: string; text: string; html: string
} {
  const textVars = docMailVars(data)
  const htmlVars = Object.fromEntries(Object.entries(textVars).map(([k, v]) => [k, escapeHtml(v)]))

  // 제목 — CRLF 는 메일 헤더 주입 축이라 항상 걷어낸다. 제목 변수는 {영업장명} 뿐이다.
  const subject = fillVars(tpl.subject ?? DOC_MAIL_DEFAULT_SUBJECT, { '{영업장명}': data.propertyName })
    .replace(/[\r\n]+/g, ' ').trim().slice(0, DOC_MAIL_LIMITS.subject)

  // 맺음말 — 비면 자동 문의 안내. 번호 뒤에 조사를 붙이지 않는다('으로/로'가 끝자리를 따라가서).
  const phone = data.propertyPhone?.trim() || null
  const autoClosing = phone
    ? `내용이 다르거나 문의사항이 있으시면 아래 번호로 연락 주세요.\n전화 ${phone}`
    : '내용이 다르거나 문의사항이 있으시면 이 메일에 회신해 주세요.'

  // 본문 블록 — 텍스트 모드는 본문+맺음말 두 블록, 고급 모드는 저장된 HTML 하나(맺음말 없음 —
  // 운영자의 HTML 이 완결이다). 고급 모드도 렌더 직전에 한 번 더 새니타이즈한다.
  let bodyBlockHtml: string
  let bodyBlockText: string
  let closingHtml: string | null
  let closingText: string | null
  if (tpl.mode === 'html' && tpl.bodyHtml) {
    const safe = sanitizeDocMailHtml(fillVars(tpl.bodyHtml, htmlVars))
    bodyBlockHtml = safe
    bodyBlockText = htmlToPlain(safe)
    closingHtml = null
    closingText = null
  } else {
    const body = fillVars(tpl.bodyText ?? DOC_MAIL_DEFAULT_BODY, textVars)
    const closing = fillVars(tpl.closingText?.trim() ? tpl.closingText : autoClosing, textVars)
    bodyBlockHtml = escapeHtml(body).replace(/\n/g, '<br>')
    bodyBlockText = body
    closingHtml = escapeHtml(closing).replace(/\n/g, '<br>')
    closingText = closing
  }

  // 첨부 상자 — 실제 첨부 파일명·건수에서만 그린다. 파일명은 로마자·숫자 섞임이라 break-all.
  const attachBoxHtml = data.attachmentNames.length === 0 ? '' : `
    <tr><td style="padding:18px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${LABEL_BG};border:1px solid ${RULE};" bgcolor="${LABEL_BG}"><tr><td style="padding:12px 14px;">
        <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;color:${INK_MUTED};">첨부 ${data.attachmentNames.length}건</p>
        <p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${INK};word-break:break-all;">${data.attachmentNames.map(escapeHtml).join('<br>')}</p>
      </td></tr></table>
    </td></tr>`

  // 프레임 — 헤더(영업장명+테라코타 룰)·첨부 상자·푸터는 어느 모드에서도 프레임 몫이다.
  // 룰은 §26 의 1.6pt 를 2px 로 올림(메일 렌더러의 소수 px 반올림이 제각각이라 정수로 박는다).
  // max-width 560px — 모바일 실측·아웃룩 워드 엔진 안전폭.
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;" bgcolor="#FFFFFF"><tr><td align="center" style="padding:24px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding-bottom:10px;border-bottom:2px solid ${TC};font-family:${FONT};font-size:18px;font-weight:700;color:${INK};word-break:keep-all;">${escapeHtml(data.propertyName)}</td></tr>
    <tr><td style="padding:20px 0 0;font-family:${FONT};font-size:14px;line-height:1.7;color:${INK};word-break:keep-all;">${bodyBlockHtml}</td></tr>${attachBoxHtml}${closingHtml ? `
    <tr><td style="padding:18px 0 0;font-family:${FONT};font-size:14px;line-height:1.7;color:${INK};word-break:keep-all;">${closingHtml}</td></tr>` : ''}
    <tr><td style="padding-top:26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border-top:1px solid ${RULE};padding-top:12px;font-family:${FONT};font-size:11px;color:${INK_MUTED};">made with <span style="color:${INK};font-weight:600;">stay</span><span style="color:${TC};font-weight:600;">eum</span></td></tr></table></td></tr>
  </table>
</td></tr></table>`

  const text = [
    data.propertyName,
    '',
    bodyBlockText,
    ...(data.attachmentNames.length > 0
      ? ['', `첨부 ${data.attachmentNames.length}건`, ...data.attachmentNames.map(n => `- ${n}`)]
      : []),
    ...(closingText ? ['', closingText] : []),
    '',
    'made with stayeum',
  ].join('\n')

  return { subject, text, html }
}

