import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
async function main() {
  const it = await prisma.trackedItem.findFirst({ where: { label: '라면', isArchived: false } })
  if (!it) return
  const expenses = await prisma.expense.findMany({
    where: { propertyId: it.propertyId, category: it.category, itemLabel: it.label, ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}) },
    select: { date: true, qtyValue: true, specValue: true, receivedAt: true, createdAt: true, vendor: true },
    orderBy: { date: 'asc' },
  })
  console.log('라면 구매 전체:')
  for (const e of expenses) {
    console.log(`  date=${e.date.toISOString()} qty=${e.qtyValue}×${e.specValue}=${(e.qtyValue ?? 0) * (e.specValue ?? 1)} receivedAt=${e.receivedAt?.toISOString() ?? '대기'} created=${e.createdAt.toISOString()}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
