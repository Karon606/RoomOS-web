// 라면 2026-09-30 위치별 점검에서 지워진 4층 주방 옮김 마커(+5)를 되살리는 일회성 정정 — 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-09-30, 운영자 승인 2026-10-01). 같은 점검 안에서 4층 주방을 +5 옮겨 저장(창고 60 → 55)한 뒤
// 옮김 없이 다시 저장하자 마커가 이번 보충량(null)으로 덮였다. 창고 차감 15(60 → 45)는 남고 마커는
// 5층 주방 +10 만 남아 check-stock-ledger-parity 가 "저장 45 대 기대 50" 으로 걸렸다.
// 생성 경로는 c018fa60(같은 위치 재점검 마커 누적)으로 막았다. 이 스크립트는 그 이전에 지워진 한 칸만 되돌린다.
// 잔량(remainingQty)은 건드리지 않는다 — 운영자가 센 수다. 바꾸는 것은 restockedQty 한 칸뿐이다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-ramen-0930-marker.ts [--apply | --revert <undo.json>]
import fs from 'node:fs'
import prisma from '../lib/prisma'

const ROW_ID = '5ee42375-86e8-468e-b2c1-82ca347a38ff'    // 라면 · 51585510 점검 · 4층 주방
const CHECK_ID = '51585510-3b00-49a0-8fb9-4e447fc0b3ec'
const RESTORE = 5

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) {
    const file = process.argv[revertIdx + 1]
    const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as { rowId: string; before: number | null; after: number }
    const cur = await prisma.stockCheckLocation.findUnique({ where: { id: snap.rowId }, select: { restockedQty: true } })
    if (cur?.restockedQty !== snap.after) throw new Error(`현재 값 ${cur?.restockedQty} 이 적용값 ${snap.after} 과 달라 되돌리지 않는다`)
    await prisma.stockCheckLocation.update({ where: { id: snap.rowId }, data: { restockedQty: snap.before } })
    console.log(`되돌림: restockedQty ${snap.after} -> ${snap.before}`)
    return
  }

  const row = await prisma.stockCheckLocation.findUnique({
    where: { id: ROW_ID },
    select: { stockCheckId: true, remainingQty: true, restockedQty: true, storageLocation: { select: { name: true, parent: { select: { name: true } } } } },
  })
  if (!row || row.stockCheckId !== CHECK_ID) throw new Error('대상 행을 찾지 못했다')
  const where = `${row.storageLocation.parent?.name ?? ''} ${row.storageLocation.name}`.trim()
  console.log(`대상: 라면 2026-09-30 · ${where} · 잔량 ${row.remainingQty} · 마커 ${row.restockedQty} -> ${RESTORE}`)
  if (row.restockedQty != null) throw new Error('마커가 이미 있다 — 예상한 상태가 아니라 멈춘다')
  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const file = `scripts/.fix-ramen-0930-marker-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ rowId: ROW_ID, before: row.restockedQty, after: RESTORE }, null, 2))
  await prisma.stockCheckLocation.update({ where: { id: ROW_ID }, data: { restockedQty: RESTORE } })
  console.log(`적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-ramen-0930-marker.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
