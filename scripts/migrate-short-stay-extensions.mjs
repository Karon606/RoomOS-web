// 단기 연장 이력 컬럼 추가(비파괴 1단계) — lease_terms.shortStayExtensions nullable jsonb.
// append-only 스냅샷 배열: 연장 확정 시 직전 값(rentAmount·퇴실일·상태·일할)과 마커 record id를 보관해
// 단일클릭 적용취소(undo)의 원복 근거로 쓴다(checkoutProrationUndo와 같은 패턴, 운영자 승인 2026-07-20).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
async function main() {
  console.log('→ ADD COLUMN lease_terms."shortStayExtensions"')
  await prisma.$executeRawUnsafe(`ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "shortStayExtensions" jsonb`)
  console.log('migration applied')
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
