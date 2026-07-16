// UserRole enum에 LIMITED_STAFF 값 추가(비파괴, 가산적) — 제한 스태프 역할(오류신고 65992b0a).
// Postgres enum 값 추가는 기존 데이터 무영향. IF NOT EXISTS로 멱등.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('→ ADD VALUE LIMITED_STAFF to enum UserRole')
  await prisma.$executeRawUnsafe(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LIMITED_STAFF'`)
  console.log('migration applied')
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
