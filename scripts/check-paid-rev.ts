import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TARGET_MONTH = '2026-05'

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return

  // 시스템 현재 paidRevenue 재현: ACTIVE/CHECKOUT_PENDING/NON_RESIDENT 만
  const activeLeases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: { id: true, rentAmount: true },
  })
  const activeIds = new Set(activeLeases.map(l => l.id))
  const rentMap = new Map(activeLeases.map(l => [l.id, l.rentAmount]))

  const payments = await prisma.paymentRecord.findMany({
    where: { propertyId: property.id, targetMonth: TARGET_MONTH, isDeposit: false, isPrevOwner: false },
    select: { leaseTermId: true, actualAmount: true },
  })

  const paidByLease: Record<string, number> = {}
  for (const p of payments) {
    if (!activeIds.has(p.leaseTermId)) continue
    paidByLease[p.leaseTermId] = (paidByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }
  const paidRevenue = Object.entries(paidByLease).reduce((s, [id, paid]) => {
    const rent = rentMap.get(id) ?? 0
    return s + Math.min(paid, rent)
  }, 0)

  const incomes = await prisma.extraIncome.aggregate({
    where: { propertyId: property.id, date: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) } },
    _sum: { amount: true },
  })
  const extraRevenue = incomes._sum.amount ?? 0

  // 정정값 — CHECKED_OUT 의 5월 귀속도 포함
  const checkedOutLeases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: 'CHECKED_OUT', rentAmount: { gt: 0 } },
    select: { id: true, rentAmount: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  const checkedOutRentMap = new Map(checkedOutLeases.map(l => [l.id, l.rentAmount]))
  const checkedOutPaidByLease: Record<string, number> = {}
  for (const p of payments) {
    if (!checkedOutRentMap.has(p.leaseTermId)) continue
    checkedOutPaidByLease[p.leaseTermId] = (checkedOutPaidByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }
  let checkedOutPaid = 0
  console.log('CHECKED_OUT lease 의 5월 귀속 입금 (현재 totalRevenue 에서 누락):')
  for (const [id, paid] of Object.entries(checkedOutPaidByLease)) {
    const rent = checkedOutRentMap.get(id) ?? 0
    const recognized = Math.min(paid, rent)
    const lease = checkedOutLeases.find(l => l.id === id)!
    console.log(`  ${lease.room?.roomNo}호 ${lease.tenant.name}: paid=${paid.toLocaleString()} rent=${rent.toLocaleString()} → 인식=${recognized.toLocaleString()}원`)
    checkedOutPaid += recognized
  }
  console.log(`  → 추가 합계: ${checkedOutPaid.toLocaleString()}원`)

  console.log(`\n[현재 시스템 표시]`)
  console.log(`  paidRevenue (ACTIVE 만):   ${paidRevenue.toLocaleString()}원`)
  console.log(`  extraRevenue:              ${extraRevenue.toLocaleString()}원`)
  console.log(`  totalRevenue (현재 매출):  ${(paidRevenue + extraRevenue).toLocaleString()}원`)

  console.log(`\n[정정 후]`)
  console.log(`  paidRevenue + checkedOut:  ${(paidRevenue + checkedOutPaid).toLocaleString()}원`)
  console.log(`  + extraRevenue:            ${(paidRevenue + checkedOutPaid + extraRevenue).toLocaleString()}원`)
  console.log(`  차이: +${checkedOutPaid.toLocaleString()}원`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
