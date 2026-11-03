// 같은 품명 안의 제품(브랜드·제품명) 묶음과 '지금 남아 있을 제품' 추정 정본. 표시 전용이고 잔량 수학에 들어가지 않는다.
//
// 운영자 승인(2026-11-02 '추천대로', 가이드 §22 제품 표기). 재고는 품명 하나로 센다. 라면을 오뚜기와 삼양으로 섞어 사도
// 카드는 하나이고 잔량도 하나다. 여기서 하는 일은 그 위에 '무엇이 남아 있을 것 같은가' 를 보여 주는 것뿐이다.
//   · 묶는 키는 브랜드(앞뒤 공백을 떼고 대소문자 무시), 브랜드가 없으면 제품명이다(결정 A).
//   · 대표 표기는 그 묶음에서 가장 많이 쓴 원문이고, 같으면 최근 것이다(김치 남도청년 표기 넷이 한 묶음).
//   · 남아 있을 제품은 받은 날 최신순으로 지금 잔량을 채우는 구매 묶음이다(먼저 산 것부터 썼다는 선입선출 추정).
//     잔량을 모르면(null) 추정하지 않는다. 브랜드 없는 구매도 잔량 자리는 차지하지만 이름이 없어 목록에는 안 선다.
//   · 재고 제외로 등록한 지출(excludeFromInventory)은 어느 셈에도 안 들어간다.
// 이 추정을 카드 수치 자리에 쓰지 않는다(§22). 제품별 재고 분리(2단계)는 보류다(knowledge/domain-inventory).
import { specMultiplier } from './units'

export type MixPurchase = {
  brand: string | null
  productName: string | null
  date: Date
  receivedAt: Date | null
  qtyValue: number | null
  qtyUnit: string | null
  specValue: number | null
  specUnit: string | null
  amount: number
  excludeFromInventory?: boolean
}

export type ProductGroup = {
  key: string
  brand: string | null         // 대표 표기의 브랜드
  productName: string | null   // 대표 표기의 제품명
  text: string                 // 대표 원문 '브랜드 제품명'(공백 연결, 브랜드 먼저)
}

export type MadeMix = {
  // 마지막으로 받은 제품(브랜드·제품명이 있는 구매 중). date = 받은 날 'YYYY-MM-DD'(KST).
  last: (ProductGroup & { receivedOn: string }) | null
  // 지금 남아 있을 것으로 추정되는 제품(최근 받은 것부터). 잔량을 모르거나 0 이면 빈 배열.
  onShelf: (ProductGroup & { qty: number })[]
  // 최근 12개월 구매한 제품(많이 산 순, 같으면 최근 순). unitPrice 는 그 묶음의 단위당 평균 단가(없으면 null).
  history: (ProductGroup & { count: number; lastDate: string; unitPrice: number | null })[]
}

const clean = (s: string | null | undefined) => (s ?? '').trim()

/** 묶는 키. 브랜드(공백 떼고 대소문자 무시), 없으면 제품명. 둘 다 없으면 null(이름 없는 구매). */
export function productKeyOf(brand: string | null | undefined, productName: string | null | undefined): string | null {
  const b = clean(brand).toLowerCase()
  if (b) return `b:${b}`
  const p = clean(productName).toLowerCase()
  return p ? `p:${p}` : null
}

/** 원문 표기. '브랜드 제품명'(공백 연결, 브랜드 먼저). 이력 구매 카드·지출 칩·상세 제품 줄이 같은 글자를 쓴다. */
export function productText(brand: string | null | undefined, productName: string | null | undefined): string {
  return [clean(brand), clean(productName)].filter(Boolean).join(' ')
}

const kstYmd = (d: Date) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10)

/**
 * 같은 키끼리 묶고 대표 표기를 고른다. rows 는 최근 순이어야 한다(대표 동률은 앞의 것, 결과 순서도 처음 나온 차례).
 * 지출 입력의 지난 제품 칩도 이 함수 하나로 묶는다(화면마다 묶는 규칙이 갈리면 칩과 카드가 다른 묶음을 말한다).
 * 행에 n(같은 원문이 몇 번 나왔나)이 있으면 그만큼 센다. 장부를 (품명·브랜드·제품명)으로 groupBy 한 행을 그대로 받으려고 둔다.
 */
export function groupProducts<T extends { brand: string | null; productName: string | null; n?: number }>(rows: readonly T[]): (ProductGroup & { rows: T[] })[] {
  type Combo = { brand: string | null; productName: string | null; count: number }
  const groups = new Map<string, { rows: T[]; combos: Map<string, Combo> }>()
  for (const r of rows) {
    const key = productKeyOf(r.brand, r.productName)
    if (!key) continue
    const g = groups.get(key) ?? { rows: [] as T[], combos: new Map<string, Combo>() }
    g.rows.push(r)
    const b = clean(r.brand) || null, p = clean(r.productName) || null
    const ck = `${b ?? ''}␟${p ?? ''}`
    const c = g.combos.get(ck)
    const w = r.n ?? 1
    if (c) c.count += w; else g.combos.set(ck, { brand: b, productName: p, count: w })
    groups.set(key, g)
  }
  return [...groups.entries()].map(([key, g]) => {
    // Map 은 넣은 차례를 지키므로 동률이면 먼저 나온(최근) 표기가 남는다.
    let rep: Combo | null = null
    for (const c of g.combos.values()) if (!rep || c.count > rep.count) rep = c
    const brand = rep!.brand, productName = rep!.productName
    return { key, brand, productName, text: productText(brand, productName), rows: g.rows }
  })
}

/**
 * 한 품목의 제품 표기 셋(마지막 받은 제품 · 남아 있을 제품 · 최근 12개월 구매한 제품).
 * 수량은 잔량 셈(consumptionSeries.sumPurchasesMem)과 같은 규칙으로 카드 단위로 바꾼다. 단위가 안 맞는 구매(느슨 매칭 밖)는 빼고,
 * 규격으로 세는 품목이면 수량 × 규격(카드 규격 단위로 환산)이다.
 */
export function resolveMadeMix(
  purchases: readonly MixPurchase[],
  currentStock: number | null,
  unit: { qtyUnit: string | null; useSpec: boolean; specUnit: string | null },
  now: Date = new Date(),
): MadeMix {
  const rows = purchases.filter(p => p.excludeFromInventory !== true)
    .filter(p => unit.qtyUnit ? (p.qtyUnit == null || p.qtyUnit === unit.qtyUnit) : true)
  const qtyOf = (p: MixPurchase): number => {
    const q = p.qtyValue ?? 0
    if (!unit.useSpec) return q
    const spec = specMultiplier(p.specValue, p.specUnit, unit.specUnit)
    return spec != null ? q * spec : q
  }
  const received = rows.filter(p => p.receivedAt != null)
    .sort((a, b) => b.receivedAt!.getTime() - a.receivedAt!.getTime())

  // 마지막으로 받은 제품. 이름이 있는 구매 중 가장 최근에 받은 것.
  const lastRow = received.find(p => productKeyOf(p.brand, p.productName) != null) ?? null
  let last: MadeMix['last'] = null
  if (lastRow) {
    const g = groupProducts(received).find(x => x.key === productKeyOf(lastRow.brand, lastRow.productName))!
    // 제품 줄은 그 구매의 원문을 그대로 말한다(대표 표기로 바꾸면 '이번에 받은 것' 이 아니게 된다).
    const brand = clean(lastRow.brand) || null, productName = clean(lastRow.productName) || null
    last = { key: g.key, brand, productName, text: productText(brand, productName), receivedOn: kstYmd(lastRow.receivedAt!) }
  }

  // 남아 있을 제품. 받은 날 최신순으로 지금 잔량을 채운다. 이름 없는 구매도 자리는 차지한다.
  const onShelf: MadeMix['onShelf'] = []
  if (currentStock != null && currentStock > 0) {
    const groups = groupProducts(received)
    const groupOf = new Map<MixPurchase, ProductGroup>()
    for (const g of groups) for (const r of g.rows) groupOf.set(r, g)
    const byKey = new Map<string, ProductGroup & { qty: number }>()
    let left = currentStock
    for (const p of received) {
      if (left <= 1e-9) break
      const q = qtyOf(p)
      if (!(q > 0)) continue
      const take = Math.min(q, left)
      left -= take
      const g = groupOf.get(p)
      if (!g) continue
      const cur = byKey.get(g.key)
      if (cur) cur.qty += take
      else byKey.set(g.key, { key: g.key, brand: g.brand, productName: g.productName, text: g.text, qty: take })
    }
    onShelf.push(...byKey.values())
  }

  // 최근 12개월 구매한 제품. 날짜 축은 @db.Date(UTC 자정) 그대로 비교한다(overview 단가 창과 같은 절단).
  const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const yearAgoMs = Math.floor(yearAgo.getTime() / 86400000) * 86400000
  const recent = rows.filter(p => p.date.getTime() >= yearAgoMs).sort((a, b) => b.date.getTime() - a.date.getTime())
  const history = groupProducts(recent).map(g => {
    // 단가는 카드 평균 단가와 같은 표본(받은 구매 · 수량 > 0 · 금액 > 0)에서 낸다.
    let amt = 0, base = 0
    for (const r of g.rows) {
      if (r.receivedAt == null || !(r.amount > 0) || !((r.qtyValue ?? 0) > 0)) continue
      const b = qtyOf(r)
      if (b > 0) { amt += r.amount; base += b }
    }
    return {
      key: g.key, brand: g.brand, productName: g.productName, text: g.text,
      count: g.rows.length, lastDate: g.rows[0].date.toISOString().slice(0, 10),
      unitPrice: base > 0 ? amt / base : null,
    }
  }).sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))

  return { last, onShelf, history }
}

/**
 * 제품 이름 한 토막(2026-11-03 운영자 지시 '브랜드와 제품명 둘 다'). full = '브랜드 제품명', name = 제품명만(없으면 브랜드).
 * 오뚜기 라면이 수백 가지라 브랜드만으로는 무엇인지 모른다. 자리가 모자랄 때 버리는 쪽은 브랜드다.
 * full 은 기록된 원문 그대로다. 제품명이 브랜드로 시작해도 줄이지 않는다('삼양 삼양라면 깔끔한 감칠맛', 같은 날 운영자 지시).
 */
export type ShelfNameMode = 'full' | 'name'
export function shelfName(g: { brand: string | null; productName: string | null }, mode: ShelfNameMode): string {
  const b = clean(g.brand), p = clean(g.productName)
  if (mode === 'name') return p || b
  return productText(b, p)
}

/**
 * 카드 메타 제품 토막. 묶음 전체에 한 표기(mode)를 쓴다(하나만 브랜드가 빠지면 둘이 다른 급으로 읽힌다).
 * 하나면 그 이름, 둘이면 ', ' 로 잇고, 셋부터 '앞 둘 외 N'. 없으면 ''. 어느 표기를 쓸지는 화면이 폭을 재서 고른다.
 */
export function shelfProductsText(onShelf: readonly { brand: string | null; productName: string | null }[], mode: ShelfNameMode): string {
  const names = onShelf.map(g => shelfName(g, mode)).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}`
}

// ── 제품별 보기(가이드 §22, 2026-11 등재, 운영자 승인 '추천대로' 해석 A) ──
// 품목 상세 '월별 입수'·'단가 추이' 를 제품 묶음으로 나눠 보여 준다. 보기만 나누고 실사·잔량·소모·알림은 늘 합계다.
// 입수·단가처럼 구매(지출)에서 나온 사실만 나눈다. 묶는 키·대표 표기는 위 groupProducts 하나다(카드 메타·펼침과 같은 묶음).
// 한 지출은 한 묶음에만 들어가고, 이름 없는 구매와 무상 입수는 '제품 기록 없음' 나머지로 합을 맞춘다(제품별 합 + 나머지 = 통합).

/** 제품 줄·선의 상한. 넘는 묶음은 '외 N종'(입수) 또는 선 밖(단가)이다. */
export const PRODUCT_LINES_MAX = 3

/**
 * 보기 토글 판정 재료. 금액이 있는 이름 있는 구매의 묶음 키(중복 없음). 두 탭(월별 입수·단가 추이)이 같은 재료로 판정하게
 * 단가 표본(금액 > 0)과 같은 거름을 쓴다. 0원 구매는 단가에 안 서므로 월별에서도 묶음 수에 넣지 않는다.
 */
export function productViewKeys(rows: readonly { brand: string | null; productName: string | null; amount: number }[]): string[] {
  const keys = new Set<string>()
  for (const r of rows) { if (!(r.amount > 0)) continue; const k = productKeyOf(r.brand, r.productName); if (k) keys.add(k) }
  return [...keys]
}
/** 보기 토글을 세우는가. 묶음이 둘 미만이면 나눠 볼 것이 없다. 두 탭이 이 함수 하나로 판정한다. */
export function showsProductView(keys: Iterable<string>): boolean {
  return new Set(keys).size >= 2
}

export type InflowPurchase = { date: Date; month: string; brand: string | null; productName: string | null; qty: number; amount: number }
export type InflowLine = { key: string; text: string; qty: number; amount: number }
export type InflowSplit = {
  /** 그 달 많이 들어온 순(같으면 최근 묶음 먼저) 최대 PRODUCT_LINES_MAX 줄. */
  lines: InflowLine[]
  /** 줄에 못 든 묶음('외 N종'). keys.length = N. */
  more: { keys: string[]; qty: number; amount: number } | null
  /** 이름 없는 구매 + 무상 입수('제품 기록 없음'). */
  unrecorded: { qty: number; amount: number } | null
  /** 그 달 보기 토글 판정 재료(productViewKeys). 화면은 달들을 합쳐 showsProductView 로 판정한다. */
  viewKeys: string[]
}

/**
 * 달별 입수를 제품 묶음으로 나눈다. 수량은 호출부가 카드 단위로 바꿔 넘긴다(getMonthlyInflow 와 같은 환산).
 * 묶음(키)은 전 기간 groupProducts 하나로 정하고, 줄 이름은 그 달에 실제로 산 구매의 최빈 원문(같으면 최근)이다.
 * 전 기간 대표 표기를 쓰면 10월에 산 '스파크 스마트 클린 분말세제' 가 11월에 많이 산 '…리필' 로 서서 그 달 사실과 갈린다(독립 검수).
 */
export function splitInflowByProduct(
  purchases: readonly InflowPurchase[],
  additions: readonly { month: string; qty: number }[],
): Map<string, InflowSplit> {
  const recent = [...purchases].sort((a, b) => b.date.getTime() - a.date.getTime())
  const groups = groupProducts(recent)
  const groupOf = new Map<InflowPurchase, ProductGroup>()
  const order = new Map<string, number>()
  groups.forEach((g, i) => { order.set(g.key, i); for (const r of g.rows) groupOf.set(r, g) })

  const months = new Map<string, { byKey: Map<string, InflowLine & { rows: InflowPurchase[] }>; rest: { qty: number; amount: number }; all: InflowPurchase[] }>()
  const monthOf = (m: string) => {
    let v = months.get(m)
    if (!v) { v = { byKey: new Map(), rest: { qty: 0, amount: 0 }, all: [] }; months.set(m, v) }
    return v
  }
  for (const p of recent) {
    const m = monthOf(p.month)
    m.all.push(p)
    const g = groupOf.get(p)
    if (!g) { m.rest.qty += p.qty; m.rest.amount += p.amount; continue }
    const cur = m.byKey.get(g.key)
    if (cur) { cur.qty += p.qty; cur.amount += p.amount; cur.rows.push(p) }
    else m.byKey.set(g.key, { key: g.key, text: g.text, qty: p.qty, amount: p.amount, rows: [p] })
  }
  // 줄 이름 = 그 달 그 묶음 구매의 최빈 원문(rows 는 최근 순이라 동률이면 최근). 한 묶음 안이라 groupProducts 결과는 하나다.
  for (const m of months.values()) for (const l of m.byKey.values()) l.text = groupProducts(l.rows)[0].text
  for (const a of additions) monthOf(a.month).rest.qty += a.qty

  const out = new Map<string, InflowSplit>()
  for (const [month, m] of months) {
    const sorted = [...m.byKey.values()].map(({ key, text, qty, amount }) => ({ key, text, qty, amount }))
      .sort((a, b) => b.qty - a.qty || order.get(a.key)! - order.get(b.key)!)
    const lines = sorted.slice(0, PRODUCT_LINES_MAX)
    const tail = sorted.slice(PRODUCT_LINES_MAX)
    out.set(month, {
      lines,
      more: tail.length > 0 ? { keys: tail.map(l => l.key), qty: tail.reduce((s, l) => s + l.qty, 0), amount: tail.reduce((s, l) => s + l.amount, 0) } : null,
      unrecorded: m.rest.qty > 0 || m.rest.amount > 0 ? m.rest : null,
      viewKeys: productViewKeys(m.all),
    })
  }
  return out
}

export type PriceSeries<T> = ProductGroup & { points: T[] }

/**
 * 단가 점을 제품 묶음별 선으로 나눈다. 점은 날짜 오름차순으로 받고 선 안에서도 그 차례다.
 * 선은 점이 많은 묶음부터(같으면 최근에 산 묶음 먼저) 최대 PRODUCT_LINES_MAX 개다.
 * more = 선에 못 든 묶음 수, unrecorded = 이름 없는 점 수(선을 긋지 않는다).
 */
export function splitPriceByProduct<T extends { date: Date; brand: string | null; productName: string | null }>(
  points: readonly T[],
): { series: PriceSeries<T>[]; more: number; unrecorded: number } {
  const recent = [...points].sort((a, b) => b.date.getTime() - a.date.getTime())
  const groups = groupProducts(recent)
  const all = groups.map((g, i) => ({ i, key: g.key, brand: g.brand, productName: g.productName, text: g.text, points: [...g.rows].sort((a, b) => a.date.getTime() - b.date.getTime()) }))
    .sort((a, b) => b.points.length - a.points.length || a.i - b.i)
  const named = all.reduce((s, g) => s + g.points.length, 0)
  return {
    series: all.slice(0, PRODUCT_LINES_MAX).map(({ key, brand, productName, text, points }) => ({ key, brand, productName, text, points })),
    more: Math.max(0, all.length - PRODUCT_LINES_MAX),
    unrecorded: points.length - named,
  }
}
