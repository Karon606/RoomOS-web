// 임형진 보증금 정산 백필(오류신고 249b5652) — 7/20 수정폼 환불창 버그 창구로 누락된 기록 소급.
// 실수납 5만원(입주월 귀속) + 반환 0원·미반환 5만원(DepositRefund) + 부가수익 '보증금' 5만원을 생성한다.
// recordDepositReceived·recordDepositReturn(tenants/actions.ts)이 만드는 것과 동일 문법.
// 기본 드라이런. 적용: node --env-file=.env.local scripts/backfill-lim-deposit.mjs --apply
// 되돌리기: 적용 시 출력되는 3개 id 를 삭제하면 완전 원복(참조 무).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: '임형진' },
    include: { leaseTerms: { where: { status: 'CHECKED_OUT' }, include: { room: true } } },
  })
  const lease = tenant?.leaseTerms[0]
  if (!tenant || !lease || tenant.leaseTerms.length !== 1) {
    console.error(`임형진 CHECKED_OUT 계약이 정확히 1건이 아님 — 중단`)
    process.exit(1)
  }
  const dep = lease.depositAmount
  console.log(`대상: ${tenant.name} ${lease.room?.roomNo ?? '?'}호 보증금 ${dep}원 입주 ${lease.moveInDate?.toISOString().slice(0, 10)} 퇴실 ${lease.moveOutDate?.toISOString().slice(0, 10)}`)
  if (dep !== 50000) { console.error('보증금이 50,000원이 아님 — 수동 확인 필요, 중단'); process.exit(1) }

  const [inRecords, refunds] = await Promise.all([
    prisma.paymentRecord.findMany({ where: { leaseTermId: lease.id, isDeposit: true, deletedAt: null } }),
    prisma.depositRefund.findMany({ where: { leaseTermId: lease.id } }),
  ])
  if (inRecords.length > 0 || refunds.length > 0) {
    console.log(`이미 기록 있음(실수납 ${inRecords.length}건, 반환이력 ${refunds.length}건) — 할 일 없음.`)
    await prisma.$disconnect()
    return
  }

  const moveIn = lease.moveInDate
  const targetMonth = `${moveIn.getFullYear()}-${String(moveIn.getMonth() + 1).padStart(2, '0')}`
  const refundDate = lease.moveOutDate ?? new Date()
  console.log(`계획: (1) 실수납 ${dep}원 targetMonth=${targetMonth} payDate=${moveIn.toISOString().slice(0, 10)}`)
  console.log(`      (2) DepositRefund 반환 0 · 미반환 ${dep} date=${refundDate.toISOString().slice(0, 10)}`)
  console.log(`      (3) ExtraIncome 보증금 ${dep}원 "${tenant.name} 퇴실 · 보증금 미반환분" payMethod=보유 보증금`)

  if (!APPLY) { console.log('드라이런 종료 — 적용하려면 --apply'); await prisma.$disconnect(); return }

  const seqCount = await prisma.paymentRecord.count({ where: { leaseTermId: lease.id, targetMonth, deletedAt: null } })
  const [pay, refund, inc] = await prisma.$transaction([
    prisma.paymentRecord.create({
      data: {
        leaseTermId: lease.id, tenantId: tenant.id, propertyId: lease.propertyId,
        targetMonth, expectedAmount: dep, actualAmount: dep,
        payDate: moveIn, payMethod: '기타',
        memo: '보증금 수납(백필 2026-07-21, 신고 249b5652)',
        seqNo: seqCount + 1, isPaid: false, isDeposit: true, carryOver: 0,
      },
    }),
    prisma.depositRefund.create({
      data: {
        propertyId: lease.propertyId, tenantId: tenant.id, leaseTermId: lease.id,
        date: refundDate, returnedAmount: 0, withheldAmount: dep,
        memo: '백필 2026-07-21(신고 249b5652) — 7/20 환불창 버그로 누락된 퇴실 정산 소급',
      },
    }),
    prisma.extraIncome.create({
      data: {
        propertyId: lease.propertyId, date: refundDate, amount: dep,
        category: '보증금', detail: `${tenant.name} 퇴실 · 보증금 미반환분`,
        payMethod: '보유 보증금', tenantId: tenant.id, leaseTermId: lease.id,
      },
    }),
  ])
  // recordDepositReturn 과 동일 — 부가수익 카테고리 사전에 '보증금' 보장
  const prop = await prisma.property.findUnique({ where: { id: lease.propertyId }, select: { incomeCategories: true } })
  const cats = (prop?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타').split(',').map(s => s.trim()).filter(Boolean)
  if (!cats.includes('보증금')) {
    await prisma.property.update({ where: { id: lease.propertyId }, data: { incomeCategories: [...cats, '보증금'].join(',') } })
  }
  console.log(`적용 완료(되돌리기용 id): paymentRecord=${pay.id} depositRefund=${refund.id} extraIncome=${inc.id}`)
  await prisma.$disconnect()
}
main()
