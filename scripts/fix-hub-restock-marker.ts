// 허브 자기 행에 붙은 보충 마커(restockedQty)를 null 로 되돌리는 백필 — 예행 기본, --apply 로 적용.
//
// 왜 (2026-09-11 김치). 보충 마커는 '창고에서 이 위치로 옮긴 양'이라 창고 자신에게는 뜻이 없다.
// 그런데 위치별 재고확인 탭의 허브 칸이 '채운 후'에 묶여 있어 후 − 전(빈칸=0) = 잔량 전체가
// 보충량으로 셈해졌고, 그 값이 허브 행에 +N 으로 박혔다. 그 마커는
//   · 타임라인에 '창고 → 각 위치 +17kg' 이라는 없던 이동을 그리고,
//   · 이월/실측 판정(lib/stockLedger planCheckPropagation)의 허브 차감을 흔들며,
//   · check-restock-hub-drift 의 미차감 판정을 오염시킨다.
// 잔량(remainingQty)은 건드리지 않는다 — 그 값은 운영자가 실제로 센 수다. 지우는 것은 마커뿐이다.
//
// 생성 경로는 이미 두 겹으로 막았다(InventoryClient 허브 칸을 '채우기 전'에 묶고,
// lib/stockCheckMerge applyLocationCheck 이 isHubChecked 면 마커를 안 붙인다). 이 스크립트는
// 그 이전에 박힌 값을 걷어내는 일회성 백필이다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-hub-restock-marker.ts [--apply]
import prisma from '../lib/prisma'

const APPLY = process.argv.includes('--apply')

async function main() {
  // 품목 허브 = 품목 선언(hubLocationId) 우선, 없으면 영업장 기본 허브(isHub) — 화면·감지망과 같은 규칙.
  const defaultHubs = await prisma.storageLocation.findMany({ where: { isHub: true }, select: { id: true, propertyId: true } })
  const defaultHubByProperty = new Map(defaultHubs.map(h => [h.propertyId, h.id]))
  const items = await prisma.trackedItem.findMany({
    select: { id: true, label: true, hubLocationId: true, propertyId: true, property: { select: { name: true } } },
  })

  const targets: { id: string; line: string }[] = []
  for (const it of items) {
    const hubId = it.hubLocationId ?? defaultHubByProperty.get(it.propertyId) ?? null
    if (!hubId) continue
    const rows = await prisma.stockCheckLocation.findMany({
      where: { storageLocationId: hubId, restockedQty: { gt: 0 }, stockCheck: { trackedItemId: it.id } },
      select: {
        id: true, remainingQty: true, restockedQty: true,
        stockCheck: { select: { date: true, memo: true } },
        storageLocation: { select: { name: true } },
      },
    })
    for (const r of rows) {
      targets.push({
        id: r.id,
        line: `${it.property.name} · ${it.label} ${r.stockCheck.date.toISOString().slice(0, 10)} · ${r.storageLocation.name} 잔량 ${r.remainingQty} · 마커 +${r.restockedQty} → null`,
      })
    }
  }

  console.log(`\n[허브 자기 마커 정리] 대상 ${targets.length}건 ${APPLY ? '(적용)' : '(예행 — 적용하려면 --apply)'}`)
  for (const t of targets) console.log('  - ' + t.line)

  if (APPLY && targets.length > 0) {
    const r = await prisma.stockCheckLocation.updateMany({
      where: { id: { in: targets.map(t => t.id) } },
      data: { restockedQty: null },
    })
    console.log(`\n적용 완료 — ${r.count}행의 마커를 null 로 되돌렸다(잔량은 그대로).`)
  }
  await prisma.$disconnect()
}

main()
