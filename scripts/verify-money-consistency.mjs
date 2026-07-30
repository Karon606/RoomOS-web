// 돈 표시·수납 정합 상시 감지 — 읽기 전용, 위반 시 exit 1 (크리티컬 신고 50a2a69b 재발 감지망).
// 소스 가드: 표시 정본(billForLeaseMonth·discountedRent) 이탈 패턴이 코드에 되살아나는지.
// 데이터 대조: 보증금 중복 수납, 할인 미반영 락(되쓰기 누락 의심)을 SELECT 로 탐지.
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const violations = []

// ── 소스 가드 ──────────────────────────────────────────────
const roomsActions = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
if (!roomsActions.includes('reservedExpected = discountedRent')) {
  violations.push('[소스] rooms/actions RESERVED 분기의 할인 반영(reservedExpected = discountedRent)이 사라짐 — 정본 수렴 회귀')
}
if (roomsActions.includes('expected: lease.rentAmount')) {
  violations.push('[소스] rooms/actions 에 원가 직표시(expected: lease.rentAmount) 재등장 — 표시 정본 이탈')
}
const entryForm = readFileSync('components/entity-modal/widgets/PaymentEntryForm.tsx', 'utf8')
if (/payDate[^\n]*moveInDate/.test(entryForm)) {
  violations.push('[소스] PaymentEntryForm 수납일 기본값이 입주일 파생으로 회귀 의심 — 수납일 정본은 오늘(받은 날)')
}

// ── 데이터 대조 ────────────────────────────────────────────
// 간이 할인 계산 — lib/rentDiscount 규칙(amount/percent, permanent/temporary 월 범위, 0 하한)과 동일
function discounted(discounts, month, base) {
  let total = 0
  for (const d of discounts) {
    const inRange = d.scope === 'permanent'
      || ((d.startMonth == null || month >= d.startMonth) && (d.endMonth == null || month <= d.endMonth))
    if (!inRange) continue
    total += d.discountType === 'percent' ? Math.floor(base * d.value / 100) : d.value
  }
  return Math.max(0, base - total)
}

// 1. 보증금 중복 수납 — lease 별 isDeposit 실수납 합 > 계약 보증금
const leases = await prisma.leaseTerm.findMany({
  where: { depositAmount: { gt: 0 } },
  select: {
    id: true, depositAmount: true, rentAmount: true, isShortTerm: true, checkoutProratedMonth: true,
    tenant: { select: { name: true } },
    discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    paymentRecords: { where: { deletedAt: null }, select: { isDeposit: true, actualAmount: true, expectedAmount: true, targetMonth: true } },
  },
})
for (const l of leases) {
  const depositPaid = l.paymentRecords.filter(r => r.isDeposit).reduce((s, r) => s + r.actualAmount, 0)
  if (depositPaid > l.depositAmount) {
    violations.push(`[데이터] ${l.tenant.name}: 보증금 실수납 ${depositPaid.toLocaleString()}원 > 계약 ${l.depositAmount.toLocaleString()}원 — 중복 수납 의심`)
  }
  // 2. 할인 적용월의 락이 원가 그대로면 되쓰기 누락 의심 (협의 락은 원가와 다른 값이라 미탐지, 일할 월 제외)
  if (l.isShortTerm || l.discounts.length === 0) continue
  const byMonth = new Map()
  for (const r of l.paymentRecords.filter(r => !r.isDeposit)) {
    byMonth.set(r.targetMonth, Math.max(byMonth.get(r.targetMonth) ?? 0, r.expectedAmount))
  }
  for (const [mon, lockedMax] of byMonth) {
    if (lockedMax <= 0 || mon === l.checkoutProratedMonth) continue
    const want = discounted(l.discounts, mon, l.rentAmount)
    if (want !== l.rentAmount && lockedMax === l.rentAmount) {
      violations.push(`[데이터] ${l.tenant.name} ${mon}: 락 ${lockedMax.toLocaleString()}원이 할인 미반영 원가 그대로 — 되쓰기 누락 의심(기준 ${want.toLocaleString()}원)`)
    }
  }
}

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
