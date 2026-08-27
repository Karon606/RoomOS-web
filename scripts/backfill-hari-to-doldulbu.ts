// '하리' → '돌출부' 용어 백필 — 실행: npx tsx --env-file=.env.local scripts/backfill-hari-to-doldulbu.ts [--apply]
//
// 운영자 지시(2026-08-27) — "현재 장판이나 도배에서 '하리'라고 표현되어 있는 모든 곳을
// '돌출부'로 수정해줘". '하리'는 현장에서 쓰던 일본어투 용어다.
//
// 무엇을 바꾸나. 지출(Expense)의 itemLabel·detail·memo 에 든 '하리' 글자만 바꾼다.
// 금액·날짜·귀속은 한 톨도 안 건드린다. 방 작업(RoomWork)에는 실측 0건이라 대상이 없다.
//
// **공임 판정이 바뀌면 안 된다.** lib/roomWorkCost 의 LABOR_RE 가 '돌출부'를 알아보도록
// 먼저 고쳤고, 옛 말 '하리'도 남겨 뒀다. 이 스크립트는 바꾸기 전후의 공임/자재 판정을
// 대조해 하나라도 뒤집히면 멈춘다 — 이름만 바뀌고 돈의 성질이 바뀌면 그 방 투자금이 틀어진다.
import prisma from '../lib/prisma'
import { isLaborItem } from '../lib/roomWorkCost'

const APPLY = process.argv.includes('--apply')
const swap = (s: string | null): string | null => s == null ? s : s.replaceAll('하리', '돌출부')

async function main() {
  const rows = await prisma.expense.findMany({
    where: { OR: [{ itemLabel: { contains: '하리' } }, { detail: { contains: '하리' } }, { memo: { contains: '하리' } }] },
    select: { id: true, date: true, amount: true, itemLabel: true, detail: true, memo: true },
    orderBy: { date: 'asc' },
  })
  console.log(`\n대상 지출 ${rows.length}건${APPLY ? '' : ' (예행 — 쓰지 않는다)'}\n`)

  const flips: string[] = []
  for (const r of rows) {
    const nextLabel = swap(r.itemLabel), nextDetail = swap(r.detail)
    // 공임/자재 판정이 뒤집히는지 — 뒤집히면 그 방 투자금 집계가 달라진다.
    const before = isLaborItem(r.itemLabel, r.detail)
    const after = isLaborItem(nextLabel, nextDetail)
    if (before !== after) flips.push(`${r.id.slice(0, 8)} ${r.itemLabel} : ${before ? '공임' : '자재'} -> ${after ? '공임' : '자재'}`)
    console.log(`  ${r.date.toISOString().slice(0, 10)} ${String(r.amount).padStart(7)}원  ${r.itemLabel ?? '-'}  ->  ${nextLabel ?? '-'}  [${after ? '공임' : '자재'}]`)
  }

  if (flips.length > 0) {
    console.log(`\n공임/자재 판정이 뒤집힌 ${flips.length}건 — 중단한다.`)
    for (const f of flips) console.log('  ' + f)
    process.exit(1)
  }
  console.log('\n공임/자재 판정 뒤집힘 0건.')

  if (!APPLY) { console.log('\n적용하려면 --apply 를 붙인다.'); await prisma.$disconnect(); return }

  let n = 0
  for (const r of rows) {
    await prisma.expense.update({
      where: { id: r.id },
      data: { itemLabel: swap(r.itemLabel), detail: swap(r.detail), memo: swap(r.memo) },
    })
    n++
  }
  console.log(`\n${n}건 적용 완료.`)
  const left = await prisma.expense.count({
    where: { OR: [{ itemLabel: { contains: '하리' } }, { detail: { contains: '하리' } }, { memo: { contains: '하리' } }] },
  })
  console.log(`남은 '하리' ${left}건`)
  await prisma.$disconnect()
}
main()
