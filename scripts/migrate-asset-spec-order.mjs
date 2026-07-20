// 비품 순서 2계층(라벨 내 규격 순서) 컬럼 추가 — asset_item_order.specKey('' = 라벨 행, 비파괴).
// unique를 (propertyId, category, itemLabel) → (+specKey)로 교체. 기존 행은 '' 기본값이라 무손실.
// (운영자 승인 2026-07-20, 신고 1b8e7030 — 매트리스 커버 색상 간 순서 편집)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  console.log('→ ADD COLUMN asset_item_order."specKey"')
  await prisma.$executeRawUnsafe(`ALTER TABLE "asset_item_order" ADD COLUMN IF NOT EXISTS "specKey" text NOT NULL DEFAULT ''`)
  console.log('→ unique 교체 (itemLabel → itemLabel+specKey)')
  // 옛 unique가 제약조건 형태면 DROP INDEX가 실패하므로 제약조건 삭제를 먼저 시도(1차 실행이 여기서 멈췄던 원인)
  await prisma.$executeRawUnsafe(`ALTER TABLE "asset_item_order" DROP CONSTRAINT IF EXISTS "asset_item_order_propertyId_category_itemLabel_key"`)
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "asset_item_order_propertyId_category_itemLabel_key"`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "asset_item_order_propertyId_category_itemLabel_specKey_key" ON "asset_item_order"("propertyId","category","itemLabel","specKey")`)
  console.log('migration applied')
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
