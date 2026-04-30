import prisma from '@/lib/prisma'

async function main() {
  const records = await prisma.paymentRecord.findMany({
    where: { isDeposit: false },
    include: {
      tenant: { select: { name: true } },
      leaseTerm: { select: { rentAmount: true, room: { select: { roomNo: true } } } },
    },
  })

  const map = new Map<string, { paid: number; rent: number; tenantName: string; roomNo: string; tm: string; recordIds: string[] }>()
  for (const r of records) {
    const key = `${r.leaseTermId}__${r.targetMonth}`
    const cur = map.get(key) ?? {
      paid: 0,
      rent: r.leaseTerm.rentAmount,
      tenantName: r.tenant.name,
      roomNo: r.leaseTerm.room?.roomNo ?? '?',
      tm: r.targetMonth,
      recordIds: [],
    }
    cur.paid += r.actualAmount
    cur.recordIds.push(r.id)
    map.set(key, cur)
  }

  const overpaid = [...map.values()].filter(v => v.paid > v.rent && v.rent > 0)
  console.log(`총 paymentRecord: ${records.length}, 계약·월 그룹: ${map.size}, 과납 그룹: ${overpaid.length}`)
  for (const v of overpaid) {
    console.log(`  ${v.tenantName}(${v.roomNo}호) ${v.tm}: ${v.paid.toLocaleString()}원 / 임대료 ${v.rent.toLocaleString()}원 → 초과 ${(v.paid - v.rent).toLocaleString()}원 (${v.recordIds.length}개 record)`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
