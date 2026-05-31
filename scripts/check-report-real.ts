import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // 실제 report/actions.ts getForecastReport 와 동일한 fetch
  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id },
    select: {
      id: true, roomNo: true, baseRent: true, scheduledRent: true, rentUpdateDate: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: { id: true, status: true, rentAmount: true, moveInDate: true, expectedMoveOut: true, moveOutDate: true, tenant: { select: { name: true } } },
      },
    },
  })

  const monthStart = new Date(2026, 4, 1)
  const monthEnd = new Date(2026, 4, 31, 23, 59, 59, 999)
  let total = 0
  console.log('=== 결산보고서 5월 expectedRevenue (실제 시스템) ===')
  for (const r of rooms) {
    let rent = r.baseRent
    if (r.scheduledRent != null && r.rentUpdateDate && new Date(r.rentUpdateDate) <= monthEnd) rent = r.scheduledRent
    const occ = r.leaseTerms.find(l => {
      const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
      const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : (l.moveOutDate ? new Date(l.moveOutDate) : null)
      if (moveIn && moveIn > monthEnd) return false
      if (moveOut && moveOut < monthStart) return false
      return true
    })
    if (occ) {
      console.log(`  ${r.roomNo}호 ${occ.tenant.name} [${occ.status}]: rent=${rent}`)
      total += rent
    }
  }
  console.log(`\n→ 합계: ${total.toLocaleString()}원`)
  console.log(`(dashboard projectedRevenue: 15,593,000원 / 차이: ${(total - 15593000).toLocaleString()})`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
