// 비품 품목 표시 순서(비파괴) — asset_item_order 신설. 비품은 Expense 기반이라 tracked_items.sortOrder 를
// 못 쓴다(37종 중 대다수가 수선유지비로 tracked_items 에 없음). (propertyId, category, itemLabel) 키로 순서 저장.
// 순수 표시 순서 — 계산·금액 무관. 순서 미지정 품목은 뒤에서 기존 정렬(구매일) 유지.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  await prisma.$executeRawUnsafe(`
    create table if not exists asset_item_order (
      id uuid primary key default gen_random_uuid(),
      "propertyId" uuid not null references properties(id) on delete cascade,
      category text not null,
      "itemLabel" text not null,
      "sortOrder" integer not null,
      "createdAt" timestamptz not null default now(),
      unique("propertyId", category, "itemLabel")
    )`)
  await prisma.$executeRawUnsafe(`create index if not exists asset_item_order_prop_cat_idx on asset_item_order("propertyId", category)`)
  const n = await prisma.$queryRawUnsafe(`select count(*)::int c from asset_item_order`)
  console.log(`asset_item_order 생성 완료 — ${n[0].c}행(빈 테이블, 기존 정렬 불변)`)
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
