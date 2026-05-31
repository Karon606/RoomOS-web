// 5월에 입금됐지만 귀속이 6월(또는 그 이후)인 paymentRecord 조회 — 선납 케이스
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return

  // 5월에 payDate, targetMonth >= '2026-06' (선납)
  const prepay = await prisma.paymentRecord.findMany({
    where: {
      propertyId: property.id,
      isDeposit: false,
      payDate: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) },
      targetMonth: { gte: '2026-06' },
    },
    include: { leaseTerm: { include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
    orderBy: [{ payDate: 'asc' }],
  })
  if (prepay.length === 0) {
    console.log('5월 중 입금된 6월(또는 이후) 귀속 선납 record 없음.')
  } else {
    console.log(`5월 중 입금된 선납 paymentRecord ${prepay.length}건:`)
    for (const p of prepay) {
      console.log(`  ${p.leaseTerm.room?.roomNo}호 ${p.leaseTerm.tenant.name}: payDate=${p.payDate.toISOString().slice(0,10)} amount=${p.actualAmount.toLocaleString()}원 targetMonth=${p.targetMonth}`)
    }
    const total = prepay.reduce((s, p) => s + p.actualAmount, 0)
    console.log(`  합계: ${total.toLocaleString()}원`)
  }

  // 비교: dashboard totalExpected 가 잡는 영역
  console.log('\n[dashboard totalExpected 가 합산하는 항목]')
  console.log('  1) billableLeases.billThisMonth — 5월 청구액 (rentAmount × 할인). 입금 무관.')
  console.log('  2) CHECKED_OUT lease 의 paymentRecord — 조건: targetMonth=2026-05 (5월 귀속만)')
  console.log('  → 6월 귀속 선납은 어느 쪽에도 안 잡힘 ✓')

  // 또한 KPI '당월 매출' 도 발생주의 — 5월 귀속 paymentRecord 만 합산하는지 확인
  // dashboard 에서 paymentByLease 도 targetMonth=2026-05 만 보고 있는지
  const may = await prisma.paymentRecord.aggregate({
    where: { propertyId: property.id, targetMonth: '2026-05', isDeposit: false, isPrevOwner: false },
    _sum: { actualAmount: true },
  })
  console.log(`\n[참고] 5월 귀속 paymentRecord 합계 (= 당월 실수납액): ${(may._sum.actualAmount ?? 0).toLocaleString()}원`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
