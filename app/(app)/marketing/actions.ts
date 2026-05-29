'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

// /marketing 페이지용 — 영업장 publicSlug 의 페이지뷰를 집계해서 반환.
// (app) 게이트가 인증·승인 이미 처리. 여기서는 propertyId 만 검증.

async function getPropertyId(): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const id = cookieStore.get('selected_property_id')?.value
  if (!id) redirect('/property-select')
  return id
}

export type MarketingStats = {
  publicSlug: string | null
  publicUrl: string | null
  // 전체 (봇 제외)
  totals: { today: number; week: number; month: number; allTime: number }
  // 일별 추이 (최근 30일)
  dailyTrend: { date: string; views: number; visitors: number }[]
  // 유입 출처 Top
  referrers: { host: string; count: number; percent: number }[]
  // UTM 캠페인
  campaigns: { source: string; medium: string; campaign: string; count: number }[]
  // 시간대(0-23)
  hourly: { hour: number; count: number }[]
  // 디바이스
  devices: { mobile: number; desktop: number }
  // 봇 트래픽 (참고용)
  botCount: number
}

export async function getMarketingStats(): Promise<MarketingStats> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { publicSlug: true },
  })
  const slug = property?.publicSlug?.trim() || null
  // 도메인은 next.config.ts redirect로 stayeum.com → www.stayeum.com 매핑됨
  const publicUrl = slug ? `https://www.stayeum.com/members/${slug}/` : null

  if (!slug) {
    return {
      publicSlug: null,
      publicUrl: null,
      totals: { today: 0, week: 0, month: 0, allTime: 0 },
      dailyTrend: [],
      referrers: [],
      campaigns: [],
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })),
      devices: { mobile: 0, desktop: 0 },
      botCount: 0,
    }
  }

  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 6)
  const startOfMonth = new Date(startOfToday); startOfMonth.setDate(startOfMonth.getDate() - 29)

  // 봇 제외 — 전체 한 번에 가져와서 메모리에서 집계 (소규모 사이트라 충분)
  const [allRows, botCount] = await Promise.all([
    prisma.pageView.findMany({
      where: { slug, isBot: false },
      orderBy: { occurredAt: 'asc' },
      select: {
        occurredAt: true, referrerHost: true, utmSource: true, utmMedium: true, utmCampaign: true,
        isMobile: true, visitorHash: true,
      },
    }),
    prisma.pageView.count({ where: { slug, isBot: true } }),
  ])

  // ── 총계 ─────
  const totals = {
    today:   allRows.filter(r => r.occurredAt >= startOfToday).length,
    week:    allRows.filter(r => r.occurredAt >= startOfWeek).length,
    month:   allRows.filter(r => r.occurredAt >= startOfMonth).length,
    allTime: allRows.length,
  }

  // ── 일별 추이 (최근 30일, occurredAt KST 기준 yyyy-mm-dd) ─────
  const fmtDay = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) // KST 보정
  const dayMap = new Map<string, { views: number; visitors: Set<string> }>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(startOfToday); d.setDate(d.getDate() - i)
    const k = fmtDay(d)
    dayMap.set(k, { views: 0, visitors: new Set() })
  }
  for (const r of allRows.filter(r => r.occurredAt >= startOfMonth)) {
    const k = fmtDay(r.occurredAt)
    const entry = dayMap.get(k)
    if (entry) {
      entry.views++
      if (r.visitorHash) entry.visitors.add(r.visitorHash)
    }
  }
  const dailyTrend = Array.from(dayMap.entries()).map(([date, v]) => ({
    date, views: v.views, visitors: v.visitors.size,
  }))

  // ── 유입 출처 Top ─────
  const refMap = new Map<string, number>()
  for (const r of allRows) {
    const host = r.referrerHost || '직접 방문'
    refMap.set(host, (refMap.get(host) ?? 0) + 1)
  }
  const refTotal = Array.from(refMap.values()).reduce((s, v) => s + v, 0) || 1
  const referrers = Array.from(refMap.entries())
    .map(([host, count]) => ({ host, count, percent: Math.round((count / refTotal) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // ── UTM 캠페인 ─────
  const utmMap = new Map<string, number>()
  for (const r of allRows) {
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

  // ── 시간대(0-23, KST) ─────
  const hourCounts = Array.from({ length: 24 }, () => 0)
  for (const r of allRows) {
    const kst = new Date(r.occurredAt.getTime() + 9 * 60 * 60 * 1000)
    hourCounts[kst.getUTCHours()]++
  }
  const hourly = hourCounts.map((count, hour) => ({ hour, count }))

  // ── 디바이스 ─────
  const mobile  = allRows.filter(r => r.isMobile).length
  const desktop = allRows.length - mobile

  return { publicSlug: slug, publicUrl, totals, dailyTrend, referrers, campaigns, hourly, devices: { mobile, desktop }, botCount }
}
