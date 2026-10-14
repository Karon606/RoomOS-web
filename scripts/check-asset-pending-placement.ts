// 수령 전 비품 물품 행의 자리 감사. 읽기 전용, 위반 시 exit 1. 실행: npx tsx --env-file=.env.local scripts/check-asset-pending-placement.ts
//
// 왜 필요한가(2026-10-15 냉장고 519호 건, 계획서 비품-전환-배정 S7). 비품에서 roomId 는 '배정된 자리'다.
// 수령 전에 roomId·assignedLocationId 가 있으면 받는 순간 말없이 그 자리에 서고(배정일·배정 이력 없음),
// 이미 그 방이면 배정 이력이 '변화 없음'으로 영영 안 남는다. 그래서 **수령 전 비품 물품의 자리는 배정 예정
// 호실(targetRoomId) 하나뿐**이다(판정 정본 app/(app)/inventory/assets/receiptPlacement). 길을 다 막았지만
// (지출 저장·옮기기·나눠 배정·일괄 배정·수령 대기로), 새 길이 생기면 장부에서 이 그물이 먼저 운다.
//
//   축 1(오류) 수령 전 비품 물품 행인데 roomId 나 assignedLocationId 가 있다.
//   축 2(오류) 비품 물품이 아닌 행(소모품·서비스·배송비·품명 없음)에 targetRoomId 가 있다. 저장 규칙은 비운다.
//   축 3(경고) targetRoomId 가 그 영업장에 없는 방을 가리킨다(방을 지웠다). 화면은 예정 없음으로 보고 묻지 않는다.
//
// 비품 물품의 축은 비품 화면 모집단(durableExpenseWhere)의 물품 갈래와 같다. 추적 카테고리는 영업장 설정 정본
// (parseInventoryCategories)으로 읽는다. 파싱 규칙을 베끼지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseInventoryCategories } from '../app/(app)/inventory/categoryConfig'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const errors: string[] = []
  const warns: string[] = []
  const props = await prisma.property.findMany({ select: { id: true, name: true, inventoryCategories: true } })
  for (const p of props) {
    const tracked = parseInventoryCategories(p.inventoryCategories ?? null).map(c => c.cat)
    const goods = { propertyId: p.id, itemLabel: { not: null }, isShipping: false, excludeFromInventory: false, category: { notIn: tracked } }
    const placed = await prisma.expense.findMany({
      where: { ...goods, receivedAt: null, OR: [{ roomId: { not: null } }, { assignedLocationId: { not: null } }] },
      select: { id: true, itemLabel: true, date: true, roomId: true, assignedLocationId: true },
    })
    for (const e of placed) {
      errors.push(`[${p.name}] 수령 전 비품 '${e.itemLabel}' (${e.date.toISOString().slice(0, 10)}, id ${e.id.slice(0, 8)}) 에 ${e.roomId ? 'roomId' : 'assignedLocationId'} 가 있다. 수령 전 자리는 배정 예정 호실뿐이다`)
    }
    const stray = await prisma.expense.findMany({
      where: {
        propertyId: p.id, targetRoomId: { not: null },
        OR: [{ itemLabel: null }, { isShipping: true }, { excludeFromInventory: true }, { category: { in: tracked } }],
      },
      select: { id: true, itemLabel: true, category: true },
    })
    for (const e of stray) {
      errors.push(`[${p.name}] 비품 물품이 아닌 '${e.itemLabel ?? e.id.slice(0, 8)}'(${e.category}) 에 배정 예정 호실이 있다. 저장 규칙은 비운다`)
    }
    const targets = await prisma.expense.findMany({ where: { propertyId: p.id, targetRoomId: { not: null } }, select: { targetRoomId: true } })
    const ids = [...new Set(targets.map(t => t.targetRoomId!))]
    if (ids.length) {
      const alive = new Set((await prisma.room.findMany({ where: { id: { in: ids }, propertyId: p.id }, select: { id: true } })).map(r => r.id))
      const dead = ids.filter(id => !alive.has(id))
      if (dead.length) warns.push(`[${p.name}] 배정 예정 호실이 없는 방을 가리키는 지출 ${targets.filter(t => dead.includes(t.targetRoomId!)).length}건(방 ${dead.length}곳). 받을 때 묻지 않는다`)
    }
  }
  await prisma.$disconnect()
  console.log(`[수령 전 비품 자리] 오류 ${errors.length}건 · 경고 ${warns.length}건`)
  for (const w of warns) console.log('  · ' + w)
  if (errors.length) {
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
