// 단건 문자(sms:) 링크 생성 — iOS는 body 구분자로 &, 그 외 플랫폼은 ? 를 쓴다(UA 분기).

export function singleSmsHref(phone: string, body: string): string {
  const sep = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'
  return `sms:${phone.replace(/[^0-9+]/g, '')}${sep}body=${encodeURIComponent(body)}`
}
