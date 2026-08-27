// 실리콘 시공 지출을 작업 이력에 올린다 + 업체명 통일 — 운영자 확정(2026-08-27).
//   실행: npx tsx --env-file=.env.local scripts/backfill-silicone-works.ts [--apply]
//
// 왜. 도배·장판만 작업 이력에 있고 실리콘 시공 8건은 지출에만 있었다. "언제 시공했나"를
// 방에서 못 봤다. 운영자 지시 — "418호와 같이 실리콘 시공한 내역도 작업이력에 넣어줘".
// 418호만 넣으면 나머지 7건이 여전히 안 보여 전건을 올린다.
//
// 하는 일 셋.
//   ① 업체명 통일 — '글로벌 코킹'(418호 1건, 띄어쓰기)을 '글로벌코킹'으로.
//   ② 작업 종류 목록에 '실리콘 시공' 추가(Property.workKindOptions, 쉼표 문자열).
//   ③ 지출 8건마다 완료 상태 RoomWork 을 만들고 그 지출을 건다(costKind 'LABOR').
//
// 금액·날짜·품명·방 연결은 안 건드린다. 지출은 이미 방에 걸려 있어 '이 방에 든 지출'은 무변동이고,
// 작업 행에 시공비 150,000원이 새로 잡힌다.
import prisma from '../lib/prisma'

const APPLY = process.argv.includes('--apply')
const KIND = '실리콘 시공'
const VENDOR = '글로벌코킹'

async function main() {
  const rows = await prisma.expense.findMany({
    where: { roomId: { not: null }, roomWorkId: null,
      OR: [{ itemLabel: { contains: '실리콘 제거' } }, { detail: { contains: '실리콘 제거' } }] },
    select: { id: true, propertyId: true, date: true, amount: true, vendor: true, roomId: true,
      itemLabel: true, detail: true, room: { select: { roomNo: true } } },
    orderBy: { date: 'asc' },
  })
  console.log(`\n대상 지출 ${rows.length}건${APPLY ? '' : ' (예행 — 쓰지 않는다)'}\n`)
  for (const r of rows) {
    const fix = r.vendor !== VENDOR ? `  업체명 '${r.vendor}' -> '${VENDOR}'` : ''
    console.log(`  ${r.date.toISOString().slice(0, 10)} ${r.room?.roomNo}호 ${r.amount.toLocaleString()}원${fix}`)
  }
  const prop = await prisma.property.findFirst({ select: { id: true, workKindOptions: true } })
  const cur = (prop?.workKindOptions ?? '도배,장판').split(',').map(s => s.trim()).filter(Boolean)
  const next = cur.includes(KIND) ? cur : [...cur, KIND]
  console.log(`\n작업 종류  ${cur.join(' · ')}  ->  ${next.join(' · ')}`)

  if (!APPLY) { console.log('\n적용하려면 --apply'); await prisma.$disconnect(); return }

  await prisma.property.update({ where: { id: prop!.id }, data: { workKindOptions: next.join(',') } })
  let n = 0
  for (const r of rows) {
    await prisma.$transaction(async tx => {
      if (r.vendor !== VENDOR) await tx.expense.update({ where: { id: r.id }, data: { vendor: VENDOR } })
      const w = await tx.roomWork.create({
        data: {
          propertyId: r.propertyId, roomId: r.roomId!, kind: KIND,
          status: 'DONE', doneDate: r.date, scheduledDate: r.date,
          performer: 'VENDOR', performerName: VENDOR,
        },
      })
      // 표식으로도 시공이다 — 글자 판정('실리콘'은 판정어에 없다)에 기대지 않는다.
      await tx.expense.update({ where: { id: r.id }, data: { roomWorkId: w.id, costKind: 'LABOR' } })
    })
    n++
  }
  console.log(`\n작업 ${n}건 생성 · 지출 ${n}건 연결 완료`)
  await prisma.$disconnect()
}
main()
