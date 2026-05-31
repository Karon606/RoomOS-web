// 김치 월별 사용량 계산 재현 — 화면에 159kg 으로 표시되는 값이 맞는지 검증
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const item = await prisma.trackedItem.findFirst({
    where: { label: '김치', isArchived: false },
    select: { id: true, propertyId: true, label: true, category: true, qtyUnit: true, specUnit: true, trackUnit: true },
  })
  if (!item) { console.log('NO ITEM'); return }
  console.log(`Item: ${item.label} (trackUnit=${item.trackUnit}, qtyUnit=${item.qtyUnit}, specUnit=${item.specUnit})`)

  // 7개월 전부터 모든 점검
  const now = new Date(2026, 4, 31)  // 5월 31일 기준
  const sevenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1)

  const checks = await prisma.stockCheck.findMany({
    where: { trackedItemId: item.id, date: { gte: sevenMonthsAgo } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, date: true, createdAt: true, remainingQty: true, memo: true },
  })
  console.log(`\nStockChecks (${checks.length}):`)
  for (const c of checks) {
    console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} | total=${c.remainingQty}kg | memo=${c.memo ?? ''}`)
  }

  // 추가 입수(무상)
  const additions = await prisma.stockAddition.findMany({
    where: { trackedItemId: item.id, date: { gte: sevenMonthsAgo } },
    orderBy: { date: 'asc' },
  })
  console.log(`\nAdditions:`)
  for (const a of additions) console.log(`  ${a.date.toISOString().slice(0,10)} +${a.addedQty}`)

  // 구매(Expense)
  const expenses = await prisma.expense.findMany({
    where: {
      propertyId: item.propertyId,
      category: item.category, itemLabel: item.label,
      ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
      date: { gte: sevenMonthsAgo },
    },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, createdAt: true, qtyValue: true, specValue: true, receivedAt: true },
  })
  console.log(`\nPurchases:`)
  for (const e of expenses) {
    const totalKg = (e.qtyValue ?? 0) * (e.specValue ?? 1)
    console.log(`  ${e.date.toISOString().slice(0,10)} purchase=${e.qtyValue}×${e.specValue}=${totalKg}kg receivedAt=${e.receivedAt?.toISOString().slice(0,10) ?? '대기'}`)
  }

  // 월별 슬롯 초기화
  const monthlyMap: Record<string, number> = {}
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyMap[key] = 0
  }
  console.log(`\nMonthly slots:`, Object.keys(monthlyMap).join(', '))

  // 연속 점검 사이의 소모량 계산
  // consumed = (prev.remaining + 구매(prev→curr) + 무상입수(prev→curr)) - curr.remaining
  console.log(`\n계산 과정:`)
  for (let i = 1; i < checks.length; i++) {
    const prev = checks[i - 1]
    const curr = checks[i]
    const purchases = expenses
      .filter(e => e.createdAt > prev.createdAt && e.createdAt <= curr.createdAt)
      .reduce((s, e) => s + (e.qtyValue ?? 0) * (e.specValue ?? 1), 0)
    const additionsBetween = additions
      .filter(a => a.date > prev.date && a.date <= curr.date)
      .reduce((s, a) => s + a.addedQty, 0)
    const consumed = (prev.remainingQty + purchases + additionsBetween) - curr.remainingQty
    if (consumed <= 0) {
      console.log(`  ${prev.date.toISOString().slice(0,10)} → ${curr.date.toISOString().slice(0,10)}: prev=${prev.remainingQty}+구매${purchases}+무상${additionsBetween} − curr=${curr.remainingQty} = ${consumed} (음수/0 → 무시)`)
      continue
    }
    const key = `${curr.date.getFullYear()}-${String(curr.date.getMonth() + 1).padStart(2, '0')}`
    console.log(`  ${prev.date.toISOString().slice(0,10)} → ${curr.date.toISOString().slice(0,10)}: prev=${prev.remainingQty}+구매${purchases}+무상${additionsBetween} − curr=${curr.remainingQty} = ${consumed}kg → ${key}`)
    if (key in monthlyMap) monthlyMap[key] += consumed
  }

  console.log(`\n결과 (overview.ts 와 동일):`)
  let total = 0
  for (const [m, q] of Object.entries(monthlyMap)) {
    console.log(`  ${m}: ${q}kg`)
    total += q
  }
  console.log(`  합계: ${total}kg`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
