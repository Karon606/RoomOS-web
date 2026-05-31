import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true, acquisitionDate: true, prevOwnerCutoffDate: true } })
  if (!property) return
  const cutoffDate = property.prevOwnerCutoffDate ?? property.acquisitionDate

  // === 결산보고서의 "실제 매출" (revenueByMonth) 재현 ===
  // payments — targetMonth 기준, isPrevOwner 제외
  const payments = await prisma.paymentRecord.findMany({
    where: {
      propertyId: property.id,
      isDeposit: false,
      targetMonth: '2026-05',
    },
    select: { targetMonth: true, actualAmount: true, leaseTermId: true, payDate: true, isPrevOwner: true },
  })

  const allLeases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id },
    select: { id: true, rentAmount: true, status: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  const rentMap = new Map(allLeases.map(l => [l.id, l.rentAmount]))

  const receivedByLease: Record<string, number> = {}
  for (const p of payments) {
    if (p.isPrevOwner) continue
    if (cutoffDate && new Date(p.payDate) < cutoffDate) continue
    receivedByLease[p.leaseTermId] = (receivedByLease[p.leaseTermId] ?? 0) + p.actualAmount
  }
  let revenueActual = 0
  console.log('=== 결산보고서 "5월 실제 매출" (revenueByMonth) 내역 ===')
  for (const [leaseId, received] of Object.entries(receivedByLease)) {
    const rent = rentMap.get(leaseId) ?? 0
    const recognized = Math.min(received, rent)
    const lease = allLeases.find(l => l.id === leaseId)!
    console.log(`  ${lease.room?.roomNo}호 ${lease.tenant.name} [${lease.status}]: received=${received} rent=${rent} → 인식=${recognized}`)
    revenueActual += recognized
  }
  console.log(`\n→ 결산보고서 totalRevenue (5월): ${revenueActual.toLocaleString()}원`)
  console.log(`(dashboard projectedRevenue: 15,593,000원과 비교 — dashboard 는 발생주의 청구액, 결산은 실수납액이라 다른 값)`)

  // === 결산보고서의 "예상 매출" (expectedRevenue) 재현 ===
  // 호실 단위 발생주의
  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id },
    include: { leaseTerms: { select: { id: true, status: true, rentAmount: true, moveInDate: true, expectedMoveOut: true, moveOutDate: true, tenant: { select: { name: true } } } } },
  })
  const monthStart = new Date(2026, 4, 1)
  const monthEnd = new Date(2026, 4, 31, 23, 59, 59, 999)
  let expectedRev = 0
  console.log('\n=== 결산보고서 "5월 예상 매출" (호실 단위) 내역 ===')
  for (const r of rooms) {
    const rent = r.baseRent
    const occ = r.leaseTerms.find(l => {
      const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
      const moveOut = l.expectedMoveOut ? new Date(l.expectedMoveOut) : (l.moveOutDate ? new Date(l.moveOutDate) : null)
      if (moveIn && moveIn > monthEnd) return false
      if (moveOut && moveOut < monthStart) return false
      return true
    })
    if (occ) {
      console.log(`  ${r.roomNo}호 ${occ.tenant.name} [${occ.status}]: rent=${rent} 호실기준 (lease.rent=${occ.rentAmount})`)
      expectedRev += rent
    }
  }
  console.log(`\n→ 결산보고서 expectedRevenue (5월): ${expectedRev.toLocaleString()}원`)
  console.log(`(dashboard 와 차이: dashboard 는 lease.rentAmount 기반, 결산은 room.baseRent 기반)`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
