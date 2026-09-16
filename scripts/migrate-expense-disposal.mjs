// 자재 폐기·분실 두 칸 추가(비파괴) — expenses 에 disposedAt(date)·disposalReason(text) nullable.
// 실행: node --env-file=.env.local scripts/migrate-expense-disposal.mjs
// SQL 전문은 migrate_expense_disposal.sql 과 같다(Supabase SQL 편집기로 돌려도 결과 동일).
//
// 왜 지출 행에 붙나. 축이 둘이다 — 돈의 축(방에 들어간 누적 금액, 절대 안 줄어든다)과
// 물건의 축(우리가 사서 넣은 것 중 살아 있는 개수). 별도 이벤트 표로 빼면 뺄셈이 되어 음수가
// 열리고 게이트를 여섯 곳에 매달아야 한다. 행에 표식을 두면 금액은 그대로고 수량만 갈라진다.
//
// 백필은 하지 않는다(운영자 확정 2026-09-16) — 숫자만으로는 정상인 방과 초과 설치된 방을
// 구별할 수 없고 배정일도 설치일이 아니다. 명부만 낸다(scripts/check-asset-overinstall.ts).
// 멱등(IF NOT EXISTS) — 다시 돌려도 안전하다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const COLS = [['disposedAt', 'date'], ['disposalReason', 'text']]

async function main() {
  for (const [col, type] of COLS) {
    console.log(`→ ADD COLUMN expenses."${col}" ${type}`)
    // 컬럼명은 camelCase + 큰따옴표 — 따옴표 없이 만들면 Postgres 가 소문자로 접어 Prisma 와 갈린다.
    await prisma.$executeRawUnsafe(`ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
  }
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'expenses' AND column_name IN ('disposedAt', 'disposalReason') ORDER BY column_name`)
  for (const c of cols) console.log(`  [확인] ${c.column_name} ${c.data_type} nullable=${c.is_nullable}`)
  const [{ n: total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "expenses"`)
  const [{ n: nulls }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "expenses" WHERE "disposedAt" IS NULL`)
  console.log(`  [확인] 지출 ${total}행 · disposedAt IS NULL ${nulls}행 (기존 행은 전부 '지금 설치돼 있음')`)
  if (cols.length !== 2 || total !== nulls) {
    console.error('  [실패] 칸이 둘이 아니거나 기존 행이 null 이 아니다')
    process.exit(1)
  }
  await prisma.$disconnect()
}

main()
