// 비쉬 간바트(502호)·윤정승(422호) 보증금 정산 백필 — 운영자 확인 2026-07-21: 각 5만원 전액 반환함.
// 7/20 이전 수정폼 환불창 버그 창구로 기록만 누락된 케이스. 실수납 5만(입주월 귀속) + DepositRefund 반환 5만·미반환 0.
// 전액 반환이라 부가수익(ExtraIncome)은 생성하지 않는다(recordDepositReturn과 동일 규칙: withheld=0이면 미생성).
// 기본 드라이런. 적용: node --env-file=.env.local scripts/backfill-returned-deposits.mjs --apply
// 되돌리기: 적용 시 출력되는 id 들을 삭제하면 완전 원복(참조 무).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

const TARGETS = [
  { name: '비쉬 간바트', leasePrefix: 'ecf76890' },
  { name: '윤정승', leasePrefix: 'ed0d9be2' },
]

async function main() {
  for (const t of TARGETS) {
    const leases = (await prisma.leaseTerm.findMany({
      where: { status: 'CHECKED_OUT', tenant: { name: t.name } },
      include: { tenant: true, room: true },
    })).filter(l => l.id.startsWith(t.leasePrefix))
    if (leases.length !== 1) { console.error(`${t.name}: 계약 매칭 ${leases.length}건 — 건너뜀(수동 확인)`); continue }
    const lease = leases[0]
    const dep = lease.depositAmount
    console.log(`대상: ${t.name} ${lease.room?.roomNo ?? '?'}호 보증금 ${dep}원 입주 ${lease.moveInDate?.toISOString().slice(0, 10)} 퇴실 ${lease.moveOutDate?.toISOString().slice(0, 10)}`)
    if (dep !== 50000) { console.error('  보증금이 50,000원이 아님 — 건너뜀'); continue }

    const [inRecords, refunds] = await Promise.all([
      prisma.paymentRecord.findMany({ where: { leaseTermId: lease.id, isDeposit: true, deletedAt: null } }),
      prisma.depositRefund.findMany({ where: { leaseTermId: lease.id } }),
    ])
    if (refunds.length > 0) { console.log(`  반환 이력 이미 있음 — 건너뜀.`); continue }
    // 실수납은 이미 있는 케이스가 일반적(이 2건은 수납만 기록되고 환불창 버그로 반환 이력만 누락) — 없는 조각만 채운다
    const needPay = inRecords.length === 0
    const inSum = inRecords.reduce((s, r) => s + r.actualAmount, 0)
    if (!needPay && inSum !== dep) { console.error(`  실수납 합 ${inSum} != 약정 ${dep} — 건너뜀(수동 확인)`); continue }

    const moveIn = lease.moveInDate
    const targetMonth = `${moveIn.getFullYear()}-${String(moveIn.getMonth() + 1).padStart(2, '0')}`
    const refundDate = lease.moveOutDate ?? new Date()
    console.log(`  계획: ${needPay ? `실수납 ${dep} (${targetMonth}) + ` : `실수납 기존 ${inSum} 유지 + `}반환 ${dep} · 미반환 0 (${refundDate.toISOString().slice(0, 10)})`)
    if (!APPLY) continue

    const ops = []
    if (needPay) {
      const seqCount = await prisma.paymentRecord.count({ where: { leaseTermId: lease.id, targetMonth, deletedAt: null } })
      ops.push(prisma.paymentRecord.create({
        data: {
          leaseTermId: lease.id, tenantId: lease.tenantId, propertyId: lease.propertyId,
          targetMonth, expectedAmount: dep, actualAmount: dep,
          payDate: moveIn, payMethod: '기타',
          memo: '보증금 수납(백필 2026-07-21, 신고 249b5652 후속)',
          seqNo: seqCount + 1, isPaid: false, isDeposit: true, carryOver: 0,
        },
      }))
    }
    ops.push(prisma.depositRefund.create({
      data: {
        propertyId: lease.propertyId, tenantId: lease.tenantId, leaseTermId: lease.id,
        date: refundDate, returnedAmount: dep, withheldAmount: 0,
        memo: '백필 2026-07-21 — 전액 반환 확인(운영자), 환불창 버그로 기록 누락분 소급',
      },
    }))
    const results = await prisma.$transaction(ops)
    console.log(`  적용 완료(되돌리기용 id): ${results.map(r => r.id).join(' / ')}`)
  }
  if (!APPLY) console.log('드라이런 종료 — 적용하려면 --apply')
  await prisma.$disconnect()
}
main()
