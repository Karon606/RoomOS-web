// 파트쿨리나 422호 moveOutDate 정리 — CHECKED_OUT인데 null이라 연결산 미수가 매달 허수로 쌓임.
// 근거: 상태 로그 ACTIVE→CHECKED_OUT 2026-05-26. 원복: moveOutDate를 null로 되돌리면 됨.
// (운영자 승인 2026-07-20, 단기 연장 선행 데이터 정리)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
const r = await p.leaseTerm.updateMany({
  where: { status: 'CHECKED_OUT', moveOutDate: null, isShortTerm: true, tenant: { name: { contains: '파트쿨리나' } } },
  data: { moveOutDate: new Date('2026-05-26') },
})
console.log('updated:', r.count)
const check = await p.leaseTerm.findFirst({ where: { tenant: { name: { contains: '파트쿨리나' } } }, select: { status: true, moveOutDate: true } })
console.log('after:', JSON.stringify(check))
await p.$disconnect()
