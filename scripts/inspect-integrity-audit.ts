// 데이터 정합 감사를 예행으로 돌려 위반만 출력한다(오류신고 적재 없음, 읽기 전용). 새 규칙이 실제 데이터를 잡는지 확인하는 길.
// 실행: npx tsx --env-file=.env.local scripts/inspect-integrity-audit.ts [서명 조각]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { runIntegrityAudit } from '../lib/integrityAudit'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const filter = process.argv[2] ?? ''

async function main() {
  const { violations } = await runIntegrityAudit(prisma, { dryRun: true })
  const rows = violations.filter(v => v.signature.includes(filter))
  console.log(`위반 ${rows.length}건${filter ? ` (서명에 '${filter}' 포함)` : ''} / 전체 ${violations.length}건`)
  for (const v of rows) console.log(`- ${v.signature}\n  ${v.note}`)
}

main().finally(() => prisma.$disconnect())
