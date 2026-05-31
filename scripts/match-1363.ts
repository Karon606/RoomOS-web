import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// 14,960,500 (옛 시스템) - 1,330,500 = 13,630,000
// 또는 15,593,000 - 1,963,000 = 13,630,000
// 어떤 lease 합이 1,963,000원에 가까운가? (1,330,500도)

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  const active = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
    include: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  // 청구액 기준 정렬
  const list = active.map(l => ({
    roomNo: l.room?.roomNo, name: l.tenant.name, status: l.status,
    rent: l.rentAmount,
    amt: discountedRent(l.discounts, '2026-05', l.rentAmount),
  })).sort((a, b) => a.amt - b.amt)

  console.log(`총 ${list.length}건`)
  console.log(`\n[가설1] active 합 14,960,000 - X = 13,630,000 (X = 1,330,000)`)
  console.log('  1,330,000원에 가까운 lease 조합:')
  // single lease
  list.filter(l => Math.abs(l.amt - 1330000) < 50000).forEach(l => console.log(`    ${l.roomNo} ${l.name}: ${l.amt}`))
  // 2-lease combinations
  for (let i = 0; i < list.length; i++) for (let j = i+1; j < list.length; j++) {
    const sum = list[i].amt + list[j].amt
    if (Math.abs(sum - 1330000) < 5000 || Math.abs(sum - 1330500) < 5000) {
      console.log(`    조합: ${list[i].roomNo} ${list[i].name}(${list[i].amt}) + ${list[j].roomNo} ${list[j].name}(${list[j].amt}) = ${sum}`)
    }
  }
  // 3-lease combinations (간단)
  for (let i = 0; i < list.length; i++) for (let j = i+1; j < list.length; j++) for (let k = j+1; k < list.length; k++) {
    const sum = list[i].amt + list[j].amt + list[k].amt
    if (Math.abs(sum - 1330000) < 3000 || Math.abs(sum - 1330500) < 3000) {
      console.log(`    3개: ${list[i].roomNo}+${list[j].roomNo}+${list[k].roomNo} = ${sum}`)
    }
  }
  console.log(`\n[가설2] 새 시스템 15,593,000 - X = 13,630,000 (X = 1,963,000)`)
  for (let i = 0; i < list.length; i++) for (let j = i+1; j < list.length; j++) {
    const sum = list[i].amt + list[j].amt
    if (Math.abs(sum - 1963000) < 5000) {
      console.log(`    조합: ${list[i].roomNo} ${list[i].name}(${list[i].amt}) + ${list[j].roomNo} ${list[j].name}(${list[j].amt}) = ${sum}`)
    }
  }
  for (let i = 0; i < list.length; i++) for (let j = i+1; j < list.length; j++) for (let k = j+1; k < list.length; k++) {
    const sum = list[i].amt + list[j].amt + list[k].amt
    if (Math.abs(sum - 1963000) < 3000) {
      console.log(`    3개: ${list[i].roomNo}+${list[j].roomNo}+${list[k].roomNo} = ${sum}`)
    }
  }
  for (let i = 0; i < list.length; i++) for (let j = i+1; j < list.length; j++) for (let k = j+1; k < list.length; k++) for (let m = k+1; m < list.length; m++) {
    const sum = list[i].amt + list[j].amt + list[k].amt + list[m].amt
    if (Math.abs(sum - 1963000) < 2000) {
      console.log(`    4개: ${list[i].roomNo}+${list[j].roomNo}+${list[k].roomNo}+${list[m].roomNo} = ${sum}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
