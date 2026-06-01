import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const it = await prisma.trackedItem.findFirst({ where: { label: '라면', isArchived: false } })
  if (!it) return
  const prev = new Date('2026-05-08T04:58:30Z')
  const curr = new Date('2026-05-12T05:52:48Z')
  console.log(`prev=${prev.toISOString()} curr=${curr.toISOString()}`)
  const rows = await prisma.expense.findMany({
    where: {
      propertyId: it.propertyId, category: it.category, itemLabel: it.label,
      ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}),
      receivedAt: { not: null, gt: prev, lte: curr },
      excludeFromInventory: false,
    },
    select: { qtyValue: true, specValue: true, receivedAt: true },
  })
  console.log(`prisma 결과 ${rows.length}건:`)
  for (const r of rows) console.log(`  qty=${r.qtyValue}×${r.specValue} received=${r.receivedAt?.toISOString()}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
