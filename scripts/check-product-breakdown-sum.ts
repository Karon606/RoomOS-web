// 제품별 보기의 합이 통합과 같은가(가이드 §22 제품별 보기) · 읽기 전용, 위반 시 exit 1. 실행: npx tsx --env-file=.env.local scripts/check-product-breakdown-sum.ts
//
// 왜(2026-11 운영자 승인 '추천대로' 해석 A). 품목 상세 '월별 입수' 를 제품별로 나눠 볼 때, 달마다 제품 줄 + 외 N종 + 제품 기록 없음 이
// 그 달 통합 입수량·구매 금액과 같아야 한다. 진리표(test-product-mix)는 만든 값으로 이 규칙을 지키고, 여기서는 장부에 실제로 있는
// 지출·무상 입수로 같은 셈을 돌려 본다(이상한 값, 예컨대 단위 환산이 NaN 이 되는 구매가 섞이면 합이 갈린다).
// 셈은 getMonthlyInflow 와 같은 붙는 판정(카테고리·품명·느슨한 수량 단위, 받은 구매, 재고 제외 아님, 수량 > 0)이다.
// 단가 선도 3개를 넘지 않는지 본다.
//
// 멀티테넌트: 전 영업장을 본다. 특정 영업장 값을 하드코딩하지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { specMultiplier } from '../lib/units'
import { splitInflowByProduct, splitPriceByProduct, PRODUCT_LINES_MAX, type InflowPurchase } from '../lib/productMix'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })

const monthKey = (v: Date) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))

async function main() {
  const [items, expenses, additions] = await Promise.all([
    prisma.trackedItem.findMany({
      where: { isArchived: false },
      select: { id: true, propertyId: true, category: true, label: true, qtyUnit: true, specUnit: true, trackUnit: true, property: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: { qtyValue: { gt: 0 }, receivedAt: { not: null }, excludeFromInventory: false, itemLabel: { not: null } },
      select: { propertyId: true, category: true, itemLabel: true, qtyUnit: true, date: true, qtyValue: true, specValue: true, specUnit: true, amount: true, brand: true, productName: true },
    }),
    prisma.stockAddition.findMany({ select: { trackedItemId: true, date: true, addedQty: true } }),
  ])
  const byLabel = new Map<string, typeof expenses>()
  for (const e of expenses) {
    const k = `${e.propertyId}␟${e.category}␟${e.itemLabel}`
    const list = byLabel.get(k) ?? []
    list.push(e); byLabel.set(k, list)
  }
  const addsOf = new Map<string, typeof additions>()
  for (const a of additions) { const l = addsOf.get(a.trackedItemId) ?? []; l.push(a); addsOf.set(a.trackedItemId, l) }

  const fails: string[] = []
  let months = 0, mixed = 0
  for (const it of items) {
    const useSpec = it.trackUnit !== 'qty' && !!(it.specUnit && it.specUnit.trim())
    const rows = (byLabel.get(`${it.propertyId}␟${it.category}␟${it.label}`) ?? []).filter(e => !it.qtyUnit || e.qtyUnit == null || e.qtyUnit === it.qtyUnit)
    const totals = new Map<string, { qty: number; amount: number }>()
    const tot = (m: string) => { let t = totals.get(m); if (!t) { t = { qty: 0, amount: 0 }; totals.set(m, t) } return t }
    const mixRows: InflowPurchase[] = []
    for (const e of rows) {
      const q = e.qtyValue ?? 0
      const spec = useSpec ? specMultiplier(e.specValue, e.specUnit, it.specUnit) : null
      const contrib = spec != null ? q * spec : q
      const m = monthKey(e.date)
      tot(m).qty += contrib; tot(m).amount += e.amount
      mixRows.push({ date: e.date, month: m, brand: e.brand, productName: e.productName, qty: contrib, amount: e.amount })
    }
    const addRows = (addsOf.get(it.id) ?? []).map(a => ({ month: monthKey(a.date), qty: a.addedQty }))
    for (const a of addRows) tot(a.month).qty += a.qty
    const split = splitInflowByProduct(mixRows, addRows)
    const where = `${it.property.name} · ${it.label}`
    for (const [m, t] of totals) {
      months++
      const s = split.get(m)
      if (!s) { fails.push(`${where} · ${m} 제품별 나눔이 없다`); continue }
      if (s.lines.length > PRODUCT_LINES_MAX) fails.push(`${where} · ${m} 제품 줄 ${s.lines.length}개(상한 ${PRODUCT_LINES_MAX})`)
      if (s.lines.length + (s.more?.keys.length ?? 0) >= 2) mixed++
      const q = s.lines.reduce((x, l) => x + l.qty, 0) + (s.more?.qty ?? 0) + (s.unrecorded?.qty ?? 0)
      const a = s.lines.reduce((x, l) => x + l.amount, 0) + (s.more?.amount ?? 0) + (s.unrecorded?.amount ?? 0)
      if (!close(q, t.qty)) fails.push(`${where} · ${m} 입수량 제품별 합 ${q} / 통합 ${t.qty}`)
      if (!close(a, t.amount)) fails.push(`${where} · ${m} 구매 금액 제품별 합 ${a} / 통합 ${t.amount}`)
    }
    if (split.size !== totals.size) fails.push(`${where} 제품별 달 수 ${split.size} / 통합 ${totals.size}`)
    const lines = splitPriceByProduct(rows.filter(e => e.amount > 0)).series.length
    if (lines > PRODUCT_LINES_MAX) fails.push(`${where} 단가 선 ${lines}개(상한 ${PRODUCT_LINES_MAX})`)
  }
  console.log(`[제품별 보기 합] 활성 카드 ${items.length}장 · 달 ${months}개(제품 둘 이상 ${mixed}개) · 위반 ${fails.length}건`)
  for (const f of fails) console.log('  - ' + f)
  await prisma.$disconnect()
  if (fails.length > 0) process.exit(1)
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(2) })
