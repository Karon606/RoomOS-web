// 김치 데이터 정리 (옵션 A: 김치냉장고 location 신규 + 분리 보관 반영)
//
// 변경:
//  1. '김치냉장고' StorageLocation 신규 생성 (없으면)
//  2. 5/31 [수령 자동] StockCheck 삭제 (id=9b14461c-044c-4c12-8c63-0dcbf59b6b1a)
//  3. 5/27 [수령 자동] StockCheck 새로 생성 — total=22, [4층=2, 5층=20]
//  4. 5/28 StockCheck (id=91de7c6d-2f5b-4b07-b718-3f301f60d18b) → [4층=2, 5층=10, 김치냉장고=10] total=22
//  5. 5/29 StockCheck (id=20c3a009-c4e4-48cf-a7c9-b22762d4cb25) → [4층=2, 5층=10, 김치냉장고=10] total=22
//
// 사용:  dry run → 그대로 npx tsx scripts/fix-kimchi.ts
//        실제 적용 → APPLY=1 npx tsx scripts/fix-kimchi.ts

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const APPLY = process.env.APPLY === '1'

const ITEM_LABEL = '김치'

async function main() {
  const item = await prisma.trackedItem.findFirst({
    where: { label: ITEM_LABEL, isArchived: false },
    select: { id: true, propertyId: true },
  })
  if (!item) throw new Error('김치 trackedItem을 찾을 수 없음')

  // 1) 김치냉장고 location 확보
  let kimchiLoc = await prisma.storageLocation.findFirst({
    where: { propertyId: item.propertyId, name: '김치냉장고' },
    select: { id: true },
  })
  if (!kimchiLoc) {
    const maxSort = await prisma.storageLocation.aggregate({
      where: { propertyId: item.propertyId },
      _max: { sortOrder: true },
    })
    const nextSort = (maxSort._max.sortOrder ?? 0) + 1
    if (APPLY) {
      kimchiLoc = await prisma.storageLocation.create({
        data: { propertyId: item.propertyId, name: '김치냉장고', sortOrder: nextSort, isHub: false },
        select: { id: true },
      })
      console.log(`[CREATE] StorageLocation '김치냉장고' sortOrder=${nextSort}`)
    } else {
      console.log(`[DRY] would CREATE StorageLocation '김치냉장고' sortOrder=${nextSort}`)
      kimchiLoc = { id: '00000000-0000-0000-0000-NEW김치냉장고' } as any
    }
  } else {
    console.log(`[SKIP] StorageLocation '김치냉장고' 이미 존재 — id=${kimchiLoc.id}`)
  }

  // 기존 점검들 찾기
  const locs = await prisma.storageLocation.findMany({
    where: { propertyId: item.propertyId },
    select: { id: true, name: true },
  })
  const byName = (n: string) => locs.find(l => l.name === n)?.id ?? null
  const ID_4 = byName('4층 주방')
  const ID_5 = byName('5층 주방')
  if (!ID_4 || !ID_5) throw new Error('4층 주방 또는 5층 주방 location을 찾을 수 없음')

  // 2) 5/31 [수령 자동] 삭제
  const auto531Id = '9b14461c-044c-4c12-8c63-0dcbf59b6b1a'
  if (APPLY) {
    await prisma.stockCheckLocation.deleteMany({ where: { stockCheckId: auto531Id } })
    await prisma.stockCheck.delete({ where: { id: auto531Id } })
    console.log(`[DELETE] StockCheck 5/31 [수령 자동] (id=${auto531Id})`)
  } else {
    console.log(`[DRY] would DELETE StockCheck id=${auto531Id} (5/31 [수령 자동])`)
  }

  // 3) 5/27에 [수령 자동] 새로 생성
  // 5/26 잔량: 4층=2, 5층=0 → 수령 후: 4층=2, 5층=20 (5층 주방으로 20kg 수령)
  // total = 22
  // ⚠ createdAt은 5/26 점검(09:23)보다 이후, 5/28 점검(15:01)보다 이전이어야 정렬 정확.
  //   5/27 05:02 로 설정 (Expense.receivedAt 과 동일하게 맞춤)
  const new527Date = new Date('2026-05-27T00:00:00.000Z')        // date 컬럼은 Date 타입(시간 없음)
  const new527CreatedAt = new Date('2026-05-27T05:02:00.000Z')   // expense.receivedAt 시각 맞춤
  if (APPLY) {
    await prisma.stockCheck.create({
      data: {
        trackedItemId: item.id,
        date: new527Date,
        createdAt: new527CreatedAt,
        remainingQty: 22,
        memo: '[수령 자동] +20kg',
        locationBreakdown: {
          create: [
            { storageLocationId: ID_4, remainingQty: 2 },
            { storageLocationId: ID_5, remainingQty: 20 },
          ],
        },
      },
    })
    console.log(`[CREATE] StockCheck 5/27 [수령 자동] total=22 [4층=2, 5층=20]`)
  } else {
    console.log(`[DRY] would CREATE StockCheck 5/27 total=22 [4층=2, 5층=20] memo='[수령 자동] +20kg'`)
  }

  // 4) 5/28 점검 — 김치냉장고=10 추가, total=22
  const check528Id = '91de7c6d-2f5b-4b07-b718-3f301f60d18b'
  if (APPLY && kimchiLoc) {
    await prisma.stockCheckLocation.deleteMany({ where: { stockCheckId: check528Id } })
    await prisma.stockCheckLocation.createMany({
      data: [
        { stockCheckId: check528Id, storageLocationId: ID_4, remainingQty: 2 },
        { stockCheckId: check528Id, storageLocationId: ID_5, remainingQty: 10 },
        { stockCheckId: check528Id, storageLocationId: kimchiLoc.id, remainingQty: 10 },
      ],
    })
    await prisma.stockCheck.update({ where: { id: check528Id }, data: { remainingQty: 22 } })
    console.log(`[UPDATE] StockCheck 5/28 total=22 [4층=2, 5층=10, 김치냉장고=10]`)
  } else {
    console.log(`[DRY] would UPDATE StockCheck 5/28 → total=22 [4층=2, 5층=10, 김치냉장고=10]`)
  }

  // 5) 5/29 점검 — 김치냉장고=10 추가, total=22
  const check529Id = '20c3a009-c4e4-48cf-a7c9-b22762d4cb25'
  if (APPLY && kimchiLoc) {
    await prisma.stockCheckLocation.deleteMany({ where: { stockCheckId: check529Id } })
    await prisma.stockCheckLocation.createMany({
      data: [
        { stockCheckId: check529Id, storageLocationId: ID_4, remainingQty: 2 },
        { stockCheckId: check529Id, storageLocationId: ID_5, remainingQty: 10 },
        { stockCheckId: check529Id, storageLocationId: kimchiLoc.id, remainingQty: 10 },
      ],
    })
    await prisma.stockCheck.update({ where: { id: check529Id }, data: { remainingQty: 22 } })
    console.log(`[UPDATE] StockCheck 5/29 total=22 [4층=2, 5층=10, 김치냉장고=10]`)
  } else {
    console.log(`[DRY] would UPDATE StockCheck 5/29 → total=22 [4층=2, 5층=10, 김치냉장고=10]`)
  }

  console.log(APPLY ? '\n✅ 적용 완료' : '\n(dry-run) APPLY=1 환경변수와 함께 다시 실행하면 적용됩니다.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
