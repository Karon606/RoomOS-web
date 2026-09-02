// 퇴실 처리 한 건의 정산 흔적을 읽기 전용으로 펼친다(계약·상태 이력·보증금 반환·수납·부수입).
// 사용: node --env-file=.env.local scripts/inspect-checkout-case.mjs <입주자 이름> [호실번호]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const [, , name, roomNo] = process.argv
if (!name) { console.error('이름 필요'); process.exit(1) }

const tenants = await prisma.tenant.findMany({
  where: { name: { contains: name } },
  select: { id: true, name: true, leaseTerms: { select: { id: true, status: true, moveInDate: true, moveOutDate: true, expectedMoveOut: true, rentAmount: true, depositAmount: true, cleaningFee: true, isShortTerm: true, shortStayExtensions: true, paymentTiming: true, dueDay: true, autoCheckoutAt: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true, createdAt: true, updatedAt: true, room: { select: { roomNo: true } } } } },
})
for (const t of tenants) {
  for (const l of t.leaseTerms) {
    if (roomNo && l.room?.roomNo !== roomNo) continue
    console.log('=== 입주자', t.name, t.id.slice(0, 8), '/ 계약', l.id.slice(0, 8), '호실', l.room?.roomNo)
    console.log(JSON.stringify({ ...l, room: undefined }, null, 1))
    const logs = await prisma.tenantStatusLog.findMany({ where: { leaseTermId: l.id }, orderBy: { changedAt: 'asc' } })
    console.log('--- 상태 이력', logs.length)
    for (const g of logs) console.log(' ', g.changedAt.toISOString(), g.fromStatus, '->', g.toStatus, '| reason:', g.reason, '| memo:', g.memo, '| deleted:', g.deletedAt ? g.deletedAt.toISOString() : null)
    const refunds = await prisma.depositRefund.findMany({ where: { leaseTermId: l.id }, orderBy: { createdAt: 'asc' } })
    console.log('--- 보증금 반환', refunds.length)
    for (const r of refunds) console.log(' ', r.date.toISOString().slice(0, 10), 'returned', r.returnedAmount, 'withheld', r.withheldAmount, '| reason:', r.reason, '| memo:', r.memo, '| createdAt', r.createdAt.toISOString())
    const pays = await prisma.paymentRecord.findMany({ where: { leaseTermId: l.id }, orderBy: [{ targetMonth: 'asc' }, { seqNo: 'asc' }] })
    console.log('--- 수납', pays.length)
    for (const p of pays) console.log(' ', p.targetMonth, 'seq', p.seqNo, 'exp', p.expectedAmount, 'act', p.actualAmount, 'carry', p.carryOver, 'paid', p.isPaid, 'dep', p.isDeposit, 'adj', p.isBillingAdjust, 'pay', p.payDate.toISOString().slice(0, 10), '| memo:', p.memo, '| deleted:', p.deletedAt ? p.deletedAt.toISOString() : null, '| created', p.createdAt.toISOString())
    const extras = await prisma.extraIncome.findMany({ where: { OR: [{ leaseTermId: l.id }, { tenantId: t.id }] }, orderBy: { createdAt: 'asc' } }).catch(async () => prisma.extraIncome.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'asc' } }))
    console.log('--- 부수입', extras.length)
    for (const e of extras) console.log(' ', JSON.stringify(e))
  }
}
await prisma.$disconnect()
