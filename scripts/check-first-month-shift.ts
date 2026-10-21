// 입주달 첫 달 규칙 전후 대조 — 지금 화면(미납 열거·수납 추천액)에 뜨는 금액이 바뀌는 건을
// 센다. 읽기 전용, 노출 변화가 있으면 exit 1 (축 통일 때와 같은 배포 게이트 문법).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { billForLeaseMonth, monthOfDate } from '../lib/billing'
import { attachDueDayAdjusts } from '../lib/dueDayAdjust'
import { kstYmd } from '../lib/kstDate'

// 납부일만 옮긴 계약(이용 기간 1일·납부일 6일, 504호 모양)은 첫 달 규칙이 기간으로 재므로 발동하지 않는다(2026-10-21).
// DB 를 읽기 전에 먼저 본다. 이 계약이 '전후 변화' 로 잡히면 첫 달 규칙이 납부일을 읽고 있는 것이다.
function selfCheckSplitCycle() {
  const l = { rentAmount: 470000, status: 'ACTIVE', moveInDate: '2026-08-01', dueDay: '6', cycleDay: '1', dueDayAdjusts: [] }
  const got = billForLeaseMonth(l, '2026-08', null)
  const legacy = billForLeaseMonth({ ...l, cycleDay: null }, '2026-08', null)
  if (got !== 470000 || legacy !== 470000 + 78333) {
    console.error(`[첫 달 규칙 전후] 자체 점검 실패: 기간 1일·납부일 6일 입주달 ${got.toLocaleString()} (470,000 이어야), 칸 없이 ${legacy.toLocaleString()} (548,333 이어야)`)
    process.exit(1)
  }
  console.log('[첫 달 규칙 전후] 자체 점검: 기간 1일·납부일 6일 입주달 470,000 (첫 달 규칙 무발동)')
}

async function main() {
  selfCheckSplitCycle()
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const props = await db.property.findMany({ select: { id: true, acquisitionDate: true, prevOwnerCutoffDate: true } })
  const cutoffMonth = new Map(props.map(p => [p.id, monthOfDate(p.prevOwnerCutoffDate ?? p.acquisitionDate) ?? '0000-00']))
  // 조정 행은 청구 엔진의 입력이다(입주달 첫 달 규칙, lib/dueDayAdjust 정본). 엔진은 빠뜨리면 멈춘다.
  const leases = await attachDueDayAdjusts(db as never, await db.leaseTerm.findMany({
    where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, isShortTerm: false },
    select: {
      id: true, propertyId: true, status: true, rentAmount: true, dueDay: true, cycleDay: true, moveInDate: true, isShortTerm: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
      tenant: { select: { name: true } },
      paymentRecords: { where: { isDeposit: false, isPrevOwner: false, deletedAt: null }, select: { targetMonth: true, expectedAmount: true } },
    },
  }))
  const { year, month } = kstYmd()
  const nowMon = `${year}-${String(month).padStart(2, '0')}`
  let latent = 0, visible = 0
  for (const l of leases) {
    const inMon = monthOfDate(l.moveInDate)
    if (!inMon) continue
    const locked = l.paymentRecords.filter(r => r.targetMonth === inMon).reduce((mx, r) => Math.max(mx, r.expectedAmount), 0) || null
    const before = billForLeaseMonth({ ...l, dueDay: null, cycleDay: null }, inMon, locked)   // 옛 엔진(규칙 없음)과 동치(기간 시작일도 비워야 규칙이 꺼진다)
    const after = billForLeaseMonth(l, inMon, locked)
    if (before === after) continue
    // 노출 판정 — 입주달이 열거 창(컷오프월 이상, 이번 달 이하) 안이면 화면에 뜨는 금액이다.
    const cut = cutoffMonth.get(l.propertyId) ?? '0000-00'
    const shown = inMon >= cut && inMon <= nowMon
    if (shown) { visible++; console.error(`  - ${l.tenant.name} 입주달 ${inMon}: ${before.toLocaleString()} -> ${after.toLocaleString()} (노출)`) }
    else { latent++; console.log(`  · ${l.tenant.name} 입주달 ${inMon}: ${before.toLocaleString()} -> ${after.toLocaleString()} (창 밖)`) }
  }
  console.log(`\n[첫 달 규칙 전후] 검사 ${leases.length}건 · 창 밖 ${latent}건 · 노출 ${visible}건(0이어야 한다)`)
  await db.$disconnect()
  process.exit(visible > 0 ? 1 : 0)
}
main()
