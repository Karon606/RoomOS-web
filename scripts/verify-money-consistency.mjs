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
if (!roomsActions.includes('fbExpected = discountedRent(lease.discounts ?? [], fbMoveInMonth, fbBase)')) {
  violations.push('[소스] rooms/actions RESERVED fallback(fbExpected) 이 예약 인상 반영을 잃음 — 호실 배정 전후로 금액이 달라진다')
}
if (roomsActions.includes('expected: lease.rentAmount')) {
  violations.push('[소스] rooms/actions 에 원가 직표시(expected: lease.rentAmount) 재등장 — 표시 정본 이탈')
}
const entryForm = readFileSync('components/entity-modal/widgets/PaymentEntryForm.tsx', 'utf8')
if (/payDate[^\n]*moveInDate/.test(entryForm)) {
  violations.push('[소스] PaymentEntryForm 수납일 기본값이 입주일 파생으로 회귀 의심 — 수납일 정본은 오늘(받은 날)')
}
// 수납 스트립 RESERVED 혼입 가드(신고 78ea0c3d) — 예약 행 expected는 표시용이라 스트립 청구·수납 합산에서 제외돼야 한다.
// 단기 일할 가드(신고 2026-08-01) — 단기는 주 단위 정액이라 퇴실 일할 대상이 아니다.
const tenantsActions = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
if (!tenantsActions.includes('if (lease.isShortTerm) {')) {
  violations.push('[소스] tenants/actions prorationDataForChange 의 단기 제외 가드가 사라짐 — 단기에 퇴실 일할이 붙어 이중 청구된다')
}

// 인상 예약 락 되쓰기 가드(A페이즈) — 없으면 이미 선납된 달의 락이 인상을 이겨 인상분이 영원히 미청구.
if (!roomsActions.includes('export async function rewriteLockedExpectedForRentSchedule')) {
  violations.push('[소스] rooms/actions 의 인상 예약 락 되쓰기(rewriteLockedExpectedForRentSchedule)가 사라짐 — 선납된 달의 인상분이 미청구로 남는다')
}
const roomManage = readFileSync('app/(app)/room-manage/actions.ts', 'utf8')
if ((roomManage.match(/rewriteLockedExpectedForRentSchedule/g) ?? []).length < 2) {
  violations.push('[소스] room-manage 의 인상 예약 되쓰기 호출이 빠짐 — 단건·일괄 두 경로 모두 걸려 있어야 한다')
}

const roomsClient = readFileSync('app/(app)/rooms/RoomsClient.tsx', 'utf8')
if (!roomsClient.includes("occupied.filter(r => r.status !== 'RESERVED')")) {
  violations.push('[소스] RoomsClient 스트립의 RESERVED 제외 필터(billableRows)가 사라짐 — 예약 전액이 청구·수납에 혼입되는 회귀')
}
if (/expectedSum\s*=\s*occupied\.reduce/.test(roomsClient)) {
  violations.push('[소스] RoomsClient expectedSum 이 occupied 직접 합산으로 회귀 — RESERVED 행 혼입(청구·수납 부풀림)')
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

// 3. 미래 수납일 — '받은 날'이 아직 오지 않았다면 입주일 등 파생값이 샌 것(수납일 기본값 회귀 흔적).
//    월 필터 화면에서 사라져 보여 중복 수납을 부른다(신고 50a2a69b 의 직접 원인, 백필 후 감시).
// (이 스크립트는 원시 클라이언트라 lib/prisma 의 소프트삭제 자동 필터가 없다 — deletedAt 명시 필수)
const futurePays = await prisma.paymentRecord.findMany({
  where: { deletedAt: null, payDate: { gt: new Date(Date.now() + 9 * 3600000) } },
  select: { payDate: true, actualAmount: true, leaseTerm: { select: { tenant: { select: { name: true } } } } },
})
for (const r of futurePays) {
  violations.push(`[데이터] ${r.leaseTerm?.tenant?.name ?? '?'}: 수납일 ${r.payDate.toISOString().slice(0, 10)} 이 미래 — 받은 날이 아닌 파생값 의심`)
}

// 4. 단기인데 퇴실 일할이 붙은 계약 — 그 기간 전액을 이미 받았는데 일할이 더해지면 이중 청구
const shortProrated = await prisma.leaseTerm.findMany({
  where: { isShortTerm: true, checkoutProratedAmount: { not: null } },
  select: { checkoutProratedMonth: true, checkoutProratedAmount: true, tenant: { select: { name: true } } },
})
for (const l of shortProrated) {
  violations.push(`[데이터] ${l.tenant.name}: 단기 계약에 퇴실 일할 ${l.checkoutProratedAmount?.toLocaleString()}원(${l.checkoutProratedMonth}) — 주 단위 정액이라 일할 대상 아님(이중 청구)`)
}

// 5. 현금영수증 집계 배타 — 카드는 매출전표가 증빙을 대신하므로 현금영수증 합계에 넣지 않는다.
//    두 if 가 배타가 아니면 같은 금액이 양쪽에 계상돼 세무 대사가 틀어진다(520호 172,000원 사례).
if (!roomsActions.includes('else if (r.cashReceiptIssuedAt)')) {
  violations.push('[소스] getMonthPaymentAggregates 의 현금영수증·카드 배타 처리가 사라짐 — 카드 건이 양쪽에 이중 계상된다')
}

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
