import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

import('../app/(app)/inventory/overview').then(async ({ computeInventoryOverview }) => {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  const rows = await computeInventoryOverview(property.id)
  console.log(`총 ${rows.length} 품목`)
  console.log(`라벨${' '.repeat(28)}월별 사용량(2026: 12·1·2·3·4·5)${' '.repeat(15)}합계   currentStock`)
  console.log('─'.repeat(110))
  for (const r of rows) {
    const months = r.monthlyConsumption.map(m => `${m.qty.toFixed(1).padStart(6, ' ')}`).join(' ')
    const total = r.monthlyConsumption.reduce((s, m) => s + m.qty, 0)
    const unit = r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit ?? r.qtyUnit)
    console.log(`${r.label.padEnd(30, ' ')} ${months} = ${total.toFixed(1).padStart(7, ' ')}${unit ?? ''}  cur=${r.currentStock ?? '-'}`)
  }
}).catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
