// 투어 예정 시간 컬럼 추가(비파괴 1단계) — lease_terms.tourTime nullable text ("HH:MM", null=시간 미정).
// tourDate 는 @db.Date(날짜 전용)이고 소비처가 날짜 전제라 타입 변경 대신 별도 컬럼(운영자 요청 86ceb645).
// 캘린더 피드가 시간 있으면 시각 지정 이벤트(1시간 전 알림), 없으면 종일 이벤트로 낸다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  console.log('→ ADD COLUMN lease_terms."tourTime"')
  await prisma.$executeRawUnsafe(`ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "tourTime" text`)
  console.log('migration applied')
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
