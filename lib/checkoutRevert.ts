// 퇴실 적용취소의 순수 술어 — 무엇이 되는가(목적지)와 왜 못 되돌리는가(차단)를 한 벌로 정한다.
//
// 왜 lib 인가. 퇴실을 무르는 길이 둘이다. 수납 정보의 '퇴실 적용취소'가 타는 상태 전환 액션과,
// 입주자 수정 폼이 상태를 바꾸며 퇴실일을 지우는 뒷문. 두 길이 각자 판정을 들면 한쪽으로 들어온
// 계약만 막히고 다른 쪽은 그대로 지나간다 — 퇴실 처리 경로가 셋으로 갈렸던 그 사고와 같은 모양이다.
//
// 화면은 목적지를 고르지 않는다. 라벨만 받아 확인창 문장에 넣고, 실제로 무엇이 되는지는 저장할 때
// 서버가 이 술어로 다시 정한다. 화면이 목적지를 지정하면 같은 계약이 어느 화면에서 눌렀느냐에 따라
// 다른 상태로 간다.

import { hasRentRefundSnapshot, RENT_REFUND_LOCKED } from '@/lib/rentRefundRecord'
import { OCCUPYING_STATUSES, primaryRoomLease } from '@/lib/leaseStatus'

/** 퇴실을 무르면 돌아갈 수 있는 두 자리. 그 밖의 상태로는 이 문이 열리지 않는다. */
export type CheckoutRevertTarget = 'ACTIVE' | 'CHECKOUT_PENDING'

/** 돌아간 상태의 이름 — 확인창과 토스트가 이 한 벌을 쓴다(화면이 제 이름표를 만들면 두 자리가 갈린다). */
export const CHECKOUT_REVERT_LABEL: Record<CheckoutRevertTarget, string> = {
  ACTIVE: '거주중',
  CHECKOUT_PENDING: '퇴실 예정',
}

/** 이력에 남기는 되돌림 표식 — 선례는 자동 전환 되돌리기의 '자동 전환 되돌림'이다. */
export const CHECKOUT_REVERT_REASON = '퇴실 적용취소'

export type CheckoutRevertBlock = 'depositRefund' | 'rentRefund' | 'roomOccupied'

/**
 * 보증금 반환이 기록된 계약을 막는 문장. 돈이 이미 움직인 자리라 상태만 되돌리면 반환 기록만
 * 남고 되돌릴 근거가 사라진다. 한 확인창에 돈 되돌리기를 숨기지 않는 것이 규칙이다 —
 * 반환 적용취소는 보증금 카드의 별개 결정이고, 여기서 함께 처리하면 가짜 적용취소가 된다.
 */
export const DEPOSIT_REFUND_LOCKED =
  '보증금 반환이 기록된 계약입니다. 수납 정보의 보증금 카드에서 반환 기록을 먼저 적용취소해 주세요.'

/**
 * 되돌린 사이 그 호실에 다른 계약이 들어선 경우. 상태만 무르면 한 방에 거주 계약이 둘이 된다.
 * 앱이 대신 정리할 수 있는 일이 아니라(누가 나갈지는 사람이 정한다) 막고 말한다.
 */
export const CHECKOUT_REVERT_ROOM_OCCUPIED =
  '이 호실에 다른 거주·예약 계약이 있습니다. 그 계약을 먼저 정리한 뒤 퇴실을 적용취소해 주세요.'

/**
 * 퇴실을 무르면 무엇이 되는가.
 *
 * 퇴실 예정일이 아직 남아 있으면 그 계획은 살아 있다 — '퇴실 예정'으로 돌아간다.
 * 예정일이 없거나 이미 지났으면 되돌릴 계획이 없으므로 '거주중'이다.
 *
 * 경계(예정일이 오늘)는 '오늘 이후'가 아니라 거주중이다. 그날은 이미 나가기로 한 날이라
 * 예정으로 돌려 두면 오늘 안에 다시 나가야 하는 상태로 서 있게 되고, 크론이 다음 날 아침
 * 같은 계약을 또 퇴실 예정으로 집는다.
 */
export function checkoutRevertTarget(
  lease: { expectedMoveOut: string | null },
  todayKst: string,
): CheckoutRevertTarget {
  if (!lease.expectedMoveOut) return 'ACTIVE'
  return lease.expectedMoveOut > todayKst ? 'CHECKOUT_PENDING' : 'ACTIVE'
}

/**
 * 되돌릴 수 없는 이유 — 없으면 null.
 *
 * 돈이 이미 나간 계약은 상태만 무를 수 없다. 보증금 반환 기록이 있으면 보증금 카드에서 그 기록을
 * 먼저 적용취소해야 하고, 이용료 환불이 확정돼 있으면 이용료 정산 카드에서 환불부터 적용취소해야
 * 한다(기존 잠금 규칙 그대로, 문장도 그 상수 하나다). 그다음이 호실이다 — 되돌린 사이 그 방에
 * 다른 계약이 들어섰으면 한 방에 거주 계약이 둘이 된다.
 *
 * **순서는 돈이 먼저다.** 셋 다 걸린 계약은 어차피 셋을 다 풀어야 하고, 돈은 되돌리는 순간
 * 매출·현금영수증이 함께 움직이므로 먼저 말해 주는 편이 손해가 적다. 보증금이 이용료보다 앞인
 * 것은 진입점(수납 정보 '퇴실 정산' 우산) 바로 위 카드가 보증금이라 다음 손이 짧아서다.
 *
 * **호실 점유 판정은 새로 적지 않는다.** 어떤 상태가 방을 잡고 있는가는 `OCCUPYING_STATUSES`
 * 정본이고(거주중·퇴실 예정·입실 예약), 그 집합에서 대표 계약을 고르는 일은 `primaryRoomLease`
 * 정본이다. 자기 자신을 빼는 것도 여기서 한다 — 두 호출부가 각자 빼면 한쪽이 잊는 날이 온다.
 *
 * `roomLeases` 는 **이 호실의 계약 전부**(자기 자신 포함)다. 호실이 없는 계약은 빈 배열이라
 * 이 갈래가 서지 않는다 — 방이 없으면 겹칠 방도 없다.
 */
export function checkoutRevertBlock(
  lease: {
    leaseTermId: string
    hasDepositRefund: boolean
    checkoutProrationUndo: unknown
    roomLeases: { id: string; status: string; moveInDate?: Date | string | null }[]
  },
): CheckoutRevertBlock | null {
  if (lease.hasDepositRefund) return 'depositRefund'
  if (hasRentRefundSnapshot(lease.checkoutProrationUndo)) return 'rentRefund'
  const occupying: string[] = OCCUPYING_STATUSES
  const others = lease.roomLeases.filter(l => l.id !== lease.leaseTermId && occupying.includes(l.status))
  if (primaryRoomLease(others)) return 'roomOccupied'
  return null
}

/** 차단 사유의 문장 — 두 길(전환 액션·수정 폼)이 같은 말을 해야 다음 손이 같다. */
export function checkoutRevertBlockMessage(block: CheckoutRevertBlock): string {
  if (block === 'depositRefund') return DEPOSIT_REFUND_LOCKED
  if (block === 'rentRefund') return RENT_REFUND_LOCKED
  return CHECKOUT_REVERT_ROOM_OCCUPIED
}
