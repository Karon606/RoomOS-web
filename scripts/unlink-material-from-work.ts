// 작업에 걸린 자재 연결을 끊는다 — 운영자 확정(2026-08-27).
//   실행: npx tsx --env-file=.env.local scripts/unlink-material-from-work.ts [--apply]
//
// 왜. 작업 이력은 **시공 이력**이다. "언제 시공할지 미리 계획하고 언제 했는지"를 보는 자리라
// 자재가 거기 걸려 있을 이유가 없다. 자재는 살 때 이미 지출로 잡혔고 '이 방에 든 지출'이
// 그것을 다 보여준다.
//
// **지출 자체는 안 건드린다.** roomWorkId 만 null 로 되돌린다. 금액·날짜·품명·방 연결
// (roomId) 전부 그대로다. 방 연결이 살아 있으니 '이 방에 든 지출'에는 그대로 남는다 —
// 그 목록은 roomId 로만 본다(rooms/actions getRoomExpenses).
//
// 판정은 lib/roomWorkCost 정본이다. costKind 표식이 있으면 그것이 글자보다 강하다.
// 앞으로는 이 상황이 안 생긴다 — 되묻기가 공임만 후보로 고른다(lib/roomWorkMatch).
import { writeFileSync } from 'node:fs'
import prisma from '../lib/prisma'
import { isLaborItem } from '../lib/roomWorkCost'

const APPLY = process.argv.includes('--apply')

async function main() {
  const works = await prisma.roomWork.findMany({
    where: { deletedAt: null },
    select: { id: true, kind: true, room: { select: { id: true, roomNo: true } },
      expenses: { select: { id: true, amount: true, itemLabel: true, detail: true, costKind: true, roomId: true } } },
  })
  const targets: { id: string; line: string }[] = []
  const orphan: string[] = []
  for (const w of works) for (const e of w.expenses) {
    if (isLaborItem(e.itemLabel, e.detail, e.costKind)) continue
    const line = `${w.room.roomNo}호 ${w.kind} <- ${e.itemLabel ?? e.detail} ${e.amount.toLocaleString()}원`
    // 방 연결이 없으면 떼는 순간 어느 방에도 안 잡힌다 — 그런 건은 손대지 않는다.
    if (e.roomId !== w.room.id) { orphan.push(line); continue }
    targets.push({ id: e.id, line })
  }
  console.log(`\n연결을 끊을 자재 ${targets.length}건${APPLY ? '' : ' (예행 — 쓰지 않는다)'}\n`)
  for (const t of targets) console.log('  ' + t.line)
  if (orphan.length > 0) {
    console.log(`\n방 연결이 없어 건드리지 않는 ${orphan.length}건 (떼면 어느 방에도 안 잡힌다)`)
    for (const o of orphan) console.log('  ' + o)
  }
  if (!APPLY) { console.log('\n적용하려면 --apply'); await prisma.$disconnect(); return }

  const bak = `/tmp/unlinked-material-${Date.now()}.json`
  writeFileSync(bak, JSON.stringify(targets, null, 2))
  console.log(`\n백업 ${bak}`)
  await prisma.expense.updateMany({ where: { id: { in: targets.map(t => t.id) } }, data: { roomWorkId: null } })
  console.log(`${targets.length}건 연결 해제 완료.`)

  const left = (await prisma.roomWork.findMany({ where: { deletedAt: null },
    select: { expenses: { select: { itemLabel: true, detail: true, costKind: true } } } }))
    .flatMap(w => w.expenses).filter(e => !isLaborItem(e.itemLabel, e.detail, e.costKind)).length
  console.log(`작업에 남은 자재 ${left}건`)
  await prisma.$disconnect()
}
main()
