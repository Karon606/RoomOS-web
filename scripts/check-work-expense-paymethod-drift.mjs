// 작업·청소에 걸린 지출 중 결제수단이 빈 것을 세는 데이터 감지망 — 읽기 전용. 알려진 수 이하면 경고, 넘으면 위반(exit 1).
//
// 왜 (2026-10-27 운영자 지적, 승인 계획 1단계·결정 4). 작업·청소 완료가 지출을 만들 때 결제수단을 안 적던 시절의 행이 남아 있다.
// 1단계 배포 뒤 만든 행은 결제수단이 꼭 서야 한다(정적 그물 check-work-expense-paymethod 가 코드를 본다). 이 그물은 장부를 본다.
// 배포 전 행은 운영자가 실제 수단을 확인한 뒤 백필한다(scripts/backfill-expense-paymethod.ts, 예행 기본). 그 전까지는 경고로 둔다.
//
// 대상: 결제수단이 빈 지출 중 살아 있든 지워졌든 어떤 청소가 가리키거나(RoomCleaning.expenseId) 작업에 걸린 것(Expense.roomWorkId).
// 알려진 수(KNOWN_BEFORE_BACKFILL)는 2026-10-27 운영 실측이다(청소 5 · 작업 2). 백필을 마치면 0 으로 내린다(그때부터 한 건도 위반).
//
// 실행: node --env-file=.env.local scripts/check-work-expense-paymethod-drift.mjs
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

export const KNOWN_BEFORE_BACKFILL = 7

const ymd = d => (d ? d.toISOString().slice(0, 10) : '날짜 미상')

/** 트랜잭션 클라이언트도 받는다(역주입 리허설이 커밋 없이 같은 판정을 부를 수 있게). */
export async function findWorkExpensesWithoutPayMethod(db) {
  const cleanings = await db.roomCleaning.findMany({ where: { expenseId: { not: null } }, select: { expenseId: true } })
  const cleaningExpenseIds = [...new Set(cleanings.map(c => c.expenseId))]
  const rows = await db.expense.findMany({
    where: { payMethod: null, OR: [{ roomWorkId: { not: null } }, { id: { in: cleaningExpenseIds } }] },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { date: true, amount: true, category: true, vendor: true, roomWorkId: true, room: { select: { roomNo: true } } },
  })
  return rows.map(r => `${r.room?.roomNo ?? '?'}호 ${ymd(r.date)} ${r.amount.toLocaleString('ko-KR')}원 ${r.category} ${r.vendor ?? ''} (${r.roomWorkId ? '작업' : '청소'})`.trim())
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const rows = await findWorkExpensesWithoutPayMethod(prisma)
  await prisma.$disconnect()
  if (rows.length === 0) { console.log('[작업·청소 지출 결제수단] 결제수단 빈 지출 0건'); return }
  const over = rows.length > KNOWN_BEFORE_BACKFILL
  const log = over ? console.error : console.log
  log(`[작업·청소 지출 결제수단] 결제수단 빈 지출 ${rows.length}건 (알려진 백필 전 수 ${KNOWN_BEFORE_BACKFILL}) ${over ? '위반' : '경고'}`)
  for (const r of rows) log('  - ' + r)
  if (over) {
    console.error('  알려진 수보다 많다. 결제수단 없이 지출을 만드는 경로가 다시 생겼다(check-work-expense-paymethod 확인).')
    process.exit(1)
  }
  console.log('  운영자 확인 뒤 scripts/backfill-expense-paymethod.ts 로 채우고 KNOWN_BEFORE_BACKFILL 을 0 으로 내린다.')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
