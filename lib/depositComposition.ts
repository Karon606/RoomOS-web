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

import { CLEANING_FEE_CATEGORY, FORFEIT_CATEGORY } from '@/lib/incomeCategories'

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
 * 퇴실 미반환분을 **청소비 몫**과 **몰취 몫**으로 가르는 정본(운영자 규칙 2026-08-11).
 *
 *   "보증금 5만원에 이미 청소비 2만원이 포함되어 있었고 난 3만원을 돌려준 거야. 즉 정상적인 청소비를
 *    받은 거야. 보증금 몰취는 시설물이 파손되거나 했을 때 (잔여) 3만원에서 차감할 때 몰취가 되는 거지."
 *
 * 즉 미반환분은 먼저 청소비 몫을 채우고, 그걸 넘는 만큼만 몰취다. 청소비 몫은 계약에 적힌 금액이라
 * 추정이 아니라 객관적으로 갈린다. 사유 텍스트('청소비')는 보지 않는다 — 사유는 운영자가 고르는
 * 자유 값이라 같은 거래가 라벨에 따라 다른 계정으로 가면 그게 곧 다음 오분류다.
 *
 * cleaningPortion 은 퇴실 폼이 실제로 떼는 금액과 같은 판정을 써야 한다
 * (lib/depositWithholdReasons 의 cleaningFeeDeductible — 입실 때 따로 받았으면 0).
 * 화면이 여는 최대치와 서버 기준이 갈리면 안 된다는 규칙(§27.2)의 연장이다.
 */
export function splitWithheldDeposit(withheld: number, cleaningPortion: number): { cleaning: number; forfeit: number } {
  const w = Math.max(0, withheld)
  const cleaning = Math.min(w, Math.max(0, cleaningPortion))
  return { cleaning, forfeit: w - cleaning }
}

/**
 * 미반환분이 **어디로 갈지** 한 조각 — "부가수익 '청소비'로" / "부가수익 '청소비' 2만과 '보증금 몰취' 3만으로".
 * 퇴실 정산 3폼(상태전환 미니폼·고객정보 환불창·홈 알림)과 확인창이 같은 문장을 쓰게 하는 자리다.
 * 종전에는 여섯 자리가 각자 "부가수익(보증금)" 이라고 단정했고, 그 이름은 2026-08-01 에 이미 폐기됐다.
 * 조사까지 여기서 붙인다 — 분해 여부에 따라 앞말 받침이 달라져 호출부가 각자 쓰면 틀린다.
 */
export function withheldDestinationLabel(withheld: number, cleaningPortion: number, fmt: (n: number) => string): string {
  const { cleaning, forfeit } = splitWithheldDeposit(withheld, cleaningPortion)
  if (cleaning > 0 && forfeit > 0) return `부가수익 '${CLEANING_FEE_CATEGORY}' ${fmt(cleaning)}과 '${FORFEIT_CATEGORY}' ${fmt(forfeit)}으로`
  if (cleaning > 0) return `부가수익 '${CLEANING_FEE_CATEGORY}'로`
  return `부가수익 '${FORFEIT_CATEGORY}'로`
}

/**
 * 미반환분이 실제로 어떤 부가수익으로 섰는지 한 줄 — '청소비 20,000원 · 보증금 몰취 30,000원'.
 * 적용취소 확인창이 지울 대상을 정확히 말하기 위한 문법 정본(가이드 §14 — 건수·금액은 서버 실데이터).
 * 행이 하나뿐이면 카테고리 이름만 돌려준다(옆 숫자를 두 번 말하지 않는다 — 구성 라벨과 같은 규칙).
 */
export function withheldPartsLabel(
  parts: { category: string; amount: number }[],
  fmt: (n: number) => string,
): string | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0].category
  return parts.map(p => `${p.category} ${fmt(p.amount)}`).join(' · ')
}

/**
 * '받은 보증금 30,000 + 청소비 20,000 / 계약 50,000' 구성 한 줄 — DepositStatusPanel 표시 문법 정본.
 * 청소비가 채운 몫이 없으면 null. 무조건 붙이면 바로 옆 숫자를 두 번 말하게 된다(패널 규칙 그대로).
 */
export function depositCompositionLabel(c: Pick<DepositComposition, 'contract' | 'depositPaid' | 'coveredByCleaning'>): string | null {
  if (c.coveredByCleaning <= 0) return null
  const won = (n: number) => n.toLocaleString()
  return `받은 보증금 ${won(c.depositPaid)} + 청소비 ${won(c.coveredByCleaning)} / 계약 ${won(c.contract)}`
}

/**
 * 보유 보증금 중 **계약 기준** 청소비 몫 (운영자 확정 2026-08-12).
 *
 * "보증금 5만에 청소비 2만 포함"이 기본 정책이라, 홈 재무 탭의 이 자리에서 운영자가 기대하는
 * 숫자는 "지금 들고 있는 보증금 가운데 퇴실 때 청소비로 쓰일 몫이 얼마인가"다(계약 축).
 * 종전 수납 기록 축(coveredByCleaning — 청소비 명목 수납이 보증금 부족분을 채운 몫)은
 * 주단위 시작을 역산한 예외 기록(520호 김민정)에서만 값이 서서 정책 심상과 어긋났다.
 *
 * 실수취 상한을 거는 이유 — 보증금을 아직 안 낸 계약(전 원장 승계, 419호 미수취 등)의
 * 청소비 몫까지 세면 안 받은 돈을 들고 있다고 말하게 된다. 계약 상한은 청소비 약정이
 * 보증금보다 큰 비정상 입력 방어다. 퇴실 정산 분류(splitWithheldDeposit)와 같은 계약 축이다.
 */
export function heldContractCleaningPortion(args: {
  contractDeposit: number
  cleaningFee: number | null | undefined
  depositPaid: number
  cleaningPaid: number
}): number {
  const fee = Math.max(0, args.cleaningFee ?? 0)
  const received = Math.max(0, args.depositPaid) + Math.max(0, args.cleaningPaid)
  return Math.min(fee, received, Math.max(0, args.contractDeposit))
}
