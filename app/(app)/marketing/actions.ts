'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { kstYmdStr } from '@/lib/kstDate'

// /marketing 페이지용 — 영업장 publicSlug 의 페이지뷰를 범위·세분도별로 집계.
// 범위 선택 시 클라가 같은 액션을 다시 호출 → 새 통계 받아 차트·표 재렌더.

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

export type MarketingRange = 'today' | '7d' | '30d' | '90d' | '1y'
export type MarketingBucket = 'hour' | 'day' | 'month'

export type MarketingStats = {
  range: MarketingRange
  bucket: MarketingBucket
  // 실제 조회창 (KST 'YYYY-MM-DD', 양끝 포함) — 프리셋일 때도 서버가 되돌려준다.
  // 클라가 날짜 산수를 복제하지 않게 하려는 것 (캡션·픽커 시딩의 단일 진실).
  rangeFrom: string
  rangeTo: string
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
  // 트렌드 (자동 세분도) — date 는 드릴다운용 원본 키(day='YYYY-MM-DD', month='YYYY-MM', hour=null).
  // 라벨은 표시 전용이라 파싱하지 않는다(연말연시에 연도가 유실됨).
  trend: { label: string; date: string | null; views: number; visitors: number }[]
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
  // 언어 Top
  languages: { language: string; count: number }[]
  // 화면 해상도 Top
  resolutions: { res: string; count: number }[]
  // 봇 트래픽 (참고용 — 범위 내)
  botCount: number
}

// KST 보정 (브라우저/서버 timezone과 무관하게 한국시간 기준 day/month/hour)
const KST_OFFSET = 9 * 60 * 60 * 1000
const toKst = (d: Date) => new Date(d.getTime() + KST_OFFSET)
// KST 기준 '오늘 0시'의 실제 UTC 시각 — 서버가 UTC여도 한국시간 자정으로 맞춘다.
function kstStartOfTodayUtc(): Date {
  const k = new Date(Date.now() + KST_OFFSET)
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET)
}

function rangeStart(range: MarketingRange): { start: Date; bucket: MarketingBucket } {
  const startOfToday = kstStartOfTodayUtc()   // KST 자정 기준(서버 TZ 무관)
  const DAY = 86400000
  switch (range) {
    case 'today': return { start: startOfToday, bucket: 'hour' }
    case '7d':    return { start: new Date(startOfToday.getTime() - 6 * DAY),  bucket: 'day' }
    case '30d':   return { start: new Date(startOfToday.getTime() - 29 * DAY), bucket: 'day' }
    case '90d':   return { start: new Date(startOfToday.getTime() - 89 * DAY), bucket: 'day' }
    case '1y':    {
      const k = new Date(Date.now() + KST_OFFSET)   // KST 기준 11개월 전 1일
      return { start: new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - 11, 1) - KST_OFFSET), bucket: 'month' }
    }
  }
}

const p2 = (n: number) => String(n).padStart(2, '0')
// 'YYYY-MM-DD'(KST) → 그 날 KST 0시의 실제 UTC 시각
const kstMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`)
// 양끝 포함 일수
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}
// 임의 기간의 버킷 자동 선택 — 1일=시간별 · 2~92일=일별 · 93일 이상=월별.
// (프리셋은 rangeStart()가 정한 버킷을 그대로 쓴다 — 기존 동작 보존)
function bucketForSpan(days: number): MarketingBucket {
  if (days <= 1) return 'hour'
  if (days <= 92) return 'day'
  return 'month'
}

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
// video 는 개편 전(2026-07-07 이전) 기록용, tour 는 개편 후 현행 id — 같은 투어 영상 섹션.
const SECTION_LABEL: Record<string, string> = {
  top: '첫 화면(소개)', rooms: '객실·가격', amenities: '편의시설',
  video: '투어 영상', tour: '투어 영상', gallery: '갤러리', location: '위치·약도', contact: '문의',
}
const SECTION_ORDER = ['top', 'rooms', 'amenities', 'video', 'tour', 'gallery', 'location', 'contact']

// 섹션 id별 누적을 '표시 라벨' 기준으로 합산 — SECTION_LABEL 이 video·tour 를 둘 다 '투어 영상'으로
// 매핑하므로 합치지 않으면 같은 이름이 두 줄로 나온다(요약 카드·방문 상세 공통).
// 반환 순서는 SECTION_ORDER(문서 순서), 라벨은 그 라벨이 처음 등장한 위치에 자리잡는다.
type SectionAgg = { key: string; name: string; totalMs: number; count: number }
function mergeSectionsByLabel(per: Map<string, { totalMs: number; count: number }>): SectionAgg[] {
  const out: SectionAgg[] = []
  const byLabel = new Map<string, SectionAgg>()
  for (const id of SECTION_ORDER) {
    const v = per.get(id)
    if (!v || v.totalMs <= 0) continue
    const name = SECTION_LABEL[id] ?? id
    const hit = byLabel.get(name)
    if (hit) { hit.totalMs += v.totalMs; hit.count += v.count; continue }
    const agg: SectionAgg = { key: id, name, totalMs: v.totalMs, count: v.count }
    byLabel.set(name, agg)
    out.push(agg)
  }
  return out
}

// 채널 카테고리·디바이스 표시명 — 요약 집계와 방문 기록 목록이 같은 이름을 쓰도록 모듈 스코프에 둔다.
const CHANNEL_LABEL: Record<string, string> = { search: '검색', social: '소셜', direct: '직접', other: '기타' }
const DT_LABEL: Record<string, string> = { mobile: '모바일', tablet: '태블릿', desktop: '데스크탑' }

// end = 마지막 버킷이 속한 날의 KST 0시(포함). 프리셋이면 오늘, 임의 기간이면 종료일 —
// 이걸 인자로 받지 않고 new Date()를 쓰면 7/1~7/9 조회에 오늘까지 빈 막대가 붙는다.
function buildTrend(rows: Row[], start: Date, end: Date, bucket: MarketingBucket): { label: string; date: string | null; views: number; visitors: number }[] {
  type Acc = { label: string; date: string | null; views: number; visitors: Set<string> }
  const buckets: Acc[] = []

  if (bucket === 'hour') {
    // 하루 0-23시
    for (let h = 0; h < 24; h++) buckets.push({ label: `${h}시`, date: null, views: 0, visitors: new Set() })
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
    const endKst = toKst(end)
    const endD = Date.UTC(endKst.getUTCFullYear(), endKst.getUTCMonth(), endKst.getUTCDate())
    const days = Math.floor((endD - startD) / (24 * 60 * 60 * 1000)) + 1
    for (let i = 0; i < days; i++) {
      const d = new Date(startD + i * 24 * 60 * 60 * 1000)
      buckets.push({
        label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
        date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
        views: 0, visitors: new Set(),
      })
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
    // month: start~end 개월 (1y 프리셋이면 12개월 — 기존과 동일)
    const startKst = toKst(start)
    const baseY = startKst.getUTCFullYear()
    const baseM = startKst.getUTCMonth()
    const endKst = toKst(end)
    const months = (endKst.getUTCFullYear() - baseY) * 12 + (endKst.getUTCMonth() - baseM) + 1
    for (let i = 0; i < months; i++) {
      const y = baseY + Math.floor((baseM + i) / 12)
      const m = ((baseM + i) % 12 + 12) % 12
      buckets.push({
        label: `${m + 1}월${y !== baseY && m === 0 ? ` ${y}` : ''}`,
        date: `${y}-${p2(m + 1)}`,
        views: 0, visitors: new Set(),
      })
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
  return buckets.map(b => ({ label: b.label, date: b.date, views: b.views, visitors: b.visitors.size }))
}

// range 는 '직접 지정을 풀면 돌아갈 프리셋'. from·to 가 둘 다 유효하면 그 임의 기간으로 조회한다.
// (MarketingRange 유니온에 'custom'을 넣지 않는 이유 — rangeStart()의 exhaustive switch 보존)
export async function getMarketingStats(
  range: MarketingRange = '30d',
  from: string | null = null,
  to: string | null = null,
): Promise<MarketingStats> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { publicSlug: true },
  })
  const slug = property?.publicSlug?.trim() || null
  const publicUrl = slug ? `https://www.stayeum.com/members/${slug}/` : null

  // 임의 기간(from~to, KST 양끝 포함)이 유효하면 그 창, 아니면 프리셋 범위.
  const YMD = /^\d{4}-\d{2}-\d{2}$/
  const vFrom = from && YMD.test(from) ? from : null
  const vTo = to && YMD.test(to) ? to : null
  const custom = vFrom && vTo && vFrom <= vTo ? { from: vFrom, to: vTo } : null

  let start: Date
  let end: Date | null = null   // 배타적 상한 — 프리셋은 열린 끝(현행 유지)
  let lastDay: Date             // 마지막 버킷이 속한 날의 KST 0시(포함)
  let bucket: MarketingBucket
  if (custom) {
    start = kstMidnight(custom.from)
    lastDay = kstMidnight(custom.to)
    end = new Date(lastDay.getTime() + 24 * 60 * 60 * 1000)
    bucket = bucketForSpan(spanDays(custom.from, custom.to))
  } else {
    const r = rangeStart(range)
    start = r.start; bucket = r.bucket
    lastDay = kstStartOfTodayUtc()
  }
  const rangeFrom = kstYmdStr(start)
  const rangeTo = kstYmdStr(lastDay)

  if (!slug) {
    return {
      range, bucket, rangeFrom, rangeTo, publicSlug: null, publicUrl: null,
      totals: { today: 0, week: 0, month: 0, allTime: 0 },
      rangeViews: 0, rangeVisitors: 0,
      engagement: { avgDurationMs: 0, avgScrollPct: 0, sampleCount: 0, bounceRatePct: 0 },
      sections: [], sectionSampleCount: 0,
      trend: [],
      referrers: [], channels: [], namedSources: [], campaigns: [],
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })),
      deviceTypes: [], oses: [], browsers: [],
      countries: [], cities: [], languages: [], resolutions: [],
      botCount: 0,
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

  // 총계 4종은 범위와 무관 — KST 자정 기준 today / 최근7일 / 최근30일 / all-time (서버 TZ 무관)
  const startOfToday = kstStartOfTodayUtc()
  const startOfWeek  = new Date(startOfToday.getTime() - 6 * 86400000)
  const startOfMonth = new Date(startOfToday.getTime() - 29 * 86400000)

  const [todayCount, weekCount, monthCount, allTimeCount, botCount] = await Promise.all([
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfToday } } }),
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfWeek } } }),
    prisma.pageView.count({ where: { slug, isBot: false, occurredAt: { gte: startOfMonth } } }),
    prisma.pageView.count({ where: { slug, isBot: false } }),
    prisma.pageView.count({ where: { slug, isBot: true, occurredAt: { gte: start, ...(end ? { lt: end } : {}) } } }),
  ])

  // 트렌드
  const trend = buildTrend(inRange, start, lastDay, bucket)

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
  // 라벨이 같은 섹션(video·tour = 투어 영상)은 합산 후 평균 — 안 그러면 같은 이름이 두 줄로 나온다
  const secPer = new Map<string, { totalMs: number; count: number }>()
  for (const [id, total] of secTotal) secPer.set(id, { totalMs: total, count: secCount.get(id) ?? 0 })
  const sections = mergeSectionsByLabel(secPer)
    .map(a => ({
      id: a.key,
      name: a.name,
      avgMs: Math.round(a.totalMs / (a.count || 1)),
      sampleCount: a.count,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)

  return {
    range, bucket, rangeFrom, rangeTo, publicSlug: slug, publicUrl,
    totals: { today: todayCount, week: weekCount, month: monthCount, allTime: allTimeCount },
    rangeViews, rangeVisitors, engagement, sections, sectionSampleCount,
    trend, referrers, channels, namedSources, campaigns, hourly,
    deviceTypes, oses, browsers,
    countries, cities, languages, resolutions,
    botCount,
  }
}

// ── 방문 기록 목록 ──────────────────────────────────────────────
// PageView 1행 = 페이지뷰 1건(세션 아님 — 같은 사람이 다시 들어오면 2행).
// getMarketingStats 와 분리한 이유: 요약 응답에 행을 실으면 요약만 보는 대부분의 조회에서 페이로드가 커진다.

export type VisitCursor = { at: string; id: string }

export type VisitSession = {
  id: string
  cursorAt: string            // 커서용 ISO — 표시에는 쓰지 않는다
  timeLabel: string           // '19:42' (KST)
  dateLabel: string           // '7/23' (KST)
  dateTimeLabel: string       // '2026-07-23 19:42:07' (KST)
  visitNo: number | null      // 조회창 안에서 2건 이상인 방문자만 (1회차는 null)
  durationMs: number | null
  scrollDepthPct: number | null
  sections: { name: string; ms: number }[]   // 라벨 합산·문서 순서, 값 0 은 제외
  // 갤러리(방 사진) 열람 — 등급(요금)별로 본 사진 수·확대 수·깊이·사진별 체류. 방문 시점 기준 사진 순번.
  gallery: {
    rentLabel: string; n: number; seenCount: number; zoomedCount: number; maxDepth: number
    photos: { idx: number; ms: number; zoomed: boolean; roomNo: string | null; seq: number | null }[]
  }[]
  sourceLabel: string         // 유입 — '네이버'·'검색'·'직접' 등
  referrerHost: string | null
  campaign: string | null     // 'source · medium · campaign'
  regionLabel: string | null
  ipMasked: string | null     // 끝자리 가림 (null = 기록 없음)
  ip: string | null           // 원본 — 상세에서 '전체 보기' 를 눌렀을 때만 표시
  deviceLabel: string
  osLabel: string | null
  browserLabel: string | null
  screenLabel: string | null
  viewportLabel: string | null
  language: string | null
  visitorHash: string | null
  userAgent: string | null
}

export type VisitSessionsPage = {
  rows: VisitSession[]
  nextCursor: VisitCursor | null
  hasMore: boolean
}

// 'use server' 파일은 async 함수만 export 할 수 있어 상수는 모듈 내부에 둔다
// (누적 상한 500 은 표시 판단이라 클라 쪽 VISIT_MAX_ROWS 가 갖는다).
const VISIT_PAGE_SIZE = 50

// IP 가림 — IPv4 는 마지막 옥텟, IPv6 는 앞 4그룹만 남긴다.
function maskIp(ip: string | null): string | null {
  if (!ip) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.***')
  if (ip.includes(':')) {
    const g = ip.split(':')
    return g.length > 4 ? `${g.slice(0, 4).join(':')}:****` : '****'
  }
  return '***'
}

// 방문 1건의 galleryViews(JSON) → 등급별 열람 요약. dwell 큰 사진부터, 확대(zoomed) 여부 병기.
function visitGallery(gv: unknown): VisitSession['gallery'] {
  if (!Array.isArray(gv)) return []
  const out: VisitSession['gallery'] = []
  for (const item of gv) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const rent = Number(o.rent)
    if (!Number.isFinite(rent)) continue
    const n = Number(o.n) || 0
    const seen = Array.isArray(o.seen) ? o.seen.map(Number).filter(Number.isFinite) : []
    const zoomedArr = Array.isArray(o.zoomed) ? o.zoomed.map(Number).filter(Number.isFinite) : []
    const zoomedSet = new Set<number>(zoomedArr)
    const maxDepth = Number(o.maxDepth) || 0
    const dwell = (o.dwell && typeof o.dwell === 'object' && !Array.isArray(o.dwell)) ? o.dwell as Record<string, unknown> : {}
    // 방 경계 [{roomNo, count}] — 등급 연속 idx 를 '몇 호 몇 번째'로 환산(없으면 과거 방문이라 번호만)
    const roomsArr = Array.isArray(o.rooms) ? (o.rooms as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []
    const locate = (idx: number): { roomNo: string; seq: number } | null => {
      let acc = 0
      for (const r of roomsArr) {
        const cnt = Number(r.count) || 0
        const rn = typeof r.roomNo === 'string' ? r.roomNo : null
        if (idx < acc + cnt) return rn ? { roomNo: rn, seq: idx - acc + 1 } : null
        acc += cnt
      }
      return null
    }
    const photos = Object.entries(dwell)
      .map(([k, v]) => {
        const idx = Number(k)
        const loc = locate(idx)
        return { idx, ms: Number(v) || 0, zoomed: zoomedSet.has(idx), roomNo: loc?.roomNo ?? null, seq: loc?.seq ?? null }
      })
      .filter(p => Number.isFinite(p.idx) && p.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 30)
    out.push({
      rentLabel: rent >= 10000 ? `월 ${Math.round(rent / 10000)}만원` : `${rent.toLocaleString()}원`,
      n, seenCount: seen.length, zoomedCount: zoomedArr.length, maxDepth, photos,
    })
  }
  return out
}

// 방문 1건의 sectionDwellMs(JSON) → 라벨 합산·문서 순서 목록
function visitSections(sd: unknown): { name: string; ms: number }[] {
  if (!sd || typeof sd !== 'object' || Array.isArray(sd)) return []
  const per = new Map<string, { totalMs: number; count: number }>()
  for (const [id, v] of Object.entries(sd as Record<string, unknown>)) {
    const ms = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(ms) || ms <= 0) continue
    per.set(id, { totalMs: Math.round(ms), count: 1 })
  }
  return mergeSectionsByLabel(per).map(a => ({ name: a.name, ms: a.totalMs }))
}

// 조회창은 요약(getMarketingStats)이 되돌려준 rangeFrom·rangeTo 를 그대로 받는다 — 두 화면이 같은 창을 본다.
// 봇 제외는 고정(필터로 노출하지 않음). 커서는 (occurredAt, id) 복합 키셋 — offset 페이징을 쓰지 않는다.
export async function getVisitSessions(
  from: string,
  to: string,
  cursor: VisitCursor | null = null,
): Promise<VisitSessionsPage> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { publicSlug: true },
  })
  const slug = property?.publicSlug?.trim() || null

  const YMD = /^\d{4}-\d{2}-\d{2}$/
  if (!slug || !YMD.test(from) || !YMD.test(to) || from > to) {
    return { rows: [], nextCursor: null, hasMore: false }
  }

  const start = kstMidnight(from)
  const end = new Date(kstMidnight(to).getTime() + 24 * 60 * 60 * 1000)
  const base = { slug, isBot: false, occurredAt: { gte: start, lt: end } }
  // 키셋 커서 — 같은 시각이 여러 건일 수 있어 id 로 한 번 더 끊는다(내림차순이라 lt)
  const cursorAt = cursor ? new Date(cursor.at) : null
  const where = cursorAt
    ? {
        AND: [
          base,
          { OR: [{ occurredAt: { lt: cursorAt } }, { occurredAt: cursorAt, id: { lt: cursor!.id } }] },
        ],
      }
    : base

  // 1건 더 읽어 다음 페이지 유무만 판정하고 버린다
  const raw = await prisma.pageView.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: VISIT_PAGE_SIZE + 1,
    select: {
      id: true, occurredAt: true,
      durationMs: true, scrollDepthPct: true, sectionDwellMs: true, galleryViews: true,
      referrerHost: true, searchEngine: true, referrerCategory: true,
      utmSource: true, utmMedium: true, utmCampaign: true,
      country: true, region: true, city: true,
      os: true, osVersion: true, browser: true, browserVersion: true,
      deviceType: true, isMobile: true,
      screenWidth: true, screenHeight: true, viewportWidth: true, viewportHeight: true,
      language: true, visitorHash: true, ip: true, userAgent: true,
    },
  })
  const hasMore = raw.length > VISIT_PAGE_SIZE
  const page = hasMore ? raw.slice(0, VISIT_PAGE_SIZE) : raw

  // 회차 — 이 페이지에 등장한 방문자만 조회창 전체에서 오름차순으로 세어 순번을 매긴다.
  // (visitorHash: 익명 방문자 ID(vid, localStorage) 기반 안정 해시가 기본 — 날짜·IP 무관하게 이어진다.
  //  vid 없는 방문(storage 차단·구 데이터)은 날짜|IP|UA|slug 해시 폴백이라 그 건들만 날짜 경계에서 끊긴다. 2026-07-27)
  const hashes = Array.from(new Set(page.map(r => r.visitorHash).filter((h): h is string => !!h)))
  const seqById = new Map<string, number>()
  const totalByHash = new Map<string, number>()
  if (hashes.length > 0) {
    const sameVisitor = await prisma.pageView.findMany({
      where: { ...base, visitorHash: { in: hashes } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true, visitorHash: true },
    })
    for (const r of sameVisitor) {
      if (!r.visitorHash) continue
      const n = (totalByHash.get(r.visitorHash) ?? 0) + 1
      totalByHash.set(r.visitorHash, n)
      seqById.set(r.id, n)
    }
  }

  const rows: VisitSession[] = page.map(r => {
    const k = toKst(r.occurredAt)
    const y = k.getUTCFullYear(), mo = k.getUTCMonth() + 1, d = k.getUTCDate()
    const hh = k.getUTCHours(), mi = k.getUTCMinutes(), ss = k.getUTCSeconds()

    const channel = CHANNEL_LABEL[r.referrerCategory ?? ''] ?? (r.referrerHost ? '기타' : '직접')
    const city = krPlaceToKo(r.country, r.city)
    const region = regionDisplay(r.country, r.region)
    const place = [region, city && city !== region ? city : null].filter(Boolean).join(' ')
    const foreign = r.country && r.country.toUpperCase() !== 'KR' ? r.country : null
    const regionLabel = place ? (foreign ? `${place} (${foreign})` : place) : (r.country || null)

    const campaign = r.utmSource || r.utmMedium || r.utmCampaign
      ? [r.utmSource, r.utmMedium, r.utmCampaign].filter(Boolean).join(' · ')
      : null

    const multi = r.visitorHash ? (totalByHash.get(r.visitorHash) ?? 0) >= 2 : false

    return {
      id: r.id,
      cursorAt: r.occurredAt.toISOString(),
      timeLabel: `${p2(hh)}:${p2(mi)}`,
      dateLabel: `${mo}/${d}`,
      dateTimeLabel: `${y}-${p2(mo)}-${p2(d)} ${p2(hh)}:${p2(mi)}:${p2(ss)}`,
      visitNo: multi ? seqById.get(r.id) ?? null : null,
      durationMs: r.durationMs,
      scrollDepthPct: r.scrollDepthPct,
      sections: visitSections(r.sectionDwellMs),
      gallery: visitGallery(r.galleryViews),
      sourceLabel: r.searchEngine || channel,
      referrerHost: r.referrerHost,
      campaign,
      regionLabel,
      ipMasked: maskIp(r.ip),
      ip: r.ip,
      deviceLabel: DT_LABEL[r.deviceType ?? ''] ?? (r.isMobile ? '모바일' : '데스크탑'),
      osLabel: r.os ? (r.osVersion ? `${r.os} ${r.osVersion}` : r.os) : null,
      browserLabel: r.browser ? (r.browserVersion ? `${r.browser} ${r.browserVersion}` : r.browser) : null,
      screenLabel: r.screenWidth && r.screenHeight ? `${r.screenWidth} × ${r.screenHeight}` : null,
      viewportLabel: r.viewportWidth && r.viewportHeight ? `${r.viewportWidth} × ${r.viewportHeight}` : null,
      language: r.language,
      visitorHash: r.visitorHash,
      userAgent: r.userAgent,
    }
  })

  const last = page[page.length - 1]
  return {
    rows,
    nextCursor: hasMore && last ? { at: last.occurredAt.toISOString(), id: last.id } : null,
    hasMore,
  }
}
