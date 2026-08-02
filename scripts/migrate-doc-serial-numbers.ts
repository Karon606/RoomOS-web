// 서류 발행번호를 원장으로 — receiptNo·contractNo 컬럼 추가 (운영자 승인 2026-08-03).
//
// 왜
//   발행번호를 count(propertyId)+1 로 그 자리에서 만들어 PDF 에 그리기만 하고 저장하지 않았다. 그래서
//     1) 미리보기·보내기에도 같은 번호가 찍혀 **소비되지 않은 채 종이·사진으로 밖에 나간다.**
//        그 뒤 실제 발급본이 같은 번호를 갖는다.
//     2) 동시 발급이면 두 건이 같은 번호를 받는다(경합 무방비).
//     3) 계약번호는 스캔 업로드본까지 세어 다음 앱 발급본의 번호가 건너뛴다.
//   그런데 영수증 본문은 "발행번호로 진위 확인이 가능합니다" 라고 단언했다. 대조할 원장이 없었다.
//   (그 문구는 8918669 에서 이미 내렸다.)
//
// 무엇을 하나
//   rent_receipt_files."receiptNo"  text · (propertyId, receiptNo) 유니크
//   contract_files."contractNo"     text · (propertyId, contractNo) 유니크
//   기존 행은 null 로 둔다. **소급 채번하지 않는다** — 이미 종이로 나간 번호를 알 수 없고,
//   추정해 넣으면 원장이 근거 없는 값이 된다. 앞으로 발급분부터 진짜 번호가 쌓인다.
//
// 유니크는 부분 인덱스로 만든다(null 은 여러 개 허용). Postgres 의 UNIQUE 는 null 을 구별하므로
// 그냥 UNIQUE 로도 되지만, 의도를 명시하려고 WHERE 절을 붙인다.
//
// 실행:   npx tsx --env-file=.env.local scripts/migrate-doc-serial-numbers.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

const UP = [
  `ALTER TABLE "rent_receipt_files" ADD COLUMN IF NOT EXISTS "receiptNo" text`,
  `ALTER TABLE "contract_files"     ADD COLUMN IF NOT EXISTS "contractNo" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "rent_receipt_files_propertyId_receiptNo_key"
     ON "rent_receipt_files" ("propertyId", "receiptNo") WHERE "receiptNo" IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "contract_files_propertyId_contractNo_key"
     ON "contract_files" ("propertyId", "contractNo") WHERE "contractNo" IS NOT NULL`,
]
const DOWN = [
  `DROP INDEX IF EXISTS "rent_receipt_files_propertyId_receiptNo_key"`,
  `DROP INDEX IF EXISTS "contract_files_propertyId_contractNo_key"`,
  `ALTER TABLE "rent_receipt_files" DROP COLUMN IF EXISTS "receiptNo"`,
  `ALTER TABLE "contract_files"     DROP COLUMN IF EXISTS "contractNo"`,
]

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const stmts = revert ? DOWN : UP
  console.log(revert ? '되돌리기 — 컬럼·인덱스 제거' : '적용 — 컬럼·인덱스 추가')
  for (const sql of stmts) console.log('  ' + sql.replace(/\s+/g, ' ').trim())

  if (!apply) { console.log('\n실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }
  for (const sql of stmts) await prisma.$executeRawUnsafe(sql)

  const rc = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "rent_receipt_files"`)
  const cc = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "contract_files"`)
  console.log(`\n반영 완료. 기존 영수증 ${rc[0].n}건 · 계약서 ${cc[0].n}건은 번호 null 로 남는다(소급 채번 안 함).`)
  await prisma.$disconnect()
}

void main()
