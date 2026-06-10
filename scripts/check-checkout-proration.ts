// 퇴실 일할 정산 검증 — 418호 서민준 현재 상태 확인 + 6/26 퇴실 시 일할 금액 미리보기.
// 신규 컬럼(checkoutProrated*) 존재 여부도 함께 점검.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'
import { calcCheckoutProration } from '../lib/prorate'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // 418호 또는 이름 '서민준' lease 찾기 (active/checkout_pending)
  const leases = await prisma.leaseTerm.findMany({
    where: {
      status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] },
      OR: [
        { tenant: { name: { contains: '서민준' } } },
        { room: { roomNo: { contains: '418' } } },
      ],
    },
    select: {
      id: true, status: true, rentAmount: true, dueDay: true,
      expectedMoveOut: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })

  if (leases.length === 0) { console.log('418호/서민준 active lease 없음'); return }

  for (const l of leases) {
    console.log('━'.repeat(50))
    console.log(`${l.room?.roomNo ?? '?'}호 · ${l.tenant.name} · ${l.status}`)
    console.log(`  월세(rentAmount): ${l.rentAmount.toLocaleString()}원`)
    console.log(`  납부일(dueDay): ${l.dueDay ?? '-'}`)
    console.log(`  퇴실예정(expectedMoveOut): ${l.expectedMoveOut ? new Date(l.expectedMoveOut).toISOString().slice(0,10) : '-'}`)
    console.log(`  [신규컬럼] checkoutProratedAmount: ${l.checkoutProratedAmount ?? 'null'}`)
    console.log(`  [신규컬럼] checkoutProratedMonth:  ${l.checkoutProratedMonth ?? 'null'}`)
    console.log(`  [신규컬럼] checkoutProrationUndo:  ${l.checkoutProrationUndo ? JSON.stringify(l.checkoutProrationUndo) : 'null'}`)

    // 6/26 퇴실 가정 미리보기 (서버 previewCheckoutProration 과 동일 로직)
    const moveOut = '2026-06-26'
    const monthlyRent = discountedRent(l.discounts, moveOut.slice(0,7), l.rentAmount)
    const calc = calcCheckoutProration(monthlyRent, l.dueDay, moveOut)
    console.log(`  ── 6/26 퇴실 시 일할 미리보기 ──`)
    if (calc) {
      console.log(`     ${calc.moveOutMonth} 청구 = ${calc.amount.toLocaleString()}원 (${calc.daysUsed}일치)`)
      console.log(`     한 달 ${calc.fullAmount.toLocaleString()}원 ÷ 30 × ${calc.daysUsed}일 · 감액 ${calc.reduction.toLocaleString()}원`)
    } else {
      console.log(`     (퇴실일이 납부일 이전 — 일할 청구 없음)`)
    }
  }
  console.log('━'.repeat(50))
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1) })
