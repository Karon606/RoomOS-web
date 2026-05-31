// 기존 [수령 자동] StockCheck들에 sourceExpenseId backfill.
// 매칭 로직: 같은 propertyId 내에서 (trackedItem.category + label + qtyUnit) 일치하는 expense 중
//           receivedAt 이 stock_check.createdAt 직전(±5분) 또는 동일일자인 것 찾기.
// 정확 매칭 불가능한 자동 점검은 skip + 경고만 표시.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const APPLY = process.env.APPLY === '1'

async function main() {
  // [수령 자동] memo를 가진 check 중 sourceExpenseId가 null인 것들
  const autoChecks = await prisma.stockCheck.findMany({
    where: { memo: { startsWith: '[수령 자동]' }, sourceExpenseId: null },
    include: { trackedItem: { select: { id: true, propertyId: true, category: true, label: true, qtyUnit: true } } },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${autoChecks.length} unlinked [수령 자동] StockCheck(s)`)

  let matched = 0, ambiguous = 0, none = 0
  for (const c of autoChecks) {
    const item = c.trackedItem
    // ±5분 윈도우 (자동 점검과 expense.receivedAt 매칭)
    const win = 5 * 60 * 1000
    const candidates = await prisma.expense.findMany({
      where: {
        propertyId: item.propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
        receivedAt: { gte: new Date(c.createdAt.getTime() - win), lte: new Date(c.createdAt.getTime() + win) },
      },
      select: { id: true, receivedAt: true, qtyValue: true },
      orderBy: { receivedAt: 'asc' },
    })

    if (candidates.length === 0) {
      console.log(`  [NONE] check id=${c.id} (${item.label}, createdAt=${c.createdAt.toISOString()})`)
      none++
    } else if (candidates.length === 1) {
      const e = candidates[0]
      console.log(`  [MATCH] check id=${c.id} → expense id=${e.id} (${item.label}, ${e.qtyValue}${item.qtyUnit ?? ''})`)
      if (APPLY) {
        await prisma.stockCheck.update({ where: { id: c.id }, data: { sourceExpenseId: e.id } })
      }
      matched++
    } else {
      console.log(`  [AMBIG] check id=${c.id} (${item.label}) → ${candidates.length} candidates: ${candidates.map(e => e.id).join(', ')}`)
      ambiguous++
    }
  }

  console.log(`\nResult: matched=${matched}, ambiguous=${ambiguous}, none=${none}`)
  console.log(APPLY ? '✅ applied' : '(dry-run) APPLY=1 로 실제 적용')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
