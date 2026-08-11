// 열람 언어 수집값 검증 — 공개 페이지가 보낸 언어 코드·전환 이력을 저장 가능한 형태로 좁힌다.
// pageview(최초)와 closeup(전환·종료) 두 경로가 같은 규칙을 써야 해서 한곳에 둔다.

// BCP 47 앞머리만 받는다 — 'ko'·'en'·'ja'·'zh-hant'. 사이트가 쓰는 짧은 코드가 정본이고,
// 알려주지 않는 페이지의 <html lang> 폴백까지 커버하려고 하위 태그 하나를 허용한다.
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/

export function safeViewedLanguage(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return LANG_RE.test(s) ? s : null
}

// 전환 이력 'ko>en>ja' — 코드 최대 12개. 연속 중복은 버린다(같은 버튼 연타로 이력이 늘어나지 않게).
const MAX_TRAIL = 12

export function safeLanguageTrail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const out: string[] = []
  for (const part of v.split('>')) {
    if (out.length >= MAX_TRAIL) break
    const one = safeViewedLanguage(part)
    if (!one || one === out[out.length - 1]) continue
    out.push(one)
  }
  return out.length > 0 ? out.join('>') : null
}
