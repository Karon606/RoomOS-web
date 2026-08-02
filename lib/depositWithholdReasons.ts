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
export const WITHHOLD_REASONS = ['청소비', '원상복구·손괴', '계약 위반', '기타'] as const

export function buildWithholdReason(selected: string, etcText: string): string {
  if (!selected) return ''
  if (selected !== '기타') return selected
  const t = etcText.trim()
  return t ? `기타 · ${t}` : '기타'
}
