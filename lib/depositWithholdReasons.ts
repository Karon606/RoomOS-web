// 보증금 미환불 사유 선택지 정본 — 퇴실 정산 3경로(상태전환 미니폼·고객정보 환불창·홈 알림)가 공유.
// '기타'는 자유 입력을 붙여 '기타 · <내용>' 으로 저장한다(cancelReasons 와 같은 규약).
//
// 왜 필수인가. 돈이 실제로 움직이는 결정이라 분쟁이 생기면 근거가 필요하고, 세무 자료에서도
// '보증금 몰취'가 왜 발생했는지 설명이 있어야 한다. 입실 취소 사유가 선택인 것과 다른 이유다.
//
// '미납 충당'은 일부러 넣지 않았다. 미납 이용료를 보증금에서 충당한 분은 세법상 임대수입이라
// 기타수익(보증금 몰취)이 아니라 이용료 수납으로 가야 한다. 선택지로 두면 시스템이 그것을
// 잡수입으로 확정 분류한다. 틀린 라벨을 붙이는 것보다 라벨이 없는 게 낫다.
// 미납이 있으면 수납 화면에서 먼저 입금 처리하도록 안내한다.
// '키값' — 열쇠값 명목으로 보증금을 돌려주지 않는 것. 인수 전 원장의 운영 원칙이었고,
// 그때 입실한 분들에게는 그대로 적용하기로 했다(운영자 확정 2026-08-02).
//   "변세진의 보증금은 이 전 운영자에게 전달 받았던게 맞아. 다만, 그 당시 운영 원칙상
//    '키값'이라는 명목으로 안돌려줬어. 따라서, 이전 원장때 입실한 사람들은 그냥 안돌려주는걸로 하기로 했어."
// 케이스가 아니라 클래스다 — 인수 전 입주자 퇴실 시 기본 선택으로 제안한다.
export const WITHHOLD_REASONS = ['키값', '청소비', '원상복구비', '계약 위반', '기타'] as const

// 사유 목록의 '청소비' 항 — 청소비 잔고 조회와 퇴실 정산 detail 이 같은 문자열을 본다.
// 종전에는 cleaningActions 안에 사본이 있었다. 개명하면 한쪽만 바뀐다.
export const CLEANING_WITHHOLD_REASON = '청소비'

// 퇴실 정산에서 실제로 뗄 청소비 — 계약서 §2-4 의 either/or 판정 정본.
// "보증금이 있는 경우 퇴실 정산 시 보증금에서 공제하고, 보증금이 없는 경우 입실 시 이용료와 함께
// 받습니다" 라 둘 중 하나다. 입실 때 따로 받았으면(ExtraIncome 카테고리 '청소비') 퇴실 공제는 0이다.
// 종전에는 판정식이 네 곳에 흩어져 표시 화면만 빠졌고, 그래서 같은 계약이 패널에서는 30,000,
// 퇴실 폼에서는 50,000 으로 갈렸다(520호 김민정). 수신액 조회는 tenants/actions 의
// getCleaningFeeReceivedForLease 가 정본이며(순환 import 때문에 그 자리를 지킨다) 여기는 판정만 한다.
export function cleaningFeeDeductible(contractFee: number, receivedSeparately: number): number {
  return receivedSeparately > 0 ? 0 : contractFee
}

export function buildWithholdReason(selected: string, etcText: string): string {
  if (!selected) return ''
  if (selected !== '기타') return selected
  const t = etcText.trim()
  return t ? `기타 · ${t}` : '기타'
}
