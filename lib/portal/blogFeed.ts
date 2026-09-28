// 첫 화면 '원장님들의 글'과 검색 결과를 네이버 블로그 검색 API 로 모으는 서버 전용 모듈
//
// 왜 제목 규칙으로 거르나(2026-09-28 실측). '고시원 운영' 같은 검색어를 그대로 쓰면 결과 1,699건 중
// 대부분이 창업 컨설팅·분양·마케팅 대행·지역 SEO 글이었다. 제목에 운영자 본인의 말투
// ("운영해보니", "원장의 일상", "명도일지")가 있는 글만 남기면 78건이 남고 거의 전부가 실제 원장 글이다.
// 규칙을 느슨하게 풀면 광고가 첫 화면에 올라온다. 풀기 전에 같은 실측을 다시 할 것.
//
// 썸네일·본문은 가져오지 않는다(저작권). 제목·요약·블로그명·날짜·링크만 쓰고 원문으로 내보낸다.

import 'server-only'

export type BlogPost = {
  title: string
  summary: string
  blog: string
  date: string // YYYY.MM.DD
  link: string
}

type NaverItem = {
  title: string
  link: string
  description: string
  bloggername: string
  postdate: string // YYYYMMDD
}

/** 모아 두는 주기(초). 첫 화면은 이 주기로 다시 그려진다 — 실시간 목록이 아니다. */
export const FEED_REVALIDATE = 21600

const FEED_QUERIES = [
  '고시원 운영해보니', '고시원 운영일기', '고시원 운영일지', '고시원 원장 일상',
  '고시원 명도일지', '고시원 운영하며', '원룸텔 운영일기', '고시텔 원장',
]

const PLACE = /고시원|고시텔|원룸텔/
const OPERATOR_VOICE = /운영해\s?보니|운영하며|운영하면서|운영\s?일기|운영\s?일지|명도\s?일지|원장\s?일기|원장의|원장입니다|운영\s?중|인수한다면|운영\s?\d+년|\d+년차|운영기|운영 이야기/
const COMMERCIAL = /수익률|분양|매매|컨설팅|강의|수강|모집|대행|대출|체험단|협찬|이벤트|할인|프랜차이즈|멘토|방역|24시간/

const ENTITIES: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&apos;': "'" }

/** API 가 주는 <b> 강조와 HTML 엔티티, 그림 문자를 걷어낸다. 화면 문구에 이모지를 두지 않는 규칙과 같은 축. */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&(quot|amp|lt|gt|#39|apos);/g, m => ENTITIES[m] ?? m)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toPost(i: NaverItem): BlogPost {
  const d = i.postdate
  return {
    title: clean(i.title),
    summary: clean(i.description),
    blog: clean(i.bloggername),
    date: `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`,
    link: i.link,
  }
}

async function searchNaverBlog(query: string, sort: 'sim' | 'date', revalidate: number): Promise<NaverItem[]> {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) return []
  const url = `https://openapi.naver.com/v1/search/blog.json?${new URLSearchParams({ query, display: '100', sort })}`
  try {
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
      next: { revalidate },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { items?: NaverItem[] }
    return json.items ?? []
  } catch {
    // 바깥 API 가 죽어도 첫 화면은 떠야 한다 — 빈 목록이면 화면이 빈 상태 문구를 보인다.
    return []
  }
}

function isNaverBlog(link: string) {
  return /^https:\/\/(m\.)?blog\.naver\.com\//.test(link)
}

/** 첫 화면용. 원장 본인이 쓴 글만, 블로그 하나당 한 편, 최신순. */
export async function getOperatorPosts(limit = 6): Promise<BlogPost[]> {
  const batches = await Promise.all(
    FEED_QUERIES.flatMap(q => [searchNaverBlog(q, 'sim', FEED_REVALIDATE), searchNaverBlog(q, 'date', FEED_REVALIDATE)]),
  )
  const byLink = new Map<string, NaverItem>()
  for (const item of batches.flat()) byLink.set(item.link, item)

  const picked = [...byLink.values()]
    .filter(i => {
      const title = clean(i.title)
      return isNaverBlog(i.link)
        && PLACE.test(title)
        && OPERATOR_VOICE.test(title)
        && !COMMERCIAL.test(`${title} ${clean(i.bloggername)}`)
    })
    .sort((a, b) => b.postdate.localeCompare(a.postdate))

  const seenBlog = new Set<string>()
  const out: BlogPost[] = []
  for (const i of picked) {
    if (seenBlog.has(i.bloggername)) continue
    seenBlog.add(i.bloggername)
    out.push(toPost(i))
    if (out.length >= limit) break
  }
  return out
}

/** 검색 결과용. 검색어가 들어간 고시원 글에서 광고성만 뺀다(운영자 말투까지 요구하면 거의 안 남는다). */
export async function searchPosts(q: string, limit = 20): Promise<BlogPost[]> {
  const query = PLACE.test(q) ? q : `고시원 ${q}`
  const items = await searchNaverBlog(query, 'sim', 3600)
  return items
    .filter(i => {
      const title = clean(i.title)
      return isNaverBlog(i.link) && PLACE.test(`${title} ${clean(i.description)}`) && !COMMERCIAL.test(`${title} ${clean(i.bloggername)}`)
    })
    .slice(0, limit)
    .map(toPost)
}
