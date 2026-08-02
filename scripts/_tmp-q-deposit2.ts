// 계약 보증금 0 심층 조사(읽기 전용, 일회성)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    select: {
      id: true, status: true, depositAmount: true, cleaningFee: true, isShortTerm: true,
      createdAt: true, updatedAt: true, moveInDate: true, reservationDepositMode: true,
      tenant: { select: { name: true } }, room: { select: { roomNo: true } },
    },
  })
  const lm = new Map(leases.map(l => [l.id, l]))

  // 2026-04-21 인수 임포트 뭉치
  const apr21 = leases.filter(l => l.createdAt.toISOString().slice(0, 10) === '2026-04-21')
  console.log(`=== 2026-04-21 생성 계약 ${apr21.length}건 — 보증금 0: ${apr21.filter(l => l.depositAmount === 0).length}, >0: ${apr21.filter(l => l.depositAmount > 0).length}`)
  const amts: Record<string, number> = {}
  for (const l of apr21) amts[String(l.depositAmount)] = (amts[String(l.depositAmount)] ?? 0) + 1
  console.log('  금액 분포', amts)

  // 전체 보증금 금액 분포
  const all: Record<string, number> = {}
  for (const l of leases) all[String(l.depositAmount)] = (all[String(l.depositAmount)] ?? 0) + 1
  console.log('\n=== 전체 depositAmount 금액 분포 ===', all)

  // isDeposit record 전수 (소프트삭제 포함)
  const recs = await prisma.paymentRecord.findMany({
    where: { isDeposit: true },
    select: { id: true, leaseTermId: true, actualAmount: true, expectedAmount: true, targetMonth: true, payDate: true, deletedAt: true, isBillingAdjust: true, memo: true },
    orderBy: { payDate: 'asc' },
  })
  console.log(`\n=== isDeposit record 총 ${recs.length}건 (삭제됨 ${recs.filter(r => r.deletedAt).length}건) ===`)
  for (const r of recs) {
    const l = lm.get(r.leaseTermId)
    console.log(`${l?.room?.roomNo ?? '-'} ${l?.tenant?.name ?? '?'} status=${l?.status} 계약=${l?.depositAmount} 실수납=${r.actualAmount} 기대=${r.expectedAmount} ${r.targetMonth} ${r.payDate.toISOString().slice(0, 10)}${r.deletedAt ? ' [삭제됨]' : ''}${r.isBillingAdjust ? ' [조정]' : ''} memo=${r.memo ?? ''}`)
  }

  // DepositRefund 가 있는데 계약 0
  const refunds = await prisma.depositRefund.findMany({ select: { leaseTermId: true, returnedAmount: true, withheldAmount: true, date: true } })
  console.log(`\n=== DepositRefund ${refunds.length}건 중 계약 보증금 0 인 것 ===`)
  for (const r of refunds) {
    const l = lm.get(r.leaseTermId)
    if (l && l.depositAmount === 0) console.log(`${l.room?.roomNo ?? '-'} ${l.tenant?.name} status=${l.status} 반환=${r.returnedAmount} 미반환=${r.withheldAmount} ${r.date.toISOString().slice(0, 10)}`)
  }

  // CANCELLED / 예약 계약의 0 분포
  const zc = leases.filter(l => l.depositAmount === 0 && l.status === 'CANCELLED')
  console.log(`\n=== CANCELLED 0건 ${zc.length}건 (resvMode·short) ===`)
  const zcm: Record<string, number> = {}
  for (const l of zc) { const k = `${l.reservationDepositMode ?? 'null'}/short=${l.isShortTerm}`; zcm[k] = (zcm[k] ?? 0) + 1 }
  console.log(zcm)

  // 0인데 updatedAt 이 createdAt 보다 훨씬 뒤 = 저장 폼을 거친 계약(폼이 0을 다시 썼다는 정황)
  const zeroTouched = leases.filter(l => l.depositAmount === 0 && l.updatedAt.getTime() - l.createdAt.getTime() > 60_000)
  console.log(`\n=== 0인데 이후 수정된 계약 ${zeroTouched.length}건 / 전체 0 ${leases.filter(l => l.depositAmount === 0).length}건 ===`)

  await prisma.$disconnect()
}
main()
