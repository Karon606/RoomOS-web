import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TARGET_MONTH = '2026-05'

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  const active = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
    select: { id: true, status: true, rentAmount: true, discounts: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  console.log(`billableLeases: ${active.length}건`)
  let totalActive = 0
  const skipped: string[] = []
  for (const l of active) {
    const amt = discountedRent(l.discounts, TARGET_MONTH, l.rentAmount)
    if (amt === 0) skipped.push(`${l.room?.roomNo}호 ${l.tenant.name} (status=${l.status})`)
    totalActive += amt
  }
  console.log(`active 합계: ${totalActive.toLocaleString()}`)
  if (skipped.length) {
    console.log(`청구액=0 인 lease: ${skipped.length}건 — ${skipped.join(', ')}`)
  }
  const agg = await prisma.paymentRecord.aggregate({
    where: { propertyId: property.id, targetMonth: TARGET_MONTH, isDeposit: false, isPrevOwner: false, leaseTerm: { status: 'CHECKED_OUT' } },
    _sum: { actualAmount: true },
  })
  const recog = agg._sum.actualAmount ?? 0
  const extras = await prisma.extraIncome.aggregate({
    where: { propertyId: property.id, date: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) } },
    _sum: { amount: true },
  })
  const extraRevenue = extras._sum.amount ?? 0
  console.log(`CHECKED_OUT recognized: ${recog.toLocaleString()}`)
  console.log(`extraRevenue: ${extraRevenue.toLocaleString()}`)
  console.log(`projectedRevenue = ${(totalActive + recog + extraRevenue).toLocaleString()}원`)
  console.log(`사용자가 본 화면값: 13,630,000원 — 차이 ${(totalActive + recog + extraRevenue - 13630000).toLocaleString()}원`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
