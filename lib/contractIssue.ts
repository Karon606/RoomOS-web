// 원격 서명 후 '계약서 발급이 아직 안 됐는가' 판정 정본.
//
// 홈 알림('원격 서명 완료 · 계약서 발급 필요')과 고객 정보의 계약서 파일 패널이 같은 상태를 보여줘야
// 하는데, 규칙을 각자 짜면 화면마다 다른 말을 한다(이번 세션에서 반복해 겪은 패턴). 여기 한 곳에서만 정한다.
//
// 해소 조건은 **파일 종류를 가리지 않는다.** 같은 계약(leaseTermId)에 서명 시각 이후로 만들어진
// 계약서 파일이 하나라도 있으면 끝이다. 발급본(GENERATED)이든 스캔본(UPLOADED)이든 상관없다.
// 종이로 다시 받아 올린 경우도 계약서가 갖춰진 것이므로 알림이 남으면 안 되기 때문이다.
//   (2026-08-01 정정: 'GENERATED 만 해소된다'는 보고가 있었으나 실제 쿼리는 두 종류를 모두 본다.)
//
// leaseTermId 로 좁히는 이유: 같은 입주자가 재계약하면 이전 계약의 발급본이 새 서명을 오해소한다.

export type ContractFileRef = { leaseTermId: string | null; createdAt: Date }

/**
 * 이 서명을 덮는 계약서는 **어느 계약의 것인가** — 딸린 계약(2026-08-13 다호실 2단계)의 종이는
 * 부모 한 장이다. 601호 창고 계약에 서명이 들어와도 발급되는 종이는 509호 합본 계약서이고,
 * 그 종이가 만들어지면 601 의 대기·알림도 함께 끝나야 한다.
 *
 * 이 한 줄이 없으면 홈 종은 601 을 부르는데 발급은 막혀 있어(부모로만 발급) 알림이 영영 안 꺼진다.
 * 부르는 곳이 둘(홈 알림·발급 대기 목록)이라 여기 한 벌로 둔다.
 */
export function issuingLeaseId(leaseTermId: string, parentLeaseTermId: string | null | undefined): string {
  return parentLeaseTermId ?? leaseTermId
}

export function isContractIssued(
  signedAt: Date,
  leaseTermId: string,
  files: ContractFileRef[],
): boolean {
  return files.some(f =>
    f.leaseTermId === leaseTermId && f.createdAt.getTime() >= signedAt.getTime(),
  )
}
