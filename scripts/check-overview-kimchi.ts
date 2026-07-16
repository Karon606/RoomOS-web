import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// process.env.DATABASE_URL 을 prisma 가 보기 전에 어댑터 주입
import('../app/(app)/inventory/overview').then(async ({ computeInventoryOverview }) => {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  const rows = await computeInventoryOverview(property.id)
  const kimchi = rows.find(r => r.label === '김치')
  if (!kimchi) { console.log('NO 김치'); return }
  console.log('monthlyConsumption:', JSON.stringify(kimchi.monthlyConsumption, null, 2))
  const total = kimchi.monthlyConsumption.reduce((s, m) => s + (m.qty ?? 0), 0)   // null = 미관측 월
  console.log(`합계: ${total}`)
}).catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
