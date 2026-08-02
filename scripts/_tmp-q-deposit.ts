// 계약 보증금 0 분포 조사(읽기 전용, 일회성)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const props = await prisma.property.findMany({ select: { id: true, name: true, acquisitionDate: true, prevOwnerCutoffDate: true, defaultDeposit: true, reservationDepositMode: true } })
  console.log('=== Property ===')
  for (const p of props) console.log(JSON.stringify(p))

  const leases = await prisma.leaseTerm.findMany({
    where: {},
    select: {
      id: true, status: true, depositAmount: true, isShortTerm: true, createdAt: true,
      moveInDate: true, reservationDepositMode: true, propertyId: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
    },
  })
  const alive = leases
  console.log(`\n총 계약(soft-delete 제외) ${leases.length}건, 입주자 살아있는 것 ${alive.length}건`)

  const zero = alive.filter(l => l.depositAmount === 0)
  console.log(`depositAmount=0 : ${zero.length}건 / 비0 : ${alive.length - zero.length}건`)

  const by = (arr: typeof alive, k: (l: (typeof alive)[number]) => string) => {
    const m: Record<string, number> = {}
    for (const l of arr) m[k(l)] = (m[k(l)] ?? 0) + 1
    return m
  }
  console.log('\n=== 0건 status 분포 ===');   console.log(by(zero, l => l.status))
  console.log('=== 전체 status 분포 ===');    console.log(by(alive, l => l.status))
  console.log('\n=== 0건 isShortTerm 분포 ==='); console.log(by(zero, l => String(l.isShortTerm)))
  console.log('=== 0건 createdAt 월 분포 ==='); console.log(by(zero, l => l.createdAt.toISOString().slice(0, 7)))
  console.log('=== 전체 createdAt 월 분포 ==='); console.log(by(alive, l => l.createdAt.toISOString().slice(0, 7)))
  console.log('=== 0건 createdAt 일 분포(상위) ===')
  const d = by(zero, l => l.createdAt.toISOString().slice(0, 10))
  console.log(Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 15))

  // 보증금 실수납 record 있는 계약
  const depSums = await prisma.paymentRecord.groupBy({
    by: ['leaseTermId'],
    where: { isDeposit: true, deletedAt: null },
    _sum: { actualAmount: true },
    _count: true,
  })
  const paidMap = new Map(depSums.map(s => [s.leaseTermId, s._sum.actualAmount ?? 0]))

  const contradict = zero.filter(l => (paidMap.get(l.id) ?? 0) > 0)
  console.log(`\n=== 모순: 계약 0 인데 보증금 실수납 있음 : ${contradict.length}건 ===`)
  for (const l of contradict) {
    console.log(`${l.room?.roomNo ?? '-'} ${l.tenant?.name} status=${l.status} short=${l.isShortTerm} resvMode=${l.reservationDepositMode} 실수납=${paidMap.get(l.id)} createdAt=${l.createdAt.toISOString().slice(0, 10)} moveIn=${l.moveInDate?.toISOString().slice(0, 10) ?? '-'}`)
  }

  // 역모순: 계약 >0 인데 실수납 없음 (인수 승계 후보)
  const nonZero = alive.filter(l => l.depositAmount > 0)
  const noIn = nonZero.filter(l => (paidMap.get(l.id) ?? 0) === 0)
  console.log(`\n=== 계약>0 인데 실수납 record 없음 : ${noIn.length}건 (status 분포) ===`)
  console.log(by(noIn, l => l.status))

  // 0 계약 중 거주 상태만
  const zeroLiving = zero.filter(l => ['ACTIVE', 'CHECKOUT_PENDING'].includes(l.status))
  console.log(`\n=== 0건 중 ACTIVE/CHECKOUT_PENDING : ${zeroLiving.length}건 ===`)
  for (const l of zeroLiving) {
    console.log(`${l.room?.roomNo ?? '-'} ${l.tenant?.name} short=${l.isShortTerm} 실수납=${paidMap.get(l.id) ?? 0} createdAt=${l.createdAt.toISOString().slice(0, 10)} moveIn=${l.moveInDate?.toISOString().slice(0, 10) ?? '-'}`)
  }

  await prisma.$disconnect()
}
main()
