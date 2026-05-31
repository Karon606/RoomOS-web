// 517호 최명윤 + 508호 조원섭 케이스 검증 — 5월 매출 인식 여부
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const targets = ['517', '508']
  for (const roomNo of targets) {
    const room = await prisma.room.findFirst({
      where: { roomNo },
      include: {
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT'] } },
          include: {
            tenant: { select: { name: true } },
            discounts: true,
            paymentRecords: {
              where: { OR: [{ targetMonth: '2026-05' }, { targetMonth: '2026-06' }] },
              orderBy: [{ payDate: 'asc' }, { seqNo: 'asc' }],
              select: { id: true, targetMonth: true, payDate: true, expectedAmount: true, actualAmount: true, isPaid: true, payMethod: true, memo: true, seqNo: true, isDeposit: true, isPrevOwner: true },
            },
          },
        },
      },
    })
    if (!room) { console.log(`${roomNo}호: 없음\n`); continue }
    console.log(`=== ${roomNo}호 ===`)
    for (const lease of room.leaseTerms) {
      console.log(`  입주자: ${lease.tenant.name}`)
      console.log(`  status: ${lease.status}, rentAmount: ${lease.rentAmount}, dueDay: ${lease.dueDay}`)
      console.log(`  overrideDueDay: ${lease.overrideDueDay ?? '-'}, month: ${lease.overrideDueDayMonth ?? '-'}, reason: ${lease.overrideDueDayReason ?? '-'}`)
      console.log(`  PaymentRecords (5월/6월 귀속):`)
      for (const p of lease.paymentRecords) {
        console.log(`    [${p.targetMonth} 귀속] ${p.payDate.toISOString().slice(0,10)} | ${p.actualAmount}/${p.expectedAmount}원 | isPaid=${p.isPaid} | ${p.payMethod ?? '-'} | memo='${p.memo ?? ''}' | seq=${p.seqNo}${p.isDeposit ? ' [보증금]' : ''}${p.isPrevOwner ? ' [양도인]' : ''}`)
      }
      const sum5 = lease.paymentRecords.filter(p => p.targetMonth === '2026-05' && !p.isDeposit).reduce((s, p) => s + p.actualAmount, 0)
      const sum6 = lease.paymentRecords.filter(p => p.targetMonth === '2026-06' && !p.isDeposit).reduce((s, p) => s + p.actualAmount, 0)
      console.log(`  → 5월 귀속 합계: ${sum5}원 / 6월 귀속 합계: ${sum6}원`)
    }
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
