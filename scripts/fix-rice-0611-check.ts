// 쌀 2026-06-11 점검 교정 — 위치별 점검 carry-over 가 6/10 무상 입수 +30kg 을 빼먹고
// 6/9 창고값(43.2)을 그대로 복사한 건. 창고 43.2→73.2, 점검 총 잔량 52.2→82.2.
// 진단(기본) / --apply 적용. 코드 버그는 additionsSinceCheckByLocation 으로 별도 수정됨.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

async function main() {
  const item = await prisma.trackedItem.findFirst({
    where: { label: '쌀' },
    select: { id: true, label: true },
  })
  if (!item) { console.log('쌀 품목 없음'); return }

  const check = await prisma.stockCheck.findFirst({
    where: { trackedItemId: item.id, date: new Date('2026-06-11') },
    orderBy: { createdAt: 'desc' },
    include: { locationBreakdown: { include: { storageLocation: { select: { name: true } } } } },
  })
  if (!check) { console.log('2026-06-11 점검 없음'); return }

  console.log(`점검 ${check.id} · ${check.date.toISOString().slice(0, 10)} · 총 ${check.remainingQty}kg`)
  for (const lb of check.locationBreakdown) {
    console.log(`  ${lb.storageLocation.name}: ${lb.remainingQty}kg`)
  }

  const hubRow = check.locationBreakdown.find(lb => lb.storageLocation.name.includes('415호'))
  if (!hubRow) { console.log('415호 창고 행 없음'); return }
  if (hubRow.remainingQty !== 43.2 || check.remainingQty !== 52.2) {
    console.log(`예상값과 다름(창고 ${hubRow.remainingQty}, 총 ${check.remainingQty}) — 이미 교정됐거나 상황 변동. 중단.`)
    return
  }

  if (!APPLY) { console.log('진단 완료 — 교정하려면 --apply'); return }

  await prisma.$transaction([
    prisma.stockCheckLocation.update({ where: { id: hubRow.id }, data: { remainingQty: 73.2 } }),
    prisma.stockCheck.update({ where: { id: check.id }, data: { remainingQty: 82.2 } }),
  ])
  console.log('교정 완료: 창고 43.2→73.2, 총 52.2→82.2 (되돌리기: 역방향 업데이트)')
}

main().finally(() => prisma.$disconnect())
