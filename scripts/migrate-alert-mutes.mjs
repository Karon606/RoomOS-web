// 알림 끄기 일반화 — alertMutes 칸 추가 + 어제 쓰던 receiptAlertMutes 를 receipt: 접두어로 이주(멱등).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "alertMutes" jsonb`)
  const rows = await prisma.$queryRawUnsafe(`SELECT id, "receiptAlertMutes", "alertMutes" FROM "properties" WHERE "receiptAlertMutes" IS NOT NULL AND "alertMutes" IS NULL`)
  for (const r of rows) {
    const src = Array.isArray(r.receiptAlertMutes) ? r.receiptAlertMutes : []
    const moved = src.filter(m => m && typeof m.k === 'string').map(m => ({ k: `receipt:${m.k}`, at: typeof m.at === 'string' ? m.at : '' }))
    await prisma.$executeRawUnsafe(`UPDATE "properties" SET "alertMutes" = $1::jsonb WHERE id = $2`, JSON.stringify(moved), r.id)
    console.log(`이주 ${r.id.slice(0, 8)} — ${moved.length}건`)
  }
  console.log(`완료 — 대상 ${rows.length}곳`)
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
