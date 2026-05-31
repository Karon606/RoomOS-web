// migrate_stock_check_source.sql 적용 — StockCheck.sourceExpenseId FK 추가
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('→ ADD COLUMN sourceExpenseId')
  await prisma.$executeRawUnsafe(`ALTER TABLE "stock_checks" ADD COLUMN IF NOT EXISTS "sourceExpenseId" uuid`)

  // 이미 FK가 있으면 두 번째 추가는 에러 — 존재 여부 체크
  const exists = await prisma.$queryRawUnsafe<any[]>(`
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_checks_sourceExpenseId_fkey'
  `)
  if (exists.length === 0) {
    console.log('→ ADD FOREIGN KEY')
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "stock_checks"
      ADD CONSTRAINT "stock_checks_sourceExpenseId_fkey"
      FOREIGN KEY ("sourceExpenseId") REFERENCES "expenses"("id") ON DELETE SET NULL
    `)
  } else {
    console.log('→ FK already exists, skip')
  }

  console.log('→ CREATE INDEX')
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "stock_checks_sourceExpenseId_idx" ON "stock_checks"("sourceExpenseId")`)

  console.log('✅ migration applied')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
