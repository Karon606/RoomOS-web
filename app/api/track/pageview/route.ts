import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { parseUA, categorizeReferrer } from '@/lib/tracking/uaParse'
import { lookupGeo } from '@/lib/tracking/geo'

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
  const today = new Date().toISOString().slice(0, 10)
  return createHash('sha256').update(`${today}|${ip ?? ''}|${ua ?? ''}|${slug}`).digest('hex').slice(0, 16)
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
    // 클라가 만든 id(crypto.randomUUID) — 입장 응답을 기다리지 않고 closeup 이 같은 id 를 쓰게 해서
    // 'pv_id 응답 전 이탈' 결측(빠른 이탈자가 통째로 유실되던 것)을 없앤다(전문가 지적). uuid 형식만 수용.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const clientId = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
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
    const vh = visitorHash(ip, ua, slug)

    // 도시 정확도 보정 — 봇이 아니면 ipinfo 로 조회(한국 IP 도시 오판정 보정).
    // 실패/타임아웃이면 Vercel 헤더값을 그대로 사용(geo 가 기록을 막지 않게).
    const geo = isBot
      ? { country, region, city }
      : await lookupGeo(ip, { country, region, city })

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
        country: geo.country,
        region:  geo.region,
        city:    geo.city,
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

    return NextResponse.json({ ok: true, id: created.id })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
