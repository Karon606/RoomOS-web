// 단기 연장인데 청구 락(입주월 record 최대 expectedAmount)이 안 올라간 계약을 정상화 — 신고 d3ea25f0 백필.
// 생성 경로(updateTenant 락 기준 동기화)는 이미 수정 배포됨. 이 스크립트는 그 이전에 어긋난 기존 데이터만 정정한다.
// 배포된 syncShortStayCharge 와 동일한 절차(마커 record → 스냅샷 → lease 확정 → isPaid 누적 재계산)로 처리해
// 적용취소(undoShortStayExtension)도 그대로 동작한다. 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseShortStayPolicy, calcShortStay, stayDaysOf } from '../lib/shortStay.ts'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

const ymd = (d) => d ? new Date(d).toISOString().slice(0, 10) : null

async function main() {
  // 단기·거주중(또는 퇴실예정)·입주일·퇴실예정일이 있는 계약 전수
  const leases = await prisma.leaseTerm.findMany({
    where: { isShortTerm: true, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] }, moveInDate: { not: null }, expectedMoveOut: { not: null } },
    select: {
      id: true, tenantId: true, propertyId: true, status: true, rentAmount: true,
      moveInDate: true, expectedMoveOut: true, autoCheckoutAt: true, shortStayExtensions: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true, baseRent: true } },
      property: { select: { shortStayPolicy: true } },
    },
  })

  for (const l of leases) {
    if (!l.room) continue
    const policy = parseShortStayPolicy(l.property.shortStayPolicy)
    if (!policy.enabled) continue
    const moveInYmd = ymd(l.moveInDate), outYmd = ymd(l.expectedMoveOut)
    const days = stayDaysOf(moveInYmd, outYmd)
    if (days == null) continue
    const quote = calcShortStay(policy, l.room.baseRent, days)
    if (!quote) continue

    const inMonth = moveInYmd.slice(0, 7)
    // 저장된 이용료가 정책가와 다르면 운영자 협의가 — 그 값을 존중(배포 로직과 동일 규칙)
    const targetRent = l.rentAmount > quote.baseAmount ? l.rentAmount : quote.baseAmount
    const agg = await prisma.paymentRecord.aggregate({
      _max: { expectedAmount: true },
      where: { leaseTermId: l.id, targetMonth: inMonth, isDeposit: false, deletedAt: null },
    })
    const lock = agg._max.expectedAmount ?? 0
    if (targetRent <= lock) continue   // 이미 정합

    const paid = await prisma.paymentRecord.aggregate({
      _sum: { actualAmount: true },
      where: { leaseTermId: l.id, targetMonth: inMonth, isDeposit: false, deletedAt: null },
    })
    const paidSum = paid._sum.actualAmount ?? 0
    console.log(`${l.room.roomNo}호 ${l.tenant.name}: 락 ${lock.toLocaleString()} → ${targetRent.toLocaleString()} (납부 ${paidSum.toLocaleString()} · 잔액 ${(targetRent - paidSum).toLocaleString()})`)
    if (!APPLY) continue

    await prisma.$transaction(async tx => {
      const seqNo = await tx.paymentRecord.count({ where: { leaseTermId: l.id, targetMonth: inMonth } })
      const marker = await tx.paymentRecord.create({
        data: {
          leaseTermId: l.id, tenantId: l.tenantId, propertyId: l.propertyId, targetMonth: inMonth,
          expectedAmount: targetRent, actualAmount: 0, payDate: new Date(), seqNo: seqNo + 1,
          isPaid: false, carryOver: 0,
          memo: `[단기연장 백필] ${quote.units}주 · ${lock.toLocaleString()}→${targetRent.toLocaleString()} · 퇴실 ${outYmd}`,
        },
      })
      const prev = Array.isArray(l.shortStayExtensions) ? l.shortStayExtensions : []
      await tx.leaseTerm.update({
        where: { id: l.id },
        data: {
          rentAmount: targetRent,
          shortStayExtensions: [...prev, {
            at: new Date().toISOString(),
            prevRentAmount: l.rentAmount, newRentAmount: targetRent,
            prevExpectedMoveOut: outYmd, newExpectedMoveOut: outYmd,
            prevStatus: l.status,
            prevAutoCheckoutAt: l.autoCheckoutAt ? l.autoCheckoutAt.toISOString() : null,
            prevProration: null, markerRecordId: marker.id, undoneAt: null,
          }],
        },
      })
      const recs = await tx.paymentRecord.findMany({
        where: { leaseTermId: l.id, targetMonth: inMonth, isDeposit: false },
        orderBy: { payDate: 'asc' },
      })
      let cum = 0
      for (const r of recs) { cum += r.actualAmount; await tx.paymentRecord.update({ where: { id: r.id }, data: { isPaid: cum >= targetRent } }) }
    })
  }
  console.log(APPLY ? '적용 완료' : '드라이런 종료 — 적용하려면 --apply')
  await prisma.$disconnect()
}
main()
