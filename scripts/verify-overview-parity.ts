// 재고 개요(computeInventoryOverview) 성능 수술 전/후 결과 동일성 검증.
// 사용: npx tsx --env-file=.env.local scripts/verify-overview-parity.ts > /tmp/overview-{before|after}.txt
// stdout = 품목별 계산값 다이제스트(diff 대상), stderr = 소요 시간.
import { computeInventoryOverview } from '../app/(app)/inventory/overview'
import prisma from '../lib/prisma'

async function main() {
  const prop = await prisma.property.findFirst({ select: { id: true, name: true } })
  if (!prop) { console.error('NO PROPERTY'); process.exit(1) }
  const t0 = Date.now()
  const rows = await computeInventoryOverview(prop.id)
  const ms = Date.now() - t0
  for (const r of rows) {
    console.log([
      r.label, r.category, r.trackUnit, r.specUnit ?? '', r.qtyUnit ?? '',
      r.currentStock, r.avgDaily?.toFixed(6) ?? '', r.daysUntilEmpty,
      r.lastPeriodConsumption, r.lastPeriodDays,
      r.avgUnitPrice?.toFixed(4) ?? '', r.lastUnitPrice?.toFixed(4) ?? '',
      JSON.stringify(r.monthlyConsumption),
      r.pendingPurchases.length,
      JSON.stringify(r.locations.map(l => l.id)),
      JSON.stringify(r.lastCheckLocationBreakdown),
    ].join('|'))
  }
  console.error(`TIME ${ms}ms rows=${rows.length}`)
  await prisma.$disconnect()
}
main()
