// 재고 개요(computeInventoryOverview) 성능 수술 전/후 결과 동일성 검증.
// 사용: npx tsx --env-file=.env.local scripts/verify-overview-parity.ts > /tmp/overview-{before|after}.txt
// stdout = 품목별 계산값 다이제스트(diff 대상), stderr = 소요 시간.
import { computeInventoryOverview } from '../app/(app)/inventory/overview'
import prisma from '../lib/prisma'

async function main() {
  // 전 영업장 순회 — 멀티테넌트 회귀는 첫 영업장 하나로 증명되지 않음(적대검증 지적).
  const props = await prisma.property.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
  if (props.length === 0) { console.error('NO PROPERTY'); process.exit(1) }
  const t0 = Date.now()
  let total = 0
  for (const prop of props) {
    const rows = await computeInventoryOverview(prop.id)
    total += rows.length
    for (const r of rows) {
      console.log([
        prop.name,
        r.label, r.category, r.trackUnit, r.specUnit ?? '', r.qtyUnit ?? '',
        r.currentStock, r.avgDaily?.toFixed(6) ?? '', r.avgDailyBasisDays, r.daysUntilEmpty,
        r.lastPeriodConsumption, r.lastPeriodDays,
        r.avgUnitPrice?.toFixed(4) ?? '', r.lastUnitPrice?.toFixed(4) ?? '',
        JSON.stringify(r.monthlyConsumption),
        r.pendingPurchases.length,
        JSON.stringify(r.locations.map(l => l.id)),
        JSON.stringify(r.lastCheckLocationBreakdown),
      ].join('|'))
    }
  }
  console.error(`TIME ${Date.now() - t0}ms rows=${total} props=${props.length}`)
  await prisma.$disconnect()
}
main()
