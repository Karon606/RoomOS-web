// 단기 요금이 실수납보다 큰데 위약금 산식으로 환불이 나간 퇴실 건을 전 영업장에서 읽기 전용으로 판정한다(쓰기 없음).
// 실행: npx tsx --env-file=.env.local scripts/inspect-shortstay-refund-class.ts
// 한 건의 흔적(수납·이력·보증금 반환)은 scripts/inspect-checkout-case.mjs 로 본다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { settlementPeriodFor, asYmd } from '../lib/settlementPeriod'
import { calcCheckoutProration, calcCheckoutRefund, clampPenaltyPct } from '../lib/prorate'
import { calcShortStay, parseShortStayPolicy, isWithinOneCalendarMonth, stayDaysOf } from '../lib/shortStay'
import { discountedRent } from '../lib/rentDiscount'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const props = await prisma.property.findMany({ select: { id: true, name: true, shortStayPolicy: true, refundPenaltyPct: true } })
  const policyById = new Map(props.map(p => [p.id, parseShortStayPolicy(p.shortStayPolicy)]))
  const pctById = new Map(props.map(p => [p.id, clampPenaltyPct(p.refundPenaltyPct)]))

  const leases = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', isShortTerm: false },
    select: {
      id: true, propertyId: true, dueDay: true, rentAmount: true, moveInDate: true, moveOutDate: true, expectedMoveOut: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      tenant: { select: { name: true } }, room: { select: { roomNo: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  let hit = 0
  for (const l of leases) {
    const undo = l.checkoutProrationUndo as Record<string, unknown> | null
    const snap = undo && typeof undo === 'object' ? (undo.refund as Record<string, unknown> | undefined) : undefined
    if (!snap) continue
    const moveIn = asYmd(l.moveInDate)
    const moveOut = asYmd(l.moveOutDate) ?? asYmd(l.expectedMoveOut)
    if (!moveIn || !moveOut) continue
    if (!isWithinOneCalendarMonth(moveIn, moveOut)) continue
    const period = settlementPeriodFor({ dueDay: l.dueDay, moveInDate: l.moveInDate }, moveOut)
    if (!period) continue
    if (moveOut >= period.mustLeaveYmd) continue        // 만기 종료는 대상 아님
    const monthlyRent = discountedRent(l.discounts, period.month, l.rentAmount)
    const days = stayDaysOf(moveIn, moveOut)
    if (days == null) continue
    const q = calcShortStay(policyById.get(l.propertyId)!, monthlyRent, days, { moveInYmd: moveIn, moveOutYmd: moveOut })
    const prepaid = Number(snap.prepaid ?? 0)
    const refunded = Number(snap.refunded ?? 0)
    const calc = calcCheckoutProration(monthlyRent, l.dueDay, moveOut, moveIn)
    const legal = calcCheckoutRefund({ prepaidAmount: prepaid, monthlyRent, daysUsed: period.daysUsed, mode: 'legal', penaltyPct: pctById.get(l.propertyId) })
    hit++
    console.log(`\n[${hit}] ${l.tenant.name} ${l.room?.roomNo ?? '-'} ${l.id.slice(0, 8)}`)
    console.log(`  입주 ${moveIn} 퇴실 ${moveOut} 체류 ${days}일 · 납부일 ${l.dueDay} · 귀속월 ${period.month} · 사용 ${period.daysUsed}일 · 만기 ${period.mustLeaveYmd}`)
    console.log(`  월이용료(할인반영) ${monthlyRent} · 실수납(귀속월이상) ${prepaid} · 환불확정 ${refunded} · 회사귀속 ${prepaid - refunded} · 현재 checkoutProrated ${l.checkoutProratedAmount}/${l.checkoutProratedMonth}`)
    console.log(`  위약금산식 환불 ${legal.refund} (사용분 ${legal.usedAmount} + 위약금 ${legal.penalty}) · 일할청구 ${calc?.amount ?? '-'}`)
    if (q) {
      const shortRefund = Math.max(0, prepaid - q.baseAmount)
      console.log(`  단기요금 ${q.baseAmount} (${q.units}주=${q.contractDays}일, 청구 ${q.billedDays}일${q.roundedUp ? ', 올림' : ''}) · 단기 기준 환불 ${shortRefund}, 실수납 대비 차 ${q.baseAmount - prepaid}`)
      console.log(`  판정: ${refunded > shortRefund ? '과다환불 ' + (refunded - shortRefund) + '원' : '단기 기준과 일치 또는 이하'}`)
    } else {
      console.log('  단기요금 견적 없음(정책 밖)')
    }
  }
  console.log(`\n클래스 후보 ${hit}건 / CHECKED_OUT·장기·환불확정 ${leases.length}건 중`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
