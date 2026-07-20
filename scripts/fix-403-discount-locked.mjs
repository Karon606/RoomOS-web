// 403호 김우공 2026-07 할인 미반영 락인 백필 — 근본 수정(할인 변경 시 락인 되쓰기)과 세트(신고 70cde9d6).
// 전수 스캔 결과 이 시그니처는 1건뿐. 원복: expectedAmount를 470000으로 되돌리면 됨.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
const r = await p.paymentRecord.updateMany({
  where: { leaseTermId: '0f0a2c6a-d506-4168-9719-1409424d11ba', targetMonth: '2026-07', isDeposit: false, expectedAmount: 470000, deletedAt: null },
  data: { expectedAmount: 460000 },
})
console.log('updated:', r.count)
const recs = await p.paymentRecord.findMany({ where: { leaseTermId: '0f0a2c6a-d506-4168-9719-1409424d11ba', targetMonth: '2026-07', isDeposit: false, deletedAt: null }, select: { expectedAmount: true, actualAmount: true, isPaid: true } })
console.log('after:', JSON.stringify(recs), '미납:', recs.reduce((s, x) => s + x.expectedAmount, 0) - recs.reduce((s, x) => s + x.actualAmount, 0) >= 0 ? recs[0].expectedAmount - recs.reduce((s, x) => s + x.actualAmount, 0) : 0)
await p.$disconnect()
