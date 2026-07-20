// 조원섭 508호 일할 정산 해제 — 6/20 퇴실(=납부일)인데 일할 8,333@2026-06이 잔존,
// isCheckoutNoBillingMonthFor 도입(b22f3f4)으로 결산에 미수 8,333이 소급되던 것을
// 운영자 결정(2026-07-20, 6월분 미수취·그냥 보냄)대로 해제해 종전 표시(청구 0)를 유지한다.
// 원복: checkoutProratedAmount=8333, checkoutProratedMonth='2026-06' 재설정.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
const r = await p.leaseTerm.updateMany({
  where: { status: 'CHECKED_OUT', checkoutProratedMonth: '2026-06', checkoutProratedAmount: 8333, tenant: { name: { contains: '조원섭' } } },
  data: { checkoutProratedAmount: null, checkoutProratedMonth: null },
})
console.log('updated:', r.count)
const check = await p.leaseTerm.findFirst({ where: { tenant: { name: { contains: '조원섭' } } }, select: { checkoutProratedAmount: true, checkoutProratedMonth: true, status: true } })
console.log('after:', JSON.stringify(check))
await p.$disconnect()
