// 이용료 환불 확정이 만드는 수납 record 의 표식 정본 — 서버(생성·멱등 가드·잠금)와 화면(버튼 숨김)이 같은 접두어를 본다.
//
// 왜 한 벌인가. 확정(finalizeRentRefund)은 원 수납을 소프트삭제하고 청구 확정액만큼의 새 record 를
// 이 접두어 메모로 만든다. 그 record 를 수납 목록에서 직접 고치면 스냅샷(prepaid − refunded)과
// 어긋나 적용취소가 엉뚱한 금액을 복원한다. 그래서 잠근다 — 고치는 자리는 수납 정보의 이용료 정산
// 카드 하나다(적용취소 뒤 재확정). 접두어 문자열이 두 곳에 따로 있으면 한쪽이 바뀌는 날 잠금이 풀린다.

export const RENT_REFUND_MEMO_PREFIX = '[중도퇴실 환불]'

/** 이 record 가 이용료 환불 확정이 만든 것인가. */
export function isRentRefundRecord(memo: string | null | undefined): boolean {
  return (memo ?? '').startsWith(RENT_REFUND_MEMO_PREFIX)
}
