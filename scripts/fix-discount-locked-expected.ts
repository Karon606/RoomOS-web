// 할인 계약의 잘못 락인된 expectedAmount 교정 — 진단(기본) + 교정(--apply).
//
// 배경: savePayment 가 클라이언트가 보낸 할인 미반영 원금(rentAmount)을 record.expectedAmount 로
// 저장해 왔고, 읽기 엔진의 [저장 청구액 우선] 규칙이 그 값을 그 달 청구로 채택 → 할인 입주자가
// 완납해도 영구 미납으로 잡혔다. 쓰기 경로는 수정됐고(2026-06-11), 이 스크립트는 과거 record 를 고친다.
//
// 대상 시그니처(좁게): 할인이 그 달에 적용되는 계약 + record.expectedAmount == 현재 rentAmount(원금)
//   && 할인가 < 원금. (월세가 실제로 변경된 락인은 expectedAmount ≠ 현재 rentAmount 라 건드리지 않음)
//
// 실행:  npx tsx --env-file=.env.local scripts/fix-discount-locked-expected.ts          (진단만)
//        npx tsx --env-file=.env.local scripts/fix-discount-locked-expected.ts --apply  (교정)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { discounts: { some: {} } },
    select: {
      id: true, rentAmount: true, status: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  console.log(`할인 보유 계약: ${leases.length}건`)

  let flagged = 0, fixedRecords = 0
  for (const l of leases) {
    const records = await prisma.paymentRecord.findMany({
      where: { leaseTermId: l.id, isDeposit: false, isPrevOwner: false },
      select: { id: true, targetMonth: true, expectedAmount: true, actualAmount: true },
      orderBy: { targetMonth: 'asc' },
    })
    const byMonth = new Map<string, typeof records>()
    for (const r of records) {
      if (!byMonth.has(r.targetMonth)) byMonth.set(r.targetMonth, [])
      byMonth.get(r.targetMonth)!.push(r)
    }
    for (const [mon, recs] of byMonth) {
      const billed = discountedRent(l.discounts, mon, l.rentAmount)
      if (billed >= l.rentAmount) continue   // 그 달 할인 없음
      const wrong = recs.filter(r => r.expectedAmount === l.rentAmount)
      if (wrong.length === 0) continue
      flagged++
      const paid = recs.reduce((s, r) => s + r.actualAmount, 0)
      console.log(
        `[${l.room?.roomNo ?? '?'}호 ${l.tenant.name}] ${mon}: 락인 ${l.rentAmount.toLocaleString()} → 할인가 ${billed.toLocaleString()}`
        + ` (납부 ${paid.toLocaleString()}, record ${wrong.length}건${APPLY ? ' — 교정' : ''})`,
      )
      if (APPLY) {
        for (const r of wrong) {
          await prisma.paymentRecord.update({ where: { id: r.id }, data: { expectedAmount: billed } })
          fixedRecords++
        }
        // isPaid 재계산 (그 달 청구액 기준 누적)
        let cum = 0
        const all = await prisma.paymentRecord.findMany({
          where: { leaseTermId: l.id, targetMonth: mon, isDeposit: false },
          orderBy: { payDate: 'asc' },
        })
        for (const r of all) {
          cum += r.actualAmount
          await prisma.paymentRecord.update({ where: { id: r.id }, data: { isPaid: cum >= billed } })
        }
      }
    }
  }
  console.log(APPLY
    ? `완료: ${flagged}개 월 / record ${fixedRecords}건 교정`
    : `진단 완료: ${flagged}개 월 교정 대상. 적용하려면 --apply 로 재실행`)
}

main().finally(() => prisma.$disconnect())
