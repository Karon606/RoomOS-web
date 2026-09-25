// 한 주문이 두 카드로 갈렸는지 보는 감지망(verify:db). 읽기 전용, 위반 시 exit 1.
// 실행: node --env-file=.env.local scripts/check-order-card-split.mjs
//
// 왜 필요한가. 다품목 지출은 한 번 입력으로 여러 행이 **같은 카드**로 생긴다. 그런데 나중에
// 그중 하나만 고치면 그 주문이 두 카드로 갈린다. 어느 수정 경로도 형제를 따라 고치지 않는다
// (updateExpense·batchUpdateExpenses 둘 다 orderId 를 안 본다 — 2026-09-25 확인).
//
// 실제로 났다. 쿠팡 한 주문 5건 중 4건만 다른 카드로 옮겨진 채 한 달을 지났고, 카드 정산의
// 청구 합계가 두 카드로 쪼개져 있었는데 아무 화면도 말하지 않았다. 지출 수정 폼에 경고를
// 세웠지만(FinanceClient), 그것은 **고칠 때만** 뜬다. 이미 갈린 것은 여기가 잡는다.
//
// **배송비 행은 뺀다.** 착불 배송비는 택배 기사에게 따로 낸 돈이라 대표와 다른 것이 정상이다
// (2026-09-25 확인 — 어긋난 배송비 2건이 둘 다 내역에 '(착불)' 이라 적혀 있었다).
//
// 일부러 나눠 결제한 주문이 생기면 이 그물이 걸린다. 그때는 사실을 확인하고 규칙을 고친다 —
// 조용히 통과시키지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const rows = await prisma.expense.findMany({
  where: { orderId: { not: null }, isShipping: false },
  select: { id: true, date: true, amount: true, orderId: true, payMethod: true, financeName: true,
            financialAccountId: true, vendor: true, detail: true },
  orderBy: { date: 'asc' },
})

const byOrder = new Map()
for (const r of rows) {
  const a = byOrder.get(r.orderId) ?? []
  a.push(r); byOrder.set(r.orderId, a)
}

const split = []
for (const [oid, ms] of byOrder) {
  const keys = new Set(ms.map(m => `${m.payMethod ?? '-'}|${m.financialAccountId ?? '-'}`))
  if (keys.size > 1) split.push([oid, ms])
}

if (split.length) {
  console.error(`[주문 결제수단 갈림] 위반 ${split.length}건`)
  for (const [oid, ms] of split) {
    console.error(`  주문 ${oid.slice(0, 8)} · ${ms[0].date.toISOString().slice(0, 10)}`)
    for (const m of ms) {
      console.error(`    ${String(m.amount).padStart(8)}원  ${m.payMethod ?? '-'} / ${m.financeName ?? '-'}  ${[m.vendor, m.detail].filter(Boolean).join(' ').slice(0, 40)}`)
    }
  }
  console.error('  일부러 나눠 결제한 주문이면 알려 주세요 — 규칙을 고칩니다. 조용히 통과시키지 않습니다.')
  await prisma.$disconnect()
  process.exit(1)
}
console.log(`[주문 결제수단 갈림] 위반 0건 (주문 ${byOrder.size}개 · 본품 ${rows.length}건, 배송비는 착불 때문에 제외)`)
await prisma.$disconnect()
