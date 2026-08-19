import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstMonthStr, monthDbRange } from '../lib/kstDate'
import { shiftMonth } from '../lib/moveCalendar'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const item = await prisma.trackedItem.findFirst({ where: { label: '김치', isArchived: false } })
  if (!item) return
  // 재고 overview 와 같은 창 정본 — 로컬 자정으로 만들면 KST 기기에서 하루 앞으로 밀린다.
  const monthsAgo7 = monthDbRange(shiftMonth(kstMonthStr(), -7)).gte
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
