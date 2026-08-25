// 발행 줄이 가리키는 수납이 실제로 있는지 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가 (2026-08-25 신고). 발행 줄은 (계약·수납일·수단)으로 찾는다. 그 축이 움직이거나
// 수납이 지워지면 옛 줄은 **아무도 안 가리키는 채 남고 합계에 계속 든다.** 실제로 408호에
// 수납이 없는 8/22 줄이 하나 생겨 8월 합계를 764만에서 811만으로 부풀렸다.
//
// 두 방향.
//   (가) 발행 줄에 대응하는 살아 있는 수납이 없다 — 유령 줄.
//   (나) 발행 표시가 켜진 수납인데 발행 줄이 없다 — 합계에서 통째로 빠진다.
//
// 삭제 표시된 발행 줄은 대상이 아니다. 다만 **집계가 그것을 세면 안 된다** — CashReceipt 는
// 소프트삭제 익스텐션 대상이 아니라(lib/prisma) 조회마다 손으로 걸러야 한다. 그 규율이
// 무너지면 (다)로 잡는다.
//
// 실행: node --env-file=.env.local scripts/check-cash-receipt-orphan.mjs
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const violations = []
const ymd = d => d.toISOString().slice(0, 10)

const receipts = await prisma.cashReceipt.findMany({
  where: { deletedAt: null },
  select: { id: true, leaseTermId: true, payDate: true, payMethod: true, amount: true, issuedAt: true },
})
const stamped = await prisma.paymentRecord.findMany({
  where: { cashReceiptIssuedAt: { not: null } },
  select: { leaseTermId: true, payDate: true, payMethod: true, actualAmount: true },
})
const key = r => `${r.leaseTermId}|${ymd(r.payDate)}|${r.payMethod ?? ''}`
const stampedKeys = new Set(stamped.map(key))
const receiptKeys = new Set(receipts.map(key))

// (가) 유령 줄
for (const r of receipts) {
  if (!stampedKeys.has(key(r))) {
    violations.push(`[발행 줄] 유령 — ${r.amount.toLocaleString()}원 (수납일 ${ymd(r.payDate)} · 발행 ${ymd(r.issuedAt)})에 대응하는 발행 표시 수납이 없다. 합계에 그대로 든다`)
  }
}
// (나) 빠진 줄
const seen = new Set()
for (const p of stamped) {
  const k = key(p)
  if (seen.has(k)) continue
  seen.add(k)
  if (!receiptKeys.has(k)) {
    violations.push(`[발행 줄] 누락 — 수납(${ymd(p.payDate)} ${p.actualAmount.toLocaleString()}원)에 발행 표시가 켜져 있는데 발행 줄이 없다. 그 금액이 합계에서 통째로 빠진다`)
  }
}
// (다) 집계가 삭제 표시를 거르는가 — 소스 대조
const src = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
const agg = src.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)
if (!agg) violations.push('[발행 줄] getMonthPaymentAggregates 를 못 찾았다 — 대조가 건너뛰어졌다. 감지망을 고칠 것')
else if (!/prisma\.cashReceipt\.findMany\(\{[\s\S]{0,400}?deletedAt: null/.test(agg[0])) {
  violations.push('[발행 줄] 집계가 삭제 표시된 발행 줄을 안 거른다 — CashReceipt 는 소프트삭제 익스텐션 대상이 아니라 손으로 걸러야 한다. 껐다 켠 건이 두 번 세어진다')
}

console.log(`[발행 줄] 발행 ${receipts.length}건 · 발행 표시 수납 ${stamped.length}건 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations.slice(0, 20)) console.error(`  - ${v}`)
  if (violations.length > 20) console.error(`  ... 외 ${violations.length - 20}건`)
}
await prisma.$disconnect()
process.exit(violations.length > 0 ? 1 : 0)
