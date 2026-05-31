import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TARGET_MONTH = '2026-05'

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return

  // 1) 모든 active lease + 5월 청구액 dump (정렬: 청구액 큰 순)
  const active = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
    select: {
      id: true, status: true, rentAmount: true, discounts: true, updatedAt: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  console.log(`\n=== 최근 변경된 lease (updatedAt 내림차순) ===`)
  for (const l of active.slice(0, 10)) {
    const amt = discountedRent(l.discounts, TARGET_MONTH, l.rentAmount)
    console.log(`  ${l.room?.roomNo}호 ${l.tenant.name.padEnd(10, ' ')} status=${l.status.padEnd(18, ' ')} rent=${l.rentAmount} → 청구=${amt} | updated=${l.updatedAt.toISOString()}`)
  }

  // 2) discount 적용된 lease — 청구액 < rentAmount
  console.log(`\n=== 할인 적용된 lease (이 달 청구액 < rentAmount) ===`)
  for (const l of active) {
    const amt = discountedRent(l.discounts, TARGET_MONTH, l.rentAmount)
    if (amt < l.rentAmount) {
      const dInfo = l.discounts.map(d => `${d.discountType}=${d.value} ${d.scope} ${d.startMonth ?? '?'}~${d.endMonth ?? '?'}`).join(', ')
      console.log(`  ${l.room?.roomNo}호 ${l.tenant.name}: ${l.rentAmount} → ${amt} (할인 ${l.rentAmount - amt}) | ${dInfo}`)
    }
  }

  // 3) discount 자체가 오늘 추가된 게 있는지
  const recentDiscounts = await prisma.rentDiscount.findMany({
    where: {
      leaseTerm: { propertyId: property.id },
      createdAt: { gte: new Date(Date.now() - 24*3600*1000) },
    },
    include: { leaseTerm: { include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  })
  console.log(`\n=== 최근 24시간 내 추가/변경된 할인 (${recentDiscounts.length}건) ===`)
  for (const d of recentDiscounts) {
    console.log(`  ${d.leaseTerm.room?.roomNo}호 ${d.leaseTerm.tenant.name}: ${d.discountType}=${d.value} scope=${d.scope} ${d.startMonth ?? '?'}~${d.endMonth ?? '?'} | created=${d.createdAt.toISOString()}`)
  }

  // 4) ExtraIncome 음수 또는 큰 record?
  const extras = await prisma.extraIncome.findMany({
    where: { propertyId: property.id, date: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) } },
    orderBy: { date: 'asc' },
  })
  console.log(`\n=== 5월 ExtraIncome 전체 (${extras.length}건) ===`)
  for (const e of extras) {
    console.log(`  ${e.date.toISOString().slice(0,10)}: ${e.amount.toLocaleString()}원 | ${e.category} | ${e.detail ?? ''}`)
  }

  // 5) 전체 합계 재계산
  const totalActive = active.reduce((s, l) => s + discountedRent(l.discounts, TARGET_MONTH, l.rentAmount), 0)
  const agg = await prisma.paymentRecord.aggregate({
    where: { propertyId: property.id, targetMonth: TARGET_MONTH, isDeposit: false, isPrevOwner: false, leaseTerm: { status: 'CHECKED_OUT' } },
    _sum: { actualAmount: true },
  })
  const checkedOutRev = agg._sum.actualAmount ?? 0
  const extraTotal = extras.reduce((s, e) => s + e.amount, 0)
  console.log(`\n=== 합계 ===`)
  console.log(`  billable active: ${totalActive.toLocaleString()}`)
  console.log(`  + CHECKED_OUT recognized: ${checkedOutRev.toLocaleString()}`)
  console.log(`  + extraIncome: ${extraTotal.toLocaleString()}`)
  console.log(`  projectedRevenue = ${(totalActive + checkedOutRev + extraTotal).toLocaleString()}원`)
  console.log(`  화면 표시: 13,630,000원`)
  console.log(`  차이: ${(totalActive + checkedOutRev + extraTotal - 13630000).toLocaleString()}원`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
