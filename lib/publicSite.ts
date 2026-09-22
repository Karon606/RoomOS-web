// 영업장 공개 소개 페이지 URL 조립 정본 — 도메인·경로 리터럴이 화면마다 갈리지 않게 한 곳에서만 만든다.
// 실체는 next.config.ts 의 rewrite 가 가리키는 public/members/<slug>/index.html 정적 파일이다.

export const PUBLIC_SITE_ORIGIN = 'https://www.stayeum.com'

/**
 * publicSlug 로 공개 소개 페이지 URL 을 만든다. 슬러그가 비면 null — 부르는 쪽에서 그 줄을 세우지 않는다.
 *
 * **이것이 고객에게 주는 주소다.** 상담도구가 그대로 읽어 손님에게 건네므로 표식을 붙이지 않는다.
 * 운영자가 앱 안에서 열 때만 쓰는 주소는 아래 publicSiteUrlFromApp 이다.
 */
export function publicSiteUrl(slug: string | null | undefined): string | null {
  const s = String(slug ?? '').trim()
  return s ? `${PUBLIC_SITE_ORIGIN}/members/${s}/` : null
}

/**
 * **앱 안에서 운영자가 제 소개 페이지를 열 때 쓰는 주소**(운영자 지시 2026-09-22 —
 * "이건 앱에서 접속했을 때만 보여야해").
 *
 * 표식 둘을 붙인다.
 *   app=1   — 공개 페이지가 '앱으로 돌아가기' 버튼을 세울 조건이다. 홈화면 앱에는 주소창도
 *             뒤로가기도 없어 같은 오리진 새 탭이 편도가 된다(신고 3353a4ed).
 *   nolog=1 — 운영자가 제 페이지를 열어 본 것이 방문 기록에 안 섞이게 한다.
 *
 * 종전에는 버튼 조건이 nolog 하나에 얹혀 있었다. 그래서 추적 제외를 켠 브라우저면 앱 밖에서
 * 그냥 들어와도 버튼이 떴고, nolog 가 localStorage 라 한 번 켜지면 영영 남았다.
 * 두 뜻을 한 스위치가 지고 있던 것이라 갈랐다.
 */
export function publicSiteUrlFromApp(slug: string | null | undefined): string | null {
  const base = publicSiteUrl(slug)
  return base ? `${base}?app=1&nolog=1` : null
}
