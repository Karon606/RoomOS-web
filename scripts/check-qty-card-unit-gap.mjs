// 단위가 빈 개수 추적 재고 카드 감지(2026-10-09 재활용품수거봉투 사건 재발 감지) — 읽기 전용.
// 사용: node --env-file=.env.local scripts/check-qty-card-unit-gap.mjs
//
// 왜 필요한가. 품목 병합은 단위가 다른 구매를 함께 세려고 대상 카드의 qtyUnit 을 null('어떤 단위든 받는
// 카드')로 만든다(lib/mergeUnitScope). 그런데 이력 단위가 나중에 하나로 모이면 null 로 둘 까닭이 사라지고,
// 그 상태로는 지출 저장 직전 단위 확인창의 근거가 카드가 아니라 이력이 된다. 2026-10-09 에 한 지출의
// 60L 은 묻고 100L 은 묻지 않은 것이 이 상태였다(확인창은 lib/unitMismatch 로 이력 최빈 단위를 쓰게 고쳤다).
//
// 위반: 활성이고 trackUnit 'qty' 인 카드 중 qtyUnit 이 비었는데, 그 (영업장, 카테고리, 품명) 지출의
// 비어 있지 않은 qtyUnit 이 한 가지로 모이는 카드. 이력이 없거나 단위가 둘 이상이면 병합의 뜻대로 null 이 맞다.
// 용량(spec) 카드는 수량 단위가 잔량 집계에 안 쓰여 보지 않는다. 전 영업장 대상. 0건이 정상.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const cards = await prisma.trackedItem.findMany({
    where: { isArchived: false, trackUnit: 'qty', OR: [{ qtyUnit: null }, { qtyUnit: '' }] },
    select: { id: true, propertyId: true, category: true, label: true, property: { select: { name: true } } },
    orderBy: [{ propertyId: 'asc' }, { category: 'asc' }, { label: 'asc' }],
  })
  const bad = []
  for (const c of cards) {
    const hist = await prisma.expense.findMany({
      where: { propertyId: c.propertyId, category: c.category, itemLabel: c.label, qtyUnit: { not: null } },
      select: { qtyUnit: true },
    })
    const units = hist.map(h => (h.qtyUnit ?? '').trim()).filter(Boolean)
    const kinds = [...new Set(units)]
    if (kinds.length === 1) bad.push({ c, unit: kinds[0], n: units.length })
  }
  for (const { c, unit, n } of bad) {
    console.log(`[${c.property?.name ?? c.propertyId}] ${c.category} · ${c.label} (id ${c.id.slice(0, 8)}) 카드 단위 없음 · 지출 이력 ${n}건 전부 '${unit}'`)
  }
  if (bad.length) {
    console.log(`단위가 빈 개수 추적 카드 ${bad.length}건 — 이력 단위가 하나로 모였으니 카드 단위를 그 값으로 채운다(선례 scripts/fix-bag-unit-1009.ts)`)
    process.exitCode = 1
  } else {
    console.log(`단위가 빈 개수 추적 카드 중 이력 단위가 하나로 모이는 카드 없음(검사 ${cards.length}건) — 정상.`)
  }
  await prisma.$disconnect()
}
main()
