// 입실 청소비를 보증금 record 에서 기타수익으로 이관 — 2026-08-02.
//
// 왜: 입실 때 별도로 받는 청소비는 보증금이 아니다. 돌려줄 의무가 없는 확정 대가라 받은 달 수익이다
// (회계 패널). 그런데 '청소비 포함 수납' 모드가 saveDepositPayment 로 넘겨 isDeposit=true 인
// 수납 record 를 만들었고, 그러면 두 번 틀린다.
//   · 매출 집계가 isDeposit 을 통째로 빼므로 받은 청소비가 매출에 안 잡힌다
//   · 홈의 '보유 보증금'(부채성 잔고)에는 잡힌다. 보증금이 0원인 계약인데도.
// 코드는 이미 새 경로(saveCleaningFeePayment)로 바꿨다. 여기서는 과거 데이터만 옮긴다.
//
// 대상을 좁게 잡는다 — 계약 보증금이 0이고, 금액이 그 계약의 청소비와 정확히 같고, isDeposit=true 인 것.
// 진짜 보증금을 잘못 건드리지 않기 위한 3중 조건이다.
//
// 실행: node --env-file=.env.local scripts/backfill-cleaning-fee-income.mjs [--apply|--revert]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const CATEGORY = '청소비'
const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

if (revert) {
  // 되돌리기 — 이 스크립트가 만든 기타수익을 지우고 원 record 의 소프트삭제를 푼다
  const incomes = await prisma.extraIncome.findMany({
    where: { category: CATEGORY, detail: { contains: '[이관]' } },
    select: { id: true, amount: true, detail: true },
  })
  console.log(`\n[청소비 이관 되돌리기] 기타수익 ${incomes.length}건 삭제`)
  for (const i of incomes) console.log(`  ${i.amount.toLocaleString()}원  ${i.detail}`)
  if (incomes.length) {
    await prisma.extraIncome.deleteMany({ where: { id: { in: incomes.map(i => i.id) } } })
  }
  const restored = await prisma.paymentRecord.updateMany({
    where: { isDeposit: true, memo: { contains: '[청소비 이관됨]' } },
    data: { deletedAt: null, memo: '청소비' },
  })
  console.log(`  수납 record ${restored.count}건 복원`)
  await prisma.$disconnect()
  process.exit(0)
}

// 대상 — 계약 보증금 0 + 금액이 그 계약 청소비와 일치 + isDeposit
const candidates = await prisma.paymentRecord.findMany({
  where: { isDeposit: true, deletedAt: null },
  select: {
    id: true, actualAmount: true, payDate: true, payMethod: true, memo: true,
    targetMonth: true, tenantId: true, propertyId: true, leaseTermId: true,
    leaseTerm: {
      select: {
        depositAmount: true, cleaningFee: true,
        tenant: { select: { name: true } }, room: { select: { roomNo: true } },
      },
    },
  },
})
const targets = candidates.filter(r =>
  r.leaseTerm.depositAmount === 0 &&
  r.leaseTerm.cleaningFee > 0 &&
  r.actualAmount === r.leaseTerm.cleaningFee,
)

console.log(`\n[청소비 -> 기타수익 이관] 보증금 record ${candidates.length}건 중 대상 ${targets.length}건${apply ? '' : ' (미리보기)'}`)
for (const r of targets) {
  console.log(`  ${(r.leaseTerm.room?.roomNo ?? '-')}호 ${r.leaseTerm.tenant.name}  ${r.targetMonth}  ${r.actualAmount.toLocaleString()}원  결제일 ${r.payDate.toISOString().slice(0, 10)}  ${r.payMethod ?? '-'}  memo "${r.memo ?? ''}"`)
}
const skipped = candidates.length - targets.length
if (skipped > 0) console.log(`  건드리지 않는 진짜 보증금: ${skipped}건`)

if (!apply) {
  console.log('\n  실제 반영: --apply · 되돌리기: --revert')
  await prisma.$disconnect()
  process.exit(0)
}

for (const r of targets) {
  const props = await prisma.property.findUnique({ where: { id: r.propertyId }, select: { incomeCategories: true } })
  const cats = (props?.incomeCategories ?? '').split(',').map(c => c.trim()).filter(Boolean)
  if (!cats.includes(CATEGORY)) {
    await prisma.property.update({ where: { id: r.propertyId }, data: { incomeCategories: [...cats, CATEGORY].join(',') } })
  }
  await prisma.$transaction([
    prisma.extraIncome.create({
      data: {
        propertyId: r.propertyId,
        date: r.payDate,
        amount: r.actualAmount,
        category: CATEGORY,
        detail: `${r.leaseTerm.tenant.name} 입실 · 청소비 [이관]`,
        payMethod: r.payMethod,
        tenantId: r.tenantId,
        leaseTermId: r.leaseTermId,
      },
    }),
    // 원 record 는 소프트삭제로 남긴다 — 되돌릴 수 있고 이력도 사라지지 않는다
    prisma.paymentRecord.update({
      where: { id: r.id },
      data: { deletedAt: new Date(), memo: `${r.memo ?? '청소비'} [청소비 이관됨]` },
    }),
  ])
}
console.log(`\n  완료 — ${targets.length}건 이관`)
await prisma.$disconnect()
