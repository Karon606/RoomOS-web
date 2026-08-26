// 방 배정 점유 가드 정본 — 사람을 방에 넣는 모든 경로가 같은 답을 쓰게 한다.
//
// 왜 필요한가. 종전에는 이 판정이 addTenant 와 updateTenant 안에 두 벌로 적혀 있었고,
// 엑셀 가져오기(app/api/import)에는 문자 그대로 0 개였다. 그래서 화면으로는 막히는 배정이
// 시트 한 장이면 전부 통과했다 — 거주자 이중 배정도, 415호 같은 비거주 점유 방 배정도.
// 판정이 여러 벌이면 가장 느슨한 한 벌이 곧 그 앱의 실제 규칙이 된다(2026-08-12 봉합).
//
// 여기 있는 것은 순수 판정뿐이다. 어떤 계약을 읽어 올지(본인 제외 여부 등)는 호출부가 정하고,
// 이 파일은 '그 방에 이 상태로 들어갈 수 있는가'에만 답한다.

import { spanOverlaps, freeFromAfter } from './roomSchedule'

/** 거주계 상태 — 사람이 그 방을 실제로 쓰는(또는 쓰기로 한) 상태. 비거주는 명의라 구간을 차지하지 않는다. */
export const RESIDENT_STATUSES: readonly string[] = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING']

/** 방 배정 가드가 읽어야 할 그 방의 다른 계약 상태 — 점유계 + 명의. */
export const ROOM_GUARD_STATUSES: readonly string[] = [...RESIDENT_STATUSES, 'NON_RESIDENT']

// 집계 제외 방에 걸렸을 때의 안내. 계약 쪽 필드로는 풀 수 없는 상태라(비거주 계약에 퇴실 예정일을
// 넣는 것은 뜻이 안 맞는다) 유일한 출구인 방 설정을 지목한다. 문구는 호실 관리 편집의 체크박스 라벨 그대로다.
export const NON_RESIDENT_ROOM_ERROR =
  '해당 호실은 거주용이 아닌 방(창고·사무실)으로 설정돼 있습니다. 호실 관리 편집에서 \'공실 집계에서 제외\'를 해제한 뒤 배정해 주세요.'

// 단독 계약 불가 방(다른 계약에 묶어야 하는 방)에 메인 계약 지목 없이 계약을 저장하려 할 때의 안내.
// 문구는 호실 관리 편집의 체크박스 라벨과 같은 낱말을 쓴다 — 거부당한 사람이 어느 설정을 본 것인지
// 바로 알아야 한다(비거주 점유 방 문구가 '공실 집계에서 제외'를 지목하는 것과 같은 문법).
export const STANDALONE_LEASE_ERROR =
  '해당 호실은 단독 계약이 불가한 방(다른 계약에 묶어야 하는 방)으로 설정돼 있습니다. 메인 계약을 함께 골라 주세요.'

// 같은 사정을 시트에 말하는 문구. 메인 계약은 시트에 적을 자리가 없으므로
// 출구가 다르다 — 문구가 하나뿐이면 가져오기에서 막힌 운영자는 고를 수 없는 것을 고르라는 말을 듣는다.
export const STANDALONE_LEASE_IMPORT_ERROR =
  '해당 호실은 단독 계약이 불가한 방으로 설정돼 있습니다. 메인 계약은 시트로 지목할 수 없으니 입주자 상세의 \'계약 추가\'로 만들어 주세요.'

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
    return '계약을 자기 자신의 메인 계약으로 고를 수는 없습니다.'
  }
  if (!parent || !selfTenantId || parent.tenantId !== selfTenantId) {
    return '메인 계약을 찾을 수 없습니다. 같은 입주자의 진행 중인 계약 중에서 골라 주세요.'
  }
  if (!PARENT_LEASE_STATUSES.includes(parent.status)) {
    return '고른 메인 계약이 이미 끝난 계약입니다. 진행 중인 계약 중에서 골라 주세요.'
  }
  if (parent.parentLeaseTermId) {
    return '고른 계약이 이미 다른 계약의 추가 계약입니다. 종속은 한 단계까지만 됩니다.'
  }
  if (selfHasSubLeases) {
    return '이 계약에는 이미 추가 계약이 있습니다. 추가 계약이 있는 계약은 다른 계약의 추가 계약이 될 수 없습니다.'
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
 * 겹침 여부는 화면이 확인창으로 묻는 운영 재량이라 여기서는 묻지 않는다 — 확인창이 없는 경로
 * (가져오기)는 occupancyOverlaps 를 따로 걸어 스스로 판단한다(당일 회전은 빼고 본다).
 */
export function roomAssignmentDenial(input: {
  incomingStatus: string
  nonResidentOccupied: boolean
  otherLeases: RoomAssignmentLease[]
  /** 들어오는 배정의 기간 — 계획 구간과 겨루는 데만 쓴다. 없으면 열린 쪽으로 읽는다. */
  moveIn: string | null
  moveOut: string | null
  /** 남이 이 방을 임시 거처로 잡아 둔 구간. **필수다** — 옵션이면 새 호출부가 조용히 빼먹는다. */
  plannedStays: readonly PlannedStaySpan[]
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

  // 남이 임시로 잡아 둔 기간 — 상태별 분기보다 먼저 본다. 그 방은 그날 밤 이미 임자가 있다.
  const planned = plannedStayDenial({
    incomingStatus, moveIn: input.moveIn, moveOut: input.moveOut, plannedStays: input.plannedStays,
  })
  if (planned) return planned

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
 *
 * 이 `>=` 는 고치지 않는다(2026-08-19 개정 확정). 당일 회전을 정상으로 보는 소비처는 아래
 * isSameDayTurnover 로 따로 빼고, 겹침의 정의 자체는 한 벌로 둔다.
 */
export function occupancyOverlaps(
  a: { moveIn: string | null; moveOut: string | null },
  b: { moveIn: string | null; moveOut: string | null },
): boolean {
  return (!a.moveOut || !b.moveIn || a.moveOut >= b.moveIn)
    && (!b.moveOut || !a.moveIn || b.moveOut >= a.moveIn)
}

/** 체류 구간 한 벌 — 날짜는 'YYYY-MM-DD'(없으면 null = 열려 있다). */
export type OccupancySpan = { moveIn: string | null; moveOut: string | null }

/** 실제로 포개진 구간 — 겹치지 않으면 null. 양끝 중 열린 쪽은 null 로 남는다(무기한). */
export type OverlapSpan = { from: string | null; to: string | null }

/**
 * 두 체류가 실제로 포개진 구간 — 겹침 여부를 넘어 **언제부터 언제까지**를 답한다.
 *
 * 아래 두 술어(당일 회전·확인된 겹침)가 전부 이 하나를 딛는다. 겹친 날짜를 각자 다시 세면
 * "회전이라 통과"와 "그 구간을 확인했다"가 서로 다른 날을 말하게 된다.
 *
 * 시작은 두 입주일 중 늦은 쪽, 끝은 두 퇴실일 중 이른 쪽이다. 한쪽이 없으면 있는 쪽이 답이고,
 * 둘 다 없으면 그 끝은 열려 있다(null) — 입주일이 둘 다 없으면 이미 시작된 점유이고,
 * 퇴실 예정일이 둘 다 없으면 무기한이다.
 *
 * **사본 주의** — scripts/check-room-availability-drift.mjs 축 ②에 같은 식이 한 벌 더 있다
 * (.mjs 라 이 파일을 import 하지 못한다). 여기를 고치면 저기도 함께 고친다. 저쪽 주석도 여기를 가리킨다.
 */
export function occupancyOverlapSpan(a: OccupancySpan, b: OccupancySpan): OverlapSpan | null {
  if (!occupancyOverlaps(a, b)) return null
  const later = (x: string | null, y: string | null) => (x && y ? (x > y ? x : y) : (x ?? y))
  const earlier = (x: string | null, y: string | null) => (x && y ? (x < y ? x : y) : (x ?? y))
  return { from: later(a.moveIn, b.moveIn), to: earlier(a.moveOut, b.moveOut) }
}

/**
 * 당일 회전인가 — 앞 계약이 나가는 그날 뒤 계약이 들어오고, 겹침이 그 하루뿐인 경우.
 *
 * 고시원의 일상이다. 오전에 방을 비우고 오후에 다음 사람이 들어온다. 그런데 판정선이
 * occupancyOverlaps 한 벌뿐이던 동안에는 이 하루가 '이중 점유'로 셌다 — 감지망이 부르고,
 * 화면이 확인창을 띄우고, 자기가 내보낸 시트를 다시 올리면 가져오기가 막았다.
 *
 * occupancyOverlaps 의 `>=` 자체는 고치지 않는다(소비처 넷이 전부 흔들린다). 대신 이름 있는
 * 술어로 따로 묻고, 회전을 정상으로 보는 소비처가 각자 이 함수를 불러 명시적으로 뺀다.
 *
 * 같은 날 **함께 시작하는** 두 계약은 회전이 아니다 — 앞 계약의 입주일이 그 하루보다 앞서야
 * 나가는 사람과 들어오는 사람이 갈린다(입주일이 아예 없으면 이미 시작된 점유라 앞선 것으로 읽는다).
 */
export function isSameDayTurnover(a: OccupancySpan, b: OccupancySpan): boolean {
  const span = occupancyOverlapSpan(a, b)
  if (!span || !span.from || !span.to || span.from !== span.to) return false
  const day = span.from
  const turns = (front: OccupancySpan, back: OccupancySpan) =>
    front.moveOut === day && back.moveIn === day && (front.moveIn === null || front.moveIn < day)
  return turns(a, b) || turns(b, a)
}

/**
 * 확인된 겹침 한 줄 — LeaseOverlapAck 의 판정에 필요한 칸만. 구간은 확인 시점의 스냅샷이다.
 */
export type OverlapAckSpan = {
  frontLeaseTermId: string
  backLeaseTermId: string
  overlapFrom: string
  overlapTo: string
}

/**
 * 지금의 겹침이 확인된 겹침인가 — 덮는 확인 줄, 없으면 null.
 *
 * 유효 조건은 둘이다. **같은 두 계약**이고(앞뒤 순서는 묻지 않는다 — 날짜가 밀리면 앞뒤가 바뀔 수
 * 있는데 그건 같은 확인이다), **지금 실제 겹침 구간이 확인 구간 안**이어야 한다.
 *
 * 구간을 벗어나면 자동 실효다. 8/18~8/19 하루를 확인했는데 퇴실일이 8/25 로 밀리면 그것은 더 이상
 * 확인받은 사실이 아니다 — 다시 발화해서 운영자에게 묻는 것이 맞다. 열린 구간(무기한)은 스냅샷을
 * 뜰 수 없으므로 절대 덮이지 않는다. 확인은 유한한 사실에만 붙는다.
 */
export function findOverlapAck<T extends OverlapAckSpan>(
  acks: readonly T[],
  leaseAId: string,
  leaseBId: string,
  span: OverlapSpan | null,
): T | null {
  if (!span || !span.from || !span.to) return null
  const from = span.from
  const to = span.to
  return acks.find(k =>
    ((k.frontLeaseTermId === leaseAId && k.backLeaseTermId === leaseBId)
      || (k.frontLeaseTermId === leaseBId && k.backLeaseTermId === leaseAId))
    && from >= k.overlapFrom && to <= k.overlapTo) ?? null
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
  /** 남이 이 방을 임시 거처로 잡아 둔 구간. 시트에는 일정 열이 없어 늘 DB 에서만 온다. */
  plannedStays: readonly PlannedStaySpan[]
}): string | null {
  const { status } = input.incoming
  const isResident = RESIDENT_STATUSES.includes(status)
  const isNonResident = status === 'NON_RESIDENT'
  // 종료 상태(퇴실 완료·입실 취소)는 방을 잡지 않는다 — 퇴실자 시트가 여기서 막히면 안 된다.
  if (!isResident && !isNonResident) return null
  // 축 ③ — 비거주 점유 방(창고·사무실)에는 새 명의 말고 아무것도 넣지 않는다.
  if (!isNonResident && input.nonResidentOccupied) return NON_RESIDENT_ROOM_ERROR
  // 축 ⑤ — 단독 계약 불가 방(다른 계약에 묶어야 하는 방). 시트에는 메인 계약을 적을 자리가
  // 없으므로 통째로 막고 앱의 '계약 추가'로 보낸다. 화면 경로는 메인 계약을 골라 통과할 수 있다.
  if (!input.roomStandaloneAllowed) return STANDALONE_LEASE_IMPORT_ERROR
  // 축 ② 곁 — 남이 임시로 잡아 둔 기간. 화면 경로와 같은 판정 한 벌이다.
  const planned = plannedStayDenial({
    incomingStatus: status, moveIn: input.incoming.moveIn, moveOut: input.incoming.moveOut,
    plannedStays: input.plannedStays,
  })
  if (planned) return planned
  if (isNonResident) {
    return input.others.some(o => o.status === 'NON_RESIDENT')
      ? '해당 호실에 이미 비거주자(명의)가 등록되어 있습니다.'
      : null
  }
  // 축 ② — 체류 구간이 실제로 포개지면 한 방에 두 사람이다. 단 **당일 회전은 뺀다**.
  // 앞사람이 나가는 그날 뒷사람이 들어오는 것은 정상 운영인데, 종전에는 이 하루가 막혀 자기가
  // 내보낸 시트를 그대로 다시 올리는 것조차 실패했다(잠복 결함, 2026-08-19 개정). 하루 이상
  // 겹치는 것은 그대로 막는다 — 시트에는 확인창을 띄울 자리가 없다.
  const hit = input.others.find(o =>
    RESIDENT_STATUSES.includes(o.status)
    && occupancyOverlaps(input.incoming, o)
    && !isSameDayTurnover(input.incoming, o))
  return hit ? `해당 호실은 ${hit.tenantName}님의 체류 기간(${hit.moveIn ?? '미정'} ~ ${hit.moveOut ?? '무기한'})과 겹칩니다.` : null
}

/**
 * 다른 계약이 이 방을 **임시 거처로 잡아 둔** 구간 — [from, to) 반개구간.
 *
 * 마지막 줄(계약 호실·무기한)은 담지 않는다. 그 계약은 그 방을 roomId 로 잡고 있어
 * 기존 가드가 이미 본다 — 여기까지 담으면 같은 사실에 판정이 두 벌 선다.
 */
export type PlannedStaySpan = { tenantName: string; from: string; to: string }

/** 표시용 구간 — 'from ~ to 전날'. to 를 그대로 찍으면 하루 더 머무는 것으로 읽힌다. */
function plannedSpanText(p: PlannedStaySpan): string {
  const dot = (ymd: string) => ymd.replaceAll('-', '.')
  const last = new Date(Date.parse(`${p.to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return last === p.from ? `${dot(p.from)} 하루` : `${dot(p.from)} ~ ${dot(last)}`
}

/**
 * 남이 임시로 잡아 둔 기간에 이 방을 배정하려 하는가 — 안 되면 거부 문구, 되면 null.
 *
 * **왜 여기만 하드인가.** 이 파일의 다른 겹침(퇴실 예정일끼리)은 화면이 확인창으로 묻는 운영
 * 재량이다. 퇴실 예정일은 '더 일찍 나갈 수도 있는' 추정치라 재량이 성립한다. 계획 구간은 다르다 —
 * 그날 밤 그 사람이 거기서 잔다는 확정 사실이고, 계약서에도 인쇄된다(lib/roomSchedule
 * roomScheduleText). 통과시키면 만들어지는 상태가 정확히 막으라고 한 그 상태다.
 *
 * 그리고 **반대 방향이 이미 하드다**. 새 일정을 짤 때 남의 점유와 부딪히면 확인 없이 거절한다
 * (tenants/actions roomScheduleClash). 순방향만 무르면 같은 두 사실이라도 어느 쪽을 먼저
 * 저장했느냐로 답이 갈린다 — 이 파일 머리가 경계하는 '가장 느슨한 한 벌' 그 자체다.
 *
 * 겹침 선도 그 역방향과 같다. 들어오는 쪽 끝은 freeFromAfter(퇴실일 다음 날)다. 나가는 날
 * 낮까지는 앞사람이 있고 퇴실 청소도 그날 잡히니, 그날 밤 잘 곳을 묻는 이 판정에서는 하루를 민다.
 * 반대로 계획이 끝나는 날(to)에 들어오는 것은 통과한다 — 그날 아침 계획자가 방을 비운다.
 */
export function plannedStayDenial(input: {
  incomingStatus: string
  /** 'YYYY-MM-DD'. 없으면 이미 시작된 점유로 읽는다(이 파일의 기존 규약). */
  moveIn: string | null
  /** 없으면 무기한. */
  moveOut: string | null
  plannedStays: readonly PlannedStaySpan[]
}): string | null {
  if (!RESIDENT_STATUSES.includes(input.incomingStatus)) return null
  if (input.plannedStays.length === 0) return null
  const span = {
    start: input.moveIn ?? '0000-01-01',
    end: input.moveOut ? freeFromAfter(input.moveOut) : null,
  }
  const hit = input.plannedStays.find(p => spanOverlaps(span, { start: p.from, end: p.to }))
  if (!hit) return null
  const dot = (ymd: string) => ymd.replaceAll('-', '.')
  return `해당 호실은 ${plannedSpanText(hit)} ${hit.tenantName}님이 임시 호실로 지내는 방입니다. `
    + `${dot(hit.to)}부터 입주 가능합니다. `
    + `그 기간에 배정하려면 ${hit.tenantName}님의 거주 호실 일정을 먼저 바꿔 주세요.`
}
