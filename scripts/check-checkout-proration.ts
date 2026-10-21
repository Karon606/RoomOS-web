// 퇴실 일할 정산 검증 — 418호 서민준 현재 상태 확인 + 6/26 퇴실 시 일할 금액 미리보기.
// 신규 컬럼(checkoutProrated*) 존재 여부도 함께 점검.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { discountedRent } from '../lib/rentDiscount'
import { calcCheckoutProration } from '../lib/prorate'
import { cycleDayOf } from '../lib/dueDay'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// 납부일만 옮긴 계약(이용 기간 1일·납부일 6일, 470,000, 504호 모양) — 정산은 기간 시작(1일)으로 잰다(2026-10-21).
// 정산 정본에 납부일을 넘기면 기간이 6일부터로 잡혀 숫자가 전부 어긋난다. DB 를 읽기 전에 먼저 본다.
function selfCheckSplitCycle() {
  const l = { cycleDay: '1', dueDay: '6' }
  const cases: [string, number, number][] = [['2026-12-31', 30, 470000], ['2026-12-15', 15, 235000], ['2026-11-03', 3, 47000]]
  for (const [out, days, amount] of cases) {
    const c = calcCheckoutProration(470000, cycleDayOf(l), out, '2026-08-01')
    if (!c || c.daysUsed !== days || c.amount !== amount || c.startYmd !== `${out.slice(0, 7)}-01`) {
      console.error(`자체 점검 실패: 기간 1일·납부일 6일 ${out} 퇴실 ${c ? `${c.startYmd} 부터 ${c.daysUsed}일 ${c.amount}` : 'null'} (${days}일 ${amount} 이어야)`)
      process.exit(1)
    }
  }
  console.log('자체 점검: 기간 1일·납부일 6일 12/31 퇴실 470,000(추가 0) · 12/15 235,000 · 11/3 47,000')
}

async function main() {
  selfCheckSplitCycle()
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
      id: true, status: true, rentAmount: true, dueDay: true, cycleDay: true,
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
    const calc = calcCheckoutProration(monthlyRent, cycleDayOf(l), moveOut)
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
