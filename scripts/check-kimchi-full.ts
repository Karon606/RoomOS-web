import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const item = await prisma.trackedItem.findFirst({ where: { label: '김치', isArchived: false } })
  if (!item) return
  const monthsAgo7 = new Date()
  monthsAgo7.setMonth(monthsAgo7.getMonth() - 7)
  monthsAgo7.setDate(1); monthsAgo7.setHours(0, 0, 0, 0)
  console.log('monthsAgo7 cutoff:', monthsAgo7.toISOString())
  const allChecks = await prisma.stockCheck.findMany({
    where: { trackedItemId: item.id, date: { gte: monthsAgo7 } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  console.log(`Total checks: ${allChecks.length}`)
  for (const c of allChecks) {
    console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} | total=${c.remainingQty}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
