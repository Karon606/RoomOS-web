import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // trackedItem
  console.log('=== TrackedItem: 세탁조크리너 ===')
  const items = await prisma.trackedItem.findMany({
    where: { propertyId: property.id, label: { contains: '세탁조' } },
    include: { _count: { select: { stockChecks: true } } },
  })
  for (const it of items) {
    console.log(`  label=${it.label} category=${it.category} isArchived=${it.isArchived} stockChecks=${it._count.stockChecks} | id=${it.id}`)
  }

  // Expense — 세탁조 관련
  console.log('\n=== Expense: 세탁조크리너 itemLabel ===')
  const expenses = await prisma.expense.findMany({
    where: { propertyId: property.id, itemLabel: { contains: '세탁조' } },
    select: { id: true, date: true, category: true, itemLabel: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, amount: true },
    orderBy: { date: 'asc' },
  })
  for (const e of expenses) {
    console.log(`  ${e.date.toISOString().slice(0,10)} category=${e.category} label="${e.itemLabel}" qty=${e.qtyValue}${e.qtyUnit ?? ''}×${e.specValue ?? '-'}${e.specUnit ?? ''} amount=${e.amount}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
