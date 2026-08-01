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

export function isContractIssued(
  signedAt: Date,
  leaseTermId: string,
  files: ContractFileRef[],
): boolean {
  return files.some(f =>
    f.leaseTermId === leaseTermId && f.createdAt.getTime() >= signedAt.getTime(),
  )
}
