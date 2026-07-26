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
    const where = { leaseTermId: l.id, targetMonth: inMonth, isDeposit: false, isPrevOwner: false, deletedAt: null }
    const agg = await prisma.paymentRecord.aggregate({ _max: { expectedAmount: true }, where })
    const lock = agg._max.expectedAmount ?? 0
    const paid = await prisma.paymentRecord.aggregate({ _sum: { actualAmount: true }, where })
    const paidSum = paid._sum.actualAmount ?? 0

    // 저장된 이용료가 정책가보다 크면 운영자 협의가 — 그 값을 존중(배포 로직과 동일 규칙).
    // 하한은 납부합 — 이미 받은 돈 아래로는 내리지 않는다(그 아래는 환불 영역, 사람이 결정).
    const base = l.rentAmount > quote.baseAmount ? l.rentAmount : quote.baseAmount
    const newTarget = Math.max(base, paidSum)
    if (newTarget === lock) continue   // 이미 정합
    const kind = newTarget > lock ? 'increase' : 'decrease'

    console.log(`${l.room.roomNo}호 ${l.tenant.name}: 락 ${lock.toLocaleString()} → ${newTarget.toLocaleString()} (${kind === 'increase' ? '증액' : '감액'} · 납부 ${paidSum.toLocaleString()} · 잔액 ${(newTarget - paidSum).toLocaleString()})`)
    if (!APPLY) continue
    const targetRent = newTarget

    await prisma.$transaction(async tx => {
      const seqNo = await tx.paymentRecord.count({ where: { leaseTermId: l.id, targetMonth: inMonth } })
      const marker = await tx.paymentRecord.create({
        data: {
          leaseTermId: l.id, tenantId: l.tenantId, propertyId: l.propertyId, targetMonth: inMonth,
          expectedAmount: targetRent, actualAmount: 0, payDate: new Date(), seqNo: seqNo + 1,
          isPaid: false, carryOver: 0, isBillingAdjust: true,
          memo: `[${kind === 'increase' ? '단기연장' : '단기감액'} 백필] ${quote.units}주 · ${lock.toLocaleString()}→${targetRent.toLocaleString()} · 퇴실 ${outYmd}`,
        },
      })
      // 락은 max 라 마커 추가만으로는 못 내려간다 — 감액이면 초과 record 를 되쓰고 원값을 스냅샷에 남긴다(undo 복원용)
      const lockRewrites = []
      if (kind === 'decrease') {
        const over = await tx.paymentRecord.findMany({
          where: { leaseTermId: l.id, targetMonth: inMonth, isDeposit: false, deletedAt: null, expectedAmount: { gt: targetRent }, id: { not: marker.id } },
          select: { id: true, expectedAmount: true },
        })
        for (const r of over) {
          lockRewrites.push({ recordId: r.id, prevExpectedAmount: r.expectedAmount })
          await tx.paymentRecord.update({ where: { id: r.id }, data: { expectedAmount: targetRent } })
        }
      }
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
            lockRewrites, manual: l.rentAmount > quote.baseAmount,
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
