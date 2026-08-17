'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { kstYmdStr } from '@/lib/kstDate'
import { publicSiteUrl } from '@/lib/publicSite'

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
  // Clarity 세션 리플레이 대시보드 — 태그 주입(scripts/inject-clarity.mjs)과 같은 env. 없으면 버튼이 안 뜬다.
  clarityUrl: string | null
  // 범위와 무관한 4종 누적 카드 (참고용 — 항상 today/7d/30d/all-time)
  totals: { today: number; week: number; month: number; allTime: number }
  // 범위 내 핵심 지표
  rangeViews: number      // 범위 내 총 페이지뷰
  rangeVisitors: number   // 범위 내 유니크 방문자(visitorHash 기준)
  // 참여도 (범위 내 평균, durationMs/scrollDepthPct 가 채워진 행만)
  // 체류는 activeMs(방치탭 제외) 기준. 옛 기록은 durationMs 로 되돌린다.
  engagement: {
    avgDurationMs: number   // 평균 체류 시간
    avgScrollPct: number    // 평균 스크롤 깊이
    sampleCount: number     // 측정된 샘플 수(두 모수 중 큰 쪽)
    stayCount: number       // 체류가 기록된 방문 수
    scrollCount: number     // 스크롤이 기록된 방문 수
    bounceRatePct: number   // 이탈률(체류 5초 미만)
  }
  // 본문 CTA 클릭 — 전화·카카오 상담·블로그. 팝업 안 클릭은 popup.cta 로 따로 센다(이중 계상 방지).
  ctas: {
    total: number         // 클릭 총 횟수
    visitCount: number    // CTA 를 누른 방문 수
    visitRatePct: number  // 방문 대비 비율
    byKind: { kind: string; label: string; count: number }[]
  }
  // 섹션별 평균 체류시간 — 페이지 어느 영역에 오래 머물렀나
  sections: { id: string; name: string; avgMs: number; sampleCount: number }[]
  sectionSampleCount: number   // 섹션 데이터가 있는 세션 수
  // 프로모션 팝업 — popupView 가 기록된 방문만.
  // suppressed=true 는 '오늘 하루 보지 않기' 상태라 뜨지 않은 방문 → 노출로 세지 않는다(분모에는 남는다).
  popup: {
    sampleCount: number    // popupView 가 있는 행 수 (0 이면 화면에서 카드째 감춘다)
    shownCount: number     // 실제 노출 수 (suppressed 제외)
    shownRatePct: number   // 노출률 — 범위 내 비봇 방문 대비
    avgDwellMs: number     // 노출 행 평균 체류
    closes: { key: string; label: string; count: number; percent: number }[]
    cta: { kakaoCount: number; kakaoPct: number; roomsCount: number; roomsPct: number }
  }
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
  // 언어 Top — 기기 언어(navigator.language)
  languages: { language: string; count: number }[]
  // 열람 언어 — 공개 페이지에서 실제로 고른 언어. 기기 언어와 다른 사람이 마케팅 신호다.
  viewedLanguages: { language: string; count: number; percent: number }[]
  viewedLangSample: number     // 열람 언어가 기록된 방문 수 (분모)
  viewedLangMissing: number    // 열람 언어 도입 전 방문 — 집계에서 뺀 수
  viewedLangSwitched: number   // 기기 언어와 다르게 봤거나 도중에 바꾼 방문 수
  // 기기 언어 x 열람 언어 — 기기 언어별로 무엇을 골랐나. 사이트가 제공하지 않는 기기 언어
  // (예: 베트남어)가 전부 영어를 고른다면 그 언어 페이지를 검토할 근거가 된다.
  langCross: {
    device: string             // 기기 언어 앞머리 표시명 ('한국어'·'베트남어')
    count: number
    offered: boolean           // 사이트가 그 언어를 제공하는가 (열람 언어로 등장한 적이 있는가)
    viewed: { language: string; count: number }[]
  }[]
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
  activeMs: number | null
  ctaClicks: unknown
  scrollDepthPct: number | null
  sectionDwellMs: unknown
  popupView: unknown
}

// 공개페이지 섹션 id → 표시 이름 (index.html 의 <section id> 와 일치)
// video 는 개편 전(2026-07-07 이전) 기록용, tour 는 개편 후 현행 id — 같은 투어 영상 섹션.
const SECTION_LABEL: Record<string, string> = {
  top: '첫 화면(소개)', rooms: '객실·가격', amenities: '편의시설',
  video: '투어 영상', tour: '투어 영상', gallery: '갤러리', location: '위치·약도', contact: '문의',
}
const SECTION_ORDER = ['top', 'rooms', 'amenities', 'video', 'tour', 'gallery', 'location', 'contact']

// 본문 CTA 종류. sms 는 페이지에 링크가 없지만 옛 기록 호환을 위해 라벨을 둔다.
const CTA_LABEL: Record<string, string> = { tel: '전화', kakao: '카카오 상담', blog: '블로그', sms: '문자' }
const CTA_ORDER = ['tel', 'kakao', 'blog', 'sms']

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

// 언어 코드 → 한국어 표시명. 사이트가 제공하는 4개(ko·en·zh·ja)뿐 아니라 기기 언어(vi·th 등)까지
// 이름이 나와야 '어느 나라 사람이 무엇으로 보는가'를 읽을 수 있다. 직접 표를 들고 있으면 언어를
// 늘릴 때마다 손이 가므로 Intl 에 맡긴다. 모르는 코드는 코드 그대로 돌려준다.
const LANG_NAMES = new Intl.DisplayNames(['ko'], { type: 'language' })
const langLabelCache = new Map<string, string>()
function viewedLangLabel(code: string): string {
  const hit = langLabelCache.get(code)
  if (hit !== undefined) return hit
  let out = code
  try { out = LANG_NAMES.of(code) ?? code } catch { out = code }
  langLabelCache.set(code, out)
  return out
}
// 기기 언어 'ko-KR' 과 열람 언어 'ko' 를 견주려면 지역 꼬리표를 뗀 앞머리로 맞춰야 한다.
const langBase = (v: string | null): string | null => (v ? v.trim().toLowerCase().split('-')[0] || null : null)

// 프로모션 팝업 닫기 방식 — 기록 키 → 표시 라벨. 표시 순서도 이 배열이 정본(요약 카드·방문 상세 공통).
const POPUP_CLOSE_ORDER = ['x', 'scrim', 'esc', 'today', 'cta_kakao', 'cta_rooms', 'leave']
const POPUP_CLOSE_LABEL: Record<string, string> = {
  x: 'X 닫기', scrim: '배경 닫기', esc: 'Esc', today: '오늘 하루 보지 않기',
  cta_kakao: '카카오 상담', cta_rooms: '객실 둘러보기', leave: '열람 중 이탈',
}

// PageView.popupView(JSON) → 집계용 정규화. 형태가 아니면 null(= 팝업 기록 없는 방문).
type PopupRec = { dwellMs: number; close: string | null; ctaKakao: boolean; ctaRooms: boolean; suppressed: boolean }
function parsePopup(pv: unknown): PopupRec | null {
  if (!pv || typeof pv !== 'object' || Array.isArray(pv)) return null
  const o = pv as Record<string, unknown>
  const dwell = Number(o.dwellMs)
  const kinds = new Set<string>()
  if (Array.isArray(o.ctas)) {
    for (const c of o.ctas) {
      if (!c || typeof c !== 'object') continue
      const kind = (c as Record<string, unknown>).kind
      if (typeof kind === 'string') kinds.add(kind)
    }
  }
  return {
    dwellMs: Number.isFinite(dwell) && dwell > 0 ? Math.round(dwell) : 0,
    close: typeof o.close === 'string' ? o.close : null,
    ctaKakao: kinds.has('kakao'),
    ctaRooms: kinds.has('rooms'),
    suppressed: o.suppressed === true,
  }
}

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
  const publicUrl = publicSiteUrl(slug)
  // 소개 페이지에 심는 태그(scripts/inject-clarity.mjs)와 같은 env 를 읽는다 — 두 자리가 갈리면
  // 녹화는 되는데 볼 문이 없거나 그 반대가 된다. 상용화에서 영업장별 ID 가 되면 여기와 주입
  // 스크립트가 함께 property 값으로 옮겨 간다.
  const clarityId = process.env.CLARITY_PROJECT_ID?.trim() || null
  const clarityUrl = clarityId ? `https://clarity.microsoft.com/projects/view/${clarityId}/dashboard` : null

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
      range, bucket, rangeFrom, rangeTo, publicSlug: null, publicUrl: null, clarityUrl: null,
      totals: { today: 0, week: 0, month: 0, allTime: 0 },
      rangeViews: 0, rangeVisitors: 0,
      engagement: { avgDurationMs: 0, avgScrollPct: 0, sampleCount: 0, stayCount: 0, scrollCount: 0, bounceRatePct: 0 },
      ctas: { total: 0, visitCount: 0, visitRatePct: 0, byKind: [] },
      sections: [], sectionSampleCount: 0,
      popup: {
        sampleCount: 0, shownCount: 0, shownRatePct: 0, avgDwellMs: 0, closes: [],
        cta: { kakaoCount: 0, kakaoPct: 0, roomsCount: 0, roomsPct: 0 },
      },
      trend: [],
      referrers: [], channels: [], namedSources: [], campaigns: [],
      hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 })),
      deviceTypes: [], oses: [], browsers: [],
      countries: [], cities: [], languages: [], resolutions: [],
      viewedLanguages: [], viewedLangSample: 0, viewedLangMissing: 0, viewedLangSwitched: 0, langCross: [],
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
      language: true, viewedLanguage: true, languageTrail: true, screenWidth: true, screenHeight: true,
      durationMs: true, activeMs: true, ctaClicks: true,
      scrollDepthPct: true, sectionDwellMs: true, popupView: true,
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

  // 열람 언어 — 공개 페이지에서 실제로 고른 언어. 도입(2026-08-11) 전 방문은 값이 없어 분모에서 뺀다.
  const viewedRows = inRange.filter(r => !!r.viewedLanguage)
  const viewedLangSample = viewedRows.length
  const viewedLangMissing = inRange.length - viewedLangSample
  const vlMap = new Map<string, number>()
  for (const r of viewedRows) {
    const code = r.viewedLanguage!
    vlMap.set(code, (vlMap.get(code) ?? 0) + 1)
  }
  const viewedLanguages = Array.from(vlMap.entries())
    .map(([code, count]) => ({
      language: viewedLangLabel(code),
      count,
      percent: Math.round((count / Math.max(1, viewedLangSample)) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // 전환 방문 — 도중에 언어를 바꿨거나(trail 에 두 개 이상), 기기 언어와 다른 언어로 본 방문.
  // 둘 다 '기본값을 그대로 두지 않은 사람'이라 같은 신호로 센다.
  const viewedLangSwitched = viewedRows.filter(r => {
    if (r.languageTrail && r.languageTrail.includes('>')) return true
    const dev = langBase(r.language)
    return !!dev && dev !== langBase(r.viewedLanguage)
  }).length

  // 기기 언어 x 열람 언어 — 기기 언어 앞머리로 묶고, 그 안에서 무엇을 골랐는지 센다.
  // 사이트가 제공하지 않는 기기 언어를 위로 올린다(그게 보려는 것이다).
  const offered = new Set(Array.from(vlMap.keys()).map(c => langBase(c)).filter((c): c is string => !!c))
  const crossMap = new Map<string, { count: number; viewed: Map<string, number> }>()
  for (const r of viewedRows) {
    const dev = langBase(r.language)
    if (!dev) continue
    let hit = crossMap.get(dev)
    if (!hit) { hit = { count: 0, viewed: new Map() }; crossMap.set(dev, hit) }
    hit.count++
    hit.viewed.set(r.viewedLanguage!, (hit.viewed.get(r.viewedLanguage!) ?? 0) + 1)
  }
  const langCross = Array.from(crossMap.entries())
    .map(([dev, v]) => ({
      device: viewedLangLabel(dev),
      count: v.count,
      offered: offered.has(dev),
      viewed: Array.from(v.viewed.entries())
        .map(([code, count]) => ({ language: viewedLangLabel(code), count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (a.offered === b.offered ? b.count - a.count : (a.offered ? 1 : -1)))
    .slice(0, 12)

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

  // 참여도 — 체류는 activeMs(방치탭 제외) 가 정본이다.
  // 스키마가 durationMs 를 '레거시', activeMs 를 '방치탭 오염을 뺀 값'이라고 적어뒀는데
  // 화면은 계속 durationMs 를 읽고 있었다. 같은 '체류'를 두 규칙으로 저장해두고 틀린 쪽을 보여준 셈이다.
  // activeMs 가 없는 옛 기록은 durationMs 로 되돌린다(도입 전 방문). (D페이즈 2026-08-03)
  const stay = (r: Row) => r.activeMs ?? r.durationMs
  const dur = inRange.filter(r => stay(r) !== null)
  const scr = inRange.filter(r => r.scrollDepthPct !== null) as (Row & { scrollDepthPct: number })[]
  const avgDurationMs = dur.length > 0 ? Math.round(dur.reduce((s, r) => s + stay(r)!, 0) / dur.length) : 0
  const avgScrollPct  = scr.length > 0 ? Math.round(scr.reduce((s, r) => s + r.scrollDepthPct, 0) / scr.length) : 0
  const bounces = dur.filter(r => stay(r)! < 5000).length
  const bounceRatePct = dur.length > 0 ? Math.round((bounces / dur.length) * 100) : 0
  const engagement = {
    avgDurationMs, avgScrollPct,
    // 모수가 지표마다 다르다(체류 dur, 스크롤 scr). 하나로 합쳐 보여주면 어느 쪽 표본인지 알 수 없다.
    sampleCount: Math.max(dur.length, scr.length),
    stayCount: dur.length,
    scrollCount: scr.length,
    bounceRatePct,
  }

  // 본문 CTA 클릭 — 저장만 되고 읽는 곳이 저장소 어디에도 없었다.
  // 전화 클릭이 DB 에는 쌓이는데 화면에는 0 으로 존재하지 않았고, 운영자가 보는 '전환'은
  // 팝업 안 클릭 하나뿐이었다. (D페이즈 2026-08-03)
  const ctaCount = new Map<string, number>()
  let ctaRows = 0
  for (const r of inRange) {
    if (!Array.isArray(r.ctaClicks) || r.ctaClicks.length === 0) continue
    ctaRows++
    for (const c of r.ctaClicks as { kind?: unknown }[]) {
      const kind = typeof c?.kind === 'string' ? c.kind : 'unknown'
      ctaCount.set(kind, (ctaCount.get(kind) ?? 0) + 1)
    }
  }
  const ctas = {
    total: [...ctaCount.values()].reduce((a, b) => a + b, 0),
    // 한 방문에서 여러 번 눌러도 '전환한 방문'은 하나다. 비율은 이 값으로 낸다.
    visitCount: ctaRows,
    visitRatePct: rangeViews > 0 ? Math.round((ctaRows / rangeViews) * 100) : 0,
    byKind: CTA_ORDER.filter(k => ctaCount.has(k))
      .concat([...ctaCount.keys()].filter(k => !CTA_ORDER.includes(k)))
      .map(kind => ({ kind, label: CTA_LABEL[kind] ?? kind, count: ctaCount.get(kind) ?? 0 })),
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

  // 프로모션 팝업 — popupView 가 있는 행만. suppressed 는 '오늘 하루 보지 않기'라 뜨지 않은 방문이므로
  // 노출(분자)에서는 빼되 노출률 분모(범위 내 비봇 방문 = rangeViews)에는 그대로 남는다.
  let popupSampleCount = 0
  let popupShownCount = 0
  let popupDwellTotal = 0
  let ctaKakaoCount = 0
  let ctaRoomsCount = 0
  const closeMap = new Map<string, number>()
  for (const r of inRange) {
    const p = parsePopup(r.popupView)
    if (!p) continue
    popupSampleCount++
    if (p.suppressed) continue
    popupShownCount++
    popupDwellTotal += p.dwellMs
    if (p.close) closeMap.set(p.close, (closeMap.get(p.close) ?? 0) + 1)
    if (p.ctaKakao) ctaKakaoCount++
    if (p.ctaRooms) ctaRoomsCount++
  }
  const shownDiv = popupShownCount || 1
  // 순서는 POPUP_CLOSE_ORDER 고정 — 기록에 없던 키(스키마 확장분)는 뒤에 원본 키로 붙인다
  const closeKeys = [
    ...POPUP_CLOSE_ORDER.filter(k => closeMap.has(k)),
    ...Array.from(closeMap.keys()).filter(k => !POPUP_CLOSE_ORDER.includes(k)),
  ]
  const popup = {
    sampleCount: popupSampleCount,
    shownCount: popupShownCount,
    // 분모는 popupSampleCount(팝업 로직이 실제로 돌아 기록을 남긴 방문)다.
    // 전에는 rangeViews 였는데 여기에는 팝업 배포 전 방문, 날짜 게이트를 지난 뒤 방문,
    // sendBeacon 미지원 방문이 섞여 있어 '샘플 N건'과 분모가 서로 달랐다(D페이즈 2026-08-03).
    shownRatePct: popupSampleCount > 0 ? Math.round((popupShownCount / popupSampleCount) * 100) : 0,
    avgDwellMs: popupShownCount > 0 ? Math.round(popupDwellTotal / popupShownCount) : 0,
    closes: closeKeys.map(key => {
      const count = closeMap.get(key) ?? 0
      return { key, label: POPUP_CLOSE_LABEL[key] ?? key, count, percent: Math.round((count / shownDiv) * 100) }
    }),
    cta: {
      kakaoCount: ctaKakaoCount,
      kakaoPct: Math.round((ctaKakaoCount / shownDiv) * 100),
      roomsCount: ctaRoomsCount,
      roomsPct: Math.round((ctaRoomsCount / shownDiv) * 100),
    },
  }

  return {
    range, bucket, rangeFrom, rangeTo, publicSlug: slug, publicUrl, clarityUrl,
    totals: { today: todayCount, week: weekCount, month: monthCount, allTime: allTimeCount },
    rangeViews, rangeVisitors, engagement, ctas, sections, sectionSampleCount, popup,
    trend, referrers, channels, namedSources, campaigns, hourly,
    deviceTypes, oses, browsers,
    countries, cities, languages, resolutions,
    viewedLanguages, viewedLangSample, viewedLangMissing, viewedLangSwitched, langCross,
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
  // 프로모션 팝업 — 이 방문에 노출된 경우만. 미노출('오늘 하루 보지 않기')·기록 없음은 null.
  popup: { dwellMs: number; closeLabel: string | null } | null
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
  // 열람 언어 — 이 방문이 실제로 읽은 언어. 도중에 바꿨으면 '한국어 > 영어' 처럼 순서대로.
  viewedLanguageLabel: string | null
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

// 방문 1건의 열람 언어 → 상세 한 줄. 이력이 있으면 바꾼 순서대로, 없으면 마지막 값만.
// '>' 는 경로 표기(가이드 §29 허용) — 저장 형태와 같은 모양이라 대조하기 쉽다.
function visitViewedLanguage(viewed: string | null, trail: string | null): string | null {
  const steps = (trail ?? '').split('>').map(s => s.trim()).filter(Boolean)
  if (steps.length > 1) return steps.map(viewedLangLabel).join(' > ')
  const one = viewed ?? steps[0] ?? null
  return one ? viewedLangLabel(one) : null
}

// 방문 1건의 popupView(JSON) → 상세 한 줄용 요약. 미노출(suppressed)·기록 없음은 null.
function visitPopup(pv: unknown): VisitSession['popup'] {
  const p = parsePopup(pv)
  if (!p || p.suppressed) return null
  return { dwellMs: p.dwellMs, closeLabel: p.close ? (POPUP_CLOSE_LABEL[p.close] ?? p.close) : null }
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
      durationMs: true, activeMs: true, scrollDepthPct: true, sectionDwellMs: true, galleryViews: true, popupView: true,
      referrerHost: true, searchEngine: true, referrerCategory: true,
      utmSource: true, utmMedium: true, utmCampaign: true,
      country: true, region: true, city: true,
      os: true, osVersion: true, browser: true, browserVersion: true,
      deviceType: true, isMobile: true,
      screenWidth: true, screenHeight: true, viewportWidth: true, viewportHeight: true,
      language: true, viewedLanguage: true, languageTrail: true,
      visitorHash: true, ip: true, userAgent: true,
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
      // 요약 카드와 같은 정본(activeMs 우선). 상세와 요약이 다른 값을 보여주면 안 된다.
      durationMs: r.activeMs ?? r.durationMs,
      scrollDepthPct: r.scrollDepthPct,
      sections: visitSections(r.sectionDwellMs),
      gallery: visitGallery(r.galleryViews),
      popup: visitPopup(r.popupView),
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
      viewedLanguageLabel: visitViewedLanguage(r.viewedLanguage, r.languageTrail),
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
