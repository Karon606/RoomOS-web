import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const item = await prisma.trackedItem.findFirst({
    where: { label: '김치', isArchived: false },
    select: { id: true, propertyId: true, label: true, category: true, qtyUnit: true, specUnit: true, trackUnit: true },
  })
  if (!item) { console.log('NO ITEM'); return }
  console.log('=== ITEM ===')
  console.log(item)

  const locs = await prisma.storageLocation.findMany({
    where: { propertyId: item.propertyId },
    select: { id: true, name: true, sortOrder: true, isHub: true },
    orderBy: { sortOrder: 'asc' },
  })
  console.log('\n=== STORAGE LOCATIONS ===')
  for (const l of locs) console.log(`  ${l.name}${l.isHub ? ' [HUB]' : ''}  (${l.id})`)

  const checks = await prisma.stockCheck.findMany({
    where: { trackedItemId: item.id },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { locationBreakdown: { include: { storageLocation: { select: { name: true } } } } },
  })
  console.log('\n=== STOCK CHECKS ===')
  for (const c of checks) {
    const dStr = c.date.toISOString().slice(0, 10)
    const tStr = c.createdAt.toISOString().slice(11, 19)
    const lbStr = c.locationBreakdown.map(lb => `${lb.storageLocation.name}=${lb.remainingQty}`).join(', ')
    console.log(`  ${dStr} ${tStr} | total=${c.remainingQty} | [${lbStr}] | memo=${c.memo ?? ''} | id=${c.id}`)
  }

  const expenses = await prisma.expense.findMany({
    where: {
      propertyId: item.propertyId,
      itemLabel: item.label,
      category: item.category,
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, date: true, createdAt: true, qtyValue: true, specValue: true, qtyUnit: true, specUnit: true, amount: true, vendor: true, memo: true, receivedAt: true, receivedLocationId: true },
  })
  console.log('\n=== EXPENSES ===')
  for (const e of expenses) {
    const dStr = e.date.toISOString().slice(0, 10)
    const rStr = e.receivedAt ? e.receivedAt.toISOString().slice(0, 16).replace('T', ' ') : '대기'
    const locName = e.receivedLocationId ? (locs.find(l => l.id === e.receivedLocationId)?.name ?? e.receivedLocationId) : '-'
    console.log(`  구매 ${dStr} | ${e.qtyValue}${e.qtyUnit ?? ''}${e.specValue ? `×${e.specValue}${e.specUnit ?? ''}` : ''} | ${e.amount}원 | 수령 ${rStr} → ${locName} | id=${e.id}`)
  }

  const additions = await prisma.stockAddition.findMany({
    where: { trackedItemId: item.id },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { storageLocation: { select: { name: true } } },
  })
  console.log('\n=== ADDITIONS (무상입수) ===')
  for (const a of additions) {
    console.log(`  ${a.date.toISOString().slice(0, 10)} +${a.addedQty} ${a.storageLocation?.name ?? '-'} | id=${a.id}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
