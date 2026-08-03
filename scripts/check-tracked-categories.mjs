// 재고 카드 카테고리 감사(서빙집게·집게보관통·의자 사건 재발 감지) — 읽기 전용.
// 비추적 카테고리(영업장 inventoryCategories 밖)에 남은 활성 TrackedItem을 나열한다. 0건이 정상.
// 이런 카드는 소모품 화면과 비품·자재 화면에 이중 표시된다(생성 경로는 동기화 가드로 봉합됨).
// 사용: node --env-file=.env.local scripts/check-tracked-categories.mjs
//   정리(--fix): 재고 기록 0인 좀비 카드 삭제(스냅샷 출력), 기록 있으면 숨김 안내만.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const FIX = process.argv.includes('--fix')
const DEFAULT_TRACKED = ['부식비', '소모품비', '폐기물 처리비']

async function main() {
  const props = await prisma.property.findMany({ select: { id: true, name: true, inventoryCategories: true } })
  let bad = 0
  for (const p of props) {
    // 파싱 규칙은 categoryConfig.parseInventoryCategories 와 동일([{cat, alias}] JSON, 없으면 기본 3종)
    let tracked = DEFAULT_TRACKED
    if (p.inventoryCategories) {
      try {
        const parsed = JSON.parse(p.inventoryCategories)
        if (Array.isArray(parsed)) {
          const cats = parsed.map(e => (typeof e?.cat === 'string' ? e.cat.trim() : '')).filter(Boolean)
          if (cats.length) tracked = cats
        }
      } catch { /* 기본값 유지 */ }
    }
    const zombies = await prisma.trackedItem.findMany({
      where: { propertyId: p.id, isArchived: false, category: { notIn: tracked } },
    })
    for (const z of zombies) {
      bad++
      const [checks, adds, disps] = await Promise.all([
        prisma.stockCheck.count({ where: { trackedItemId: z.id } }),
        prisma.stockAddition.count({ where: { trackedItemId: z.id } }),
        prisma.stockDisposal.count({ where: { trackedItemId: z.id } }),
      ])
      const empty = checks + adds + disps === 0
      console.log(`[${p.name}] ${z.label} · ${z.category} (id ${z.id.slice(0, 8)}, 점검 ${checks}·입수 ${adds}·폐기 ${disps}) ${empty ? '— 빈 카드' : '— 기록 있음'}`)
      if (FIX) {
        if (empty) {
          console.log(`  삭제(스냅샷): label=${JSON.stringify(z.label)} category=${z.category} trackUnit=${z.trackUnit} specUnit=${z.specUnit} qtyUnit=${z.qtyUnit} alertThresholdDays=${z.alertThresholdDays}`)
          await prisma.trackedItem.delete({ where: { id: z.id } })
          console.log('  삭제 완료 (undo = 스냅샷 값으로 재생성)')
        } else {
          console.log('  기록이 있어 자동 삭제 안 함 — 재고 화면에서 숨김 처리 권장')
        }
      }
    }
  }
  console.log(bad === 0 ? '비추적 카테고리 활성 카드 없음 — 정상.' : `비추적 카테고리 활성 카드 ${bad}건${FIX ? ' 처리 시도 완료' : ' — 정리하려면 --fix'}`)
  // 실패로 알린다(G-4 2026-08-03). --fix 로 정리한 실행은 이미 처리했으니 제외한다.
  if (bad > 0 && !FIX) process.exitCode = 1
  await prisma.$disconnect()
}
main()
