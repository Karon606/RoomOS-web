// 422호 파트쿨리나 알비나 6월 이용료 record 를 청소비 부가수익으로 재분류 — 2026-08-12 운영자 확정.
//
// 운영자 사실:
//   "총 283,000원을 입금했었고 그중 262,500원은 월 이용료, 2만원은 청소비, 500원은 부가수익으로 잡았어.
//    즉 242,500원이라는 금액은 오간 적이 전혀 없는 금액이야."
//
// 실물 대조(읽기 전용 조사 2026-08-12):
//   · 2026-05 record  exp 262,500 / act 262,500  — 단기 사용료 전액, 5월에 인식됨(불변)
//   · 2026-06 record  exp 262,500 / act  20,000  — payDate 도 2026-05-11, memo '2026년 5월분 채우고 남은 금액'
//   · ExtraIncome 500원(2026-05-11 '기타 · 현금납부 차액') — 연결 없이 실재
//   합 262,500 + 20,000 + 500 = 283,000 으로 운영자 산식과 일치한다.
//
// 무엇이 잘못됐나. 청소비를 사용료와 합쳐 한 번에 입금받은 것을 이용료 수납으로 넣었고, FIFO 가
// 5월을 채우고 남은 20,000 을 6월로 밀면서 **6월 record 의 청구 락(expectedAmount)까지 262,500 으로
// 굳혔다.** 단기는 입주월 1회 청구라 6월에는 청구가 없어야 하는데, 락인은 청구 정본을 이기므로
// (lib/billing 우선순위 ②) 242,500 이 영구 미납으로 섰고 리포트 12개월 미수율 분자에도 들어갔다.
//
// 생성 경로는 이미 두 겹으로 막혀 있다 — billForLeaseMonth 의 단기 입주월 단일 청구(2026-07-20)와
// savePayment 의 shortAbsorb(단기 과납은 입력월이 흡수, 2026-07-20). 여기서는 과거 데이터만 옮긴다.
//
// 옮기는 모양은 지금의 정본 경로(saveCleaningFeePayment)가 만드는 것과 같다 — 받은 날짜(payDate),
// 카테고리 '청소비', detail '<이름> 입실 · 청소비', 결제수단·입주자·계약 연결 그대로.
// 원 record 는 소프트삭제로 남긴다(되돌릴 수 있고 이력도 안 사라진다 — backfill-cleaning-fee-income 관례).
//
// 실행: node --env-file=.env.local scripts/backfill-partkulina-cleaning.mjs [--apply|--revert]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const RECORD_ID = 'd779e5fb-cec8-4c5c-9cda-709697af4a38'
const LEASE_ID  = '9b3d5a69-e6cc-4d0f-b557-6656bb26242e'
const CATEGORY  = '청소비'
// 이 스크립트만의 표식 — backfill-cleaning-fee-income 의 '[이관]' 과 겹치면 그쪽 --revert 가
// 이 부가수익만 지우고 record 는 안 살려 20,000 이 증발한다.
const MARK_RECORD = '[청소비 재분류됨]'
const MARK_INCOME = '2026-06 이용료 record 에서 재분류 (2026-08-12)'

const apply  = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const show = o => JSON.stringify(o)

if (revert) {
  const income = await prisma.extraIncome.findFirst({ where: { leaseTermId: LEASE_ID, category: CATEGORY, memo: MARK_INCOME } })
  const rec = await prisma.paymentRecord.findUnique({ where: { id: RECORD_ID } })
  if (!rec) { console.error('원 record 없음 — 중단'); process.exit(1) }
  if (income) await prisma.extraIncome.delete({ where: { id: income.id } })
  await prisma.paymentRecord.update({
    where: { id: RECORD_ID },
    data: { deletedAt: null, memo: (rec.memo ?? '').replace(` ${MARK_RECORD}`, '') },
  })
  console.log(`되돌림 — 부가수익 ${income ? '1건 삭제' : '없음'} · record 복원`)
  await prisma.$disconnect()
  process.exit(0)
}

const rec = await prisma.paymentRecord.findUnique({
  where: { id: RECORD_ID },
  include: { leaseTerm: { select: { id: true, isShortTerm: true, moveInDate: true, cleaningFee: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
})
if (!rec) { console.error('대상 record 없음 — 중단'); process.exit(1) }

// 전제 — 조사에서 확인한 모양 그대로일 때만 손댄다.
const bad = []
if (rec.leaseTermId !== LEASE_ID) bad.push('계약이 다르다')
if (rec.targetMonth !== '2026-06') bad.push(`귀속월이 2026-06 이 아니다: ${rec.targetMonth}`)
if (rec.expectedAmount !== 262500) bad.push(`락인이 262,500 이 아니다: ${rec.expectedAmount}`)
if (rec.actualAmount !== 20000) bad.push(`수납액이 20,000 이 아니다: ${rec.actualAmount}`)
if (rec.actualAmount !== rec.leaseTerm.cleaningFee) bad.push(`수납액이 계약 청소비(${rec.leaseTerm.cleaningFee})와 다르다`)
if (rec.isDeposit || rec.isPrevOwner || rec.isBillingAdjust) bad.push('보증금·양도인·전표 record 다')
if (rec.deletedAt) bad.push('이미 삭제된 record 다')
if (!rec.leaseTerm.isShortTerm) bad.push('단기 계약이 아니다')
if (rec.leaseTerm.moveInDate?.toISOString().slice(0, 7) === rec.targetMonth) bad.push('입주월 record 다 — 이 클래스가 아니다')
if (bad.length) { console.error('전제 불일치 — 중단\n  ' + bad.join('\n  ')); process.exit(1) }

const who = `${rec.leaseTerm.room?.roomNo ?? '-'}호 ${rec.leaseTerm.tenant.name}`
console.log(`\n[422 락인 오염 정정] ${who}${apply ? '' : ' (미리보기)'}`)
console.log('  전 record:', show({
  id: rec.id, targetMonth: rec.targetMonth, expectedAmount: rec.expectedAmount, actualAmount: rec.actualAmount,
  payDate: rec.payDate.toISOString().slice(0, 10), payMethod: rec.payMethod, memo: rec.memo, deletedAt: rec.deletedAt,
}))
console.log('  후 부가수익:', show({
  date: rec.payDate.toISOString().slice(0, 10), amount: rec.actualAmount, category: CATEGORY,
  detail: `${rec.leaseTerm.tenant.name} 입실 · 청소비`, payMethod: rec.payMethod,
  tenantId: rec.tenantId, leaseTermId: rec.leaseTermId, memo: MARK_INCOME,
}))
console.log(`  후 record: 소프트삭제 + memo 뒤에 '${MARK_RECORD}'`)

if (!apply) {
  console.log('\n  실제 반영: --apply · 되돌리기: --revert')
  await prisma.$disconnect()
  process.exit(0)
}

// 영업장 수입 카테고리에 '청소비' 보장 — 없으면 재무 화면 필터에 안 뜬다(정본 경로와 같은 처리).
const property = await prisma.property.findUnique({ where: { id: rec.propertyId }, select: { incomeCategories: true } })
const cats = (property?.incomeCategories ?? '').split(',').map(c => c.trim()).filter(Boolean)
if (!cats.includes(CATEGORY)) {
  await prisma.property.update({ where: { id: rec.propertyId }, data: { incomeCategories: [...cats, CATEGORY].join(',') } })
}

await prisma.$transaction([
  prisma.extraIncome.create({
    data: {
      propertyId: rec.propertyId,
      date: rec.payDate,
      amount: rec.actualAmount,
      category: CATEGORY,
      detail: `${rec.leaseTerm.tenant.name} 입실 · 청소비`,
      memo: MARK_INCOME,
      payMethod: rec.payMethod,
      tenantId: rec.tenantId,
      leaseTermId: rec.leaseTermId,
    },
  }),
  prisma.paymentRecord.update({
    where: { id: rec.id },
    data: { deletedAt: new Date(), memo: `${rec.memo ?? ''} ${MARK_RECORD}`.trim() },
  }),
])
console.log('\n  완료 — 부가수익 1건 생성 · record 1건 소프트삭제')
await prisma.$disconnect()
