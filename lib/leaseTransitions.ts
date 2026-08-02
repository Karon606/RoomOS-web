// 계약 상태 전이표 정본 — 서버가 허용하는 from -> to 조합을 한 곳에서 정한다.
//
// 종전에는 applyStatusTransition 이 from/to 를 검증하지 않고 그대로 캐스팅 저장했다.
// 즉 서버가 허용하는 전이는 8x8 전부였고, 게이트는 상태쌍이 아니라 필드 조건 3개뿐이었다.
// UI 에 없는데 서버가 허용하는 전이가 44개 중 30개였고 그중 8종은 실제 운영에서 발생했다
// (B페이즈 조사, 폼 select 경로). 상태를 바꾸는 경로가 넷이라 경로마다 규칙이 갈렸다.
//
// 되돌리기(퇴실 취소 등)는 운영상 반드시 필요하므로 막지 않는다 — 실측으로도 발생했다.
// 막는 것은 **뜻이 성립하지 않는 전이**뿐이다(예: 퇴실 완료에서 곧장 투어 대기로).
export type LeaseStatusName =
  | 'WAITING_TOUR' | 'TOUR_DONE' | 'RESERVED' | 'ACTIVE'
  | 'CHECKOUT_PENDING' | 'CHECKED_OUT' | 'CANCELLED' | 'NON_RESIDENT'

// 앞으로 가는 정상 흐름 + 운영상 필요한 되돌리기.
// **실측으로 검증했다.** 지난 전이 로그 29종을 전부 대조해, 실제 운영에서 쓰인 조합은 전부 허용한다.
// 처음 짠 표는 RESERVED->WAITING_TOUR(19건) 같은 실사용 흐름을 막았다 — 쓰이는 것은 뜻이 성립하는 것이다.
// 막는 것은 로그에 한 번도 없고 뜻도 안 서는 조합뿐이다(예: 퇴실 완료에서 곧장 투어 대기).
const ALLOWED: Record<LeaseStatusName, readonly LeaseStatusName[]> = {
  WAITING_TOUR:     ['TOUR_DONE', 'RESERVED', 'ACTIVE', 'CANCELLED', 'NON_RESIDENT'],
  TOUR_DONE:        ['WAITING_TOUR', 'RESERVED', 'ACTIVE', 'CANCELLED', 'NON_RESIDENT'],
  // 예약을 물리면 투어 단계로 되돌린다(실측 19건). 취소 대신 이 흐름을 쓰는 운영이다.
  RESERVED:         ['WAITING_TOUR', 'TOUR_DONE', 'ACTIVE', 'CANCELLED', 'NON_RESIDENT'],
  ACTIVE:           ['RESERVED', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'CANCELLED', 'NON_RESIDENT'],
  CHECKOUT_PENDING: ['ACTIVE', 'CHECKED_OUT', 'NON_RESIDENT'],
  // 퇴실 되돌리기는 실제로 쓰인다(실측 ACTIVE 2건, CHECKOUT_PENDING 2건).
  CHECKED_OUT:      ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'],
  CANCELLED:        ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'ACTIVE'],
  NON_RESIDENT:     ['ACTIVE', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'CANCELLED'],
}

const LABEL: Record<LeaseStatusName, string> = {
  WAITING_TOUR: '투어 대기', TOUR_DONE: '투어 완료', RESERVED: '입실 예약', ACTIVE: '거주중',
  CHECKOUT_PENDING: '퇴실 예정', CHECKED_OUT: '퇴실 완료', CANCELLED: '입실 취소', NON_RESIDENT: '비거주',
}

/** 같은 상태로의 저장(변경 없음)은 항상 허용한다 — 폼 저장이 상태를 그대로 넘기는 경우가 많다. */
export function canTransition(from: string, to: string): boolean {
  if (from === to) return true
  const list = ALLOWED[from as LeaseStatusName]
  if (!list) return true   // 모르는 상태는 막지 않는다(스키마가 늘어도 저장이 깨지지 않게)
  return list.includes(to as LeaseStatusName)
}

/** 거부 사유 문구 — 운영자가 무엇을 해야 하는지까지 말한다. */
export function transitionDeniedMessage(from: string, to: string): string {
  const f = LABEL[from as LeaseStatusName] ?? from
  const t = LABEL[to as LeaseStatusName] ?? to
  return `${f}에서 ${t}(으)로는 바로 바꿀 수 없습니다. 중간 단계를 거치거나 계약을 새로 만들어 주세요.`
}
