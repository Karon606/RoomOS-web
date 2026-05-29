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
  // 트렌드 (자동 세분도)
  trend: { label: string; views: number; visitors: number }[]
  // 유입 출처 Top (범위 내)
  referrers: { host: string; count: number; percent: number }[]
  // UTM 캠페인 (범위 내)
  campaigns: { source: string; medium: string; campaign: string; count: number }[]
  // 시간대 0-23 (범위 내)
  hourly: { hour: number; count: number }[]
  // 디바이스 (범위 내)
  devices: { mobile: number; desktop: number }
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

type Row = {
  occurredAt: Date
  referrerHost: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  isMobile: boolean
  visitorHash: string | null
}

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

export async function getMarketingStats(range: MarketingRange = '30d'): Promise<MarketingStats> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { publicSlug: true },
  })
  const slug = property?.publicSlug?.trim() || null
  const publicUrl = slug ? `https://www.stayeum.com/members/${slug}/` : null

  const { start, bucket } = rangeStart(range)

  if (!slug) {
    return {
      range, bucket, publicSlug: null, publicUrl: null,
      totals: { today: 0, week: 0, month: 0, allTime: 0 },
      rangeViews: 0, rangeVisitors: 0,
      trend: [],
      referrers: [], campaigns: [],
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })),
      devices: { mobile: 0, desktop: 0 },
      botCount: 0,
    }
  }

  // 범위 내 행 (집계 대상)
  const inRange = await prisma.pageView.findMany({
    where: { slug, isBot: false, occurredAt: { gte: start } },
    orderBy: { occurredAt: 'asc' },
    select: {
      occurredAt: true, referrerHost: true, utmSource: true, utmMedium: true, utmCampaign: true,
      isMobile: true, visitorHash: true,
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
    prisma.pageView.count({ where: { slug, isBot: true, occurredAt: { gte: start } } }),
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

  // 디바이스 (범위 내)
  const mobile = inRange.filter(r => r.isMobile).length
  const desktop = inRange.length - mobile

  return {
    range, bucket, publicSlug: slug, publicUrl,
    totals: { today: todayCount, week: weekCount, month: monthCount, allTime: allTimeCount },
    rangeViews, rangeVisitors,
    trend, referrers, campaigns, hourly,
    devices: { mobile, desktop },
    botCount,
  }
}
