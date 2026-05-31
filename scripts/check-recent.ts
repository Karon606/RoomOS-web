import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // 최근 24시간 내 추가된 할인
  const recent = await prisma.rentDiscount.findMany({
    where: {
      leaseTerm: { propertyId: property.id },
      createdAt: { gte: new Date(Date.now() - 24*3600*1000) },
    },
    include: { leaseTerm: { include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  })
  console.log(`최근 24시간 할인 추가 ${recent.length}건:`)
  for (const d of recent) {
    console.log(`  ${d.leaseTerm.room?.roomNo}호 ${d.leaseTerm.tenant.name}: ${d.discountType}=${d.value} scope=${d.scope} start=${d.startMonth ?? '?'} end=${d.endMonth ?? '?'} | created=${d.createdAt.toISOString()}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
