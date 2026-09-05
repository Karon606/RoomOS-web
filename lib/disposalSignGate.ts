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

/**
 * 서명받을 서류 한 장. **계약서가 언제나 첫 슬롯**이고 나머지가 부속 서류다.
 *
 * 왜 슬롯 배열인가(2026-09-06, 제3 서류 1단계). 지금은 서류가 둘이고 두 번째가 '임의처분
 * 동의서'라는 이름으로 코드·화면·감지망에 박혀 있다. 운영자는 그 서류를 안 쓸 수도, 다른
 * 동의서를 쓸 수도 있다. 이름을 지우고 자리만 남기는 것이 이 단계의 일이다.
 *
 * **계약서를 배열의 0번으로 눕히지 않는 이유.** 계약서는 유일한 필수이고, 계약일의 원천이고,
 * 서명 시점 격리본의 주인이고, 폐기·복원이 말하는 대상이다. 눕히는 순간 그 넷이 전부
 * `if (key === 'contract')` 로 되살아난다. 그래서 계약서는 스파인이고 부속만 N 이다.
 *
 * 이 단계는 **동작이 한 비트도 안 바뀐다.** 진리표가 바뀌면 그것은 리팩터가 아니라는 신호다.
 */
export type SignSlot = {
  key: string
  /** 화면·문구가 읽을 이름. 서류를 바꾸면 이 값만 바뀌고 코드는 그대로다. */
  title: string
  signed: boolean
}

export type SignSlotState = { slots: SignSlot[] }

/** 두 문서 상태를 슬롯 배열로 옮긴다 — 기존 호출부가 그대로 살아 있게 하는 어댑터다. */
export function toSlots(s: DisposalSignState, disposalTitle = '동의서'): SignSlot[] {
  const out: SignSlot[] = [{ key: 'contract', title: '입실계약서', signed: s.hasContractSignature }]
  // 동의서가 꺼진 영업장이라도 **이미 받아 둔 서명이 있으면 슬롯을 세운다.**
  // 안 세우면 그 서명이 판정에서 사라져 '동의서만 서명된' 상태가 none 이 된다 — 받은 서명이
  // 있는데 아무것도 안 받은 것으로 읽히는 것이라, 종전 진리표와도 어긋난다.
  // 설정을 끄기 전에 받아 둔 서명이 바로 이 경우다.
  if (s.disposalEnabled || s.hasDisposalSignature) {
    out.push({ key: 'disposal', title: disposalTitle, signed: s.hasDisposalSignature })
  }
  return out
}

/** 슬롯 배열 기준 진행 상태. 전부 서명이면 complete, 하나도 없으면 none, 그 밖은 partial. */
export function signStageSlots({ slots }: SignSlotState): SignStage {
  if (slots.length === 0) return 'none'
  if (slots.every(x => x.signed)) return 'complete'
  if (slots.every(x => !x.signed)) return 'none'
  return 'partial'
}

/** 아직 안 받은 슬롯들. 화면이 어디로 데려갈지, 문구가 무엇을 말할지의 재료다. */
export function missingSlots({ slots }: SignSlotState): SignSlot[] {
  return slots.filter(x => !x.signed)
}

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
  return signStageSlots({ slots: toSlots(s) })
}

/** 아직 안 받은 서명. 무엇이 남았는지 사람 말로 옮기는 재료이자, 화면이 어디로 데려갈지의 근거다. */
export function missingSignatures(s: DisposalSignState): Array<'contract' | 'disposal'> {
  return missingSlots({ slots: toSlots(s) }).map(x => x.key as 'contract' | 'disposal')
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

/**
 * 슬롯 배열로 말하는 진행 문구 — **서류 이름을 코드가 아니라 슬롯 title 에서 읽는다.**
 *
 * 서류가 셋 이상이면 남은 것을 낱낱이 세지 않고 건수로 말한다. "계약서만 서명됨 · 동의서 서명
 * 대기"는 슬롯이 **둘일 때의 특수형**이고, 셋이 되는 순간 그 문법이 길어져 못 읽는다.
 */
export function signProgressLabelSlots(st: SignSlotState): string {
  const stage = signStageSlots(st)
  if (stage === 'complete') return '원격 서명 완료 · 계약서 발급 필요'
  if (stage === 'none') return '서명 대기'
  const left = missingSlots(st)
  const done = st.slots.filter(x => x.signed)
  if (left.length === 1 && done.length === 1) return `${done[0].title}만 서명됨 · ${left[0].title} 서명 대기`
  return `${done.length}건 서명됨 · 남은 서명 ${left.length}건`
}

export type SignAlertState = DisposalSignState & { submitted: boolean; linkDead: boolean }

/**
 * 종·푸시가 이 건을 **지금** 말할 때인가.
 *
 * 왜 있는가(운영자 신고 09da7f29, 2026-09-05). "계약서 등 그 중 하나만 서명되었을 때 알림이
 * 오는 것은 사실 필요 없을 듯하고 제출되었을 때만 알림이 와도 돼. 단, 모든 서류에 서명이 되고
 * 제출까지 완료될 수 있도록 직관적으로 유도하는 것만 잘 되면 돼."
 *
 * 판정 한 문장은 **"입주자가 스스로 마칠 수 있는 동안은 침묵한다"** 이다. 링크가 살아 있고
 * 제출 전이면 알림을 만들지 않고, 제출됐거나 링크가 죽으면(만료·잠김) 종전 규칙대로 센다.
 *
 * N시간 같은 새 설정을 발명하지 않는다 — 링크 수명 24시간이 이미 자연 마감이다.
 *
 * 왜 반쪽 알림을 아예 없애지 않는가. 문면대로 0 으로 만들면 한쪽만 서명하고 이탈한 건이
 * 영영 침묵한다(506호가 그랬다). 반면 그 알림을 하루 받아 본 운영자의 판정이 소음의 비용을
 * 지는 사람의 판정이라 우선한다. 그래서 "죽은 링크의 반쪽"만 남기는 절충이다.
 * 침묵하는 동안에도 반쪽 사실 자체는 발급 대기 목록과 계약서 패널 배지에 그대로 보인다 —
 * 그쪽은 알림이 아니라 표시다.
 *
 * 부수 효과 하나. 둘 다 서명했는데 제출 전인 살아 있는 링크의 '서명 받음' 알림도 최대 24시간
 * 침묵한다. 제출하면 실시간 푸시가 즉시 오고 만료로 죽어도 리마인더가 서므로 구멍은 아니며,
 * 운영자 문면("제출되었을 때만")과도 정합한다.
 */
export function signAlertDue(s: SignAlertState): boolean {
  if (signStage(s) === 'none') return false
  return s.submitted || s.linkDead
}
