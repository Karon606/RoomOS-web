import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'

// 공개 랜딩 페이지 페이지뷰 수집 — 정적 HTML 의 작은 클라이언트 스크립트에서 POST.
// 익명 집계 위주(IP·UA는 해시 후 폐기). CORS 는 같은 도메인이라 별도 처리 불필요.

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

// 흔한 봇/크롤러 User-Agent 키워드 (대소문자 무시)
const BOT_KEYWORDS = [
  'bot', 'spider', 'crawler', 'crawl', 'slurp', 'mediapartners', 'preview',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp', 'pinterest',
  'googleother', 'applebot', 'bingbot', 'yandex', 'duckduck',
  'ahrefs', 'semrush', 'mj12bot', 'monitoring', 'uptime', 'pingdom',
]
function detectBot(ua: string | null): boolean {
  if (!ua) return true // UA 없음 = 의심
  const l = ua.toLowerCase()
  return BOT_KEYWORDS.some(k => l.includes(k))
}

// 간단 모바일 감지
function detectMobile(ua: string | null): boolean {
  if (!ua) return false
  return /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)
}

// 익명 식별자: IP+UA+slug + 오늘 날짜 → SHA-256. 매일 바뀌어 추적 한계 둠(프라이버시).
function visitorHash(ip: string | null, ua: string | null, slug: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return createHash('sha256').update(`${today}|${ip ?? ''}|${ua ?? ''}|${slug}`).digest('hex').slice(0, 16)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { slug?: string; path?: string; referrer?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string }
      | null
    if (!body || typeof body.slug !== 'string' || !body.slug.trim()) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const slug = body.slug.trim().slice(0, 64)
    const path = trim(body.path) ?? `/members/${slug}/`
    const referrer = trim(body.referrer)
    const referrerHost = extractHost(referrer)
    const utmSource   = trim(body.utmSource)
    const utmMedium   = trim(body.utmMedium)
    const utmCampaign = trim(body.utmCampaign)

    // 클라 헤더에서 IP/UA 추출 (Vercel/Proxy 헤더 우선)
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const ua = req.headers.get('user-agent')

    const isBot = detectBot(ua)
    const isMobile = detectMobile(ua)
    const vh = visitorHash(ip, ua, slug)

    await prisma.pageView.create({
      data: {
        slug,
        path,
        referrer,
        referrerHost,
        utmSource,
        utmMedium,
        utmCampaign,
        userAgent: trim(ua),
        isMobile,
        visitorHash: vh,
        isBot,
      },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
