// 재고 규격 단위 차원 불일치 감사 — 수령된 구매의 specUnit 이 품목 단위와 차원이 다른 행을 찾는다.
// 라면 120g x 100개가 12,000개로 계산되던 버그(오류신고 0d6242f0)의 재발 감지용. 읽기 전용.
// 사용: npx tsx --env-file=.env.local scripts/check-spec-dims.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { isSpecDimensionMismatch, specMultiplier } from '../lib/units'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const items = await prisma.trackedItem.findMany({
    where: { isArchived: false, trackUnit: 'spec' },
    select: { id: true, propertyId: true, category: true, label: true, qtyUnit: true, specUnit: true },
  })
  let bad = 0
  for (const it of items) {
    const rows = await prisma.expense.findMany({
      where: {
        propertyId: it.propertyId, category: it.category, itemLabel: it.label,
        ...(it.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] } : {}),
        receivedAt: { not: null }, excludeFromInventory: false,
        specValue: { gt: 0 }, specUnit: { not: null },
      },
      select: { id: true, date: true, vendor: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, detail: true },
    })
    for (const r of rows) {
      if (!isSpecDimensionMismatch(r.specUnit, it.specUnit)) continue
      bad++
      const mult = specMultiplier(r.specValue, r.specUnit, it.specUnit)
      console.log(`[${it.label} · ${it.category}] 품목단위=${it.specUnit} vs 규격=${r.specValue}${r.specUnit}`)
      console.log(`  expense=${r.id.slice(0, 8)} ${r.date.toISOString().slice(0, 10)} ${r.vendor ?? ''} qty=${r.qtyValue}${r.qtyUnit ?? ''} detail=${r.detail ?? ''}`)
      console.log(`  → 집계 기여: ${mult != null ? `${r.qtyValue} x ${mult}` : `${r.qtyValue} (규격 곱셈 안 함, 정상)`}`)
    }
  }
  console.log(bad === 0 ? '차원 불일치 없음 — 정상.' : `차원 불일치 구매 ${bad}건 — 위 행들은 qtyValue 기준으로 집계된다(자동 점검이 이미 곱셈으로 영속된 행이 있는지 StockCheck memo 확인 필요).`)
  await prisma.$disconnect()
}
main()
