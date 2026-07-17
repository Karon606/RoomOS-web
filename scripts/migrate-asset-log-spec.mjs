// 배정 이력에 규격 컬럼 추가(비파괴 1단계) — asset_assignment_log 에 nullable 3종.
// 이유: 이력이 itemLabel 만으로 기록·조회돼 규격(색상 등)이 다른 카드끼리 이력이 섞였다(오류신고 5853a0ff).
//   더 위험한 건 revertAssignmentLog 가 되돌릴 행을 (라벨, 방)으로만 찾아 다른 규격 행을 끌어올 수 있었던 것.
// 백필: 그 라벨의 지출 규격 조합이 정확히 1종뿐이면 모호함이 없으므로 그 값으로 채운다.
//   2종 이상이면 어느 규격의 이동이었는지 알 방법이 없으므로 null 로 남긴다(= 규격 미상).
//   규격 미상 이력은 조회에서 그 라벨 전체 카드에 계속 보이되(기록 보존), 되돌리기는 앱이 막는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  for (const [col, type] of [['specValue', 'double precision'], ['specUnit', 'text'], ['specText', 'text']]) {
    console.log(`→ ADD COLUMN asset_assignment_log.${col}`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "asset_assignment_log" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
  }
  // 백필 — 규격 조합이 1종뿐인 라벨만. 이미 채워진 행은 건드리지 않는다(재실행 안전).
  const labels = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "itemLabel" FROM "asset_assignment_log" WHERE "itemLabel" IS NOT NULL`,
  )
  let filled = 0, skipped = 0
  for (const { itemLabel } of labels) {
    const combos = await prisma.expense.findMany({
      where: { itemLabel, excludeFromInventory: false },
      select: { specValue: true, specUnit: true, specText: true },
      distinct: ['specValue', 'specUnit', 'specText'],
    })
    if (combos.length !== 1) {
      const n = await prisma.assetAssignmentLog.count({ where: { itemLabel } })
      console.log(`  [규격 미상 유지] ${itemLabel} — 규격 ${combos.length}종 · 이력 ${n}건`)
      skipped += n
      continue
    }
    const { specValue, specUnit, specText } = combos[0]
    const r = await prisma.$executeRawUnsafe(
      `UPDATE "asset_assignment_log" SET "specValue" = $1, "specUnit" = $2, "specText" = $3
       WHERE "itemLabel" = $4 AND "specValue" IS NULL AND "specUnit" IS NULL AND "specText" IS NULL`,
      specValue, specUnit, specText, itemLabel,
    )
    filled += r
  }
  console.log(`\nmigration applied — 백필 ${filled}건 · 규격 미상 유지 ${skipped}건`)
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
