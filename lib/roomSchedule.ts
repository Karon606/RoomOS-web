// 호실 일정 정본 — 한 계약이 기간마다 다른 방에 머무는 일정을 다룬다.
//
// 무엇을 푸는가 (운영자 실무 2026-08-26). 9월 1일에 404호로 올 사람이 개강 때문에 8월 31일에
// 오고 싶은데 그날 404호는 아직 앞사람이 있다. 하루만 빈 방에서 자고 다음날 옮긴다.
//
// **이것은 '조기 입실'이 아니라 그냥 입주일이 바뀐 것이다**(운영자 정정). 예약을 9/1로 잡았어도
// 상황에 따라 날짜는 바뀔 수 있다. 입주일이 8/31이 되면 8월분이 8/31에 청구되고 다음 납부일이
// 9/30이 된다. 하루치를 따로 받거나 청구를 손보는 일이 없다 — 주기가 통째로 하루 앞당겨질 뿐이다.
//
// 그래서 남는 문제는 돈이 아니라 **방**뿐이다. 계약 호실은 404호인데 8/31 하루는 402호에 있다.
// 그 사실을 일정으로 적어 두면 앱도 알고 계약서도 적는다.
//
// **일정이 진실이고 점유 구간은 파생이다.** 종전에는 계약의 roomId 하나가 진실이라 자가 치유가
// "계약 방과 열린 구간이 다르면 이사"로 보고 임시 방 사실을 지웠고, 그것을 막으려고 게이트를
// 따로 세워야 했다. 일정을 두면 자가 치유가 **오늘의 방**을 알게 되어 게이트가 필요 없어진다.
// 규칙 하나가 늘어난 것이 아니라 예외 하나가 없어진 것이다.
//
// 구간은 [from, to) 반개구간이다. 앞 구간의 to 와 뒤 구간의 from 이 같은 날이고, 그날 옮긴다.

/** 일정 한 줄 — 이 기간에는 이 방에 있다. */
export type RoomScheduleEntry = {
  roomId: string
  /** 이 방에 드는 날 'YYYY-MM-DD'(포함). */
  from: string
  /** 이 방을 비우는 날 'YYYY-MM-DD'(미포함). null 이면 무기한 — 마지막 줄(본 계약 호실)이다. */
  to: string | null
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * DB Json 을 일정으로 읽는다 — 깨진 값은 빈 배열이다.
 *
 * 못 읽는다고 막지 않는다. 일정이 없으면 계약 호실 하나로 사는 보통 계약과 같게 굴러야 한다
 * (일정을 안 쓰는 계약이 대다수다).
 */
export function parseRoomSchedule(raw: unknown): RoomScheduleEntry[] {
  if (!Array.isArray(raw)) return []
  const out: RoomScheduleEntry[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') return []
    const o = v as Record<string, unknown>
    if (typeof o.roomId !== 'string' || !o.roomId) return []
    if (typeof o.from !== 'string' || !YMD.test(o.from)) return []
    const to = o.to == null ? null : (typeof o.to === 'string' && YMD.test(o.to) ? o.to : undefined)
    if (to === undefined) return []
    out.push({ roomId: o.roomId, from: o.from, to })
  }
  return out
}

/** 일정을 쓰는 계약인가 — 줄이 둘 이상일 때만 일정이다(한 방으로 사는 계약은 일정이 없다). */
export function hasRoomSchedule(entries: readonly RoomScheduleEntry[]): boolean {
  return entries.length >= 2
}

/**
 * 일정이 성립하는가 — 어긋나면 사람이 읽을 사유, 맞으면 null.
 *
 * 빈틈과 겹침을 다 막는다. 빈틈이 있으면 그 며칠 동안 이 사람이 어디 있는지 앱이 모르고,
 * 겹치면 한 사람이 두 방에 있게 된다. 마지막 줄은 반드시 본 계약 호실이고 무기한이다 —
 * 임시로 시작해 임시로 끝나는 일정은 갈 곳이 없는 사람을 만든다.
 */
export function validateRoomSchedule(
  entries: readonly RoomScheduleEntry[],
  ctx: { moveInYmd: string; mainRoomId: string },
): string | null {
  if (entries.length === 0) return null              // 일정 없음 = 계약 호실 하나. 정상이다.
  if (entries.length === 1) return '방을 둘 이상 정해야 일정이 됩니다.'
  if (entries[0].from !== ctx.moveInYmd) return '일정은 입주일부터 시작해야 합니다.'

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const last = i === entries.length - 1
    if (last) {
      if (e.to !== null) return '마지막 방은 기한 없이 머뭅니다.'
      if (e.roomId !== ctx.mainRoomId) return '마지막 방은 계약 호실이어야 합니다.'
    } else {
      if (e.to === null) return '중간 방에는 비우는 날이 있어야 합니다.'
      if (e.to <= e.from) return '비우는 날이 드는 날보다 뒤여야 합니다.'
      if (entries[i + 1].from !== e.to) return '방과 방 사이에 빈 날이 없어야 합니다.'
      if (entries[i + 1].roomId === e.roomId) return '같은 방이 이어서 오면 나눌 이유가 없습니다.'
    }
  }
  return null
}

/**
 * 그날 이 사람이 있는 방 — 일정 밖이면 null(계약 호실을 쓰라는 뜻이다).
 *
 * 자가 치유가 이 답을 쓴다. 오늘의 방을 알면 "계약 방과 다르니 이사"라는 잘못된 결론이 안 나온다.
 */
export function scheduledSegmentOn(
  entries: readonly RoomScheduleEntry[],
  ymd: string,
): RoomScheduleEntry | null {
  if (!hasRoomSchedule(entries)) return null
  for (const e of entries) {
    if (ymd < e.from) continue
    if (e.to === null || ymd < e.to) return e
  }
  return null
}

/** 다음 이동 — 그날 이후 처음 오는 방 바뀜. 없으면 null(마지막 방에 이미 들었다). */
export function nextRoomMove(
  entries: readonly RoomScheduleEntry[],
  ymd: string,
): { at: string; roomId: string } | null {
  if (!hasRoomSchedule(entries)) return null
  for (const e of entries) {
    if (e.from > ymd) return { at: e.from, roomId: e.roomId }
  }
  return null
}

/**
 * 아직 안 채운 기간의 시작 — 일정을 짜는 화면이 "그 다음엔 어디로?"를 물을 자리다.
 *
 * 마지막 줄이 무기한이면 다 채워진 것이라 null 이다.
 */
export function scheduleOpenFrom(entries: readonly RoomScheduleEntry[]): string | null {
  if (entries.length === 0) return null
  const last = entries[entries.length - 1]
  return last.to === null ? null : last.to
}

/**
 * 계약서에 적을 문구 — "2026.08.31 ~ 2026.08.31 402호 · 2026.09.01부터 404호".
 *
 * 종이에 이 줄이 있으면 서명 뒤에 앱 기록을 다시 손볼 일이 없다(운영자 확정 2026-08-26,
 * "아예 옮길 곳을 계약서에 다 적어둘테니라"). 마지막 줄만 '부터'로 적는 것은 기한이 없어서다.
 */
export function roomScheduleText(
  entries: readonly RoomScheduleEntry[],
  roomNoOf: (roomId: string) => string | null,
): string | null {
  if (!hasRoomSchedule(entries)) return null
  const dot = (ymd: string) => ymd.replaceAll('-', '.')
  const dayBefore = (ymd: string) =>
    dot(new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400000).toISOString().slice(0, 10))
  return entries.map(e => {
    const no = roomNoOf(e.roomId) ?? '?'
    return e.to === null
      ? `${dot(e.from)}부터 ${no}호`
      : `${dot(e.from)} ~ ${dayBefore(e.to)} ${no}호`
  }).join(' · ')
}

/**
 * 두 구간이 겹치는가 — [start, end) 반개구간. end null 은 무기한이다.
 *
 * 앞사람이 나가는 날 새 사람이 들어오는 당일 회전은 겹침이 아니다(이 저장소의 점유 겹침 정본과
 * 같은 규약). 조기 입실 모듈에 있던 것을 일정 정본으로 옮겼다 — 쓰는 곳이 여기뿐이다.
 */
export function spanOverlaps(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  const aEnd = a.end ?? '9999-12-31'
  const bEnd = b.end ?? '9999-12-31'
  return a.start < bEnd && b.start < aEnd
}

/**
 * 그 방이 언제까지 차 있나 — 퇴실 예정일 **다음 날**부터 빈 것으로 본다.
 *
 * 이 앱의 다른 판정(방 배정·예약)은 당일 회전을 정상으로 본다. 앞사람이 나가는 날 뒷사람이
 * 들어오는 것을 막을 이유가 없기 때문이다. **여기서 묻는 것은 다른 질문이다** — "그날 밤 잘
 * 곳이 있나". 나가는 날 낮까지는 앞사람이 있고 그날 퇴실 청소도 잡힌다. 그래서 하루를 민다.
 *
 * 실측(2026-08-26). 404호 조성훈 님 퇴실 예정 8/31, 박정후 님 입주 8/31. 당일 회전으로 보면
 * 앱이 "비어 있다"고 답해 아무것도 묻지 않았고, 정작 그날 잘 곳이 없었다.
 */
export function freeFromAfter(moveOutYmd: string): string {
  return new Date(Date.parse(`${moveOutYmd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
}
