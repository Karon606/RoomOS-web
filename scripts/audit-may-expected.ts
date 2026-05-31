// dashboard 의 totalExpected (5월 예상 매출) 계산을 재현 + 호실별로 출력.
// 사용자가 손계산한 15,222,500원 vs 시스템 14,960,500원 차이 분석.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TARGET_MONTH = '2026-05'

async function main() {
  const properties = await prisma.property.findMany({ select: { id: true, name: true, acquisitionDate: true, prevOwnerCutoffDate: true } })
  // 실제 active property 1개 가정 (없으면 사용자 안내)
  if (properties.length === 0) { console.log('property 없음'); return }
  // 사용자가 보고 있는 게 "더스테이원룸텔 제기역점" (현재 컨텍스트 기준)
  const p = properties.find(x => x.name.includes('제기')) ?? properties[0]
  console.log(`Property: ${p.name} (id=${p.id})`)
  console.log(`acquisitionDate: ${p.acquisitionDate?.toISOString().slice(0,10) ?? '-'}, prevOwnerCutoff: ${p.prevOwnerCutoffDate?.toISOString().slice(0,10) ?? '-'}`)

  // dashboard 가 가져오는 것과 동일한 셀렉트
  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId: p.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: {
      id: true, status: true, rentAmount: true, dueDay: true,
      overrideDueDay: true, overrideDueDayMonth: true,
      moveInDate: true, moveOutDate: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
    orderBy: { room: { roomNo: 'asc' } },
  })

  const billableLeases = leases.filter(l => l.rentAmount > 0)

  // prevOwnerLeaseIds 계산은 cutoffMonth 비교. 5월 > cutoff 일 가능성 큼 → 빈 set.
  const cutoffDate = p.prevOwnerCutoffDate ?? p.acquisitionDate
  const cutoffMonthStr = cutoffDate ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}` : null
  console.log(`cutoffMonth: ${cutoffMonthStr ?? '-'}, targetMonth: ${TARGET_MONTH}`)
  const isPrevOwnerRelevant = cutoffMonthStr && TARGET_MONTH <= cutoffMonthStr
  console.log(`양도인 제외 적용? ${isPrevOwnerRelevant ? 'YES' : 'no'}`)

  // 호실별 출력
  console.log('\n호실별 5월 청구액 (할인 반영):')
  let total = 0
  const byRoom = new Map<string, { name: string; amount: number; status: string; rentAmount: number; discount: string }[]>()
  for (const l of billableLeases) {
    const amount = discountedRent(l.discounts, TARGET_MONTH, l.rentAmount)
    const discountInfo = l.discounts.length > 0
      ? l.discounts.map(d => `${d.discountType}=${d.value}(${d.scope}, ${d.startMonth ?? '?'}~${d.endMonth ?? '?'})`).join(' / ')
      : '-'
    const roomNo = l.room?.roomNo ?? '?'
    const arr = byRoom.get(roomNo) ?? []
    arr.push({ name: l.tenant.name, amount, status: l.status, rentAmount: l.rentAmount, discount: discountInfo })
    byRoom.set(roomNo, arr)
    total += amount
  }
  const sortedRooms = [...byRoom.keys()].sort()
  for (const roomNo of sortedRooms) {
    const arr = byRoom.get(roomNo)!
    for (const e of arr) {
      console.log(`  ${roomNo}호 ${e.name.padEnd(10, ' ')} status=${e.status.padEnd(18, ' ')} rent=${e.rentAmount.toLocaleString().padStart(9, ' ')} → 청구=${e.amount.toLocaleString().padStart(9, ' ')} | 할인:${e.discount}`)
    }
  }
  console.log(`\n총 청구액 (totalExpected) = ${total.toLocaleString()}원`)

  // RESERVED 도 따로 보기 (사용자 추가분 가능성)
  const reserved = await prisma.leaseTerm.findMany({
    where: { propertyId: p.id, status: 'RESERVED' },
    include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  if (reserved.length > 0) {
    console.log(`\n[참고] RESERVED (billableLeases 미포함):`)
    for (const l of reserved) {
      console.log(`  ${l.room?.roomNo ?? '?'}호 ${l.tenant.name} rent=${l.rentAmount.toLocaleString()} moveIn=${l.moveInDate?.toISOString().slice(0,10) ?? '-'}`)
    }
  }

  // extraIncome 도 분리해서 표시
  const extraIncomeAgg = await prisma.extraIncome.aggregate({
    where: { propertyId: p.id, date: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) } },
    _sum: { amount: true },
  })
  console.log(`\n[참고] 5월 기타수익 (ExtraIncome) 합계: ${(extraIncomeAgg._sum.amount ?? 0).toLocaleString()}원`)

  console.log(`\n→ projectedRevenue = totalExpected (${total.toLocaleString()}) + extraRevenue`)
  console.log(`   사용자 손계산: 15,222,500원 / 시스템 표시: 14,960,500원 / 차이: 262,000원`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
