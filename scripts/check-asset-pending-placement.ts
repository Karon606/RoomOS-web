// 수령 전 비품 물품 행의 자리 감사. 읽기 전용, 위반 시 exit 1. 실행: npx tsx --env-file=.env.local scripts/check-asset-pending-placement.ts
//
// 왜 필요한가(2026-10-15 냉장고 519호 건, 계획서 비품-전환-배정 S7). 비품에서 roomId 는 '배정된 자리'다.
// 수령 전에 roomId·assignedLocationId 가 있으면 받는 순간 말없이 그 자리에 서고(배정일·배정 이력 없음),
// 이미 그 방이면 배정 이력이 '변화 없음'으로 영영 안 남는다. 그래서 **수령 전 비품 물품의 자리는 배정 예정
// 호실(targetRoomId) 하나뿐**이다(판정 정본 app/(app)/inventory/assets/receiptPlacement). 길을 다 막았지만
// (지출 저장·옮기기·나눠 배정·일괄 배정·수령 대기로), 새 길이 생기면 장부에서 이 그물이 먼저 운다.
//
//   축 1(오류) 수령 전 비품 물품 행인데 roomId·assignedLocationId 가 있거나 공용 자재 표식이 있다(놓인 행의 판정 정본
//             isUnplaced 와 같은 셋, 2차 검수 R3).
//   축 2(오류) 비품 물품이 아닌 행(소모품·서비스·배송비·품명 없음)에 targetRoomId 가 있다. 저장 규칙은 비운다.
//   축 3(경고) targetRoomId 가 그 영업장에 없는 방을 가리킨다(방을 지웠다). 화면은 예정 없음으로 보고 묻지 않는다.
//   축 4(오류) 보관 위치(storedLocationId, 2026-10-19)가 받은 + 안 놓인 비품 물품 행 밖에 있다(수령 전·방·공용부·공용 자재·재고 제외). 보관 위치는
//             배정과 다른 축이고 받은 + 안 놓인 비품에만 산다(판정 정본 app/(app)/inventory/assets/storagePlace canHoldStorage).
//   축 5(오류) 보관 위치가 다른 영업장 위치를 가리킨다(FK 는 영업장을 모른다).
//   칸이 아직 운영 DB 에 없으면(마이그레이션 prisma/migrate_expense_stored_location.sql 적용 전) 축 4·5 는 건너뛰고 그 사실을 말한다.
//   이 그물은 칸을 직접 SQL 로 읽는다(새 Prisma 클라이언트로 읽으면 칸이 없을 때 전체 조회가 죽어 축 1~3 까지 못 본다).
//
// 비품 물품의 축은 비품 화면 모집단(durableExpenseWhere)의 물품 갈래와 같다. 추적 카테고리는 영업장 설정 정본
// (parseInventoryCategories)으로 읽는다. 파싱 규칙을 베끼지 않는다.
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseInventoryCategories } from '../app/(app)/inventory/categoryConfig'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const errors: string[] = []
  const warns: string[] = []
  const props = await prisma.property.findMany({ select: { id: true, name: true, inventoryCategories: true } })
  const storedCol = (await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'storedLocationId'`))[0]?.n ?? BigInt(0)
  if (!storedCol) warns.push('보관 위치 칸(expenses.storedLocationId)이 아직 없다(마이그레이션 적용 전). 축 4·5 를 건너뛴다')
  for (const p of props) {
    const tracked = parseInventoryCategories(p.inventoryCategories ?? null).map(c => c.cat)
    const goods = { propertyId: p.id, itemLabel: { not: null }, isShipping: false, excludeFromInventory: false, category: { notIn: tracked } }
    const placed = await prisma.expense.findMany({
      where: { ...goods, receivedAt: null, OR: [{ roomId: { not: null } }, { assignedLocationId: { not: null } }, { isCommonAsset: true }] },
      select: { id: true, itemLabel: true, date: true, roomId: true, assignedLocationId: true, isCommonAsset: true },
    })
    for (const e of placed) {
      errors.push(`[${p.name}] 수령 전 비품 '${e.itemLabel}' (${e.date.toISOString().slice(0, 10)}, id ${e.id.slice(0, 8)}) 에 ${e.roomId ? 'roomId' : e.assignedLocationId ? 'assignedLocationId' : 'isCommonAsset(공용 자재)'} 가 있다. 수령 전 자리는 배정 예정 호실뿐이다`)
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
    if (storedCol) {
      const badStore = await prisma.$queryRaw<{ id: string; itemLabel: string | null; why: string }[]>(Prisma.sql`
        SELECT e.id, e."itemLabel",
          CASE WHEN e."receivedAt" IS NULL THEN '수령 전' WHEN e."roomId" IS NOT NULL THEN '방 배정' WHEN e."assignedLocationId" IS NOT NULL THEN '공용부 배정' WHEN e."isCommonAsset" THEN '공용 자재' ELSE '재고 제외(서비스)' END AS why
        FROM expenses e
        WHERE e."propertyId" = ${p.id}::uuid AND e."storedLocationId" IS NOT NULL
          AND (e."receivedAt" IS NULL OR e."roomId" IS NOT NULL OR e."assignedLocationId" IS NOT NULL OR e."isCommonAsset" = true OR e."excludeFromInventory" = true)`)
      for (const e of badStore) errors.push(`[${p.name}] '${e.itemLabel ?? e.id.slice(0, 8)}'(id ${e.id.slice(0, 8)}) 이 ${e.why}인데 보관 위치가 있다. 보관 위치는 받은 + 안 놓인 행에만 산다`)
      const foreign = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT e.id FROM expenses e JOIN storage_locations l ON l.id = e."storedLocationId"
        WHERE e."propertyId" = ${p.id}::uuid AND l."propertyId" <> e."propertyId"`)
      for (const e of foreign) errors.push(`[${p.name}] 지출 ${e.id.slice(0, 8)} 의 보관 위치가 다른 영업장 위치다`)
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
