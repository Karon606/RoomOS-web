// 청구 락인 오염 감지(읽기 전용) — **청구가 없는 달에 양수 락인이 굳은 record** 를 잡는다.
//
// 왜 이 축인가 (422호 파트쿨리나, 2026-08-12 정정).
//   단기 계약은 rentAmount 가 월액이 아니라 체류 전체 사용료라 **입주월에 한 번만** 청구한다
//   (lib/billing billForLeaseMonth 의 단기 규칙, 운영자 승인 2026-07-20). 그런데 청소비를 사용료와
//   합쳐 입금받은 것을 이용료 수납으로 넣으면서 FIFO 가 남은 20,000 을 다음 달로 밀었고, 그때
//   다음 달 record 의 expectedAmount 까지 262,500 으로 같이 굳었다. 락인은 청구 정본을 이기므로
//   (billForLeaseMonth 우선순위 ②) 그 달은 영원히 242,500 미납이 된다 — 오간 적 없는 돈이다.
//   리포트 12개월 미수율 분자에도 그대로 들어갔다(0.82% 로 부풀어 있었다).
//
// 판정은 정본 함수 자체로 한다 — `billForLeaseMonth(lease, mon, null)` 이 0 인데 그 달 락인이
//   양수면 오염이다. 규칙을 여기 사본으로 적으면 정본이 바뀔 때 그물만 옛 규칙에 남는다.
//   락을 안 넘기는 것(null)이 핵심이다. 락을 넘기면 오염된 값이 자기 자신을 정당화한다.
//
// 락인이 정본과 **다른 것 자체**는 정상이다(가변 마스터로 과거를 재계산하지 않는 것이 락의 존재
//   이유다). 그래서 '값이 다르다'가 아니라 '그 달에는 청구 자체가 없다'만 본다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-billing-lock-drift.ts
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { billForLeaseMonth } from '@/lib/billing'

const violations: string[] = []

// ── 소스 가드 — 이 오염을 막는 두 겹이 살아 있는가 ─────────────────
const billing = readFileSync('lib/billing.ts', 'utf8')
if (!/if \(l\.isShortTerm && l\.moveInDate\)/.test(billing)) {
  violations.push('[소스] lib/billing 의 단기 입주월 단일 청구 규칙이 사라졌다 — 단기가 달마다 다시 청구된다')
}
const roomsActions = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
if (!/const shortAbsorb = /.test(roomsActions)) {
  violations.push('[소스] savePayment 의 단기 과납 입력월 흡수(shortAbsorb)가 사라졌다 — 청소비 합산 입금이 다음 달로 밀려 락인을 오염시킨다')
}
// 락 되쓰기가 단기 두 칸을 안 넘기면 엔진의 단기 규칙이 통째로 꺼진다(둘 다 있을 때만 발동).
// 그러면 되쓰기가 **입주월 밖 달에 양수 락인을 새로 찍는다** — 422 와 같은 모양을 코드가 만든다.
const engine = readFileSync('app/(app)/rooms/paymentEngine.ts', 'utf8')
const rentAmountFn = engine.slice(engine.indexOf('export async function rewriteLockedExpectedForRentAmount'))
if (!/isShortTerm: lease\.isShortTerm/.test(rentAmountFn) || !/moveInDate: lease\.moveInDate/.test(rentAmountFn)) {
  violations.push('[소스] rewriteLockedExpectedForRentAmount 가 단기 두 칸(isShortTerm·moveInDate)을 청구 엔진에 안 넘긴다 — 입주월 밖에 양수 락인을 찍는다')
}

// ── 데이터 대조 ────────────────────────────────────────────────────
async function main() {
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const leases = await prisma.leaseTerm.findMany({
  select: {
    id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true,
    checkoutProratedAmount: true, checkoutProratedMonth: true,
    discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    tenant: { select: { name: true } },
    paymentRecords: {
      where: { isDeposit: false, isPrevOwner: false, isBillingAdjust: false, deletedAt: null },
      select: { id: true, targetMonth: true, expectedAmount: true, actualAmount: true },
    },
  },
})

for (const l of leases) {
  const byMonth = new Map<string, { locked: number; paid: number; ids: string[] }>()
  for (const r of l.paymentRecords) {
    const cur = byMonth.get(r.targetMonth) ?? { locked: 0, paid: 0, ids: [] }
    if (r.expectedAmount > cur.locked) cur.locked = r.expectedAmount
    cur.paid += r.actualAmount
    cur.ids.push(r.id)
    byMonth.set(r.targetMonth, cur)
  }
  for (const [mon, v] of byMonth) {
    if (v.locked <= 0) continue
    // 일할 정산이 확정된 달은 그 금액이 청구 권위다 — 정본도 그 값을 먼저 돌려준다.
    if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) continue
    if (billForLeaseMonth(l, mon, null) !== 0) continue
    const who = `${l.room?.roomNo ?? '-'}호 ${l.tenant.name}`
    violations.push(
      `[데이터] ${who} ${mon} — 그 달은 청구가 없는데 락인 ${v.locked.toLocaleString()}원이 굳어 있다`
      + ` (수납 ${v.paid.toLocaleString()}원 · 허수 미납 ${(v.locked - v.paid).toLocaleString()}원 · record ${v.ids.join(', ')})`,
    )
  }
}

await prisma.$disconnect()

if (violations.length) {
  console.error(`\n[청구 락인 오염] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\n  락인은 청구 정본을 이긴다. 청구가 없는 달에 굳은 락인은 영원히 사라지지 않는 허수 미납이다.')
  console.error('  데이터 건은 그 수납이 무엇이었는지 확인해 성격대로 옮기고(예: 청소비 부가수익), 원 record 는 소프트삭제한다.')
  process.exit(1)
}
console.log(`[청구 락인 오염] 계약 ${leases.length}개 / 위반 0건`)
}
void main()
