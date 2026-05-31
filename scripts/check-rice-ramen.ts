import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function dumpItem(label: string) {
  const item = await prisma.trackedItem.findFirst({ where: { label, isArchived: false } })
  if (!item) return
  console.log(`\n========== ${label} ==========`)
  const checks = await prisma.stockCheck.findMany({
    where: { trackedItemId: item.id },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: { locationBreakdown: { include: { storageLocation: { select: { name: true } } } } },
  })
  console.log(`Checks (${checks.length}):`)
  for (const c of checks) {
    const lb = c.locationBreakdown.map(l => `${l.storageLocation.name}=${l.remainingQty}`).join(', ')
    console.log(`  ${c.date.toISOString().slice(0,10)} ${c.createdAt.toISOString().slice(11,19)} | total=${c.remainingQty} | [${lb}] | ${c.memo ?? ''}`)
  }
  // 연속 점검 사이 소모량
  let totalConsumed = 0
  console.log(`\n  pair 별 소모량:`)
  for (let i = 1; i < checks.length; i++) {
    const p = checks[i-1], c = checks[i]
    const diff = p.remainingQty - c.remainingQty
    if (diff > 0) {
      totalConsumed += diff
      console.log(`    ${p.date.toISOString().slice(0,10)}(${p.remainingQty}) → ${c.date.toISOString().slice(0,10)}(${c.remainingQty}): +${diff} 누적=${totalConsumed}`)
    } else {
      console.log(`    ${p.date.toISOString().slice(0,10)}(${p.remainingQty}) → ${c.date.toISOString().slice(0,10)}(${c.remainingQty}): 차이${diff} (무시)`)
    }
  }
}

(async () => {
  await dumpItem('라면')
  await dumpItem('쌀')
  await dumpItem('주방세제')
  prisma.$disconnect()
})().catch(e => { console.error(e); process.exit(1) })
