import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstMonthStr, monthDbRange } from '../lib/kstDate'
import { shiftMonth } from '../lib/moveCalendar'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

function dedup<T extends { date: Date; createdAt: Date }>(arr: T[]): T[] {
  const m = new Map<string, T>()
  for (const c of arr) {
    const k = `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}-${c.date.getUTCDate()}`
    const ex = m.get(k)
    if (!ex || c.createdAt > ex.createdAt) m.set(k, c)
  }
  return [...m.values()].sort((a,b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
}

async function main() {
  const it = await prisma.trackedItem.findFirst({ where: { label: '라면', isArchived: false } })
  if (!it) return
  // 재고 overview 와 같은 창 정본 — 로컬 자정으로 만들면 KST 기기에서 하루 앞으로 밀린다.
  const monthsAgo7 = monthDbRange(shiftMonth(kstMonthStr(), -7)).gte
  const checks = await prisma.stockCheck.findMany({
    where: { trackedItemId: it.id, date: { gte: monthsAgo7 } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, date: true, createdAt: true, remainingQty: true, memo: true },
  })
  console.log(`원본 ${checks.length}건:`)
  for (const c of checks) console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} total=${c.remainingQty} | ${c.memo ?? ''}`)
  const deduped = dedup(checks)
  console.log(`\ndedup 후 ${deduped.length}건:`)
  for (const c of deduped) console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} total=${c.remainingQty}`)
  // 구매·추가
  const expenses = await prisma.expense.findMany({
    where: { propertyId: it.propertyId, category: it.category, itemLabel: it.label, ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}), date: { gte: monthsAgo7 } },
    select: { qtyValue: true, specValue: true, receivedAt: true, date: true },
  })
  const additions = await prisma.stockAddition.findMany({ where: { trackedItemId: it.id, date: { gte: monthsAgo7 } } })
  console.log(`\n구매 ${expenses.length}건:`)
  for (const e of expenses) console.log(`  date=${e.date.toISOString().slice(0,10)} qty=${e.qtyValue}×${e.specValue} received=${e.receivedAt?.toISOString().slice(0,10) ?? '-'}`)
  console.log(`\n추가 ${additions.length}건:`)
  for (const a of additions) console.log(`  ${a.date.toISOString().slice(0,10)} +${a.addedQty}`)

  // monthly consumption 시뮬레이션 (dedup 적용)
  console.log(`\n=== monthly 계산 (dedup 적용) ===`)
  let total = 0
  const useSpec = it.trackUnit !== 'qty' && !!(it.specUnit && it.specUnit.trim())
  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1], curr = deduped[i]
    const purchases = expenses
      .filter(e => e.receivedAt && e.receivedAt > prev.createdAt && e.receivedAt <= curr.createdAt)
      .reduce((s, e) => s + (useSpec && e.specValue ? (e.qtyValue ?? 0) * e.specValue : (e.qtyValue ?? 0)), 0)
    const adds = additions
      .filter(a => a.date > prev.date && a.date <= curr.date)
      .reduce((s, a) => s + a.addedQty, 0)
    const consumed = prev.remainingQty + purchases + adds - curr.remainingQty
    if (consumed > 0) total += consumed
    console.log(`  ${prev.date.toISOString().slice(0,10)}(${prev.remainingQty}) → ${curr.date.toISOString().slice(0,10)}(${curr.remainingQty}) | 구매=${purchases} 추가=${adds} consumed=${consumed} (누적${total > 0 ? total : 0})`)
  }
  console.log(`\n최종 사용량 (dedup 시뮬): ${total}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
