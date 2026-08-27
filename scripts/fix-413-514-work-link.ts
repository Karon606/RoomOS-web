// 413호 중복 지출 정리 + 413·514호 지출을 작업에 연결 — 운영자 확정(2026-08-27).
//   실행: npx tsx --env-file=.env.local scripts/fix-413-514-work-link.ts [--apply]
//
// 무슨 일이 있었나. 07:30 에 지출 화면에서 두 방 시공비를 한 번에 넣었다(방별 분배).
// 그 뒤 작업 완료 처리로 413호에 같은 돈이 한 번 더 생겼다 — 앱이 "이미 지출이 걸려 있어
// 지출 화면에서 고칩니다"라고만 하고 **어느 줄인지 안 알려 줘서** 새로 적을 수밖에 없었다.
//
// 운영자 확정 — "413호와 514호 두 곳에 도배와 장판 시공을 했고 방 종류나 사이즈 등이 모두
// 동일해서 각 방의 시공비가 도배는 14만원, 장판은 5만원이야. 즉 방마다 19만원이 들었어."
//
// 하는 일 둘.
//   ① 413호의 자동생성 중복 2건(각 140,000)을 지운다. 07:30 지출이 진짜다.
//   ② 두 방의 07:30 지출을 각 작업에 건다. 514호는 이걸로 같은 사고가 예방된다 —
//      걸린 지출이 생기면 completeRoomWork 가 새 지출을 안 만든다.
// 금액·날짜·품명은 안 건드린다. 지운 건은 아래 백업 JSON 으로 되살릴 수 있다.
import { writeFileSync } from 'node:fs'
import prisma from '../lib/prisma'

const APPLY = process.argv.includes('--apply')
/** 지울 중복 — 작업 완료가 만든 것. detail 로 특정한다(자동생성분은 itemLabel 이 없다). */
const DUPES = ['413호 도배 · 대방도배사', '413호 장판 · 대방도배사']

async function main() {
  const rooms = await prisma.room.findMany({ where: { roomNo: { in: ['413', '514'] } }, select: { id: true, roomNo: true } })
  const dupes = await prisma.expense.findMany({
    where: { detail: { in: DUPES }, roomId: { in: rooms.map(r => r.id) } },
    select: { id: true, date: true, amount: true, detail: true, roomWorkId: true, roomId: true, category: true, vendor: true, excludeFromInventory: true },
  })
  console.log(`\n① 지울 중복 ${dupes.length}건`)
  for (const d of dupes) console.log(`   ${d.id.slice(0, 8)} ${d.date.toISOString().slice(0, 10)} ${d.amount.toLocaleString()}원 · ${d.detail}`)

  // ② 연결 — 07:30 지출(작업 미연결)을 같은 방·같은 날·같은 종류의 작업에 건다.
  const links: { expenseId: string; workId: string; label: string }[] = []
  for (const room of rooms) {
    const works = await prisma.roomWork.findMany({
      where: { roomId: room.id, deletedAt: null },
      select: { id: true, kind: true, status: true, scheduledDate: true, doneDate: true },
    })
    const free = await prisma.expense.findMany({
      where: { roomId: room.id, roomWorkId: null, id: { notIn: dupes.map(d => d.id) } },
      select: { id: true, date: true, amount: true, itemLabel: true, detail: true },
    })
    for (const w of works) {
      const wd = (w.doneDate ?? w.scheduledDate)?.toISOString().slice(0, 10)
      const hit = free.find(e =>
        e.date.toISOString().slice(0, 10) === wd &&
        `${e.itemLabel ?? ''} ${e.detail ?? ''}`.includes(w.kind))
      if (hit) links.push({ expenseId: hit.id, workId: w.id, label: `${room.roomNo}호 ${w.kind} <- ${hit.itemLabel} ${hit.amount.toLocaleString()}원` })
    }
  }
  console.log(`\n② 연결할 ${links.length}건`)
  for (const l of links) console.log(`   ${l.label}`)

  if (!APPLY) { console.log('\n예행 — 적용하려면 --apply'); await prisma.$disconnect(); return }

  // 지운 건은 되살릴 수 있게 통째로 남긴다.
  const full = await prisma.expense.findMany({ where: { id: { in: dupes.map(d => d.id) } } })
  const bak = `/tmp/deleted-expenses-413-${Date.now()}.json`
  writeFileSync(bak, JSON.stringify(full, (_, v) => typeof v === 'bigint' ? String(v) : v, 2))
  console.log(`\n백업 ${bak}`)

  await prisma.expense.deleteMany({ where: { id: { in: dupes.map(d => d.id) } } })
  for (const l of links) await prisma.expense.update({ where: { id: l.expenseId }, data: { roomWorkId: l.workId } })
  console.log(`\n중복 ${dupes.length}건 삭제 · 연결 ${links.length}건 완료`)

  for (const room of rooms) {
    const sum = await prisma.expense.aggregate({ where: { roomId: room.id }, _sum: { amount: true } })
    console.log(`   ${room.roomNo}호 지출 합계 ${(sum._sum.amount ?? 0).toLocaleString()}원`)
  }
  await prisma.$disconnect()
}
main()
