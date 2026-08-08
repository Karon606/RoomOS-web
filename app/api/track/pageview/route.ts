import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { parseUA, categorizeReferrer } from '@/lib/tracking/uaParse'
import { lookupGeo } from '@/lib/tracking/geo'
import { isKnownSlug, rateLimited, clientIp } from '@/lib/tracking/guard'
import { kstYmdStr } from '@/lib/kstDate'

// 공개 랜딩 페이지 페이지뷰 수집 — 정적 HTML 의 클라이언트 스크립트에서 POST.
// 익명 집계 위주(IP·UA는 해시 후 폐기). closeup(체류·스크롤)은 /api/track/closeup 으로.

const MAX_LEN = 512
const trim = (v: string | null | undefined): string | null => {
  if (!v) return null
  const t = v.trim()
  if (!t) return null
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t
}

function extractHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null
  try { return new URL(referrer).host || null } catch { return null }
}

const BOT_KEYWORDS = [
  'bot', 'spider', 'crawler', 'crawl', 'slurp', 'mediapartners', 'preview',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp', 'pinterest',
  'googleother', 'applebot', 'bingbot', 'yandex', 'duckduck',
  'ahrefs', 'semrush', 'mj12bot', 'monitoring', 'uptime', 'pingdom',
]
function detectBot(ua: string | null): boolean {
  if (!ua) return true
  const l = ua.toLowerCase()
  return BOT_KEYWORDS.some(k => l.includes(k))
}

function visitorHash(ip: string | null, ua: string | null, slug: string): string {
  const today = kstYmdStr()   // 일 버킷은 KST — UTC 로 자르면 하루 경계가 KST 09 시가 된다
  return createHash('sha256').update(`${today}|${ip ?? ''}|${ua ?? ''}|${slug}`).digest('hex').slice(0, 16)
}

// 익명 방문자 ID(vid) 기반 안정 해시 — 날짜·IP 무관이라 같은 브라우저면 계속 같은 방문자로 이어진다.
// DB 에는 원본 vid 가 아닌 해시만 저장(16자 hex, 기존 visitorHash 컬럼·표기 그대로 재사용).
function stableVisitorHash(vid: string, slug: string): string {
  return createHash('sha256').update(`v1|${vid}|${slug}`).digest('hex').slice(0, 16)
}

// 안전 정수 변환 (음수·NaN·과대값 제거)
function safeInt(v: unknown, max = 10000): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.floor(n)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | {
          id?: string
          vid?: string
          slug?: string; path?: string; referrer?: string
          utmSource?: string; utmMedium?: string; utmCampaign?: string
          screenWidth?: number; screenHeight?: number
          viewportWidth?: number; viewportHeight?: number
          language?: string
        }
      | null
    if (!body || typeof body.slug !== 'string' || !body.slug.trim()) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const slug = body.slug.trim().slice(0, 64)
    // 실존 영업장 slug 만 받는다. slug 는 공개 URL 에 드러나 있어 누구나 알지만,
    // 화이트리스트가 없으면 아무 문자열로도 행이 쌓여 저장공간과 유료 geo 호출이 무한히 늘어난다.
    if (!(await isKnownSlug(slug))) return NextResponse.json({ ok: false }, { status: 404 })
    // IP 레이트리밋 — 무한 주입을 유한하게 만든다(완전 차단이 목적이 아니다, guard.ts 주석 참조)
    if (rateLimited(clientIp(req))) return NextResponse.json({ ok: false }, { status: 429 })
    // 클라가 만든 id(crypto.randomUUID) — 입장 응답을 기다리지 않고 closeup 이 같은 id 를 쓰게 해서
    // 'pv_id 응답 전 이탈' 결측(빠른 이탈자가 통째로 유실되던 것)을 없앤다(전문가 지적). uuid 형식만 수용.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const clientId = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
    // 익명 방문자 ID(localStorage 영속) — 있으면 IP·날짜와 무관한 안정 해시로 같은 사람을 이어준다(모바일 IP 변동 과소집계 해소)
    const vid = typeof body.vid === 'string' && UUID_RE.test(body.vid) ? body.vid.toLowerCase() : null
    const path = trim(body.path) ?? `/members/${slug}/`
    const referrer = trim(body.referrer)
    const referrerHost = extractHost(referrer)
    const utmSource   = trim(body.utmSource)
    const utmMedium   = trim(body.utmMedium)
    const utmCampaign = trim(body.utmCampaign)
    const language    = trim(body.language)

    // Vercel 자동 헤더 — 도시 단위 위치
    const country = trim(req.headers.get('x-vercel-ip-country'))
    const region  = trim(req.headers.get('x-vercel-ip-country-region'))
    const cityRaw = req.headers.get('x-vercel-ip-city')
    const city    = cityRaw ? trim(decodeURIComponent(cityRaw)) : null

    // 헤더 IP/UA
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const ua = req.headers.get('user-agent')

    const isBot = detectBot(ua)
    const uaInfo = parseUA(ua)
    const isMobile = uaInfo.deviceType === 'mobile'
    const refInfo = categorizeReferrer(referrerHost)
    const vh = vid ? stableVisitorHash(vid, slug) : visitorHash(ip, ua, slug)

    const created = await prisma.pageView.create({
      data: {
        ...(clientId && { id: clientId }),
        slug,
        path,
        referrer,
        referrerHost,
        searchEngine:     refInfo.searchEngine,
        referrerCategory: refInfo.referrerCategory,
        utmSource,
        utmMedium,
        utmCampaign,
        country,
        region,
        city,
        os:             uaInfo.os,
        osVersion:      uaInfo.osVersion,
        browser:        uaInfo.browser,
        browserVersion: uaInfo.browserVersion,
        deviceType:     uaInfo.deviceType,
        screenWidth:   safeInt(body.screenWidth,   20000),
        screenHeight:  safeInt(body.screenHeight,  20000),
        viewportWidth: safeInt(body.viewportWidth, 20000),
        viewportHeight: safeInt(body.viewportHeight, 20000),
        language,
        userAgent: trim(ua),
        isMobile,
        visitorHash: vh,
        // 방문 기록 상세 조회용. 90일 지나면 크론이 비운다(개인정보 보관 기간, 운영자 결정 2026-07-24).
        ip,
        isBot,
      },
      select: { id: true },
    })

    // 도시 정확도 보정 — 봇이 아니면 ipinfo 로 조회(한국 IP 도시 오판정 보정).
    // **행을 만든 뒤에 한다.** 전에는 이 조회(타임아웃 1.5초)를 create 앞에서 await 해서
    // 방문 시작 1.5초 안에 도착한 closeup·cta·gallery·popup 이 대상 행을 못 찾고 조용히 버려졌다.
    // 가장 빨리 떠난 사람일수록 기록이 안 남으니 이탈률이 과소, 평균 체류가 과대로 나왔다.
    // 실패·타임아웃이면 Vercel 헤더값을 그대로 둔다(geo 가 기록을 막지 않게).
    if (!isBot) {
      const geo = await lookupGeo(ip, { country, region, city })
      if (geo.country !== country || geo.region !== region || geo.city !== city) {
        await prisma.pageView.update({
          where: { id: created.id },
          data: { country: geo.country, region: geo.region, city: geo.city },
        }).catch(() => null)
      }
    }

    return NextResponse.json({ ok: true, id: created.id })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
