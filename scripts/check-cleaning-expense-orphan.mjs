// 청소 이력과 청소 지출이 서로를 잃어버리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가
//   RoomCleaning.expenseId 는 관계가 아니라 uuid 칸이고 Expense 에는 소프트삭제 칸이 없다.
//   그래서 지출 화면에서 청소 지출을 지우면 아무 에러 없이 끊긴 링크가 남는다(507호에서 실재).
//   반대 방향도 같다. 청소 기록을 지우면 그 돈을 설명하는 것이 아무것도 없는 지출만 남는다.
//   둘 다 조용해서, 방별 비용은 맞는데 청소 이력에는 금액이 안 뜨거나 그 반대가 된다.
//
// 두 방향
//   (가) 살아 있는 청소가 가리키는 지출이 없다 — 링크가 끊겼다.
//   (나) 방에 걸린 청소용역비 지출인데 살아 있는 어떤 청소도 안 가리킨다 — 고아 지출.
//        roomId 없는 건물 청소비(고정지출)는 애초에 청소 이력과 짝이 아니라 대상이 아니다.
//
// 실행: node --env-file=.env.local scripts/check-cleaning-expense-orphan.mjs
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// 카테고리 이름은 화면·서버가 쓰는 정본에서 읽는다 — 여기 문자열을 복제하면 정본을 고쳐도
// 감지망만 옛 이름을 보고 영원히 0 건을 보고한다.
const CANON = 'app/(app)/room-manage/cleaningConstants.ts'
const CATEGORY = (readFileSync(CANON, 'utf8').match(/CLEANING_EXPENSE_CATEGORY\s*=\s*'([^']+)'/) ?? [])[1]
if (!CATEGORY) {
  console.error(`[청소 지출] ${CANON} 에서 CLEANING_EXPENSE_CATEGORY 를 못 읽었다 — 검사가 통째로 건너뛰어졌다. 감지망을 고쳐야 한다.`)
  process.exit(1)
}

const ymd = d => (d ? d.toISOString().slice(0, 10) : '날짜 미상')

/**
 * 두 방향을 한 번에 훑는다. 트랜잭션 클라이언트도 받도록 db 를 인자로 둔다 —
 * 역주입 리허설이 커밋 없이 같은 판정을 부를 수 있어야 한다(운영 DB 에 흔적을 남기지 않는다).
 */
export async function findCleaningExpenseOrphans(db) {
  // 소프트삭제 익스텐션은 앱 쪽 클라이언트에만 붙는다. 여기서는 직접 걸러야 한다.
  const cleanings = await db.roomCleaning.findMany({
    where: { deletedAt: null },
    select: {
      id: true, expenseId: true, status: true, scheduledDate: true, doneDate: true,
      room: { select: { roomNo: true } },
    },
  })
  const linkedIds = [...new Set(cleanings.map(c => c.expenseId).filter(Boolean))]
  const aliveIds = new Set(
    (await db.expense.findMany({ where: { id: { in: linkedIds } }, select: { id: true } })).map(e => e.id),
  )

  // (가) 끊긴 링크
  const dangling = cleanings
    .filter(c => c.expenseId && !aliveIds.has(c.expenseId))
    .map(c => `${c.room?.roomNo ?? '?'}호 ${ymd(c.doneDate ?? c.scheduledDate)} [${c.status}] — 걸린 지출 ${c.expenseId} 가 없다`)

  // (나) 고아 지출
  const linked = new Set(linkedIds)
  const expenses = await db.expense.findMany({
    where: { category: CATEGORY, roomId: { not: null } },
    select: { id: true, date: true, amount: true, detail: true, vendor: true, room: { select: { roomNo: true } } },
  })
  const orphans = expenses
    .filter(e => !linked.has(e.id))
    .map(e => `${e.room?.roomNo ?? '?'}호 ${ymd(e.date)} ${e.amount.toLocaleString('ko-KR')}원 ${e.detail ?? e.vendor ?? ''}`.trim())

  return { dangling, orphans, cleaningCount: cleanings.length, expenseCount: expenses.length }
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const { dangling, orphans, cleaningCount, expenseCount } = await findCleaningExpenseOrphans(prisma)
  await prisma.$disconnect()

  console.log(`[청소 지출] 살아 있는 청소 ${cleaningCount}건 · 방에 걸린 ${CATEGORY} 지출 ${expenseCount}건 검사`)
  if (dangling.length) {
    console.error(`\n[끊긴 링크] ${dangling.length}건 — 청소 이력에 금액이 안 뜬다`)
    for (const d of dangling) console.error('  - ' + d)
    console.error('  청소 이력에서 완료 처리를 다시 하면 지출이 새로 생기고 링크가 이어진다.')
  }
  if (orphans.length) {
    console.error(`\n[고아 지출] ${orphans.length}건 — 이 돈을 설명하는 청소 기록이 없다`)
    for (const o of orphans) console.error('  - ' + o)
    console.error('  청소 이력에 해당 건을 남기거나, 방과 무관한 돈이면 지출에서 대상 호실을 비운다.')
  }
  const total = dangling.length + orphans.length
  if (total > 0) {
    console.error(`\n[청소 지출] 위반 ${total}건`)
    process.exit(1)
  }
  console.log('[청소 지출] 위반 0건')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
