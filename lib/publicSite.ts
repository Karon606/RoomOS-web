// 영업장 공개 소개 페이지 URL 조립 정본 — 도메인·경로 리터럴이 화면마다 갈리지 않게 한 곳에서만 만든다.
// 실체는 next.config.ts 의 rewrite 가 가리키는 public/members/<slug>/index.html 정적 파일이다.

export const PUBLIC_SITE_ORIGIN = 'https://www.stayeum.com'

/** publicSlug 로 공개 소개 페이지 URL 을 만든다. 슬러그가 비면 null — 부르는 쪽에서 그 줄을 세우지 않는다. */
export function publicSiteUrl(slug: string | null | undefined): string | null {
  const s = String(slug ?? '').trim()
  return s ? `${PUBLIC_SITE_ORIGIN}/members/${s}/` : null
}
