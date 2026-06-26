'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

// /marketing 페이지용 — 영업장 publicSlug 의 페이지뷰를 범위·세분도별로 집계.
// 범위 선택 시 클라가 같은 액션을 다시 호출 → 새 통계 받아 차트·표 재렌더.

async function getPropertyId(): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const id = cookieStore.get('selected_property_id')?.value
  if (!id) redirect('/property-select')
  return id
}

export type MarketingRange = 'today' | '7d' | '30d' | '90d' | '1y'
export type MarketingBucket = 'hour' | 'day' | 'month'

export type MarketingStats = {
  range: MarketingRange
  bucket: MarketingBucket
  publicSlug: string | null
  publicUrl: string | null
  // 범위와 무관한 4종 누적 카드 (참고용 — 항상 today/7d/30d/all-time)
  totals: { today: number; week: number; month: number; allTime: number }
  // 범위 내 핵심 지표
  rangeViews: number      // 범위 내 총 페이지뷰
  rangeVisitors: number   // 범위 내 유니크 방문자(visitorHash 기준)
  // 참여도 (범위 내 평균, durationMs/scrollDepthPct 가 채워진 행만)
  engagement: {
    avgDurationMs: number   // 평균 체류 시간
    avgScrollPct: number    // 평균 스크롤 깊이
    sampleCount: number     // 측정된 샘플 수
    bounceRatePct: number   // 이탈률(체류 5초 미만)
  }
  // 섹션별 평균 체류시간 — 페이지 어느 영역에 오래 머물렀나
  sections: { id: string; name: string; avgMs: number; sampleCount: number }[]
  sectionSampleCount: number   // 섹션 데이터가 있는 세션 수
  // 트렌드 (자동 세분도)
  trend: { label: string; views: number; visitors: number }[]
  // 유입 출처 Top (범위 내, 호스트 기준)
  referrers: { host: string; count: number; percent: number }[]
  // 채널 카테고리 (검색/소셜/직접/기타)
  channels: { category: string; count: number; percent: number }[]
  // 검색엔진·소셜 분류된 이름 Top
  namedSources: { name: string; category: string; count: number }[]
  // UTM 캠페인 (범위 내)
  campaigns: { source: string; medium: string; campaign: string; count: number }[]
  // 시간대 0-23 (범위 내)
  hourly: { hour: number; count: number }[]
  // 디바이스 종류 (mobile/tablet/desktop)
  deviceTypes: { type: string; count: number; percent: number }[]
  // OS Top
  oses: { os: string; count: number; percent: number }[]
  // 브라우저 Top
  browsers: { browser: string; count: number; percent: number }[]
  // 지역 (국가 / 도시) — city 에 상위 지역(시·도) 병행 표기
  countries: { country: string; count: number; percent: number }[]
  cities: { city: string; region: string | null; country: string | null; count: number }[]
  // 선택된 특정 날짜 (YYYY-MM-DD KST) — 프리셋 범위면 null
  customDate: string | null
  // 언어 Top
  languages: { language: string; count: number }[]
  // 화면 해상도 Top
  resolutions: { res: string; count: number }[]
  // 봇 트래픽 (참고용 — 범위 내)
  botCount: number
}

function rangeStart(range: MarketingRange): { start: Date; bucket: MarketingBucket } {
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  switch (range) {
    case 'today': return { start: startOfToday, bucket: 'hour' }
    case '7d':    { const d = new Date(startOfToday); d.setDate(d.getDate() - 6);  return { start: d, bucket: 'day' } }
    case '30d':   { const d = new Date(startOfToday); d.setDate(d.getDate() - 29); return { start: d, bucket: 'day' } }
    case '90d':   { const d = new Date(startOfToday); d.setDate(d.getDate() - 89); return { start: d, bucket: 'day' } }
    case '1y':    { const d = new Date(startOfToday); d.setMonth(d.getMonth() - 11); d.setDate(1); return { start: d, bucket: 'month' } }
  }
}

// KST 보정 (브라우저/서버 timezone과 무관하게 한국시간 기준 day/month)
const KST_OFFSET = 9 * 60 * 60 * 1000
const toKst = (d: Date) => new Date(d.getTime() + KST_OFFSET)

// 한국 시·도명 표준화 → 한국어.
// 두 가지 입력을 모두 받는다: (1) Vercel x-vercel-ip-country-region 의 ISO 3166-2 코드('11'),
// (2) ipinfo 의 영문 시·도명('Seoul'). 레거시 데이터(코드)와 신규(ipinfo 영문) 모두 표시되게 함.
const KR_REGION_CODE: Record<string, string> = {
  '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전',
  '31': '울산', '50': '세종', '41': '경기', '42': '강원', '43': '충북', '44': '충남',
  '45': '전북', '46': '전남', '47': '경북', '48': '경남', '49': '제주',
}
// ipinfo 영문 시·도명(정규화: 소문자·영문자만) → 한국어. 도(道)는 표기 변형까지 흡수.
const KR_REGION_NAME: [RegExp, string][] = [
  [/seoul/, '서울'], [/busan|pusan/, '부산'], [/daegu|taegu/, '대구'], [/incheon/, '인천'],
  [/gwangju|kwangju/, '광주'], [/daejeon|taejon/, '대전'], [/ulsan/, '울산'], [/sejong/, '세종'],
  [/gyeonggi|kyonggi/, '경기'], [/gangwon|kangwon/, '강원'],
  [/chungcheongbuk|chungbuk|northchungcheong/, '충북'], [/chungcheongnam|chungnam|southchungcheong/, '충남'],
  [/jeollabuk|jeonbuk|northjeolla/, '전북'], [/jeollanam|jeonnam|southjeolla/, '전남'],
  [/gyeongsangbuk|gyeongbuk|northgyeongsang/, '경북'], [/gyeongsangnam|gyeongnam|southgyeongsang/, '경남'],
  [/jeju|cheju/, '제주'],
]
// 한국 지명(시·도 또는 광역시 city)을 한국어로. 매핑 안 되면 원본 유지(예: 'Suwon', 'Seongnam-si').
function krPlaceToKo(country: string | null, name: string | null): string | null {
  if (!name) return null
  if (country && country.toUpperCase() !== 'KR') return name   // 한국 외엔 손대지 않음
  let code = name.toUpperCase()
  if (code.startsWith('KR-')) code = code.slice(3)
  if (KR_REGION_CODE[code]) return KR_REGION_CODE[code]          // ISO 코드(레거시)
  const norm = name.toLowerCase().replace(/[^a-z]/g, '')
  for (const [re, ko] of KR_REGION_NAME) if (re.test(norm)) return ko  // ipinfo 영문명
  return name
}
function regionDisplay(country: string | null, region: string | null): string | null {
  return krPlaceToKo(country, region)
}

type Row = {
  occurredAt: Date
  referrerHost: string | null
  searchEngine: string | null
  referrerCategory: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  isMobile: boolean
  visitorHash: string | null
  country: string | null
  region: string | null
  city: string | null
  os: string | null
  browser: string | null
  deviceType: string | null
  language: string | null
  screenWidth: number | null
  screenHeight: number | null
  durationMs: number | null
  scrollDepthPct: number | null
  sectionDwellMs: unknown
}

// 공개페이지 섹션 id → 표시 이름 (index.html 의 <section id> 와 일치)
const SECTION_LABEL: Record<string, string> = {
  top: '첫 화면(소개)', rooms: '객실·가격', amenities: '편의시설',
  video: '투어 영상', gallery: '갤러리', location: '위치·약도', contact: '문의',
}
const SECTION_ORDER = ['top', 'rooms', 'amenities', 'video', 'gallery', 'location', 'contact']

function buildTrend(rows: Row[], start: Date, bucket: MarketingBucket): { label: string; views: number; visitors: number }[] {
  type Acc = { label: string; views: number; visitors: Set<string> }
  const buckets: Acc[] = []
  const now = new Date()

  if (bucket === 'hour') {
    // 오늘 0-23시
    for (let h = 0; h < 24; h++) buckets.push({ label: `${h}시`, views: 0, visitors: new Set() })
    for (const r of rows) {
      const kst = toKst(r.occurredAt)
      const h = kst.getUTCHours()
      if (h >= 0 && h < 24) {
        buckets[h].views++
        if (r.visitorHash) buckets[h].visitors.add(r.visitorHash)
      }
    }
  } else if (bucket === 'day') {
    const startKst = toKst(start)
    const startD = Date.UTC(startKst.getUTCFullYear(), startKst.getUTCMonth(), startKst.getUTCDate())
    const todayKst = toKst(now)
    const todayD = Date.UTC(todayKst.getUTCFullYear(), todayKst.getUTCMonth(), todayKst.getUTCDate())
    const days = Math.floor((todayD - startD) / (24 * 60 * 60 * 1000)) + 1
    for (let i = 0; i < days; i++) {
      const d = new Date(startD + i * 24 * 60 * 60 * 1000)
      buckets.push({ label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, views: 0, visitors: new Set() })
    }
    for (const r of rows) {
      const kst = toKst(r.occurredAt)
      const dayKey = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
      const idx = Math.floor((dayKey - startD) / (24 * 60 * 60 * 1000))
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].views++
        if (r.visitorHash) buckets[idx].visitors.add(r.visitorHash)
      }
    }
  } else {
    // month: 12 개월
    const startKst = toKst(start)
    const baseY = startKst.getUTCFullYear()
    const baseM = startKst.getUTCMonth()
    for (let i = 0; i < 12; i++) {
      const y = baseY + Math.floor((baseM + i) / 12)
      const m = ((baseM + i) % 12 + 12) % 12
      buckets.push({ label: `${m + 1}월${y !== baseY && m === 0 ? ` ${y}` : ''}`, views: 0, visitors: new Set() })
    }
    for (const r of rows) {
      const kst = toKst(r.occurredAt)
      const ry = kst.getUTCFullYear()
      const rm = kst.getUTCMonth()
      const idx = (ry - baseY) * 12 + (rm - baseM)
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].views++
        if (r.visitorHash) buckets[idx].visitors.add(r.visitorHash)
      }
    }
  }
  return buckets.map(b => ({ label: b.label, views: b.views, visitors: b.visitors.size }))
}

export async function getMarketingStats(
  range: MarketingRange = '30d',
  customDate: string | null = null,
): Promise<MarketingStats> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { publicSlug: true },
  })
  const slug = property?.publicSlug?.trim() || null
  const publicUrl = slug ? `https://www.stayeum.com/members/${slug}/` : null

  // 특정 날짜(YYYY-MM-DD, KST 하루) 선택 시 → 그 날 0~24시(시간별). 아니면 프리셋 범위.
  const validCustom = customDate && /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : null
  let start: Date
  let end: Date | null = null
  let bucket: MarketingBucket
  if (validCustom) {
    start = new Date(`${validCustom}T00:00:00+09:00`)
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    bucket = 'hour'
  } else {
    const r = rangeStart(range)
    start = r.start; bucket = r.bucket
  }

  if (!slug) {
    return {
      range, bucket, publicSlug: null, publicUrl: null,
      totals: { today: 0, week: 0, month: 0, allTime: 0 },
      rangeViews: 0, rangeVisitors: 0,
      engagement: { avgDurationMs: 0, avgScrollPct: 0, sampleCount: 0, bounceRatePct: 0 },
      sections: [], sectionSampleCount: 0,
      trend: [],
      referrers: [], channels: [], namedSources: [], campaigns: [],
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })),
      deviceTypes: [], oses: [], browsers: [],
      countries: [], cities: [], languages: [], resolutions: [],
      customDate: validCustom, botCount: 0,
    }
  }

  // 범위 내 행 (집계 대상)
  const inRange = await prisma.pageView.findMany({
    where: { slug, isBot: false, occurredAt: { gte: start, ...(end ? { lt: end } : {}) } },
    orderBy: { occurredAt: 'asc' },
    select: {
      occurredAt: true,
      referrerHost: true, searchEngine: true, referrerCategory: true,
      utmSource: true, utmMedium: true, utmCampaign: true,
      isMobile: true, visitorHash: true,
      country: true, region: true, city: true,
      os: true, browser: true, deviceType: true,
      language: true, screenWidth: true, screenHeight: true,
      durationMs: true, scrollDepthPct: true, sectionDwellMs: true,
    },
  })

  // 총계 4종은 범위와 무관 — KST 기준 today/week/month/all-time
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const startOfWeek  = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 6)
  const startOfMonth = new Date(startOfToday); startOfMonth.setDate(startOfMonth.getDate() - 29)

  const [todayCount, weekCount, monthCount, allTimeCount, botCount] = await Promise.all([
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfToday } } }),
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfWeek } } }),
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfMonth } } }),
    prisma.pageView.count({ where: { slug, isBot: false } }),
    prisma.pageView.count({ where: { slug, isBot: true, occurredAt: { gte: start, ...(end ? { lt: end } : {}) } } }),
  ])

  // 트렌드
  const trend = buildTrend(inRange, start, bucket)

  // 범위 내 총뷰·유니크 방문자
  const rangeViews = inRange.length
  const rangeVisitors = new Set(inRange.map(r => r.visitorHash).filter(Boolean) as string[]).size

  // 유입 출처
  const refMap = new Map<string, number>()
  for (const r of inRange) {
    const host = r.referrerHost || '직접 방문'
    refMap.set(host, (refMap.get(host) ?? 0) + 1)
  }
  const refTotal = Array.from(refMap.values()).reduce((s, v) => s + v, 0) || 1
  const referrers = Array.from(refMap.entries())
    .map(([host, count]) => ({ host, count, percent: Math.round((count / refTotal) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // UTM
  const utmMap = new Map<string, number>()
  for (const r of inRange) {
    if (!r.utmSource && !r.utmMedium && !r.utmCampaign) continue
    const key = `${r.utmSource ?? '-'}|${r.utmMedium ?? '-'}|${r.utmCampaign ?? '-'}`
    utmMap.set(key, (utmMap.get(key) ?? 0) + 1)
  }
  const campaigns = Array.from(utmMap.entries())
    .map(([k, count]) => {
      const [source, medium, campaign] = k.split('|')
      return { source, medium, campaign, count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // 시간대 (KST) — 범위 내
  const hourCounts = Array.from({ length: 24 }, () => 0)
  for (const r of inRange) {
    const kst = toKst(r.occurredAt)
    hourCounts[kst.getUTCHours()]++
  }
  const hourly = hourCounts.map((count, hour) => ({ hour, count }))

  // 채널 카테고리 (검색/소셜/직접/기타)
  const chMap = new Map<string, number>()
  for (const r of inRange) {
    const c = r.referrerCategory || (r.referrerHost ? 'other' : 'direct')
    chMap.set(c, (chMap.get(c) ?? 0) + 1)
  }
  const chTotal = Array.from(chMap.values()).reduce((s, v) => s + v, 0) || 1
  const CHANNEL_LABEL: Record<string, string> = { search: '검색', social: '소셜', direct: '직접', other: '기타' }
  const channels = Array.from(chMap.entries())
    .map(([k, count]) => ({ category: CHANNEL_LABEL[k] ?? k, count, percent: Math.round((count / chTotal) * 100) }))
    .sort((a, b) => b.count - a.count)

  // 분류된 검색엔진·소셜 이름 Top
  const namedMap = new Map<string, { count: number; category: string }>()
  for (const r of inRange) {
    if (!r.searchEngine) continue
    const cat = CHANNEL_LABEL[r.referrerCategory ?? ''] ?? '기타'
    const existing = namedMap.get(r.searchEngine)
    if (existing) existing.count++
    else namedMap.set(r.searchEngine, { count: 1, category: cat })
  }
  const namedSources = Array.from(namedMap.entries())
    .map(([name, v]) => ({ name, category: v.category, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // 디바이스 타입
  const dtMap = new Map<string, number>()
  for (const r of inRange) {
    const t = r.deviceType || (r.isMobile ? 'mobile' : 'desktop')
    dtMap.set(t, (dtMap.get(t) ?? 0) + 1)
  }
  const dtTotal = Array.from(dtMap.values()).reduce((s, v) => s + v, 0) || 1
  const DT_LABEL: Record<string, string> = { mobile: '모바일', tablet: '태블릿', desktop: '데스크탑' }
  const deviceTypes = Array.from(dtMap.entries())
    .map(([t, count]) => ({ type: DT_LABEL[t] ?? t, count, percent: Math.round((count / dtTotal) * 100) }))
    .sort((a, b) => b.count - a.count)

  // OS Top
  const osMap = new Map<string, number>()
  for (const r of inRange) if (r.os) osMap.set(r.os, (osMap.get(r.os) ?? 0) + 1)
  const osTotal = Array.from(osMap.values()).reduce((s, v) => s + v, 0) || 1
  const oses = Array.from(osMap.entries())
    .map(([os, count]) => ({ os, count, percent: Math.round((count / osTotal) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // 브라우저 Top
  const brMap = new Map<string, number>()
  for (const r of inRange) if (r.browser) brMap.set(r.browser, (brMap.get(r.browser) ?? 0) + 1)
  const brTotal = Array.from(brMap.values()).reduce((s, v) => s + v, 0) || 1
  const browsers = Array.from(brMap.entries())
    .map(([browser, count]) => ({ browser, count, percent: Math.round((count / brTotal) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // 국가
  const ctMap = new Map<string, number>()
  for (const r of inRange) {
    const c = r.country || '미상'
    ctMap.set(c, (ctMap.get(c) ?? 0) + 1)
  }
  const ctTotal = Array.from(ctMap.values()).reduce((s, v) => s + v, 0) || 1
  const countries = Array.from(ctMap.entries())
    .map(([country, count]) => ({ country, count, percent: Math.round((count / ctTotal) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // 도시 (상위 지역·국가 함께) — 같은 city명 구분 위해 region(시·도) 병행.
  // 광역시는 city·region 이 같으므로(서울·서울) 중복 표기를 없앤다.
  const cityMap = new Map<string, { city: string; region: string | null; country: string | null; count: number }>()
  for (const r of inRange) {
    if (!r.city) continue
    const city = krPlaceToKo(r.country, r.city) ?? r.city
    const region = regionDisplay(r.country, r.region)
    const dedupRegion = region && region === city ? null : region   // '서울 · 서울' 방지
    const key = `${r.country ?? ''}|${dedupRegion ?? ''}|${city}`
    const existing = cityMap.get(key)
    if (existing) existing.count++
    else cityMap.set(key, { city, region: dedupRegion, country: r.country, count: 1 })
  }
  const cities = Array.from(cityMap.values()).sort((a, b) => b.count - a.count).slice(0, 12)

  // 언어 Top
  const langMap = new Map<string, number>()
  for (const r of inRange) if (r.language) langMap.set(r.language, (langMap.get(r.language) ?? 0) + 1)
  const languages = Array.from(langMap.entries())
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // 화면 해상도 Top (보기 좋게 묶기)
  const resMap = new Map<string, number>()
  for (const r of inRange) {
    if (!r.screenWidth || !r.screenHeight) continue
    const k = `${r.screenWidth} × ${r.screenHeight}`
    resMap.set(k, (resMap.get(k) ?? 0) + 1)
  }
  const resolutions = Array.from(resMap.entries())
    .map(([res, count]) => ({ res, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // 참여도 — durationMs / scrollDepthPct 채워진 행만 평균
  const dur = inRange.filter(r => r.durationMs !== null) as (Row & { durationMs: number })[]
  const scr = inRange.filter(r => r.scrollDepthPct !== null) as (Row & { scrollDepthPct: number })[]
  const avgDurationMs = dur.length > 0 ? Math.round(dur.reduce((s, r) => s + r.durationMs, 0) / dur.length) : 0
  const avgScrollPct  = scr.length > 0 ? Math.round(scr.reduce((s, r) => s + r.scrollDepthPct, 0) / scr.length) : 0
  const bounces = dur.filter(r => r.durationMs < 5000).length
  const bounceRatePct = dur.length > 0 ? Math.round((bounces / dur.length) * 100) : 0
  const engagement = {
    avgDurationMs, avgScrollPct,
    sampleCount: Math.max(dur.length, scr.length),
    bounceRatePct,
  }

  // 섹션별 평균 체류시간 — sectionDwellMs(JSON { id: ms }) 가 있는 세션만 평균
  const secTotal = new Map<string, number>()   // 섹션별 누적 ms
  const secCount = new Map<string, number>()   // 섹션별 세션 수(그 섹션을 본 세션)
  let sectionSampleCount = 0
  for (const r of inRange) {
    const sd = r.sectionDwellMs
    if (!sd || typeof sd !== 'object' || Array.isArray(sd)) continue
    let any = false
    for (const [id, v] of Object.entries(sd as Record<string, unknown>)) {
      const ms = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(ms) || ms <= 0) continue
      secTotal.set(id, (secTotal.get(id) ?? 0) + ms)
      secCount.set(id, (secCount.get(id) ?? 0) + 1)
      any = true
    }
    if (any) sectionSampleCount++
  }
  const sections = SECTION_ORDER
    .filter(id => secCount.has(id))
    .map(id => ({
      id,
      name: SECTION_LABEL[id] ?? id,
      avgMs: Math.round((secTotal.get(id) ?? 0) / (secCount.get(id) ?? 1)),
      sampleCount: secCount.get(id) ?? 0,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)

  return {
    range, bucket, publicSlug: slug, publicUrl,
    totals: { today: todayCount, week: weekCount, month: monthCount, allTime: allTimeCount },
    rangeViews, rangeVisitors, engagement, sections, sectionSampleCount,
    trend, referrers, channels, namedSources, campaigns, hourly,
    deviceTypes, oses, browsers,
    countries, cities, languages, resolutions,
    customDate: validCustom, botCount,
  }
}
