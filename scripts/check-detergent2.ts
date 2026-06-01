import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // "크리너" 또는 "클리너" 또는 "세탁조" 포함 검색
  const expenses = await prisma.expense.findMany({
    where: {
      propertyId: property.id,
      OR: [
        { itemLabel: { contains: '크리너' } },
        { itemLabel: { contains: '클리너' } },
        { itemLabel: { contains: '세탁조' } },
        { vendor: { contains: '세탁조' } },
        { detail: { contains: '세탁조' } },
        { memo: { contains: '세탁조' } },
      ],
    },
    select: { id: true, date: true, category: true, itemLabel: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, amount: true, vendor: true, detail: true, memo: true, excludeFromInventory: true },
    orderBy: { date: 'asc' },
  })
  console.log(`검색 결과 ${expenses.length}건:`)
  for (const e of expenses) {
    console.log(`  ${e.date.toISOString().slice(0,10)} cat=${e.category} itemLabel="${e.itemLabel ?? '-'}" qty=${e.qtyValue ?? '-'}×${e.specValue ?? '-'} amount=${e.amount} vendor="${e.vendor ?? '-'}" detail="${e.detail ?? '-'}" memo="${e.memo ?? '-'}" excludeFromInv=${e.excludeFromInventory}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
