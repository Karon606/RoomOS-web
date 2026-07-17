// orphan 링크 정합 복구 — 재고가 들어가 있는데 TrackedItemLocation 링크가 없는 (품목, 위치) 조합을 채운다.
//
// 왜: 위치별 재고확인 탭·보정 폼이 링크(row.locations)로 필터하므로, 링크 없는 위치의 재고는
//   화면에서 통째로 안 보인다(오류신고 601303c5 — 김치 15kg). 더 나쁜 건 타임라인 보정 폼이
//   '예상 20 / 실측 5' 라는 가짜 차이를 보여주고, 그대로 저장하면 총량이 5로 박혀 15kg 이 조용히 사라지는 것.
//
// 대상 선정 = "마지막 점검의 breakdown 중 잔량>0 인데 링크가 없는 조합".
//   전 이력이 아니라 마지막 점검으로 좁힌다 — 불변식이 현재시제("지금 들어가 있다")이고,
//   과거의 qty=0 행까지 링크하면 운영자가 의도적으로 해제했던 위치를 부활시킨다.
//   품목·영업장 하드코딩 없음(멀티테넌트).
//
// 실행 순서: orphan 생성기 차단(transferLocationStock·confirmReceipt·additionsSinceCheckByLocation·
//   mergeTrackedItems) 배포 뒤에 실행할 것. 먼저 하면 이동 한 번에 다시 깨진다.
// 재실행 안전(멱등): ON CONFLICT DO NOTHING + 술어 자기소멸.
// 적용취소: 아래가 출력하는 대상 목록의 (trackedItemId, storageLocationId) 를 DELETE.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const TARGET_SQL = `
  SELECT DISTINCT lc."trackedItemId", scl."storageLocationId", ti.label, sl.name AS "locName", scl."remainingQty"
  FROM (
    SELECT DISTINCT ON (sc."trackedItemId") sc.id, sc."trackedItemId"
    FROM stock_checks sc
    ORDER BY sc."trackedItemId", sc."date" DESC, sc."createdAt" DESC
  ) lc
  JOIN stock_check_locations scl ON scl."stockCheckId" = lc.id
  JOIN tracked_items ti ON ti.id = lc."trackedItemId"
  JOIN storage_locations sl ON sl.id = scl."storageLocationId"
  LEFT JOIN tracked_item_locations til
    ON til."trackedItemId" = lc."trackedItemId" AND til."storageLocationId" = scl."storageLocationId"
  WHERE scl."remainingQty" > 0 AND til."trackedItemId" IS NULL
`

async function main() {
  const apply = process.argv.includes('--apply')
  const targets = await prisma.$queryRawUnsafe(TARGET_SQL)
  if (targets.length === 0) { console.log('orphan 없음 — 할 일 없음(멱등)'); return }
  console.log(`대상 ${targets.length}건`)
  for (const t of targets) {
    console.log(`  ${t.label} · ${t.locName} · ${t.remainingQty}  (${t.trackedItemId} / ${t.storageLocationId})`)
  }
  if (!apply) { console.log('\n드라이런입니다. 실제 적용은 --apply 를 붙여 실행하세요.'); return }
  const n = await prisma.$executeRawUnsafe(`
    INSERT INTO tracked_item_locations ("trackedItemId", "storageLocationId")
    SELECT DISTINCT lc."trackedItemId", scl."storageLocationId"
    FROM (
      SELECT DISTINCT ON (sc."trackedItemId") sc.id, sc."trackedItemId"
      FROM stock_checks sc
      ORDER BY sc."trackedItemId", sc."date" DESC, sc."createdAt" DESC
    ) lc
    JOIN stock_check_locations scl ON scl."stockCheckId" = lc.id
    LEFT JOIN tracked_item_locations til
      ON til."trackedItemId" = lc."trackedItemId" AND til."storageLocationId" = scl."storageLocationId"
    WHERE scl."remainingQty" > 0 AND til."trackedItemId" IS NULL
    ON CONFLICT DO NOTHING
  `)
  console.log(`\n적용 완료 — ${n}행 삽입`)
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
