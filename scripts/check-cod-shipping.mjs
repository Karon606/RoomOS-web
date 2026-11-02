// 착불 배송비 장부 그물(verify:db). 읽기 전용, 경고만 한다(exit 0). 실행: node --env-file=.env.local scripts/check-cod-shipping.mjs
//
// 왜(신고 6ab4f868·a016642e, 2026-11-02). 배송비 줄은 본품 결제수단을 복사해 태어났다. 그래서 착불 5건이 모두 본품 신용카드·미정산으로
// 생겼고 운영자가 4건을 손으로 계좌이체로 고쳤다. 이제 배송비 줄은 자기 수단으로 태어난다(기본 계좌이체). 고친 뒤에도 새로 생기는지,
// 착불인데 배송비를 아직 안 적은 주문(미기록)이 쌓이는지 본다.
//
// 경고 둘. 둘 다 사실 확인 대상이지 오류가 아니다(본품과 같은 카드로 착불을 낸 경우도 있다). 그래서 실패로 멈추지 않는다.
//   ① 착불 주문인데 배송비 줄이 본품과 같은 신용카드(같은 계정)다. 복사로 태어났을 수 있다. 지출 상세 [수정] 에서 수단을 확인한다.
//   ② 착불 주문인데 배송비 줄이 없다(미기록). 받을 때 비워 둔 것이다. 지출 상세에서 금액을 적거나 '배송비 없었음' 으로 닫는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const orders = await prisma.expenseOrder.findMany({
  where: { shippingType: '착불' },
  select: {
    id: true, code: true, propertyId: true,
    expenses: { select: { id: true, isShipping: true, payMethod: true, financialAccountId: true, financeName: true, amount: true, date: true, settleStatus: true } },
  },
})

const sameCard = []
const unrecorded = []
for (const o of orders) {
  const heads = o.expenses.filter(e => !e.isShipping)
  const ships = o.expenses.filter(e => e.isShipping)
  if (!heads.length) continue
  if (!ships.length) { unrecorded.push({ o, heads }); continue }
  for (const s of ships) {
    if (s.payMethod !== '신용카드') continue
    if (heads.some(h => h.payMethod === '신용카드' && (h.financialAccountId ?? '') === (s.financialAccountId ?? ''))) sameCard.push({ o, s })
  }
}

const day = d => d.toISOString().slice(0, 10)
if (sameCard.length) {
  console.warn(`[착불 배송비] 주의 ① 본품과 같은 신용카드인 착불 배송비 ${sameCard.length}건(복사로 태어났을 수 있다)`)
  for (const { o, s } of sameCard) console.warn(`  주문 ${o.code} · ${day(s.date)} · ${s.amount}원 · ${s.financeName ?? s.payMethod} · ${s.settleStatus}`)
  console.warn('  실제로 그 카드로 냈으면 그대로 두면 됩니다. 아니면 지출 상세 [수정] 에서 배송비 결제수단을 고쳐 주세요.')
}
if (unrecorded.length) {
  console.warn(`[착불 배송비] 주의 ② 배송비 미기록 착불 주문 ${unrecorded.length}건`)
  for (const { o, heads } of unrecorded) console.warn(`  주문 ${o.code} · ${day(heads[0].date)} · 본품 ${heads.length}건`)
  console.warn("  지출 상세 [수정] 의 주문 묶음에서 배송비를 적거나, 없었으면 '배송비 없었음' 으로 닫아 주세요.")
}
console.log(`[착불 배송비] 착불 주문 ${orders.length}개 · 같은 카드 주의 ${sameCard.length}건 · 미기록 ${unrecorded.length}건 (경고만, 실패 아님)`)
await prisma.$disconnect()
