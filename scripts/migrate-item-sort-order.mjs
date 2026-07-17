// 재고 품목 사용자 지정 순서(비파괴 1단계) — tracked_items.sortOrder nullable int.
// null = 미지정(기존 가나다순 위치 유지, 정렬 뒤로 가지 않게 nulls last + label 2차 정렬).
// 운영자 요청 a5e258c3: 식료품 리스트에서 김치·라면·쌀 순서를 드래그로 바꾸는 기능.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  console.log('→ ADD COLUMN tracked_items."sortOrder"')
  await prisma.$executeRawUnsafe(`ALTER TABLE "tracked_items" ADD COLUMN IF NOT EXISTS "sortOrder" integer`)
  console.log('migration applied — 전부 NULL(기존 정렬 불변)')
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
