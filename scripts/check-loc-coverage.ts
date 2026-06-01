import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // 각 점검의 locationBreakdown 갯수 + 위치 이름 분포
  const items = await prisma.trackedItem.findMany({
    where: { propertyId: property.id, isArchived: false, label: { in: ['라면', '쌀', '주방세제'] } },
    select: { id: true, label: true },
  })
  for (const it of items) {
    console.log(`\n========== ${it.label} ==========`)
    const checks = await prisma.stockCheck.findMany({
      where: { trackedItemId: it.id, date: { gte: new Date(2026, 4, 1) } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { locationBreakdown: { include: { storageLocation: { select: { name: true } } } } },
    })
    for (const c of checks) {
      const locs = c.locationBreakdown.map(lb => `${lb.storageLocation.name}=${lb.remainingQty}`).join(', ')
      console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} total=${c.remainingQty} | [${locs || '위치 없음'}] | ${c.memo ?? ''}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
