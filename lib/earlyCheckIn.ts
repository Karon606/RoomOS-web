// 조기 입실 판정 정본 — 본 계약 방이 비기 전, 임시 방에서 먼저 입실한 상태를 다룬다.
//
// 무엇이 문제였나(운영자 실무 2026-08-26). 9/1에 404호로 들어올 사람이 개강 때문에 8/31에
// 오고 싶은데, 404호는 그날까지 앞사람이 있다. 하루만 빈 방(402호)에서 자고 다음날 옮긴다.
// **계약은 404호 한 건이고 입실일만 하루 당겨진 것**이지 단기계약도, 두 계약도 아니다.
//
// 왜 어려웠나. 앱은 "계약 하나에 방 하나"를 전제하는데 이 상황은 하루 동안 계약상 방과
// 몸이 있는 방이 다르다. 그런데 억지로 넣으면 세 가지가 어긋난다.
//   · moveInDate 를 8/31로 당기면 **8월이 청구월이 되어 그 달 이용료가 통째로 미납으로 뜬다**
//     (입주월 일할 장치가 청구 엔진에 없다. 퇴실 일할만 있다).
//   · roomId 를 402로 바꾸면 계약서·실거주 확인서에 임시 방이 찍히고, 404호가 빈방으로
//     남에게 권해진다.
//   · 아무것도 안 하면 402호가 하루 찼다는 사실을 캘린더·공실·청소가 통째로 모른다.
//
// 그래서 **계약의 진실(roomId·moveInDate)은 손대지 않고** 전사(前史)만 따로 적는다.
// 실제 점유는 이미 있는 정본(RoomStay 구간)이 지고, 하루치 돈은 부가수익으로 받는다.
//
// **진행 중 판정은 플래그가 아니라 파생이다.** "열린 구간의 방이 임시 방이고 본 방과 다르다"를
// 값끼리 견주어 답한다 — 상태 플래그를 따로 두면 그것과 실제가 갈리는 날이 온다.

/** 하루치 산정의 분모 — 퇴실 일할(lib/prorate)과 같은 30분할을 쓴다. */
export const EARLY_CHARGE_BASE_DAYS = 30

/** 조기 입실 판정에 필요한 최소 모양. */
export type EarlyCheckInSource = {
  roomId: string | null
  earlyCheckInRoomId: string | null
}

/**
 * 지금 임시 방에 있는가 — 열린 점유 구간의 방을 함께 넣어 판정한다.
 *
 * 두 값이 다 있어야 하고 서로 달라야 한다. 이동이 끝나면 열린 구간이 본 방으로 옮겨가
 * 자연히 false 가 된다(두 칸은 사실 기록이라 지우지 않는다).
 */
export function isEarlyCheckInActive(
  lease: EarlyCheckInSource, openStayRoomId: string | null,
): boolean {
  const { roomId, earlyCheckInRoomId } = lease
  if (!roomId || !earlyCheckInRoomId || !openStayRoomId) return false
  if (roomId === earlyCheckInRoomId) return false
  return openStayRoomId === earlyCheckInRoomId
}

/**
 * 하루치 제안액 — 월 이용료를 30으로 나눈 하루치 곱하기 일수.
 *
 * 제안일 뿐 강제가 아니다(운영자 원문 "가능하다면 하루치만 조금 더 받아도 되고").
 * 화면이 이 값을 채우고 운영자가 고치거나 0으로 지운다.
 */
export function earlyChargeSuggest(rentAmount: number, days: number): number {
  if (!(rentAmount > 0) || !(days > 0)) return 0
  return Math.round(rentAmount / EARLY_CHARGE_BASE_DAYS) * days
}

/** 조기 입실일부터 본 계약 시작일 전날까지의 일수 — 하루치 제안의 곱수. */
export function earlyStayDays(earlyDate: string, moveInDate: string): number {
  const a = Date.parse(`${earlyDate}T00:00:00Z`)
  const b = Date.parse(`${moveInDate}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return Math.round((b - a) / 86400000)
}

/** 부가수익 카테고리 — 세무 자료에 이 이름으로 남는다(운영자 확정). */
export const EARLY_CHECK_IN_INCOME_CATEGORY = '조기 입실'

/**
 * 임시 방 후보 판정 — 그 기간에 겹치는 점유가 없는가.
 *
 * 기존 '입주 가능' 판정(roomAvailability)은 못 쓴다. 그것은 하루 축이라 **뒤에 무기한 예약이
 * 걸린 방을 통째로 뺀다** — 실측(2026-08-26)에서 402·409 둘 다 9/8 예약 때문에 후보에서
 * 빠졌다. 하루만 빌리는 자리라 "그 구간에 겹치는 사람이 있나"만 물어야 한다.
 *
 * 구간은 [start, end) 반개구간이다. 앞사람이 나가는 날 새 사람이 들어오는 당일 회전이
 * 겹침으로 잡히면 안 된다(이 저장소의 점유 겹침 정본과 같은 규약).
 */
export function spanOverlaps(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  const aEnd = a.end ?? '9999-12-31'
  const bEnd = b.end ?? '9999-12-31'
  return a.start < bEnd && b.start < aEnd
}
