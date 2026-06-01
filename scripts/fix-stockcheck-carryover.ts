// 위치별 점검에서 일부 위치만 입력되어 다른 위치 잔량이 누락된 stockCheck 데이터를 보정.
//
// 정책:
//   - 각 trackedItem 의 점검을 시간순(date asc, createdAt asc) 순회
//   - 각 점검에서 직전 점검의 위치별 잔량과 비교:
//     · 직전 점검에는 있는데 이 점검에 누락된 위치 → 직전 잔량 carry-over (위치만 추가)
//   - stockCheck.remainingQty 를 새 합으로 재계산
//
// 사용:
//   dry-run:    npx tsx scripts/fix-stockcheck-carryover.ts
//   apply:      APPLY=1 npx tsx scripts/fix-stockcheck-carryover.ts
//   특정 품목만: ITEM=라면 npx tsx scripts/fix-stockcheck-carryover.ts

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const APPLY = process.env.APPLY === '1'
const FILTER_LABEL = process.env.ITEM ?? null

type LocBreakdown = { storageLocationId: string; locationName: string; remainingQty: number; restockedQty: number | null }

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) { console.log('property 없음'); return }

  const items = await prisma.trackedItem.findMany({
    where: { propertyId: property.id, isArchived: false, ...(FILTER_LABEL ? { label: FILTER_LABEL } : {}) },
    select: { id: true, label: true },
    orderBy: { label: 'asc' },
  })

  let totalChecksAdjusted = 0
  let totalLocsCarriedOver = 0
  const itemSummary: { label: string; checksAdjusted: number; locsAdded: number; totalChangeAbs: number }[] = []

  for (const it of items) {
    const checks = await prisma.stockCheck.findMany({
      where: { trackedItemId: it.id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { locationBreakdown: { include: { storageLocation: { select: { name: true } } } } },
    })
    if (checks.length === 0) continue

    let prevLocMap: Map<string, LocBreakdown> = new Map()
    let itemChecksAdjusted = 0
    let itemLocsAdded = 0
    let itemTotalChange = 0
    const adjustments: { checkId: string; oldTotal: number; newTotal: number; added: string[] }[] = []

    for (const c of checks) {
      const currLocs = new Map<string, LocBreakdown>(
        c.locationBreakdown.map(lb => [lb.storageLocationId, {
          storageLocationId: lb.storageLocationId,
          locationName: lb.storageLocation.name,
          remainingQty: lb.remainingQty,
          restockedQty: lb.restockedQty,
        }])
      )

      // 직전 점검에는 있는데 이 점검에 없는 위치 → carry-over 후보
      const missingLocs: LocBreakdown[] = []
      for (const [locId, prevLb] of prevLocMap) {
        if (!currLocs.has(locId)) {
          missingLocs.push({ ...prevLb, restockedQty: null })  // carry-over 는 보충 없음
        }
      }

      if (missingLocs.length > 0) {
        itemChecksAdjusted++
        itemLocsAdded += missingLocs.length
        const oldTotal = c.remainingQty
        const carryOverSum = missingLocs.reduce((s, l) => s + l.remainingQty, 0)
        const newTotal = oldTotal + carryOverSum
        itemTotalChange += carryOverSum
        adjustments.push({
          checkId: c.id,
          oldTotal, newTotal,
          added: missingLocs.map(l => `${l.locationName}=${l.remainingQty}`),
        })

        if (APPLY) {
          await prisma.stockCheckLocation.createMany({
            data: missingLocs.map(l => ({
              stockCheckId: c.id,
              storageLocationId: l.storageLocationId,
              remainingQty: l.remainingQty,
              restockedQty: null,
            })),
          })
          await prisma.stockCheck.update({
            where: { id: c.id },
            data: { remainingQty: newTotal },
          })
        }

        // 이 점검의 prevLocMap 업데이트 — 새로 채워진 위치 포함
        for (const lb of missingLocs) currLocs.set(lb.storageLocationId, lb)
      }

      prevLocMap = currLocs
    }

    if (itemChecksAdjusted > 0) {
      itemSummary.push({ label: it.label, checksAdjusted: itemChecksAdjusted, locsAdded: itemLocsAdded, totalChangeAbs: itemTotalChange })
      totalChecksAdjusted += itemChecksAdjusted
      totalLocsCarriedOver += itemLocsAdded
      console.log(`\n[${it.label}] ${itemChecksAdjusted}건 보정 / 총 ${itemLocsAdded}개 위치 추가 / 합계 +${itemTotalChange}`)
      for (const adj of adjustments.slice(0, 5)) {
        console.log(`  check ${adj.checkId.slice(0, 8)}: total ${adj.oldTotal} → ${adj.newTotal} (${adj.added.join(', ')})`)
      }
      if (adjustments.length > 5) console.log(`  … 외 ${adjustments.length - 5}건`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`전체 영향: ${itemSummary.length} 품목 / ${totalChecksAdjusted} 점검 / ${totalLocsCarriedOver} 위치 추가`)
  console.log(APPLY ? '\n✅ 적용 완료' : '\n(dry-run) APPLY=1 와 함께 실행하면 실제 적용됩니다.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
