// '입실 예약 전환' 미니폼의 저장 값과 적용취소 값 정본 — '바로 예약 확정'을 체크하면 한 번 제출로 예약과 확정을 함께 한다.
//
// 운영자 승인 2026-11-02(신고 507e1a0d, 안 A). 종전에는 예약으로 바꾼 뒤 '예약 확정'을 따로 눌러야 했다.
// 서버는 이미 한 호출로 받는다(applyStatusTransition 이 상태와 reservationConfirmedAt 를 함께 쓰고, 확정 게이트
// 입주 희망일·본인 연락처를 같은 호출 안에서 다시 잰다). 이 파일은 화면이 보낼 값과 되돌릴 값을 한 곳에서 만든다.
// 진리표 scripts/test-reserve-transition.ts, 실제 쓰기 왕복은 scripts/test-reserve-confirm-flow.ts(PGlite).
import { transitionStatusLabel } from '@/lib/leaseTransitions'
import { withParticle } from '@/lib/koParticle'
import { leavesWishLead } from '@/lib/wishMatch'

export type ReserveFields = {
  moveInDate: string
  reservationConfirmedAt?: string | null
}

/** 제출 값. 확정을 체크하면 오늘 날짜로 확정 시각을 싣는다(종전 '예약 확정' 버튼과 같은 값). */
export function reserveSubmitFields(moveInYmd: string, confirmNow: boolean, todayYmd: string): ReserveFields {
  return confirmNow ? { moveInDate: moveInYmd, reservationConfirmedAt: todayYmd } : { moveInDate: moveInYmd }
}

/** 확정을 체크했는데 입주 희망일이 비었으면 그 이유(서버 거부 문장과 같은 말). 통과하면 null. */
export function reserveConfirmDenial(moveInYmd: string, confirmNow: boolean): string | null {
  return confirmNow && !moveInYmd ? '예약 확정에는 입주 희망일이 필요합니다.' : null
}

/**
 * 적용취소 값 — 전환 전 상태·입주 희망일·조절 여부로 되돌리고, 함께 확정했으면 확정도 지운다. **한 호출**이다.
 * 확정만 남기고 상태가 돌아가거나(투어 단계의 확정 계약), 상태만 남고 확정이 빠지는 반쪽이 없게 둘을 같이 싣는다.
 * 확정을 체크하지 않았으면 reservationConfirmedAt 을 아예 안 싣는다(서버 '안 보냄 = 그대로').
 *
 * expect 는 이 전환이 쓴 값이다(§27.1 CAS, 독립 검수 B1). 서버가 지금 값과 대조해 하나라도 다르면 거부한다.
 * 전환 뒤 '예약 확정' 을 따로 눌렀거나 희망일을 고쳤으면 되돌리지 않는다(되돌리면 확정만 남은 반쪽이 생기거나 고친 날짜가 덮인다).
 * 조절 여부(moveInFlexible)는 확정이 리드에서 빼며 접는다(lib/wishMatch leavesWishLead). 전환 뒤 기대값도 그 규칙으로 낸다.
 */
export function reserveUndo(
  prev: { status: string; moveInYmd: string | null; moveInFlexible: boolean | null },
  wrote: { moveInYmd: string; confirmedYmd: string | null },
): {
  toStatus: string
  fields: { moveInDate: string | null; moveInFlexible: boolean | null; reservationConfirmedAt?: null }
  expect: { status: 'RESERVED'; reservationConfirmedAt: string | null; moveInDate: string; moveInFlexible: boolean | null }
  toast: string
} {
  const confirmedNow = wrote.confirmedYmd != null
  const what = confirmedNow ? '입실 예약 전환과 예약 확정을' : '입실 예약 전환을'
  const flexAfter = leavesWishLead('RESERVED', confirmedNow ? new Date(wrote.confirmedYmd as string) : null) ? null : prev.moveInFlexible
  return {
    toStatus: prev.status,
    fields: confirmedNow
      ? { moveInDate: prev.moveInYmd, moveInFlexible: prev.moveInFlexible, reservationConfirmedAt: null }
      : { moveInDate: prev.moveInYmd, moveInFlexible: prev.moveInFlexible },
    expect: { status: 'RESERVED', reservationConfirmedAt: wrote.confirmedYmd, moveInDate: wrote.moveInYmd, moveInFlexible: flexAfter },
    toast: `${what} 적용취소했습니다 · ${withParticle(transitionStatusLabel(prev.status), '으로/로')} 복귀`,
  }
}

/** 성공 토스트 문장. 라벨 뒤 '완료' 문법(형제 전이와 같다). */
export function reserveDoneToast(confirmedNow: boolean): string {
  return confirmedNow ? '입실 예약 전환 · 예약 확정 완료' : '입실 예약 전환 완료'
}
