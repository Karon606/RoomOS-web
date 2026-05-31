import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const room = await prisma.room.findFirst({
    where: { roomNo: '422' },
    include: {
      leaseTerms: {
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!room) { console.log('422호 없음'); return }
  console.log(`422호 baseRent=${room.baseRent}, isVacant=${room.isVacant}`)
  console.log('전체 lease (모든 status):')
  for (const l of room.leaseTerms) {
    console.log(`  ${l.tenant.name.padEnd(10, ' ')} status=${l.status.padEnd(18, ' ')} rent=${l.rentAmount.toLocaleString().padStart(9, ' ')} dueDay=${l.dueDay ?? '-'} isShortTerm=${l.isShortTerm} moveIn=${l.moveInDate?.toISOString().slice(0,10) ?? '-'} moveOut=${l.moveOutDate?.toISOString().slice(0,10) ?? '-'} expectedMoveOut=${l.expectedMoveOut?.toISOString().slice(0,10) ?? '-'} | id=${l.id}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
