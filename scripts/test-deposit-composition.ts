// 보증금 구성 판정 회귀 테스트 — lib/depositComposition. 실패 시 exit 1.
// 실행: npx tsx scripts/test-deposit-composition.ts
//
// 왜 두 shape 를 함께 고정하는가. 이 판정은 영업장 설정 하나로 정반대가 된다.
// 청소비를 보증금 안의 몫으로 받는 영업장(포함형)에서는 입실 때 받은 청소비가 계약 보증금을
// 그만큼 채우고, 별도로 받는 영업장(별도형)에서는 보증금과 아무 상관이 없다.
// 한쪽만 고정하면 반대쪽이 조용히 뒤집힌다 — 포함형에 맞춘 코드가 별도형의 실제 부족을 완납으로
// 덮고, 별도형에 맞춘 코드가 포함형에 영원한 '부족 20,000'을 띄운다. 둘 다 실제로 일어났다.
import { depositComposition, depositCompositionLabel } from '../lib/depositComposition'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

/** contract·paid·cleaning 을 넣고 covered / shortfall / cashDue 세 값을 한 번에 고정한다. */
const shape = (
  name: string,
  input: { contract: number; paid: number; cleaning: number; inclusive: boolean },
  want: { covered: number; shortfall: number; cashDue: number },
) => {
  const c = depositComposition({
    contractDeposit: input.contract, depositPaid: input.paid,
    cleaningPaid: input.cleaning, cleaningFeeInDeposit: input.inclusive,
  })
  eq(name, { covered: c.coveredByCleaning, shortfall: c.shortfall, cashDue: c.cashDue }, want)
}

// ── 포함형 — 청소비가 보증금 안의 몫인 영업장(제기역점, 운영자 확정 2026-08-10) ─────────
// 520호 김민정 실데이터. 계약 50,000 을 현금 30,000 + 입실 청소비 20,000 으로 채운 상태.
shape('포함형·김민정 실데이터', { contract: 50000, paid: 30000, cleaning: 20000, inclusive: true },
  { covered: 20000, shortfall: 0, cashDue: 30000 })
// 아직 현금을 못 받은 상태 — 부족은 청소비를 뺀 현금 몫이다(5만이 아니다).
shape('포함형·현금 미수납', { contract: 50000, paid: 0, cleaning: 20000, inclusive: true },
  { covered: 20000, shortfall: 30000, cashDue: 30000 })
// 사고 상태(정정 전) — 현금으로 전액을 받아 같은 20,000 이 두 번 잡혔다. 부족은 0이지만 현금 몫은 30,000.
// 이 간극이 감지망 (a)가 잡는 자리다(verify-money-consistency 19).
shape('포함형·전액 현금 수납(이중 계상)', { contract: 50000, paid: 50000, cleaning: 20000, inclusive: true },
  { covered: 0, shortfall: 0, cashDue: 30000 })
// 청소비를 안 받은 계약은 포함형이어도 전부 현금 몫이다.
shape('포함형·청소비 미수령', { contract: 300000, paid: 300000, cleaning: 0, inclusive: true },
  { covered: 0, shortfall: 0, cashDue: 300000 })
// 청소비가 계약 보증금보다 크면 크레딧은 보증금까지만 — 현금 몫이 음수가 되면 안 된다.
shape('포함형·청소비 > 계약 보증금', { contract: 10000, paid: 0, cleaning: 20000, inclusive: true },
  { covered: 10000, shortfall: 0, cashDue: 0 })
// 계약 보증금 미입력(0)은 부족을 말할 근거가 없다 — 종전 화면 판정과 같은 규칙.
shape('포함형·계약 보증금 미입력', { contract: 0, paid: 20000, cleaning: 20000, inclusive: true },
  { covered: 0, shortfall: 0, cashDue: 0 })
// 과납은 부족 0. 음수 부족이 새어 나가면 '부족 -10,000' 배지가 뜬다.
shape('포함형·과납', { contract: 50000, paid: 60000, cleaning: 20000, inclusive: true },
  { covered: 0, shortfall: 0, cashDue: 30000 })

// ── 별도형 — 청소비를 보증금과 별도로 받는 영업장(기본값) ────────────────────────────
// 같은 데이터라도 판정이 뒤집힌다. 청소비 20,000 은 보증금과 무관하므로 실제로 20,000 이 부족하다.
shape('별도형·같은 데이터는 실제 부족', { contract: 50000, paid: 30000, cleaning: 20000, inclusive: false },
  { covered: 0, shortfall: 20000, cashDue: 50000 })
// 별도형에서 계약액 전액을 현금으로 받은 것은 정상 완납이다 — 초과 수납 가드가 막으면 안 된다.
shape('별도형·전액 현금 수납은 정상', { contract: 50000, paid: 50000, cleaning: 20000, inclusive: false },
  { covered: 0, shortfall: 0, cashDue: 50000 })
shape('별도형·청소비 미수령', { contract: 300000, paid: 0, cleaning: 0, inclusive: false },
  { covered: 0, shortfall: 300000, cashDue: 300000 })

// ── 구성 병기 한 줄 — 네 화면이 같은 문자열을 쓴다 ──────────────────────────────────
eq('구성 문구·포함형', depositCompositionLabel(depositComposition({
  contractDeposit: 50000, depositPaid: 30000, cleaningPaid: 20000, cleaningFeeInDeposit: true,
})), '받은 보증금 30,000 + 청소비 20,000 / 계약 50,000')
// 청소비가 채운 몫이 없으면 붙이지 않는다 — 무조건 붙이면 바로 옆 숫자를 두 번 말한다.
eq('구성 문구·별도형은 없음', depositCompositionLabel(depositComposition({
  contractDeposit: 50000, depositPaid: 30000, cleaningPaid: 20000, cleaningFeeInDeposit: false,
})), null)
eq('구성 문구·청소비 미수령은 없음', depositCompositionLabel(depositComposition({
  contractDeposit: 50000, depositPaid: 50000, cleaningPaid: 0, cleaningFeeInDeposit: true,
})), null)

console.log(`\n보증금 구성 판정 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
