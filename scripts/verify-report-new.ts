import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'
import { BILLABLE_STATUSES, getCheckedOutRecognizedRevenue } from '../lib/leaseStatus'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  const billable = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: BILLABLE_STATUSES }, rentAmount: { gt: 0 } },
    select: {
      id: true, status: true, rentAmount: true, moveInDate: true, expectedMoveOut: true, moveOutDate: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  const month = '2026-05'
  const monthStart = new Date(2026, 4, 1)
  const monthEnd = new Date(2026, 4, 31, 23, 59, 59, 999)
  let revenue = 0
  for (const l of billable) {
    const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : (l.moveOutDate ? new Date(l.moveOutDate) : null)
    if (moveIn && moveIn > monthEnd) continue
    if (moveOut && moveOut < monthStart) continue
    revenue += discountedRent(l.discounts, month, l.rentAmount)
  }
  const checkedOutRev = await getCheckedOutRecognizedRevenue(prisma, property.id, month)
  const total = revenue + checkedOutRev
  console.log(`billable lease 합: ${revenue.toLocaleString()}`)
  console.log(`+ CHECKED_OUT recognized: ${checkedOutRev.toLocaleString()}`)
  console.log(`→ 결산 expectedRevenue (5월): ${total.toLocaleString()}원`)
  console.log(`(dashboard projectedRevenue: 15,593,000원 — extras 500 포함, 결산 expectedRevenue 는 extras 별도)`)
  console.log(`결산 expectedRevenue 가 ${total === 15592500 ? '✓ dashboard totalExpected (15,592,500) 와 일치' : '✗ 불일치'}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
