// 퇴실 미반환분 분류 감사(읽기 전용) — 보증금 안의 청소비 몫이 '보증금 몰취'로 잡혀 있는 건을 찾는다.
// 사용: node --env-file=.env.local scripts/check-withhold-classification.mjs
//
// 운영자 정본(2026-08-11):
//   "보증금 5만원에 이미 청소비 2만원이 포함되어 있었고 난 3만원을 돌려준 거야. 즉 정상적인 청소비를
//    받은 거야. 보증금 몰취는 시설물이 파손되거나 했을 때 (잔여) 3만원에서 차감할 때 몰취가 되는 거지."
//
// 생성 경로는 이미 성격대로 가른다(recordDepositReturn 의 splitWithheldDeposit, 소스 가드는
// verify-money-consistency 6-2). 여기는 **과거분 존량**을 본다.
//
// 왜 verify:db(차단)가 아니라 verify:data(비차단)인가. 과거 건의 재분류는 "그 미반환에 파손 차감이
// 섞이지 않았다"는 운영자 확인이 있어야 확정된다. 개발자가 푸시 시점에 채울 수 없는 값이라
// 게이트로 두면 확인될 때까지 모든 배포가 막히는 영구 실패 게이트가 된다(G-4 2026-08-03 판례).
// 대신 조용히 넘어가지 않고 매번 보여 준다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const DEPOSIT_SOURCED_PAY_METHOD = '보유 보증금'
const CLEANING_CATEGORY = '청소비'
// '입실 때 별도로 받은 청소비' 만 — NOT 만 쓰면 payMethod NULL 행이 떨어진다(SQL 3치 논리).
const CLEANING_RECEIVED_WHERE = {
  category: CLEANING_CATEGORY,
  OR: [{ payMethod: null }, { payMethod: { not: DEPOSIT_SOURCED_PAY_METHOD } }],
}

async function main() {
  const refunds = await prisma.depositRefund.findMany({
    orderBy: { date: 'asc' },
    select: {
      leaseTermId: true, withheldAmount: true, date: true, reason: true,
      leaseTerm: { select: { cleaningFee: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } } },
    },
  })

  const hits = []
  for (const r of refunds) {
    if (r.withheldAmount <= 0) continue
    const rows = await prisma.extraIncome.findMany({
      where: { leaseTermId: r.leaseTermId, payMethod: DEPOSIT_SOURCED_PAY_METHOD, deletedAt: null },
      select: { id: true, category: true, amount: true },
    })
    if (rows.length === 0) continue
    // 입실 때 따로 받았으면 퇴실 공제는 0 이다(계약서 §2-4 either/or) — 코드와 같은 판정.
    const received = await prisma.extraIncome.aggregate({
      where: { leaseTermId: r.leaseTermId, ...CLEANING_RECEIVED_WHERE }, _sum: { amount: true },
    })
    const cleaningPortion = (received._sum.amount ?? 0) > 0 ? 0 : (r.leaseTerm?.cleaningFee ?? 0)
    const expected = Math.min(r.withheldAmount, cleaningPortion)
    const got = rows.filter(x => x.category === CLEANING_CATEGORY).reduce((s, x) => s + x.amount, 0)
    if (got === expected) continue
    hits.push({
      who: `${r.leaseTerm?.room?.roomNo ?? '-'}호 ${r.leaseTerm?.tenant?.name ?? '?'}`,
      date: r.date.toISOString().slice(0, 10),
      withheld: r.withheldAmount, expected, got, reason: r.reason,
      rows: rows.filter(x => x.category !== CLEANING_CATEGORY),
    })
  }

  if (hits.length === 0) {
    console.log('[미반환분 분류] 위반 0건 — 보증금 청소비 몫이 몰취로 잡힌 건 없음.')
    await prisma.$disconnect()
    return
  }

  console.log(`[미반환분 분류] ${hits.length}건 — 보증금 안의 청소비 몫이 '보증금 몰취'로 잡혀 있습니다\n`)
  for (const h of hits) {
    console.log(`  ${h.date}  ${h.who}  미반환 ${h.withheld.toLocaleString()}원 (사유 ${h.reason ?? '없음'})`)
    console.log(`    청소비여야 할 몫 ${h.expected.toLocaleString()}원 / 현재 '청소비' ${h.got.toLocaleString()}원`)
    for (const x of h.rows) console.log(`    현재 '${x.category}' ${x.amount.toLocaleString()}원  id=${x.id}`)
  }
  console.log('\n각 건은 그 미반환에 파손 등 차감이 섞이지 않았는지 확인한 뒤 재분류할 것.')
  console.log('섞였다면 청소비 몫만 청소비로 두고 나머지는 몰취로 나눠 기록한다.')
  await prisma.$disconnect()
  process.exitCode = 1
}
void main()
