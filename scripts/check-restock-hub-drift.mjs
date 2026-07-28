// 재고 옮김-허브 차감 정합 감지 — 읽기 전용, 발견 시 exit 1(수정은 하지 않는다).
// 옮김(restockedQty>0)이 기록된 점검에 허브 행이 빠져 있으면, carryOver 가 차감 전 허브 값을
// 복원해 총량이 부푸는 유령 재고가 된다(김치 후속 신고 2026-07-28 — calcLocMove 단일화로 봉합됐지만
// 다른 경로가 다시 갈라질 때를 대비한 상시 감지망). 허브 미지정 품목은 영업장 기본 허브로 판정.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const defaultHubs = await prisma.storageLocation.findMany({
    where: { isHub: true },
    select: { id: true, propertyId: true },
  })
  const defaultHubByProperty = new Map(defaultHubs.map(h => [h.propertyId, h.id]))

  const checks = await prisma.stockCheck.findMany({
    where: { locationBreakdown: { some: { restockedQty: { gt: 0 } } } },
    include: {
      locationBreakdown: { select: { storageLocationId: true, restockedQty: true } },
      trackedItem: { select: { label: true, hubLocationId: true, propertyId: true } },
    },
    orderBy: { date: 'asc' },
  })

  const violations = []
  for (const c of checks) {
    const hubId = c.trackedItem.hubLocationId ?? defaultHubByProperty.get(c.trackedItem.propertyId) ?? null
    if (!hubId) continue   // 허브 자체가 없는 구성 — 차감 대상이 없어 판정 불가(위반 아님)
    if (!c.locationBreakdown.some(lb => lb.storageLocationId === hubId)) {
      const restockSum = c.locationBreakdown.reduce((s, lb) => s + (lb.restockedQty ?? 0), 0)
      violations.push(`${c.date.toISOString().slice(0, 10)} ${c.trackedItem.label} — 옮김 ${restockSum} 기록됐는데 허브 행 없음(미차감 의심)`)
    }
  }

  console.log(`\n[옮김 기록인데 허브 미차감 의심] ${violations.length}건`)
  for (const v of violations) console.log(`  - ${v}`)
  console.log(`\n옮김 기록 점검 ${checks.length}건 검사 · 위반 ${violations.length}건`)
  await prisma.$disconnect()
  if (violations.length > 0) process.exit(1)
}
main()
