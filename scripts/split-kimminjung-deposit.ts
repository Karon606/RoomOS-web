// 520호 김민정 — 8/2 수납 100,000 중 50,000 을 보증금으로 분리 (운영자 지시 2026-08-02).
//
// 왜
//   단기에서 월 전환하며 계약 보증금 50,000 이 잡혔는데 그 돈을 받은 기록이 없었다.
//   운영자 확인 — "5만원 받을 예정이야. 오늘 받은 10만원에서 5만원을 보증금으로 채워도 되고",
//   "7월 이용료 전체 금액으로 보면 이제 47만원 + 5만원 보증금이 되어야 하는거야.
//    7월에 2번 수납했고 오늘 10만원 수납한건 거기서 차감하면 되는거고."
//
// 즉 7월에 받아야 할 총액은 이용료 470,000 + 보증금 50,000 = 520,000 이다.
// 받은 총액 429,000 은 그대로고, 그 안에서 보증금 몫 50,000 을 갈라낸다.
// 부족액은 어느 쪽으로 보든 91,000 으로 같다 — 이 정정은 총액을 바꾸지 않는다.
//
//   현재  이용료 429,000 (부족 41,000) · 보증금 0     (미수납)
//   이후  이용료 379,000 (부족 91,000) · 보증금 50,000 (완납)
//
// 결제일은 8/2 그대로 둔다. 실제로 그날 받은 돈이다(귀속월과 결제일은 별개 축).
//
// 실행:   npx tsx --env-file=.env.local scripts/split-kimminjung-deposit.ts [--apply]
// 되돌리기: --revert
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const SPLIT = 50_000
const MONTH = '2026-07'
const SRC_AMOUNT = 100_000
const SRC_PAYDATE = '2026-08-02'
const DEP_MEMO = '7월 수납분에서 보증금 충당(운영자 지시 2026-08-02)'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const lease = await prisma.leaseTerm.findFirst({
    where: { tenant: { name: '김민정' }, status: 'ACTIVE' },
    select: { id: true, rentAmount: true, depositAmount: true, tenantId: true, propertyId: true, room: { select: { roomNo: true } } },
  })
  if (!lease) { console.log('계약을 찾을 수 없습니다.'); process.exit(1) }

  const show = async (label: string) => {
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, deletedAt: null, isBillingAdjust: false },
      orderBy: [{ targetMonth: 'asc' }, { seqNo: 'asc' }],
      select: { seqNo: true, targetMonth: true, actualAmount: true, payDate: true, isDeposit: true, isPaid: true, memo: true },
    })
    let rent = 0, dep = 0
    for (const r of recs) { if (r.isDeposit) dep += r.actualAmount; else rent += r.actualAmount }
    console.log(`\n[${label}]`)
    for (const r of recs) {
      console.log(`   ${r.targetMonth} seq${r.seqNo}  ${String(r.actualAmount).padStart(7)}  ${r.payDate.toISOString().slice(0, 10)}  ${r.isDeposit ? '[보증금]' : '[이용료]'} ${r.isPaid ? '완납' : '    '}  ${r.memo ?? ''}`)
    }
    console.log(`   이용료 청구 ${lease.rentAmount.toLocaleString()} · 수납 ${rent.toLocaleString()} · 부족 ${(lease.rentAmount - rent).toLocaleString()}`)
    console.log(`   보증금 계약 ${lease.depositAmount.toLocaleString()} · 수납 ${dep.toLocaleString()} · 부족 ${(lease.depositAmount - dep).toLocaleString()}`)
    console.log(`   합계 받아야 할 ${(lease.rentAmount + lease.depositAmount).toLocaleString()} · 받은 ${(rent + dep).toLocaleString()} · 부족 ${(lease.rentAmount + lease.depositAmount - rent - dep).toLocaleString()}`)
  }

  await show('현재')

  const src = await prisma.paymentRecord.findFirst({
    where: {
      leaseTermId: lease.id, targetMonth: MONTH, isDeposit: false, deletedAt: null,
      actualAmount: SRC_AMOUNT, payDate: new Date(`${SRC_PAYDATE}T00:00:00.000Z`),
    },
    select: { id: true, seqNo: true, payMethod: true, memo: true, expectedAmount: true },
  })
  const made = await prisma.paymentRecord.findFirst({
    where: { leaseTermId: lease.id, isDeposit: true, deletedAt: null, memo: DEP_MEMO },
    select: { id: true },
  })

  if (revert) {
    if (!made) { console.log('\n  되돌릴 대상이 없습니다.'); await prisma.$disconnect(); return }
    const rest = await prisma.paymentRecord.findFirst({
      where: { leaseTermId: lease.id, targetMonth: MONTH, isDeposit: false, deletedAt: null, actualAmount: SRC_AMOUNT - SPLIT },
      select: { id: true },
    })
    if (!apply) { console.log('\n  되돌리려면 --revert --apply'); await prisma.$disconnect(); return }
    await prisma.paymentRecord.delete({ where: { id: made.id } })
    if (rest) await prisma.paymentRecord.update({ where: { id: rest.id }, data: { actualAmount: SRC_AMOUNT } })
    await recalcRent(prisma, lease.id, MONTH, lease.rentAmount)
    await show('되돌림')
    await prisma.$disconnect(); return
  }

  if (made) { console.log('\n  이미 정정됐습니다.'); await prisma.$disconnect(); return }
  if (!src) { console.log(`\n  분리 대상(${MONTH} · ${SRC_AMOUNT.toLocaleString()} · ${SRC_PAYDATE})을 찾지 못했습니다.`); await prisma.$disconnect(); process.exit(1) }
  console.log(`\n  대상: ${MONTH} seq${src.seqNo} · ${SRC_AMOUNT.toLocaleString()}원 · ${SRC_PAYDATE}`)
  console.log(`  분리: 이용료 ${(SRC_AMOUNT - SPLIT).toLocaleString()} + 보증금 ${SPLIT.toLocaleString()}`)

  if (!apply) { console.log('\n  실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  const maxSeq = await prisma.paymentRecord.aggregate({
    where: { leaseTermId: lease.id, targetMonth: MONTH }, _max: { seqNo: true },
  })
  await prisma.$transaction([
    prisma.paymentRecord.update({ where: { id: src.id }, data: { actualAmount: SRC_AMOUNT - SPLIT } }),
    prisma.paymentRecord.create({
      data: {
        leaseTermId: lease.id, tenantId: lease.tenantId, propertyId: lease.propertyId,
        targetMonth: MONTH, seqNo: (maxSeq._max.seqNo ?? 0) + 1,
        // 보증금 record 의 expectedAmount 는 계약 보증금이다(이용료 청구와 섞이면 락인 계산이 오염된다)
        expectedAmount: lease.depositAmount, actualAmount: SPLIT,
        payDate: new Date(`${SRC_PAYDATE}T00:00:00.000Z`),
        isDeposit: true, isPaid: true, payMethod: src.payMethod, memo: DEP_MEMO,
      },
    }),
  ])
  await recalcRent(prisma, lease.id, MONTH, lease.rentAmount)
  await show('정정 후')
  await prisma.$disconnect()
}

// 이용료 완납 재판정 — 보증금은 이용료 충당에 안 들어가므로 제외한다
async function recalcRent(prisma: PrismaClient, leaseTermId: string, mon: string, expected: number) {
  const rows = await prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth: mon, isDeposit: false, isBillingAdjust: false, deletedAt: null },
    orderBy: { payDate: 'asc' }, select: { id: true, actualAmount: true },
  })
  let cum = 0
  for (const r of rows) { cum += r.actualAmount; await prisma.paymentRecord.update({ where: { id: r.id }, data: { isPaid: cum >= expected } }) }
}

void main()
