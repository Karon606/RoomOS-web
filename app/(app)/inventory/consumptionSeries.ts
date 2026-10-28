// 재고 소모 추이 순수층. 점검 구간 셈(개요·품목 상세 공용 정본), 진행 중인 달 라벨, 하루당 캡션, 기간 확대(연·분기·월·주·일) 묶음. 'use server' 아님. 진리표 scripts/test-consumption-series.ts.
//
// 왜 있나(2026-10-26 운영자 승인, 신고 9d26a7ee "10월달에도 많이 소모된 것 같은데 그래프는 지난달보다 줄어든 추세로 보이거든?").
// 숫자는 맞았다(9월 190봉 30일, 10월 23일까지 138봉). 진행 중인 달 막대가 만월 옆에 그대로 섰고 '(진행 중)' 은 hover 툴팁뿐이라
// 폰에서 안 보였다. 하루당은 지어낸 값이 아니다(그 달에 귀속된 구간 일수 합이 분모). 예측 막대는 그리지 않는다(2026-07-17 결정 유지).
//
// 2단계(같은 승인): 품목 상세에 '소모 추이' 탭을 두고 연·분기·월·주·일로 넓혀 본다. 구간 셈이 개요(overview.ts)와 갈리면 카드와 상세가
// 다른 소모를 말하므로, 개요 안에 있던 순수 셈(dedupSameDay·effTime·dbDateMs·unitMatches·sumPurchasesMem·sumLedgerMem·구간 셈)을 여기로
// 옮겨 둘이 같이 부른다. 옮기면서 규칙은 한 글자도 안 바꿨다(scripts/verify-overview-parity.ts 전후 동일).
import { specMultiplier } from '@/lib/units'

export type MonthSlot = { month: string; qty: number | null; days: number | null; lastDate: string | null }

/** 하루당 표기. 소수 첫째 자리 고정('6.0봉'). 일수가 없으면 null. */
export function perDayText(qty: number | null, days: number | null, unit: string | null): string | null {
  if (qty == null || !days || days <= 0) return null
  return `${(Math.round((qty / days) * 10) / 10).toFixed(1)}${unit ?? ''}`
}

/** 진행 중인 달 축 라벨의 둘째 줄('23일까지'). 그 달 점검이 있을 때만. 판정은 시계가 아니라 마지막 슬롯(구조적)이다. */
export function partialMonthTail(slot: MonthSlot, isCurrent: boolean): string | null {
  if (!isCurrent || slot.qty == null || !slot.lastDate) return null
  if (slot.lastDate.slice(0, 7) !== slot.month) return null
  return `${Number(slot.lastDate.slice(8, 10))}일까지`
}

/** 카드 캡션 '이번 달 하루 6.0봉 · 지난달 6.3봉'. 이번 달 값이 없으면 null(캡션을 안 단다), 지난달이 없으면 앞 토막만. */
export function perDayCaption(series: readonly MonthSlot[], unit: string | null): string | null {
  const cur = series[series.length - 1]
  const prev = series[series.length - 2]
  const a = cur ? perDayText(cur.qty, cur.days, unit) : null
  if (!a) return null
  const b = prev ? perDayText(prev.qty, prev.days, unit) : null
  return b ? `이번 달 하루 ${a} · 지난달 ${b}` : `이번 달 하루 ${a}`
}

// ── 점검 구간 셈(개요·품목 상세 공용 정본) ─────────────────────────────────
// ⚠️ @db.Date 칸(StockAddition.date·StockDisposal.date·Expense.date)은 Prisma 가 인자를 **UTC 날짜로 잘라** 보낸다(실측 2026-09-11).
//   effTime(시각이 붙은 값)으로 잡은 구간 경계도 SQL 에서는 그 날짜로 비교됐다. 메모리 비교도 같은 절단을 거쳐야 답이 같다.
export const dbDateMs = (d: Date) => Math.floor(d.getTime() / 86400000) * 86400000
// qtyUnit 느슨 매칭. overview.sumPurchases 머리말의 그 규칙(null 이거나 같으면 같은 품목).
export const unitMatches = (rowUnit: string | null, itemUnit: string | null) =>
  itemUnit ? (rowUnit == null || rowUnit === itemUnit) : true

export type PurchaseRow = { receivedAt: Date | null; qtyUnit: string | null; qtyValue: number | null; specValue: number | null; specUnit: string | null }
export type CheckRow = { date: Date; createdAt: Date; remainingQty: number; isReconcile?: boolean }
type LedgerAdd = { date: Date; createdAt: Date; addedQty: number }
type LedgerDisp = { date: Date; createdAt: Date; disposedQty: number }

// 같은 날 여러 점검 dedup — 가장 늦은 createdAt 만 유효한 점검으로 간주.
// 사용자가 같은 날 임시 점검 후 확정 점검을 다시 하는 패턴 + 그 사이 큰 잔량 jump 가
// 가짜 소모로 누적되던 문제 (라면 187 / 쌀 159) 해결.
export function dedupSameDay<T extends { date: Date; createdAt: Date; isReconcile?: boolean }>(arr: T[]): T[] {
  const map = new Map<string, T>()
  for (const c of arr) {
    const day = `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}-${c.date.getUTCDate()}`
    const existing = map.get(day)
    if (!existing) { map.set(day, c); continue }
    const winner = c.createdAt > existing.createdAt ? c : existing
    // 같은 날에 '전체 보정'이 있었으면 살아남는 점검도 보정으로 취급 —
    // 보정 후 같은 날 일반/자동수령 점검이 생기면 보정이 통째로 무효화되어
    // 직전 구간의 분실·오차가 가짜 소모로 잡히던 문제 방지.
    const hadReconcile = !!existing.isReconcile || !!c.isReconcile
    map.set(day, hadReconcile && !winner.isReconcile ? { ...winner, isReconcile: true } : winner)
  }
  return Array.from(map.values()).sort((a, b) =>
    a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
  )
}

// 점검의 '실제 발생 시각' — 입고/구매 구간 귀속 기준. 타임라인 정렬과 동일 규칙.
//  · 입력 당일(KST) 점검이면 createdAt(실제 점검 시각), 과거 보정 입력(백필)이면 date.
// 이유: 수령 즉시 자동 생성되는 점검(sourceExpenseId)은 그 구매를 이미 잔량에 반영한다.
//  구매를 점검 date(자정) 기준으로 귀속하면, 같은 날 자동점검이 baseline 인데도 구매가
//  '그 다음 구간'에 입고로 또 더해져 사용량이 부풀려졌음 (수세미: 사서 분산만 했는데 10 소모로 둔갑).
//  effTime 기준으로 비교하면 수령 시각과 같은(또는 이전) 점검 baseline 에 흡수되어 중복 안 됨.
const KST = 9 * 3600000
export const kstDay = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10)
// 백필(나중 입력) 점검 — 그 날짜의 KST 자정 + 입력시각(createdAt)의 하루중 경과시간.
//   타임라인 표시 정렬(actions.ts getInventoryItemDetail)과 동일 규칙으로 통일(2026-06-09).
//   같은 날 입력 점검(자동수령 등)은 createdAt 그대로 → 기존 보호 로직(중복 입고 방지) 영향 없음.
const kstMidnightMs = (d: Date) => Math.floor((d.getTime() + KST) / 86400000) * 86400000 - KST
const kstTodMs = (d: Date) => (d.getTime() + KST) % 86400000
export const effTime = (c: { date: Date; createdAt: Date }): Date =>
  kstDay(c.createdAt) === kstDay(c.date)
    ? c.createdAt
    : new Date(kstMidnightMs(c.date) + kstTodMs(c.createdAt))

export const sumPurchasesMem = (
  rows: readonly PurchaseRow[], qtyUnit: string | null,
  afterReceivedAt: Date | null, beforeReceivedAt: Date | null,
  useSpecBase: boolean, itemUnit: string | null,
): number => {
  let s = 0
  for (const r of rows) {
    if (r.receivedAt == null) continue
    if (!unitMatches(r.qtyUnit, qtyUnit)) continue
    if (afterReceivedAt && !(r.receivedAt.getTime() > afterReceivedAt.getTime())) continue
    if (beforeReceivedAt && !(r.receivedAt.getTime() <= beforeReceivedAt.getTime())) continue
    const q = r.qtyValue ?? 0
    if (!useSpecBase) { s += q; continue }
    const spec = specMultiplier(r.specValue, r.specUnit, itemUnit)
    s += spec != null ? q * spec : q
  }
  return s
}

// sumAdditions·sumDisposals 의 date·createdAt 경계 규칙(오류신고 a1e048e8) 그대로.
export const sumLedgerMem = <T extends { date: Date; createdAt: Date }>(
  rows: readonly T[], qtyOf: (r: T) => number,
  from: Date | null, to: Date | null, fromCreatedAt?: Date | null,
): number => {
  const toMs = to ? dbDateMs(to) : null
  const fromMs = from != null ? dbDateMs(from) : null
  let s = 0
  for (const r of rows) {
    const d = r.date.getTime()
    if (toMs != null && !(d <= toMs)) continue
    if (fromMs != null) {
      const ok = fromCreatedAt != null
        ? (d > fromMs || (d === fromMs && r.createdAt.getTime() > fromCreatedAt.getTime()))
        : d > fromMs
      if (!ok) continue
    }
    s += qtyOf(r)
  }
  return s
}

/**
 * 연속 두 점검 사이 소모 구간. 전체 보정 점검으로 끝나는 구간은 빼고(실측 리셋), 입고는 effTime 경계로 귀속하며, 부호 그대로 둔다
 * (telescoping, 음수 구간을 버리면 입고가 가짜 소모로 둔갑한다). checks 는 dedupSameDay 를 거친 오래된 순이어야 한다.
 */
export function intervalConsumption<C extends CheckRow>(i: {
  checks: readonly C[]
  purchases: readonly PurchaseRow[]
  adds: readonly LedgerAdd[]
  disps: readonly LedgerDisp[]
  qtyUnit: string | null
  useSpec: boolean
  specUnit: string | null
}): { prev: C; curr: C; consumed: number; days: number }[] {
  const out: { prev: C; curr: C; consumed: number; days: number }[] = []
  for (let k = 1; k < i.checks.length; k++) {
    const prev = i.checks[k - 1], curr = i.checks[k]
    if (curr.isReconcile) continue
    const purchases = sumPurchasesMem(i.purchases, i.qtyUnit, effTime(prev), effTime(curr), i.useSpec, i.specUnit)
    const additions = sumLedgerMem(i.adds, a => a.addedQty, effTime(prev), effTime(curr))
    const disposals = sumLedgerMem(i.disps, d => d.disposedQty, effTime(prev), effTime(curr))
    out.push({
      prev, curr,
      consumed: (prev.remainingQty + purchases + additions - disposals) - curr.remainingQty,
      // 구간 일수를 구간에 동봉. 보정 구간을 소모에서 빼면 분모에서도 같이 빠져야 하므로.
      // date 는 @db.Date(그 날의 UTC 자정)라 이 나눗셈은 반올림 오차 없는 정수.
      days: Math.max(1, Math.round((curr.date.getTime() - prev.date.getTime()) / 86400000)),
    })
  }
  return out
}

// ── 기간 확대(2단계) ─────────────────────────────────────────────────────
// 서버 액션 getConsumptionSeries 가 품목 하나의 전 기간 구간을 한 번 보내고, 화면은 연·분기·월·주·일 전환과 앞뒤 이동을 이 함수로
// 다시 묶는다(전환마다 왕복하지 않는다). 귀속 규칙은 카드와 같은 **구간 끝 날짜**다. 일 단위는 여러 날 구간을 날마다 쪼개지 않고
// 그 구간이 걸친 날들 위의 띠 하나로 그린다(span). 띠 높이는 그 구간의 하루 평균, 띠 위 숫자는 구간 합계다. 쪼개면 없는 정보를 지어낸다.
export type Gran = 'year' | 'quarter' | 'month' | 'week' | 'day'
export const GRAN_LABEL: Record<Gran, string> = { year: '연', quarter: '분기', month: '월', week: '주', day: '일' }
/** 한 화면에 보이는 칸 수. 월은 1년치 12칸(2026-10-28 운영자 결정 '1년치 한눈에'). 320px 에서 칸이 약 18px 라 세 자리 숫자가 붙으므로
 *  칸 수가 TREND_VALUE_MAX_COLS 를 넘으면 막대 위 숫자를 빼고, 막대를 눌러 고른 칸의 값을 범위 글 아래 한 줄로 읽는다
 *  (형제 정본: 홈 추이 차트 TrendChart 는 막대 위 숫자 없이 누르면 값이 뜬다). */
export const TREND_WINDOW: Record<Gran, number> = { year: 5, quarter: 8, month: 12, week: 8, day: 14 }
export const TREND_VALUE_MAX_COLS = 8
/** 막대 위 숫자를 그릴 칸 수인가. */
export const showsBarValues = (g: Gran) => TREND_WINDOW[g] <= TREND_VALUE_MAX_COLS
/** 서버가 보내는 구간 하나. start·end 는 KST 달력일 'YYYY-MM-DD'(@db.Date 그대로). */
export type SeriesInterval = { start: string; end: string; consumed: number; days: number }
export type TrendBucket = {
  key: string
  label: string
  /** 그 칸에 귀속된 소모 합(음수는 0, '사용량' 은 음수일 수 없다). 구간이 하나도 없으면 null(미관측). */
  qty: number | null
  /** 귀속된 구간 일수 합(하루당 분모). */
  days: number
  /** 귀속된 구간 수와 그중 하루 간격 구간 수(요일 비교 표본). */
  n: number
  oneDay: number
  current: boolean
  /** 칸 이름 둘째 줄. 진행 중인 칸의 꼬리('23일까지'·'10/27까지', 연·분기·월), 아니면 해가 바뀌는 월·분기 칸의 연도('2026년'). */
  tail: string | null
  /** 일 단위의 띠 폭(그 칸에서 끝나는 구간의 일수, 창 시작에서 자른다). 그 밖은 1. */
  span: number
}

const DAY = 86400000
const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const ymdOf = (t: number) => new Date(t).toISOString().slice(0, 10)

/** 그 날짜가 속한 칸의 열쇠. 주는 월요일 시작(그 주 월요일 날짜). */
export function bucketKey(ymd: string, g: Gran): string {
  const y = ymd.slice(0, 4), m = Number(ymd.slice(5, 7))
  if (g === 'year') return y
  if (g === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  if (g === 'month') return ymd.slice(0, 7)
  if (g === 'week') { const t = ms(ymd); const dow = (new Date(t).getUTCDay() + 6) % 7; return ymdOf(t - dow * DAY) }
  return ymd
}
/** 칸 열쇠를 n 칸 옮긴다(음수면 과거). */
export function shiftKey(key: string, g: Gran, n: number): string {
  if (g === 'year') return String(Number(key) + n)
  if (g === 'quarter') { const idx = Number(key.slice(0, 4)) * 4 + Number(key.slice(6)) - 1 + n; return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}` }
  if (g === 'month') { const idx = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}` }
  return ymdOf(ms(key) + n * (g === 'week' ? 7 : 1) * DAY)
}
/** 칸의 첫날 'YYYY-MM-DD'. */
function bucketStart(key: string, g: Gran): string {
  if (g === 'year') return `${key}-01-01`
  if (g === 'quarter') return `${key.slice(0, 4)}-${String((Number(key.slice(6)) - 1) * 3 + 1).padStart(2, '0')}-01`
  if (g === 'month') return `${key}-01`
  return key
}
function bucketLabel(key: string, g: Gran): string {
  if (g === 'year') return key
  if (g === 'quarter') return `${key.slice(6)}분기`
  if (g === 'month') return String(Number(key.slice(5, 7)))
  if (g === 'week') return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`
  return String(Number(key.slice(8, 10)))
}
/**
 * 창 범위 글. 좁은 자리(320px 모달에서 좌우 이동 버튼 사이 약 136px)라 짧게 쓴다. 뒤쪽은 앞과 같은 해·달이면 뺀다.
 * 연 '2022년 ~ 2026년', 분기 '25년 1분기 ~ 26년 4분기'·'2026년 1~3분기', 월 '2026년 5월 ~ 10월', 주·일은 점 날짜 '2026.10.15 ~ 10.28'
 * (주는 첫 주 월요일부터 끝 주 일요일까지, 정본 날짜 표기 fmtDate 의 점 문법).
 */
function rangeOf(keys: readonly string[], g: Gran): string {
  const k0 = keys[0], k1 = keys[keys.length - 1]
  if (g === 'year') return `${k0}년 ~ ${k1}년`
  if (g === 'quarter') return k0.slice(0, 4) === k1.slice(0, 4)
    ? `${k0.slice(0, 4)}년 ${k0.slice(6)}~${k1.slice(6)}분기`
    : `${k0.slice(2, 4)}년 ${k0.slice(6)}분기 ~ ${k1.slice(2, 4)}년 ${k1.slice(6)}분기`
  if (g === 'month') return k0.slice(0, 4) === k1.slice(0, 4)
    ? `${k0.slice(0, 4)}년 ${Number(k0.slice(5, 7))}월 ~ ${Number(k1.slice(5, 7))}월`
    : `${k0.slice(0, 4)}년 ${Number(k0.slice(5, 7))}월 ~ ${k1.slice(0, 4)}년 ${Number(k1.slice(5, 7))}월`
  const end = g === 'week' ? ymdOf(ms(k1) + 6 * DAY) : k1
  const dot = (ymd: string) => `${Number(ymd.slice(5, 7))}.${Number(ymd.slice(8, 10))}`
  return k0.slice(0, 4) === end.slice(0, 4) ? `${k0.slice(0, 4)}.${dot(k0)} ~ ${dot(end)}` : `${k0.slice(0, 4)}.${dot(k0)} ~ ${end.slice(0, 4)}.${dot(end)}`
}

/**
 * 창 하나. offset 0 = 오늘이 든 칸이 맨 끝, 1 = 그 앞 창. today 는 서버가 준 KST 날짜(클라 시계를 안 쓴다).
 * hasPrev = 창 앞에 구간이 더 있다, hasNext = 더 최근 창이 있다.
 */
export function trendWindow(intervals: readonly SeriesInterval[], g: Gran, today: string, offset: number): {
  buckets: TrendBucket[]; hasPrev: boolean; hasNext: boolean; range: string
} {
  const count = TREND_WINDOW[g]
  const nowKey = bucketKey(today, g)
  const lastKey = shiftKey(nowKey, g, -offset * count)
  const keys = Array.from({ length: count }, (_, i) => shiftKey(lastKey, g, i - (count - 1)))
  const at = new Map(keys.map((k, i) => [k, i]))
  const acc = keys.map(() => ({ sum: 0, days: 0, n: 0, oneDay: 0, lastEnd: '', span: 1 }))
  const firstStart = bucketStart(keys[0], g)
  let hasPrev = false
  for (const iv of intervals) {
    if (iv.end < firstStart) { hasPrev = true; continue }
    const i = at.get(bucketKey(iv.end, g))
    if (i == null) continue
    const a = acc[i]
    a.sum += iv.consumed; a.days += iv.days; a.n++
    if (iv.days === 1) a.oneDay++
    if (iv.end > a.lastEnd) a.lastEnd = iv.end
    if (g === 'day') a.span = Math.max(1, Math.min(iv.days, i + 1))
  }
  const buckets: TrendBucket[] = keys.map((key, i) => {
    const a = acc[i]
    const current = key === nowKey
    let tail: string | null = null
    if (current && a.n > 0 && (g === 'year' || g === 'quarter' || g === 'month')) {
      // 연·분기 칸은 좁아 '10/27까지'(월/일), 월 칸은 카드와 같은 '27일까지'.
      tail = g === 'month' ? `${Number(a.lastEnd.slice(8, 10))}일까지` : `${Number(a.lastEnd.slice(5, 7))}/${Number(a.lastEnd.slice(8, 10))}까지`
    }
    // 주 칸 이름은 달이 바뀌는 칸만 '10/5', 나머지는 날짜만('12'). 320px 에서 '10/1210/19' 처럼 붙던 것을 푼다.
    const label = g === 'week' && i > 0 && keys[i - 1].slice(5, 7) === key.slice(5, 7) ? String(Number(key.slice(8, 10))) : bucketLabel(key, g)
    // 월·분기 칸은 해가 바뀌는 칸 둘째 줄에 연도를 단다(1~4분기 다음 1분기가 같은 분기로 읽히던 것, 웹디자이너 패스). 진행 중 꼬리가 우선.
    const yearTurn = (g === 'month' || g === 'quarter') && i > 0 && keys[i - 1].slice(0, 4) !== key.slice(0, 4)
    return { key, label, qty: a.n === 0 ? null : Math.max(0, a.sum), days: a.days, n: a.n, oneDay: a.oneDay, current, tail: tail ?? (yearTurn ? `${key.slice(0, 4)}년` : null), span: a.span }
  })
  return { buckets, hasPrev, hasNext: offset > 0, range: rangeOf(keys, g) }
}

const COMPARE_WORD: Partial<Record<Gran, [string, string]>> = {
  year: ['올해', '작년'], quarter: ['이번 분기', '지난 분기'], month: ['이번 달', '지난달'], week: ['이번 주', '지난주'],
}
/** 창 요약 줄 '합계 1,024봉 · 하루 6.1봉 · 점검 구간 160개'. 관측이 없으면 null. */
export function windowSummary(buckets: readonly TrendBucket[], unit: string | null, fmt: (q: number) => string): string | null {
  const seen = buckets.filter(b => b.qty != null)
  if (seen.length === 0) return null
  const sum = seen.reduce((s, b) => s + (b.qty ?? 0), 0)
  const days = seen.reduce((s, b) => s + b.days, 0)
  const n = seen.reduce((s, b) => s + b.n, 0)
  const per = perDayText(sum, days, unit)
  return [`합계 ${fmt(sum)}`, per ? `하루 ${per}` : null, `점검 구간 ${n}개`].filter(Boolean).join(' · ')
}
/** 최근 창(offset 0)에서만 '이번 달 하루 6.1봉 · 지난달 6.3봉'. 일 단위는 칸이 구간 하나라 비교 줄을 안 단다. */
export function trendCompare(buckets: readonly TrendBucket[], g: Gran, offset: number, unit: string | null): string | null {
  const w = COMPARE_WORD[g]
  if (!w || offset !== 0) return null
  const cur = buckets[buckets.length - 1], prev = buckets[buckets.length - 2]
  const a = cur ? perDayText(cur.qty, cur.days, unit) : null
  if (!a) return null
  const b = prev ? perDayText(prev.qty, prev.days, unit) : null
  return b ? `${w[0]} 하루 ${a} · ${w[1]} ${b}` : `${w[0]} 하루 ${a}`
}
/** 일 단위 표본 줄. 요일 비교는 하루 간격 점검이 있는 날만 정확하다(재고 도메인·분석가 합의). */
export function dayViewNote(buckets: readonly TrendBucket[]): string | null {
  const one = buckets.reduce((s, b) => s + b.oneDay, 0)
  const multi = buckets.reduce((s, b) => s + (b.n - b.oneDay), 0)
  if (one + multi === 0) return null
  return `하루 간격 점검 ${one}일 · 여러 날 묶인 구간 ${multi}개. 옅은 띠는 여러 날 구간이고 높이는 그 구간의 하루 평균입니다.`
}

/** 칸 하나의 온전한 이름. 연 '2026년', 분기 '2026년 4분기', 월 '2026년 10월', 주 '2026.10.19 주', 일 '2026.10.27'. */
export function bucketTitle(key: string, g: Gran): string {
  if (g === 'year') return `${key}년`
  if (g === 'quarter') return `${key.slice(0, 4)}년 ${key.slice(6)}분기`
  if (g === 'month') return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`
  const d = `${key.slice(0, 4)}.${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`
  return g === 'week' ? `${d} 주` : d
}
/** 고른 칸 읽기 줄 '2026년 10월 · 164봉 · 하루 6.1봉 · 27일까지'. 미관측이면 '2026년 4월 · 점검 기록 없음'. */
export function bucketReadout(b: TrendBucket, g: Gran, unit: string | null, fmt: (q: number) => string): string {
  const head = bucketTitle(b.key, g)
  if (b.qty == null) return `${head} · 점검 기록 없음`
  const per = perDayText(b.qty, b.days, unit)
  const tail = b.current ? b.tail : null
  return [head, b.qty > 0 ? fmt(b.qty) : '사용 없음', per ? `하루 ${per}` : null, tail].filter(Boolean).join(' · ')
}
