import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
async function main() {
  const APPLY = process.env.APPLY === '1'
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // 1) TrackedItem 카테고리 부식비 → 소모품비
  const item = await prisma.trackedItem.findFirst({ where: { propertyId: property.id, label: '세탁조크리너' } })
  if (item && item.category === '부식비') {
    console.log(`[1] TrackedItem 세탁조크리너 category: 부식비 → 소모품비`)
    if (APPLY) {
      // unique 충돌 방지 — (propertyId, category, label) unique
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId: property.id, category: '소모품비', label: '세탁조크리너' } },
      })
      if (existing) { console.log('  ⚠ 소모품비 카드 이미 존재 — 부식비 카드 archive'); await prisma.trackedItem.update({ where: { id: item.id }, data: { isArchived: true } }) }
      else { await prisma.trackedItem.update({ where: { id: item.id }, data: { category: '소모품비' } }) }
    }
  } else {
    console.log(`[1] TrackedItem 변경 불필요 (현재 category=${item?.category ?? '없음'})`)
  }

  // 2) Expense itemLabel 채우기 — detail 에 "[세탁조크리너]" 포함된 경우
  const expenses = await prisma.expense.findMany({
    where: { propertyId: property.id, itemLabel: null, detail: { contains: '세탁조크리너' } },
    select: { id: true, date: true, detail: true, category: true },
  })
  console.log(`[2] itemLabel 비어있고 detail 에 '세탁조크리너' 있는 expense ${expenses.length}건`)
  for (const e of expenses) {
    console.log(`  ${e.date.toISOString().slice(0,10)} cat=${e.category} detail="${e.detail}"`)
    if (APPLY) {
      await prisma.expense.update({ where: { id: e.id }, data: { itemLabel: '세탁조크리너' } })
    }
  }
  console.log(APPLY ? '\n✅ 적용 완료' : '\n(dry-run) APPLY=1 로 적용')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
