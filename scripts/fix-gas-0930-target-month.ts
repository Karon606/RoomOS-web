// 가스요금 9월분을 10/1 에 납부·기록한 1건에 귀속월 2026-09 를 다는 일회성 정정 — 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-10-01, 운영자 승인). 고정지출 회차를 date 의 달로만 판정하던 때라 9월 미기록·10월 기록됨이 됐다.
// 생성 경로는 Expense.targetMonth 와 기록 모달 귀속월 칸으로 막았다(knowledge/domain-expense-target-month).
// date(실제 납부일 10/1)와 카드 청구월은 그대로 둔다 — 바꾸는 것은 targetMonth 한 칸뿐이다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-gas-0930-target-month.ts [--apply | --revert <undo.json>]
import fs from 'node:fs'
import prisma from '../lib/prisma'

const ID = 'bf6aeefb-53fd-4740-b321-b8ffed4caa37'
const TARGET = '2026-09'

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) {
    const snap = JSON.parse(fs.readFileSync(process.argv[revertIdx + 1], 'utf8')) as { id: string; before: string | null; after: string }
    const cur = await prisma.expense.findUnique({ where: { id: snap.id }, select: { targetMonth: true } })
    if (cur?.targetMonth !== snap.after) throw new Error(`현재 값 ${cur?.targetMonth} 이 적용값 ${snap.after} 과 달라 되돌리지 않는다`)
    await prisma.expense.update({ where: { id: snap.id }, data: { targetMonth: snap.before } })
    console.log(`되돌림: targetMonth ${snap.after} -> ${snap.before}`)
    return
  }

  const e = await prisma.expense.findUnique({
    where: { id: ID },
    select: { date: true, amount: true, detail: true, targetMonth: true, recurringExpenseId: true },
  })
  if (!e || e.detail !== '가스요금' || !e.recurringExpenseId) throw new Error('대상 행이 예상과 다르다')
  if (e.targetMonth != null) throw new Error('귀속월이 이미 있다 — 예상한 상태가 아니라 멈춘다')
  const dup = await prisma.expense.count({
    where: { recurringExpenseId: e.recurringExpenseId, id: { not: ID }, OR: [{ targetMonth: TARGET }, { targetMonth: null, date: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } }] },
  })
  if (dup > 0) throw new Error('9월분 기록이 이미 있다 — 중복이 되므로 멈춘다')
  console.log(`대상: ${e.detail} ${e.date.toISOString().slice(0, 10)} ${e.amount}원 · 귀속월 null -> ${TARGET}`)
  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const file = `scripts/.fix-gas-0930-target-month-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ id: ID, before: null, after: TARGET }, null, 2))
  await prisma.expense.update({ where: { id: ID }, data: { targetMonth: TARGET } })
  console.log(`적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-gas-0930-target-month.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
