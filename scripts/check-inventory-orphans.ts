// 재고 축에서 사라진 구매·오염된 단위 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-04, 신고 78ff0e64·102d768f).
//
// 두 결함을 한 그물로 지킨다. 둘 다 "저장은 됐는데 재고에는 없다"로 끝나기 때문이다.
//   1) 품목 귀속은 라벨 **완전일치**다. 괄호 하나만 달라도 어느 카드에도 안 붙는다.
//      "종량제쓰레기봉투 (50L)" 20매 25,000원이 그렇게 사라졌고, 보류 결정을 보여주는 화면이
//      2026-07-09 이후 없어서 되살릴 길조차 없었다.
//   2) 단위 칸에 뜻 없는 기호가 들어오면 단위가 채워진 카드와 매칭이 탈락한다.
//      영수증 인식이 줄표를 단위로 읽어 넘긴 것을 앱이 그대로 적었다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const HAS_WORD = /[\p{L}\p{N}]/u
const junk = (v: string | null) => !!v && !HAS_WORD.test(v.trim())

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []
  // 미아는 지금 게이트가 아니다. 운영자가 재고 화면에서 어느 품목에 넣을지 정해야 닫히는데,
  // 그 결정 전까지 게이트로 걸면 그동안 모든 푸시가 막힌다. 0 이 되면 게이트로 올린다.
  const orphans: string[] = []

  const cards = await prisma.trackedItem.findMany({ select: { label: true, category: true } })
  const known = new Set(cards.map(c => `${c.category}|${c.label}`))

  // 추적 카테고리 판정은 카드가 하나라도 있는 카테고리로 잡는다 — 설정을 복제하지 않는다.
  const trackedCats = new Set(cards.map(c => c.category))
  const expenses = await prisma.expense.findMany({
    select: { id: true, date: true, category: true, itemLabel: true, qtyUnit: true, specUnit: true, excludeFromInventory: true },
  })

  for (const e of expenses) {
    if (junk(e.qtyUnit) || junk(e.specUnit)) {
      violations.push(`[단위] ${e.date.toISOString().slice(0, 10)} "${e.itemLabel ?? '?'}" 의 단위가 뜻 없는 기호다 — 단위가 채워진 품목과 매칭이 탈락한다`)
    }
    if (e.excludeFromInventory || !e.itemLabel || !trackedCats.has(e.category)) continue
    if (!known.has(`${e.category}|${e.itemLabel}`)) {
      orphans.push(`${e.date.toISOString().slice(0, 10)} "${e.itemLabel}"`)
    }
  }

  await prisma.$disconnect()

  console.log(`[재고 귀속] 지출 ${expenses.length}건 · 카드 ${cards.length}개 검사 / 위반 ${violations.length}건`)
  if (orphans.length) {
    console.log(`  [현황] 재고에 못 붙은 구매 ${orphans.length}건 (현재 기준선 1). 재고 화면의 알림에서 품목을 정하면 닫힌다.`)
    for (const o of orphans) console.log('    - ' + o)
  }
  if (violations.length) {
    console.error(`\n[재고 귀속] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  재고 화면의 "재고에 못 붙은 구매" 에서 어느 품목에 넣을지 정하면 닫힌다.')
    process.exit(1)
  }
}

main()
