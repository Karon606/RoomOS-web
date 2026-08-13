// 서류가 어느 계약을 그리는가 — 계약서·실거주 확인서·납부 확인서가 공유하는 단 하나의 선택 규칙.
//
// 왜 여기 하나로 모으는가 (2026-08-13, 1인 다호실 1단계).
//   같은 질문("이 사람의 서류는 어느 계약으로 채우나")을 다섯 곳이 각자 적고 있었다. 셋은 우선순위
//   표(ACTIVE > CHECKOUT_PENDING > RESERVED > NON_RESIDENT)를 손으로 베꼈고, 둘은 '비거주만 뒤로'
//   라는 절반짜리 규칙이었다. 절반짜리는 거주 계약이 하나뿐이던 시절에는 같은 답을 냈지만, 한 사람이
//   방을 둘 쓰기 시작하면 예약과 거주가 섞여 계약서와 납부 확인서가 서로 다른 계약을 그린다.
//   방 축이 2026-06 에 정확히 같은 길을 갔고(503호), 그때의 처방이 primaryRoomLease 였다.
//
// 사람 축 정본(lib/leaseStatus 의 primaryTenantLease)과 왜 다른가.
//   저쪽은 '이 사람을 대표하는 계약'을 묻고 예약 동률을 입주 예정일로 가른다(화면 앵커의 질문).
//   이쪽은 '이 서류를 채울 계약'을 묻고 상태 우선순위 하나로만 가른다. 두 규칙의 답이 갈리는 구간은
//   거주 계약이 둘이거나 예약이 둘인 집합인데, 앞은 감지망이 사고라 부르는 상태이고 뒤는 서류 발급
//   대상이 아직 하나로 좁혀지지 않은 상태다. 억지로 한 규칙으로 합치면 어느 한쪽의 기존 선택이
//   바뀌므로, 질문이 둘이라는 사실을 그대로 두고 규칙도 둘로 둔다(각각은 정본 하나씩이다).
//
// 지목(namedLeaseTermId)이 있으면 그것이 이긴다. 없거나 이 사람의 발급 대상이 아니면 종전 추론
// 그대로다 — 하위 호환이 그 인자의 유일한 계약 조건이다(옛 URL 이 404 가 되면 그게 회귀다).

/** 서류 계약 우선순위 — 실제 거주 계약을 먼저 채운다. 표에 없는 상태는 맨 뒤(99). */
const DOCUMENT_LEASE_PRIORITY: Record<string, number> = {
  ACTIVE: 0, CHECKOUT_PENDING: 1, RESERVED: 2, NON_RESIDENT: 3,
}

/** 이 상태가 서류 선택에서 몇 번째인가. 목록 화면의 입실자 중복 제거가 이 값으로 정렬한다. */
export function documentLeaseRank(status: string): number {
  return DOCUMENT_LEASE_PRIORITY[status] ?? 99
}

/**
 * 이 서류를 채울 계약 하나. 우선순위가 같으면 호출부가 넘긴 배열 순서를 따른다(Array.sort 는 안정 정렬).
 * 대개 호출부의 orderBy 가 `moveInDate desc, createdAt desc` 라 같은 우선순위 안에서는 최신 계약이다.
 */
export function pickDocumentLease<T extends { id: string; status: string }>(
  leases: T[],
  namedLeaseTermId?: string | null,
): T | null {
  const named = namedLeaseTermId ? leases.find(l => l.id === namedLeaseTermId) : undefined
  if (named) return named
  return [...leases].sort((a, b) => documentLeaseRank(a.status) - documentLeaseRank(b.status))[0] ?? null
}
