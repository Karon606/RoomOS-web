// 보증금 구성 판정 회귀 테스트 — lib/depositComposition. 실패 시 exit 1.
// 실행: npx tsx scripts/test-deposit-composition.ts
//
// 왜 두 shape 를 함께 고정하는가. 이 판정은 영업장 설정 하나로 정반대가 된다.
// 청소비를 보증금 안의 몫으로 받는 영업장(포함형)에서는 입실 때 받은 청소비가 계약 보증금을
// 그만큼 채우고, 별도로 받는 영업장(별도형)에서는 보증금과 아무 상관이 없다.
// 한쪽만 고정하면 반대쪽이 조용히 뒤집힌다 — 포함형에 맞춘 코드가 별도형의 실제 부족을 완납으로
// 덮고, 별도형에 맞춘 코드가 포함형에 영원한 '부족 20,000'을 띄운다. 둘 다 실제로 일어났다.
import { depositComposition, depositCompositionLabel, splitWithheldDeposit, withheldDestinationLabel, withheldPartsLabel } from '../lib/depositComposition'
import { cleaningFeeDeductible } from '../lib/depositWithholdReasons'
import { fmtWon } from '../lib/fmtMoney'

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

// ── 미반환분 분류 — 청소비 몫과 몰취 몫 (운영자 정본 2026-08-11) ─────────────────────
//
//   "보증금 5만원에 이미 청소비 2만원이 포함되어 있었고 난 3만원을 돌려준 거야. 즉 정상적인 청소비를
//    받은 거야. 보증금 몰취는 시설물이 파손되거나 했을 때 (잔여) 3만원에서 차감할 때 몰취가 되는 거지."
//
// 이 판정이 뒤집히면 정상 청소비 수취가 세무 자료에서 손해배상성 잡수입으로 선다.
const split = (name: string, withheld: number, portion: number, want: { cleaning: number; forfeit: number }) =>
  eq(name, splitWithheldDeposit(withheld, portion), want)

// 실측 507·509호 — 보증금 50,000(청소비 몫 20,000) 중 30,000 반환. 전부 청소비다.
split('정상 퇴실·청소비 몫만 사용', 20000, 20000, { cleaning: 20000, forfeit: 0 })
// 전액 미반환 — 청소비 몫을 먼저 채우고 남은 30,000 만 몰취다. 파손 차감이 여기 선다.
split('전액 미반환·청소비 + 몰취 분리', 50000, 20000, { cleaning: 20000, forfeit: 30000 })
// 실측 키값 3건(인수 승계분) — 계약 청소비 0 이라 전부 몰취다. 규칙이 기계적으로 맞아떨어져야 한다.
split('키값 승계분·청소비 몫 없음', 50000, 0, { cleaning: 0, forfeit: 50000 })
// 미반환이 청소비 몫보다 작으면 그만큼만 청소비다 — 없는 청소비를 만들어 내면 안 된다.
split('미반환 < 청소비 몫', 10000, 20000, { cleaning: 10000, forfeit: 0 })
split('미반환 0', 0, 20000, { cleaning: 0, forfeit: 0 })
// 음수 방어 — 상류가 깨져도 매출을 만들지 않는다.
split('음수 방어', -5000, -20000, { cleaning: 0, forfeit: 0 })

// either/or 와 물려 있다 — 입실 때 따로 받았으면 퇴실 청소비 몫은 0 이고 전부 몰취다(계약서 §2-4).
split('입실 수령분 있음·전부 몰취', 20000, cleaningFeeDeductible(20000, 20000), { cleaning: 0, forfeit: 20000 })
split('입실 수령분 없음·청소비 몫 유지', 20000, cleaningFeeDeductible(20000, 0), { cleaning: 20000, forfeit: 0 })

// 안내 문구 — 여섯 자리가 같은 문장을 쓴다. 조사까지 정본이 붙인다(분해 여부로 받침이 달라진다).
eq('안내·청소비만', withheldDestinationLabel(20000, 20000, fmtWon), "부가수익 '청소비'로")
eq('안내·몰취만', withheldDestinationLabel(50000, 0, fmtWon), "부가수익 '보증금 몰취'로")
eq('안내·분리', withheldDestinationLabel(50000, 20000, fmtWon), "부가수익 '청소비' 20,000원과 '보증금 몰취' 30,000원으로")
// 미반환 0 이어도 문장은 서야 한다(폼 상시 안내) — 기본은 몰취.
eq('안내·미반환 0', withheldDestinationLabel(0, 20000, fmtWon), "부가수익 '보증금 몰취'로")

// 적용취소 확인창 — 무엇이 사라지는지 카테고리로 말한다. 한 행이면 이름만(옆 숫자를 두 번 말하지 않는다).
eq('적용취소·한 행', withheldPartsLabel([{ category: '청소비', amount: 20000 }], fmtWon), '청소비')
eq('적용취소·두 행', withheldPartsLabel(
  [{ category: '청소비', amount: 20000 }, { category: '보증금 몰취', amount: 30000 }], fmtWon),
  '청소비 20,000원 · 보증금 몰취 30,000원')
eq('적용취소·행 없음', withheldPartsLabel([], fmtWon), null)

console.log(`\n보증금 구성 판정 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
