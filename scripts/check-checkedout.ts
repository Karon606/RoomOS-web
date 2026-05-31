import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) { console.log('no property'); return }
  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: 'CHECKED_OUT' },
    include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
    orderBy: [{ moveInDate: 'desc' }],
  })
  console.log(`CHECKED_OUT lease ${leases.length}건:`)
  let nullMoveOut = 0
  for (const l of leases) {
    const flagMissing = !l.moveOutDate
    if (flagMissing) nullMoveOut++
    console.log(`  ${l.room?.roomNo?.padStart(4, ' ') ?? '?  '}호 ${l.tenant.name.padEnd(12, ' ')} rent=${l.rentAmount.toString().padStart(7, ' ')} isShort=${l.isShortTerm} moveIn=${l.moveInDate?.toISOString().slice(0,10) ?? '-'.padEnd(10, ' ')} moveOut=${l.moveOutDate?.toISOString().slice(0,10) ?? '   <NULL>  '} expectedMoveOut=${l.expectedMoveOut?.toISOString().slice(0,10) ?? '-'}${flagMissing ? '  ⚠' : ''}`)
  }
  console.log(`\n→ moveOutDate가 null 인 CHECKED_OUT: ${nullMoveOut}건`)

  // 5월에 결제한 paymentRecord 있는 CHECKED_OUT lease — "활동" 신호 후보
  const may05Active = await prisma.paymentRecord.findMany({
    where: {
      propertyId: property.id,
      payDate: { gte: new Date(2026, 4, 1), lte: new Date(2026, 4, 31, 23, 59, 59) },
      leaseTerm: { status: 'CHECKED_OUT' },
    },
    include: { leaseTerm: { include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  })
  console.log(`\n5월에 입금 받은 CHECKED_OUT lease (활동 신호):`)
  const seen = new Set<string>()
  for (const p of may05Active) {
    if (seen.has(p.leaseTermId)) continue
    seen.add(p.leaseTermId)
    console.log(`  ${p.leaseTerm.room?.roomNo}호 ${p.leaseTerm.tenant.name} payDate=${p.payDate.toISOString().slice(0,10)} amount=${p.actualAmount} targetMonth=${p.targetMonth} leaseId=${p.leaseTermId}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
