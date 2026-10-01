// 퇴실 처리가 다음 예약(RESERVED)이 있는 513호를 공실로 덮은 것을 되돌리는 일회성 정정 — 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-10-01, 운영자 승인). applyCheckoutSideEffects 가 그 방의 다른 계약을 보지 않고 isVacant:true 를
// 썼다. 생성 경로는 roomStillOccupied 가드로 막았다(knowledge/domain-vacancy). 판정은 그 정본과 같게,
// 점유 계약(ACTIVE·CHECKOUT_PENDING·RESERVED)이 있을 때만 false 로 되돌린다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-513-vacancy-reserved.ts [--apply | --revert <undo.json>]
import fs from 'node:fs'
import prisma from '../lib/prisma'

const ROOM_ID = 'e8eba31b-6c1f-4b31-b737-e6380beabc49'   // 더스테이원룸텔 제기역점 513호

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) {
    const snap = JSON.parse(fs.readFileSync(process.argv[revertIdx + 1], 'utf8')) as { roomId: string; before: boolean; after: boolean }
    const cur = await prisma.room.findUnique({ where: { id: snap.roomId }, select: { isVacant: true } })
    if (cur?.isVacant !== snap.after) throw new Error(`현재 값 ${cur?.isVacant} 이 적용값 ${snap.after} 과 달라 되돌리지 않는다`)
    await prisma.room.update({ where: { id: snap.roomId }, data: { isVacant: snap.before } })
    console.log(`되돌림: isVacant ${snap.after} -> ${snap.before}`)
    return
  }

  const room = await prisma.room.findUnique({ where: { id: ROOM_ID }, select: { roomNo: true, isVacant: true } })
  if (!room || room.roomNo !== '513') throw new Error('대상 방이 예상과 다르다')
  const occupying = await prisma.leaseTerm.findMany({
    where: { roomId: ROOM_ID, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'] } },
    select: { status: true, tenant: { select: { name: true } } },
  })
  if (!room.isVacant) { console.log('이미 공실 아님 — 할 일 없다'); return }
  if (occupying.length === 0) throw new Error('점유 계약이 없다 — 공실이 맞으므로 멈춘다')
  console.log(`대상: 513호 isVacant true -> false · 점유 ${occupying.map(o => `${o.status}/${o.tenant?.name ?? '-'}`).join(', ')}`)
  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const file = `scripts/.fix-513-vacancy-reserved-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ roomId: ROOM_ID, before: true, after: false }, null, 2))
  await prisma.room.update({ where: { id: ROOM_ID }, data: { isVacant: false } })
  console.log(`적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-513-vacancy-reserved.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
