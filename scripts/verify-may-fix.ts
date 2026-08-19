import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'
import { monthDbRange } from '../lib/kstDate'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TARGET_MONTH = '2026-05'

async function main() {
  const property = await prisma.property.findFirst({ where: { name: { contains: '제기' } }, select: { id: true } })
  if (!property) return
  // 창 정본 — 로컬 자정으로 만들면 KST 기기에서 하루 앞으로 밀려 말일 퇴실이 빠진다.
  const monthWindow = monthDbRange(TARGET_MONTH)

  const active = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
    select: { id: true, rentAmount: true, discounts: true },
  })
  const totalActive = active.reduce((s, l) => s + discountedRent(l.discounts, TARGET_MONTH, l.rentAmount), 0)

  const checkedOut = await prisma.leaseTerm.findMany({
    where: {
      propertyId: property.id, status: 'CHECKED_OUT', rentAmount: { gt: 0 },
      OR: [
        { moveOutDate: monthWindow },
        { paymentRecords: { some: { targetMonth: TARGET_MONTH, isDeposit: false } } },
      ],
    },
    include: {
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })

  console.log(`기존 active billable: ${totalActive.toLocaleString()}원`)
  console.log(`\n새로 인식되는 CHECKED_OUT lease:`)
  let extra = 0
  for (const l of checkedOut) {
    const amt = discountedRent(l.discounts, TARGET_MONTH, l.rentAmount)
    extra += amt
    console.log(`  ${l.room?.roomNo}호 ${l.tenant.name} +${amt.toLocaleString()}원`)
  }
  console.log(`→ 추가 합계: ${extra.toLocaleString()}원`)
  console.log(`\n새 totalExpected: ${(totalActive + extra).toLocaleString()}원`)
  console.log(`사용자 손계산(15,222,500) 대비 차이: ${(totalActive + extra - 15222500).toLocaleString()}원`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
