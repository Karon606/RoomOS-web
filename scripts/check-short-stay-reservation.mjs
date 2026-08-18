// 단기 예약금 분해(applyToRent) 감지망 — 읽기 전용, 위반 시 exit 1.
// 실행: node --env-file=.env.local scripts/check-short-stay-reservation.mjs (verify:db)
//
// 왜 필요한가. 2026-08-19 확정 규칙은 "단기 예약금은 청소비를 먼저 떼고 남은 몫을 이용료 선납으로
// 충당한다. 보증금 record 는 만들지 않는다"이다. 이 규칙이 무너지는 방향은 조용하고 셋뿐이다.
//   축 A · 단기 퇴실에서 '보증금 몰취'가 다시 선다. 그 계약에는 돌려줄 보증금 자체가 없어야 하고,
//          옛 환불 보증금 단기 계약(소급 없음, 2건)도 청소비 몫만 떼면 몰취가 0 이다.
//          기준선 0 — 실측으로 확인했다(황인정 402 정정 완료).
//   축 B · 분해 규칙이 켜진 영업장의 단기 계약에 보증금 수납이 **새로** 생긴다. 분해 경로가
//          퇴행했거나 누군가 보증금 폼으로 우회한 것이다. 컷오프 이전 record 는 옛 계약이라 대상 아님.
//   축 C · 분해가 반쪽만 남는다. 청소비 부가수익과 선납 record 는 한 결제라 짝이 맞아야 하고,
//          분해된 계약에 보증금까지 있으면 같은 돈이 두 번 잡힌 것이다.
//
// 판정 함수는 순수하게 두고 아래에서 역주입한다 — 실데이터가 0건이라, 그물이 실제로 발화하는지
// 확인하지 않으면 "위반 0건"이 빈 그물의 침묵인지 건강함인지 구분되지 않는다.
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const FORFEIT_CATEGORY = '보증금 몰취'
const CLEANING_CATEGORY = '청소비'
const DEPOSIT_SOURCED_PAY_METHOD = '보유 보증금'
// 예약금 분해가 만든 청소비 행의 표식 — 생성부(createCleaningFeeIncome occasion '예약')와 한 벌.
// 아래 소스 가드가 생성부에 이 문법이 살아 있는지 함께 본다(문자열이 갈리면 그물이 영원히 0건이다).
const RESERVATION_CLEANING_MARK = ' 예약 · 청소비'
// 규칙 발효일(KST) — 이전 record 는 옛 규칙으로 받은 돈이라 대상이 아니다.
const CUTOFF = new Date('2026-08-19T00:00:00+09:00')

// ── 축 A ── 단기 퇴실에 '보증금 몰취'가 섰는가.
export function shortStayForfeit(row) {
  if (!row.isShortTerm) return null
  if (row.status !== 'CHECKED_OUT') return null
  if (!(row.forfeitSum > 0)) return null
  return `단기 퇴실인데 '${FORFEIT_CATEGORY}' ${row.forfeitSum.toLocaleString('ko-KR')}원이 섰다`
}

// ── 축 B ── 분해 규칙이 켜진 영업장의 단기 계약에 보증금이 새로 생겼는가.
// 계약이 개별로 '보증금 대체'를 고른 경우는 그 선택의 뜻대로 보증금이 맞다(해석 우선순위 정본).
export function unexpectedReservationDeposit(row) {
  if (!row.policyApplyToRent) return null
  if (!row.isShortTerm) return null
  if (row.leaseMode === 'deposit') return null
  if (!(row.depositAfterCutoff > 0)) return null
  return `분해 규칙(applyToRent) 영업장의 단기 계약에 보증금 수납 ${row.depositAfterCutoff.toLocaleString('ko-KR')}원이 새로 생겼다`
}

// ── 축 C ── 분해가 짝이 맞는가. 분해 흔적(예약 청소비 부가수익)이 있는 계약만 본다.
export function splitInconsistency(row) {
  if (!(row.reservationCleaningRows > 0)) return null
  if (row.reservationCleaningRows > 1) {
    return `예약 청소비 부가수익이 ${row.reservationCleaningRows}행이다 — 예약금 분해는 한 결제에 한 행이라 중복 수납 의심`
  }
  if (row.reservationCleaningSum > row.contractCleaningFee) {
    return `예약 청소비 몫 ${row.reservationCleaningSum.toLocaleString('ko-KR')}원이 계약 청소비 ${row.contractCleaningFee.toLocaleString('ko-KR')}원을 넘는다 — 분해 상한 이탈`
  }
  if (row.depositPaid > 0) {
    return `분해 수납인데 보증금 실수납 ${row.depositPaid.toLocaleString('ko-KR')}원이 함께 있다 — 같은 돈이 두 번 잡혔을 수 있다`
  }
  return null
}

// ── 소스 가드 ── 생성·판정 정본이 사라지면 아래 데이터 대조는 영원히 0건을 보고한다.
const sourceViolations = []
{
  const lib = readFileSync('lib/reservationDeposit.ts', 'utf8')
  if (!lib.includes('export function reservationFeeSplitApplies')) {
    sourceViolations.push('[소스] lib/reservationDeposit 의 분해 발동 정본(reservationFeeSplitApplies)이 사라졌다')
  }
  const actions = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  if (!actions.includes('reservationFeeSplitApplies({')) {
    sourceViolations.push('[소스] saveReservationDeposit 가 분해 발동 판정을 더 이상 부르지 않는다 — 예약금이 통째로 선납으로 간다')
  }
  if (!actions.includes("occasion: '예약'")) {
    sourceViolations.push('[소스] 예약금 분해가 청소비 부가수익을 만들지 않는다(occasion: \'예약\' 소실)')
  }
  if (!actions.includes('${args.occasion} · 청소비')) {
    sourceViolations.push(`[소스] 청소비 detail 문법이 바뀌었다 — 이 그물의 표식('${RESERVATION_CLEANING_MARK}')과 갈린다`)
  }
  const tenants = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
  if (!tenants.includes('cleaningIncomeIds')) {
    sourceViolations.push('[소스] 예약 취소가 예약 청소비 몫을 더 이상 다루지 않는다 — 취소 기준액·적용취소 대칭이 깨진다')
  }
}

// ── 자가 역주입 ── 그물이 실제로 발화하는가.
const 역주입 = [
  ['축A 단기 퇴실 몰취', shortStayForfeit({ isShortTerm: true, status: 'CHECKED_OUT', forfeitSum: 50000 })],
  ['축B 분해 영업장 신규 보증금', unexpectedReservationDeposit({ policyApplyToRent: true, isShortTerm: true, leaseMode: null, depositAfterCutoff: 50000 })],
  ['축C 청소비 2행', splitInconsistency({ reservationCleaningRows: 2, reservationCleaningSum: 20000, contractCleaningFee: 20000, depositPaid: 0 })],
  ['축C 상한 이탈', splitInconsistency({ reservationCleaningRows: 1, reservationCleaningSum: 30000, contractCleaningFee: 20000, depositPaid: 0 })],
  ['축C 보증금 공존', splitInconsistency({ reservationCleaningRows: 1, reservationCleaningSum: 20000, contractCleaningFee: 20000, depositPaid: 50000 })],
]
const 미발화 = 역주입.filter(([, r]) => r === null).map(([n]) => n)
// 성한 값에는 침묵해야 한다 — 무조건 발화하는 그물은 발화하지 않는 그물과 똑같이 쓸모없다.
const 오탐 = [
  ['축A 장기 퇴실 몰취는 대상 아님', shortStayForfeit({ isShortTerm: false, status: 'CHECKED_OUT', forfeitSum: 50000 })],
  ['축A 단기 퇴실 몰취 0', shortStayForfeit({ isShortTerm: true, status: 'CHECKED_OUT', forfeitSum: 0 })],
  ['축B 정책 미설정', unexpectedReservationDeposit({ policyApplyToRent: false, isShortTerm: true, leaseMode: null, depositAfterCutoff: 50000 })],
  ['축B 계약이 보증금 대체를 고름', unexpectedReservationDeposit({ policyApplyToRent: true, isShortTerm: true, leaseMode: 'deposit', depositAfterCutoff: 50000 })],
  ['축B 장기 계약', unexpectedReservationDeposit({ policyApplyToRent: true, isShortTerm: false, leaseMode: null, depositAfterCutoff: 50000 })],
  ['축C 정상 분해', splitInconsistency({ reservationCleaningRows: 1, reservationCleaningSum: 20000, contractCleaningFee: 20000, depositPaid: 0 })],
  ['축C 전액 청소비(예약금 ≤ 청소비)', splitInconsistency({ reservationCleaningRows: 1, reservationCleaningSum: 10000, contractCleaningFee: 20000, depositPaid: 0 })],
  ['축C 분해 흔적 없음', splitInconsistency({ reservationCleaningRows: 0, reservationCleaningSum: 0, contractCleaningFee: 20000, depositPaid: 50000 })],
].filter(([, r]) => r !== null).map(([n]) => n)

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const properties = await prisma.property.findMany({ select: { id: true, shortStayPolicy: true } })
const applyToRentProps = new Set(
  properties.filter(p => (p.shortStayPolicy ?? {})?.reservationMode === 'applyToRent').map(p => p.id),
)

const leases = await prisma.leaseTerm.findMany({
  where: { OR: [{ isShortTerm: true }, { status: 'RESERVED' }] },
  select: {
    id: true, propertyId: true, status: true, isShortTerm: true, cleaningFee: true,
    reservationDepositMode: true,
    room: { select: { roomNo: true } }, tenant: { select: { name: true } },
  },
})
const leaseIds = leases.map(l => l.id)

// 소프트삭제 익스텐션은 앱 클라이언트에만 붙는다 — 여기서는 직접 건다.
const [incomes, deposits] = await Promise.all([
  prisma.extraIncome.findMany({
    where: { leaseTermId: { in: leaseIds }, deletedAt: null },
    select: { leaseTermId: true, category: true, amount: true, detail: true, payMethod: true },
  }),
  prisma.paymentRecord.findMany({
    where: { leaseTermId: { in: leaseIds }, isDeposit: true, deletedAt: null },
    select: { leaseTermId: true, actualAmount: true, createdAt: true },
  }),
])

const agg = new Map(leaseIds.map(id => [id, {
  forfeitSum: 0, reservationCleaningRows: 0, reservationCleaningSum: 0, depositPaid: 0, depositAfterCutoff: 0,
}]))
for (const i of incomes) {
  const a = agg.get(i.leaseTermId); if (!a) continue
  if (i.category === FORFEIT_CATEGORY) a.forfeitSum += i.amount
  // 예약금 분해가 만든 청소비 행 — 퇴실 정산이 보증금에서 만든 몫(payMethod 표식)은 제외.
  if (i.category === CLEANING_CATEGORY && i.payMethod !== DEPOSIT_SOURCED_PAY_METHOD
      && (i.detail ?? '').includes(RESERVATION_CLEANING_MARK)) {
    a.reservationCleaningRows += 1
    a.reservationCleaningSum += i.amount
  }
}
for (const d of deposits) {
  const a = agg.get(d.leaseTermId); if (!a) continue
  a.depositPaid += d.actualAmount
  if (d.createdAt >= CUTOFF) a.depositAfterCutoff += d.actualAmount
}

const violations = []
let splitLeases = 0
for (const l of leases) {
  const a = agg.get(l.id)
  const who = `${l.room?.roomNo ?? '호실 미지정'} ${l.tenant?.name ?? '?'}`
  if (a.reservationCleaningRows > 0) splitLeases += 1
  const rA = shortStayForfeit({ isShortTerm: l.isShortTerm, status: l.status, forfeitSum: a.forfeitSum })
  if (rA) violations.push(`축A ${who} — ${rA}`)
  const rB = unexpectedReservationDeposit({
    policyApplyToRent: applyToRentProps.has(l.propertyId),
    isShortTerm: l.isShortTerm, leaseMode: l.reservationDepositMode, depositAfterCutoff: a.depositAfterCutoff,
  })
  if (rB) violations.push(`축B ${who} — ${rB}`)
  const rC = splitInconsistency({
    reservationCleaningRows: a.reservationCleaningRows,
    reservationCleaningSum: a.reservationCleaningSum,
    contractCleaningFee: l.cleaningFee ?? 0,
    depositPaid: a.depositPaid,
  })
  if (rC) violations.push(`축C ${who} — ${rC}`)
}

await prisma.$disconnect()

console.log(`[단기 예약금] 계약 ${leases.length}건(단기·예약) · 분해 수납 ${splitLeases}건`
  + ` · 분해 규칙 영업장 ${applyToRentProps.size}곳 / 위반 ${violations.length}건 (기준선 0)`)
console.log(`  역주입 ${역주입.length - 미발화.length}/${역주입.length} 발화 · 오탐 ${오탐.length}건`)
for (const v of sourceViolations) console.error(`  ${v}`)
for (const v of violations) console.error(`  ${v}`)
if (미발화.length) console.error(`  역주입 미발화: ${미발화.join(', ')}`)
if (오탐.length) console.error(`  오탐: ${오탐.join(', ')}`)
if (violations.length) {
  console.error('  축A 가 정당한 몰취(옛 환불 보증금 단기 계약에서 실제로 떼기로 한 돈)라면 이 그물의 기준선을 운영자 승인으로 올린다.')
  console.error('  축B·축C 는 생성 경로 결함이다 — 데이터를 손보기 전에 경로부터 고친다.')
}
if (sourceViolations.length || violations.length || 미발화.length || 오탐.length) process.exit(1)
