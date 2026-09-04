// 잔여 소지품 임의처분 동의서 서명 게이트 정본 — 계약서만 서명된 반쪽 상태를 완료로 부르지 않는다.
//
// 왜 필요한가(운영자 신고 2026-09-03). 413호 입주자가 원격 링크에서 계약서에만 서명하고 멈췄다.
// 동의서 서명도 제출도 없었다. 그런데 홈 알림이 "원격 서명 완료 · 계약서 발급 필요"라고 점등했고,
// 운영자는 그 알림을 믿고 발급했다. 동의서 장은 서명란이 빈 채로 나갔다.
//
// 알림 판정이 link.signedAt 하나만 봤기 때문이다. 동의서 서명도 제출 여부도 안 봤다.
// **운영자는 앱이 시킨 대로 했다. 앱이 완료가 아닌 것을 완료라고 불렀다.**
//
// 그래서 판정을 여기 한 벌로 모은다. 세 자리가 이것을 배선한다.
//   · 제출(app/sign/[token]/actions.ts) — 하드 차단. 클라이언트 canSubmit 의 서버 거울이다.
//   · 발급(app/api/contract/generate) — 확인창 뒤 진행 가능(운영자 결정 2026-09-04).
//     이미 반쪽으로 굳은 건이 있고, 출력해서 손으로 받는 운용도 정당하기 때문이다.
//   · 표시(홈 알림·발급 대기·계약서 패널) — 반쪽이면 반쪽이라고 말한다.
//     세 자리를 전수로 적어 둔다. 하나라도 빠지면 그 표면만 옛 말을 계속하고, 운영자는 어느
//     화면을 봤느냐에 따라 다른 사실을 듣는다. check-disposal-sign-gate 가 배선을 지킨다.
//
// 동의서가 꺼진 영업장은 어느 자리에서도 걸리지 않는다. 계약서 서명 자체가 없는 빈 종이 인쇄도
// 종전대로 통과한다 — 그 길은 출력 후 수기 서명을 받는 정당한 흐름이다.

export type DisposalSignState = {
  /** 이 종이에 동의서 절이 붙는가. 링크는 발급 시점 스냅샷을, 발급은 해석된 영업장 설정을 넘긴다. */
  disposalEnabled: boolean
  hasContractSignature: boolean
  hasDisposalSignature: boolean
}

/**
 * 동의서 서명이 빠진 반쪽 상태인가.
 *
 * 계약서 서명을 함께 보는 이유. 아무 서명도 없는 상태는 "빈 종이를 뽑아 손으로 받는" 정상 경로라
 * 여기서 막으면 그 운용이 통째로 깨진다. 막아야 할 것은 **한쪽만 받고 끝난 것**이다.
 */
export function disposalSignatureMissing(s: DisposalSignState): boolean {
  return s.disposalEnabled && s.hasContractSignature && !s.hasDisposalSignature
}

export type SignStage = 'none' | 'partial' | 'complete'

/**
 * 이 계약의 서명이 어디까지 왔는가. **동의서를 안 쓰는 영업장은 계약서 하나로 complete 다.**
 *
 * 왜 별도 함수인가(2026-09-04). disposalSignatureMissing 은 **발급 축**이라 계약서가 있는데
 * 동의서가 없는 경우만 본다. 그래서 506호처럼 동의서만 서명된 반쪽이 어느 화면에도 안 나왔다.
 * 표시 자리가 넷인데 각자 세면 어느 화면을 봤느냐에 따라 운영자가 다른 사실을 듣는다 —
 * 그것이 이 사건의 원인 그대로다.
 *
 * 두 함수의 관계는 회귀 테스트가 항등으로 못박는다.
 *   disposalSignatureMissing(s) === (signStage(s) === 'partial' && s.hasContractSignature)
 */
export function signStage(s: DisposalSignState): SignStage {
  const disposalDone = !s.disposalEnabled || s.hasDisposalSignature
  if (s.hasContractSignature && disposalDone) return 'complete'
  if (!s.hasContractSignature && !s.hasDisposalSignature) return 'none'
  return 'partial'
}

/** 아직 안 받은 서명. 무엇이 남았는지 사람 말로 옮기는 재료이자, 화면이 어디로 데려갈지의 근거다. */
export function missingSignatures(s: DisposalSignState): Array<'contract' | 'disposal'> {
  const out: Array<'contract' | 'disposal'> = []
  if (!s.hasContractSignature) out.push('contract')
  if (s.disposalEnabled && !s.hasDisposalSignature) out.push('disposal')
  return out
}

/** 서명 진행 상태의 사람 말 — 표시 세 자리가 같은 문장을 쓴다. */
export function signProgressLabel(s: DisposalSignState): string {
  const stage = signStage(s)
  if (stage === 'complete') return '원격 서명 완료 · 계약서 발급 필요'
  if (stage === 'none') return '서명 대기'
  // 반쪽은 양방향이다. 종전에는 계약서만 서명된 쪽만 말했고 동의서만 서명된 쪽(506호)은
  // 화면 어디에도 안 나왔다 — 링크 쿼리가 계약서 서명만 보고 그것을 통째로 걸렀다.
  return s.hasContractSignature ? '계약서만 서명됨 · 동의서 서명 대기' : '동의서만 서명됨 · 계약서 서명 대기'
}
