// 방 배정 점유 가드 정본 — 사람을 방에 넣는 모든 경로가 같은 답을 쓰게 한다.
//
// 왜 필요한가. 종전에는 이 판정이 addTenant 와 updateTenant 안에 두 벌로 적혀 있었고,
// 엑셀 가져오기(app/api/import)에는 문자 그대로 0 개였다. 그래서 화면으로는 막히는 배정이
// 시트 한 장이면 전부 통과했다 — 거주자 이중 배정도, 415호 같은 비거주 점유 방 배정도.
// 판정이 여러 벌이면 가장 느슨한 한 벌이 곧 그 앱의 실제 규칙이 된다(2026-08-12 봉합).
//
// 여기 있는 것은 순수 판정뿐이다. 어떤 계약을 읽어 올지(본인 제외 여부 등)는 호출부가 정하고,
// 이 파일은 '그 방에 이 상태로 들어갈 수 있는가'에만 답한다.

/** 거주계 상태 — 사람이 그 방을 실제로 쓰는(또는 쓰기로 한) 상태. 비거주는 명의라 구간을 차지하지 않는다. */
export const RESIDENT_STATUSES: readonly string[] = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING']

/** 방 배정 가드가 읽어야 할 그 방의 다른 계약 상태 — 점유계 + 명의. */
export const ROOM_GUARD_STATUSES: readonly string[] = [...RESIDENT_STATUSES, 'NON_RESIDENT']

// 집계 제외 방에 걸렸을 때의 안내. 계약 쪽 필드로는 풀 수 없는 상태라(비거주 계약에 퇴실 예정일을
// 넣는 것은 뜻이 안 맞는다) 유일한 출구인 방 설정을 지목한다. 문구는 호실 관리 편집의 체크박스 라벨 그대로다.
export const NON_RESIDENT_ROOM_ERROR =
  '해당 호실은 세를 놓지 않는 방(창고·사무실)으로 설정돼 있습니다. 호실 관리 편집에서 \'공실 집계에서 제외\'를 해제한 뒤 배정해 주세요.'

// 단독 계약 불가 방(다른 계약에 딸리는 방)에 부모 지목 없이 계약을 저장하려 할 때의 안내.
// 문구는 호실 관리 편집의 체크박스 라벨과 같은 낱말을 쓴다 — 거부당한 사람이 어느 설정을 본 것인지
// 바로 알아야 한다(비거주 점유 방 문구가 '공실 집계에서 제외'를 지목하는 것과 같은 문법).
export const STANDALONE_LEASE_ERROR =
  '해당 호실은 단독 계약이 불가한 방(다른 계약에 딸리는 방)으로 설정돼 있습니다. 이 계약이 딸릴 계약을 함께 골라 주세요.'

// 같은 사정을 시트에 말하는 문구. 어느 계약에 딸리는지는 시트에 적을 자리가 없으므로
// 출구가 다르다 — 문구가 하나뿐이면 가져오기에서 막힌 운영자는 고를 수 없는 것을 고르라는 말을 듣는다.
export const STANDALONE_LEASE_IMPORT_ERROR =
  '해당 호실은 단독 계약이 불가한 방(다른 계약에 딸리는 방)으로 설정돼 있습니다. 어느 계약에 딸리는지는 시트로 지목할 수 없으니 고객 상세의 \'계약 추가\'로 만들어 주세요.'

/**
 * 부모가 될 수 있는 계약의 상태 — 끝난 계약(퇴실 완료·입실 취소)과 문의 단계에는 아무것도 딸릴 수 없다.
 *
 * 지금은 ROOM_GUARD_STATUSES 와 명단이 같지만 묻는 것이 다르다. 저쪽은 '그 방을 잡고 있는가'이고
 * 이쪽은 '아직 살아 있는 계약인가'다. 한 상수로 합치면 뒤에 어느 한쪽만 바뀌어야 할 때 둘이 같이 움직인다.
 */
export const PARENT_LEASE_STATUSES: readonly string[] = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT']

/** 종속 판정이 읽는 부모 계약 한 줄. 호출부가 **같은 고객·같은 영업장 안에서** 찾아 넘긴다. */
export type ParentLeaseRow = {
  id: string
  tenantId: string
  status: string
  parentLeaseTermId: string | null
}

/**
 * 이 계약을 이 부모에 딸리게 저장해도 되는가 — 안 되면 거부 문구, 되면 null.
 *
 * 규칙은 넷이다(2026-08-13, 다호실 2단계 운영자 승인).
 *   · 단독 계약 불가 방(standaloneLeaseAllowed=false)은 부모 지목이 없으면 저장 불가.
 *   · 부모는 **같은 사람의 살아 있는 계약**이어야 한다. 남의 계약도, 끝난 계약도 안 된다.
 *   · 자기 자신은 부모가 될 수 없다.
 *   · 종속은 한 단계까지다. 부모가 이미 딸려 있거나(2단), 자신에게 이미 딸린 계약이 있으면 거부한다.
 *     이 둘을 함께 막으면 길이 2 이상의 순환은 만들어질 수 없다 — 순환을 따로 탐색하지 않는 이유다.
 *
 * 방이 없는 계약(문의·투어 단계)은 첫 규칙의 대상이 아니다. 호출부가 roomStandaloneAllowed 에
 * true 를 넘긴다 — 방 설정이 없는 것을 '불가'로 읽으면 방 미배정 계약이 통째로 막힌다.
 */
export function leaseSubordinationDenial(input: {
  roomStandaloneAllowed: boolean
  parentLeaseTermId: string | null
  parent: ParentLeaseRow | null
  selfTenantId: string | null
  selfLeaseTermId: string | null
  selfHasSubLeases: boolean
}): string | null {
  const { roomStandaloneAllowed, parentLeaseTermId, parent, selfTenantId, selfLeaseTermId, selfHasSubLeases } = input

  if (!parentLeaseTermId) {
    return roomStandaloneAllowed ? null : STANDALONE_LEASE_ERROR
  }
  if (selfLeaseTermId && parentLeaseTermId === selfLeaseTermId) {
    return '계약을 자기 자신에 딸리게 할 수는 없습니다.'
  }
  if (!parent || !selfTenantId || parent.tenantId !== selfTenantId) {
    return '딸릴 계약을 찾을 수 없습니다. 같은 고객의 진행 중인 계약 중에서 골라 주세요.'
  }
  if (!PARENT_LEASE_STATUSES.includes(parent.status)) {
    return '딸릴 계약이 이미 끝난 계약입니다. 진행 중인 계약 중에서 골라 주세요.'
  }
  if (parent.parentLeaseTermId) {
    return '딸릴 계약이 이미 다른 계약에 딸려 있습니다. 종속은 한 단계까지만 됩니다.'
  }
  if (selfHasSubLeases) {
    return '이 계약에는 이미 딸린 계약이 있습니다. 딸린 계약이 있는 계약은 다른 계약에 딸릴 수 없습니다.'
  }
  return null
}

export type RoomAssignmentLease = {
  status: string
  expectedMoveOut: Date | string | null
}

/**
 * 이 방에 이 상태로 들어갈 수 있는가 — 안 되면 거부 문구, 되면 null.
 *
 * `nonResidentOccupied` 는 호출부가 lib/vacancy 의 집계 제외 술어로 미리 판정해 넘긴다
 * (418호처럼 방 설정이 '공실로 세라'인 거주·비거주 동거는 비대상이다).
 * `otherLeases` 는 그 방의 다른 점유·명의 계약이다 — 수정 경로는 본인 계약을 빼고 넘긴다.
 *
 * 세분의 근거. 예약도 '언제 나가는지 아는가'로 나눈다 — 퇴실 예정일 없는 예약만 방을 무기한 잡은 것이다.
 * 날짜가 잡힌 예약은 화면(roomPickability)이 고를 수 있게 열어 주므로 서버도 같은 선이어야 한다.
 * 겹침(같은 날 포함) 여부는 화면이 확인창으로 묻는 운영 재량이라 여기서는 묻지 않는다 — 확인창이
 * 없는 경로(가져오기)는 occupancyOverlaps 를 따로 걸어 스스로 판단한다.
 */
export function roomAssignmentDenial(input: {
  incomingStatus: string
  nonResidentOccupied: boolean
  otherLeases: RoomAssignmentLease[]
}): string | null {
  const { incomingStatus, nonResidentOccupied, otherLeases } = input
  const incomingIsResident = RESIDENT_STATUSES.includes(incomingStatus)
  const incomingIsNonResident = incomingStatus === 'NON_RESIDENT'

  const hasNonResident = otherLeases.some(l => l.status === 'NON_RESIDENT')
  const hasResident = otherLeases.some(l => RESIDENT_STATUSES.includes(l.status))
  const hasIndefiniteReservation = otherLeases.some(l => l.status === 'RESERVED' && !l.expectedMoveOut)
  const occupants = otherLeases.filter(l => ['ACTIVE', 'CHECKOUT_PENDING'].includes(l.status))
  // 점유자가 언제 나가는지(퇴실 예정일)가 잡혀 있으면 그 방에 다음 사람을 예약해 둘 수 있다.
  const occupiedIndefinitely = occupants.length > 0 && !occupants.every(l => !!l.expectedMoveOut)

  // 비거주 점유 방(창고·사무실) — 새 명의를 얹는 것 말고는 어느 단계도 받지 않는다.
  if (!incomingIsNonResident && nonResidentOccupied) return NON_RESIDENT_ROOM_ERROR

  if (incomingStatus === 'RESERVED') {
    if (hasIndefiniteReservation) return '해당 호실에 퇴실 예정일이 없는 입실 예약이 있습니다. 그 예약의 퇴실 예정일을 먼저 입력해 주세요.'
    if (occupiedIndefinitely) return '해당 호실에 거주 중인 입주자가 있습니다. 퇴실 예정일을 먼저 입력해 주세요.'
    return null
  }
  // 입실·퇴실 예정으로 들어오는 건은 지금 비어 있는 방만 받는다.
  if (incomingIsResident) {
    if (hasResident) return '해당 호실에 이미 거주 중인 입주자가 있습니다.'
    return null
  }
  if (incomingIsNonResident) {
    if (hasNonResident) return '해당 호실에 이미 비거주자(명의)가 등록되어 있습니다.'
    return null
  }
  // 문의·투어 단계 — 퇴실 예정일이 잡힌 방은 희망 호실로 적을 수 있게 하고, 무기한 점유·예약된 방은 막는다.
  // 비거주는 위 정본 판정 한 줄이 대신 본다 — 여기서 또 hasNonResident 를 보면 판정이 두 벌이 된다.
  if (hasIndefiniteReservation || occupiedIndefinitely) return '해당 호실에 이미 입주자가 있습니다.'
  return null
}

/**
 * 두 체류 구간이 실제로 포개지는가 — 같은 날 퇴실·입주는 겹침으로 센다.
 *
 * 입주일이 없으면 이미 시작된 점유로, 퇴실 예정일이 없으면 무기한으로 읽는다.
 * 감지망 check-room-availability-drift 축 ② 와 화면 확인창(overlapOccupancy)이 쓰는 그 선이다.
 * 날짜는 'YYYY-MM-DD' 문자열이라 사전순 비교가 곧 날짜 비교다.
 */
export function occupancyOverlaps(
  a: { moveIn: string | null; moveOut: string | null },
  b: { moveIn: string | null; moveOut: string | null },
): boolean {
  return (!a.moveOut || !b.moveIn || a.moveOut >= b.moveIn)
    && (!b.moveOut || !a.moveIn || b.moveOut >= a.moveIn)
}

/** 그 방을 이미 잡고 있는 계약 한 줄 — 날짜는 'YYYY-MM-DD'(없으면 null). */
export type RoomAssignmentOccupant = {
  status: string
  moveIn: string | null
  moveOut: string | null
  tenantName: string
}

/**
 * 확인창이 없는 경로(엑셀 가져오기)의 판정 — 막는 것은 **감지망이 사고라고 부르는 상태**뿐이다.
 *
 * 왜 위 roomAssignmentDenial 을 그대로 쓰지 않는가. 그쪽은 폼의 모양에 맞춘 규칙이다. 거주계끼리는
 * 날짜를 보지 않고 '이미 거주 중'이면 통째로 막고, 겹침은 화면이 확인창으로 물어 운영자 재량으로
 * 통과시킨다. 시트에는 물어볼 자리가 없으니 그 거친 규칙을 그대로 옮기면 두 가지가 깨진다.
 *   · 402호처럼 짧게 이어 붙은 두 거주 계약(8/2~8/14 뒤 8/17~8/29)은 지금 실재하고 정상인데,
 *     내보낸 파일을 그대로 다시 올리면 둘째 줄이 막힌다.
 *   · 퇴실자 시트의 종료 계약은 방을 잡지 않는데도 그 방의 현 거주자 때문에 막힌다.
 * 그래서 여기서는 날짜가 있는 시트의 이점을 살려 구간으로 묻는다. 무기한 점유·무기한 예약은
 * 구간으로도 그 뒤 전부와 겹치므로 따로 볼 필요가 없다 — 판정선은 감지망
 * check-room-availability-drift 축 ②(구간 겹침)·축 ③(비거주 점유 방)과 정확히 같다.
 * 미리보기와 적용이 같은 답을 말하도록 판정은 여기 한 벌뿐이다.
 */
export function roomAssignmentBlockReason(input: {
  incoming: { status: string; moveIn: string | null; moveOut: string | null }
  nonResidentOccupied: boolean
  /** 이 방만으로 계약이 되는가(Room.standaloneLeaseAllowed). 방을 못 찾았으면 호출부가 true 를 넘긴다. */
  roomStandaloneAllowed: boolean
  others: RoomAssignmentOccupant[]
}): string | null {
  const { status } = input.incoming
  const isResident = RESIDENT_STATUSES.includes(status)
  const isNonResident = status === 'NON_RESIDENT'
  // 종료 상태(퇴실 완료·입실 취소)는 방을 잡지 않는다 — 퇴실자 시트가 여기서 막히면 안 된다.
  if (!isResident && !isNonResident) return null
  // 축 ③ — 비거주 점유 방(창고·사무실)에는 새 명의 말고 아무것도 넣지 않는다.
  if (!isNonResident && input.nonResidentOccupied) return NON_RESIDENT_ROOM_ERROR
  // 축 ⑤ — 단독 계약 불가 방(다른 계약에 딸리는 방). 시트에는 어느 계약에 딸리는지 적을 자리가
  // 없으므로 통째로 막고 앱의 '계약 추가'로 보낸다. 화면 경로는 부모를 골라 통과할 수 있다.
  if (!input.roomStandaloneAllowed) return STANDALONE_LEASE_IMPORT_ERROR
  if (isNonResident) {
    return input.others.some(o => o.status === 'NON_RESIDENT')
      ? '해당 호실에 이미 비거주자(명의)가 등록되어 있습니다.'
      : null
  }
  // 축 ② — 체류 구간이 실제로 포개지면 한 방에 두 사람이다. 같은 날 퇴실·입주도 겹침으로 센다.
  const hit = input.others.find(o => RESIDENT_STATUSES.includes(o.status) && occupancyOverlaps(input.incoming, o))
  return hit ? `해당 호실은 ${hit.tenantName}님의 체류 기간(${hit.moveIn ?? '미정'} ~ ${hit.moveOut ?? '무기한'})과 겹칩니다.` : null
}
