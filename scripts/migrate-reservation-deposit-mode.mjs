// 예약금 처리 모드 컬럼 추가(비파괴 1단계) — Property/LeaseTerm에 nullable 컬럼.
// Property.reservationDepositMode = 영업장 기본값('deposit'|'prepaid'|'none', null=deposit 해석).
// LeaseTerm.reservationDepositMode = 예약별 선택(null=영업장 기본 상속).
// 소프트삭제-record추론 충돌 때문에 LeaseTerm에도 모드를 영속(적대검증 발견 4).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('→ ADD COLUMN properties.reservationDepositMode')
  await prisma.$executeRawUnsafe(`ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "reservationDepositMode" text`)
  console.log('→ ADD COLUMN lease_terms.reservationDepositMode')
  await prisma.$executeRawUnsafe(`ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "reservationDepositMode" text`)
  console.log('migration applied')
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
