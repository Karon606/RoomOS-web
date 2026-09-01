// 현금영수증 알림 끄기 저장 칸 추가 — 멱등(IF NOT EXISTS).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "receiptAlertMutes" jsonb`)
  console.log('migration applied — 기본 NULL(끈 건 없음, 기존 동작 불변)')
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
