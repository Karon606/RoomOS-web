// 보증금 구성 판정 정본 — 계약 보증금이 현금 몫과 청소비 몫으로 어떻게 나뉘는지 한 곳에서 정한다.
//
// 왜 필요한가. 청소비가 보증금 안의 몫인 영업장에서는 입실 때 받은 청소비가 계약 보증금의 일부를
// 채운다(운영자 확정 2026-08-10, 520호 김민정 — 보증금 50,000 중 현금 30,000 + 청소비 20,000).
// 현금만 세면 그 몫이 영원히 '부족'으로 보이고, 그걸 메우려 보증금을 다시 넣으면 같은 2만원이
// 두 번 잡힌다(신고 a5edc93e). 반대로 청소비를 보증금과 별도로 받는 영업장에서 같은 판정을 하면
// 실제 부족을 완납으로 덮는다. 그래서 판정 근거는 영업장 설정(Property.cleaningFeeInDeposit)이다.
//
// 계약 단위 플래그는 두지 않는다 — 설정이 켜진 영업장에서 그 계약이 청소비를 실제로 받았는지
// (ExtraIncome '청소비')가 계약별 구성을 이미 결정한다(cleaningFeeDeductible 의 either/or 와 같은 규칙).
//
// 화면이 각자 min/max 를 다시 쓰지 않게 하는 것이 이 파일의 목적이다. 종전에는 DepositStatusPanel
// 한 곳만 청소비를 연결해 읽었고, 나머지 스무 곳은 계약 보증금을 그대로 믿었다.

export type DepositComposition = {
  /** 계약 보증금 (0 하한) */
  contract: number
  /** 실수납 보증금 합(isDeposit=true, 소프트삭제 제외) */
  depositPaid: number
  /** 입실 때 받은 청소비 합(ExtraIncome '청소비') */
  cleaningPaid: number
  /** 영업장 설정 — 청소비를 보증금 안의 몫으로 받는가 */
  cleaningFeeInDeposit: boolean
  /** 설정상 보증금 몫으로 인정되는 청소비 상한(계약 보증금을 넘지 않는다) */
  cleaningCredit: number
  /** 청소비가 실제로 채운 부족분 */
  coveredByCleaning: number
  /** 현금으로 받아야 할 몫 = 계약 보증금 − 청소비 몫 */
  cashDue: number
  /** 현금·청소비를 다 세고도 남은 실제 부족 */
  shortfall: number
}

export function depositComposition(input: {
  contractDeposit: number
  depositPaid: number
  cleaningPaid: number
  cleaningFeeInDeposit: boolean
}): DepositComposition {
  const contract = Math.max(0, input.contractDeposit)
  const depositPaid = Math.max(0, input.depositPaid)
  const cleaningPaid = Math.max(0, input.cleaningPaid)
  // 별도 수령 영업장은 청소비가 보증금과 무관하다 — 크레딧 0 이라 아래 판정이 전부 현금 기준으로 돌아간다.
  const cleaningCredit = input.cleaningFeeInDeposit ? Math.min(contract, cleaningPaid) : 0
  // 계약 보증금이 비어 있으면(미입력) 부족을 말할 근거가 없다 — 종전 화면 판정과 같은 규칙.
  const rawShortfall = contract > 0 ? contract - depositPaid : 0
  const coveredByCleaning = Math.min(Math.max(0, rawShortfall), cleaningCredit)
  return {
    contract,
    depositPaid,
    cleaningPaid,
    cleaningFeeInDeposit: input.cleaningFeeInDeposit,
    cleaningCredit,
    coveredByCleaning,
    cashDue: Math.max(0, contract - cleaningCredit),
    shortfall: Math.max(0, rawShortfall - coveredByCleaning),
  }
}

/**
 * '보증금 50,000 (현금 30,000 + 청소비 20,000)' 구성 한 줄.
 * 청소비 몫이 없으면 null — 무조건 붙이면 같은 숫자를 두 번 말하게 된다(DepositStatusPanel 규칙).
 */
export function depositCompositionLabel(c: Pick<DepositComposition, 'contract' | 'cashDue' | 'cleaningCredit'>): string | null {
  if (c.cleaningCredit <= 0) return null
  const won = (n: number) => n.toLocaleString()
  return `보증금 ${won(c.contract)} (현금 ${won(c.cashDue)} + 청소비 ${won(c.cleaningCredit)})`
}
