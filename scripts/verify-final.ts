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
    select: { rentAmount: true, discounts: true },
  })
  const totalActive = active.reduce((s, l) => s + discountedRent(l.discounts, TARGET_MONTH, l.rentAmount), 0)

  // 새 정책: CHECKED_OUT 의 5월 귀속 paymentRecord 합계
  const agg = await prisma.paymentRecord.aggregate({
    where: { propertyId: property.id, targetMonth: TARGET_MONTH, isDeposit: false, isPrevOwner: false, leaseTerm: { status: 'CHECKED_OUT' } },
    _sum: { actualAmount: true },
  })
  const recog = agg._sum.actualAmount ?? 0

  // 5월 ExtraIncome
  const extraIncome = await prisma.extraIncome.aggregate({
    where: { propertyId: property.id, date: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) } },
    _sum: { amount: true },
  })

  const newExpected = totalActive + recog
  const newProjected = newExpected + (extraIncome._sum.amount ?? 0)

  console.log(`ACTIVE billable totalExpected:           ${totalActive.toLocaleString()}원`)
  console.log(`CHECKED_OUT 5월 귀속 paymentRecord 합계:  ${recog.toLocaleString()}원`)
  console.log(`──────────────────────────────────────────`)
  console.log(`새 totalExpected:                        ${newExpected.toLocaleString()}원`)
  console.log(`+ ExtraIncome:                           ${(extraIncome._sum.amount ?? 0).toLocaleString()}원`)
  console.log(`= projectedRevenue (시스템 5월 예상 매출): ${newProjected.toLocaleString()}원`)
  console.log()
  console.log(`사용자 손계산: 15,222,500원 (단기 262,500 포함, 정종학 0원으로 봄)`)
  console.log(`차이: ${(newProjected - 15222500).toLocaleString()}원 — 사용자 표에 누락된 항목`)

  // CHECKED_OUT 5월 귀속 paymentRecord 상세
  console.log(`\n[디테일] CHECKED_OUT lease 5월 귀속 paymentRecord:`)
  const detail = await prisma.paymentRecord.findMany({
    where: { propertyId: property.id, targetMonth: TARGET_MONTH, isDeposit: false, isPrevOwner: false, leaseTerm: { status: 'CHECKED_OUT' } },
    include: { leaseTerm: { include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  })
  for (const p of detail) {
    console.log(`  ${p.leaseTerm.room?.roomNo}호 ${p.leaseTerm.tenant.name}: ${p.actualAmount.toLocaleString()}원 (payDate=${p.payDate.toISOString().slice(0,10)})`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
