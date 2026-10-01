// 한 지출 카테고리를 품목별로 나눠 합계·건수·수량을 내는 정본(쿼리 0, 신고 bc5d1c06).
//
// 재무 '카테고리별 지출 분석' 카드에서 카테고리를 펼치면 "김치에 얼마, 쌀에 얼마"가 선다.
// 입력은 그 카드가 카테고리 합(currentCatMap)을 만드는 **바로 그 배열**이어야 한다 — 다른
// 필터를 탄 배열을 넣으면 아래 불변식(Σ버킷 == 카테고리 합)이 화면에서 깨진다
// (scripts/test-expense-item-breakdown.ts 가 배선까지 지킨다).
//
// 행 하나는 정확히 한 버킷에 들어간다. 순서가 곧 우선순위다.
//   ① isShipping            → '배송비'
//   ② itemLabel 있음        → 그 라벨(brand·productName 은 표시·검색 전용이라 키로 안 쓴다)
//   ③ recurringExpenseId 있음 → detail(고정지출 기록은 detail 에 제목이 들어간다)
//   ④ 나머지                → '품목 미지정'(itemLabel 없는 수기 지출은 detail 이 있어도 여기다)
// ④를 detail 로 묶지 않는 이유: 수기 지출의 detail 은 자유문이라 같은 물건도 줄이 흩어진다.

export const SHIPPING_BUCKET = '배송비'
export const UNASSIGNED_BUCKET = '품목 미지정'

export type BreakdownInput = {
  amount: number
  isShipping: boolean
  itemLabel: string | null
  recurringExpenseId: string | null
  detail: string | null
  allocationGroupId: string | null
  qtyValue: number | null
  qtyUnit: string | null
}

export type BreakdownKind = 'shipping' | 'item' | 'recurring' | 'none'

export type BreakdownBucket = {
  label: string
  kind: BreakdownKind
  amount: number
  /** 건수 — allocationGroupId 가 같은 행(한 품목을 방별로 쪼갠 것)은 1건 */
  count: number
  /** 수량 합 — 버킷의 모든 행이 같은 단위이고 수량이 다 있을 때만, 아니면 null */
  qty: { value: number; unit: string } | null
}

function bucketOf(e: BreakdownInput): { label: string; kind: BreakdownKind } {
  if (e.isShipping) return { label: SHIPPING_BUCKET, kind: 'shipping' }
  const item = e.itemLabel?.trim()
  if (item) return { label: item, kind: 'item' }
  const title = e.recurringExpenseId ? e.detail?.trim() : ''
  if (title) return { label: title, kind: 'recurring' }
  return { label: UNASSIGNED_BUCKET, kind: 'none' }
}

/** 지출 행들을 품목 버킷으로 나눈다. 금액 내림차순, '품목 미지정'은 맨 뒤. */
export function expenseItemBreakdown(rows: BreakdownInput[]): BreakdownBucket[] {
  type Acc = { label: string; kind: BreakdownKind; amount: number; keys: Set<string>; rows: BreakdownInput[] }
  const map = new Map<string, Acc>()
  rows.forEach((e, i) => {
    const { label, kind } = bucketOf(e)
    // 같은 이름이라도 성질이 다르면(품목 '배송비' 와 실제 배송비 행) 다른 버킷이다.
    const key = `${kind}\u0000${label}`
    let acc = map.get(key)
    if (!acc) { acc = { label, kind, amount: 0, keys: new Set(), rows: [] }; map.set(key, acc) }
    acc.amount += e.amount
    acc.keys.add(e.allocationGroupId ? `g:${e.allocationGroupId}` : `r:${i}`)
    acc.rows.push(e)
  })
  const out: BreakdownBucket[] = []
  for (const acc of map.values()) {
    const unit = acc.rows[0].qtyUnit
    const sameUnit = !!unit && acc.rows.every(r => r.qtyUnit === unit && r.qtyValue != null)
    out.push({
      label: acc.label,
      kind: acc.kind,
      amount: acc.amount,
      count: acc.keys.size,
      qty: sameUnit ? { value: acc.rows.reduce((s, r) => s + (r.qtyValue ?? 0), 0), unit: unit! } : null,
    })
  }
  return out.sort((a, b) => {
    if ((a.kind === 'none') !== (b.kind === 'none')) return a.kind === 'none' ? 1 : -1
    return b.amount - a.amount
  })
}
