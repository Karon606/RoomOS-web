// 품목별 보관위치 숨김(비파괴 1단계) — tracked_item_locations.closedAt nullable 추가.
// null=표시(열림), 값=그 시점에 이 품목에서 이 위치를 숨김. StorageLocation 은 영업장 공용이라 안 지운다.
// 숨김은 (품목, 위치) 쌍의 속성 — 위치 자체를 숨기면 무관한 품목이 함께 사라진다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  console.log('→ ADD COLUMN tracked_item_locations."closedAt"')
  await prisma.$executeRawUnsafe(`ALTER TABLE "tracked_item_locations" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3)`)
  const n = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "tracked_item_locations"`)
  console.log(`적용 완료 — 기존 링크 ${n[0].c}행 전부 NULL(=표시). 화면 불변.`)
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
