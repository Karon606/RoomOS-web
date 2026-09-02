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

/**
 * 이 계약에 이용료 환불 확정 스냅샷(checkoutProrationUndo.refund)이 살아 있는가.
 *
 * 확정 뒤 그 달 청구는 prepaid − refunded 로 고정된 값이다. 이 값을 덮거나(일할 재적용) 스냅샷을
 * 지우는(거주중 복귀·단기 연장) 쓰기는 record 와 청구를 어긋나게 하고 적용취소 길을 없앤다.
 * 그래서 청구·스냅샷을 만지는 자리는 전부 이 술어로 먼저 거른다. 판정이 한 곳이어야 감지망이
 * 이름 하나로 걸린다. 소유자인 finalizeRentRefund·undoRentRefund 는 스냅샷 안을 직접 읽는다.
 */
export function hasRentRefundSnapshot(undo: unknown): boolean {
  return !!undo && typeof undo === 'object' && 'refund' in (undo as Record<string, unknown>)
}

/**
 * 위 술어에 걸린 쓰기가 돌려주는 한 문장. 일할 재적용·적용취소, 거주중 복귀, 단기 연장이 전부
 * 같은 말을 해야 운영자가 어느 화면에서 막히든 다음 손이 같다(위 이용료 정산 카드의 적용취소).
 */
export const RENT_REFUND_LOCKED = '이용료 환불이 확정된 계약입니다. 환불 적용취소를 먼저 진행해 주세요.'

