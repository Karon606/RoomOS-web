// 입퇴실 캘린더 조립 — 방별 체류 구간을 하나의 날짜 범위에 잘라 행·바·공백·충돌로 세운다.
//
// 왜 조립을 여기 두는가. 화면은 이 결과를 배치만 한다. 겹침·충돌·라벨을 화면이 다시 세면
// 감지망(check-room-availability-drift)이 사고라 부르는 상태와 화면이 갈린다.
//
// 범위는 둘이다.
//   · buildMoveCalendar — 한 달 창. 홈 '이달 입퇴실 N건'이 딛는 수를 낸다.
//   · buildMoveRange    — 여러 달을 잇는 연속 창(2026-08-17 운영자 오더). 호실 관리 입퇴실 탭이 쓴다.
// 기하는 한 벌(assemble)이다. 좌표를 '범위 첫날부터 며칠'로 세므로 한 달 창에서는 그 값이
// 곧 '그 달 며칠'이라, 달을 넘겨도 같은 코드가 같은 그림을 그린다.
//
// 판정은 전부 정본을 부른다.
//   · 겹침 여부 = lib/roomAssignment occupancyOverlaps (같은 날 퇴실·입주도 겹침으로 세는 그 선).
//   · 다음 예약 = lib/leaseStatus roomReservationQueue.
//   · 날짜 문구 = checkoutDateLabel · moveInDateLabel · moveInSubText.
//
// 날짜는 전부 'YYYY-MM-DD' 문자열이다. 사전순 비교가 곧 날짜 비교라 비교에 Date 를 만들지 않고,
// 날짜 덧셈이 필요한 자리만 UTC 자정으로 다룬다(lib/kstDate 규약 — 서버 UTC·기기 KST 가 하루
// 다른 오늘을 보는 함정을 애초에 열지 않는다).

import { occupancyOverlaps } from './roomAssignment'
import { OCCUPYING_STATUSES, checkoutDateLabel, moveInDateLabel, moveInSubText, primaryRoomLease, roomReservationQueue } from './leaseStatus'
import { fmtRoomNo } from './roomNo'
import { fmtMD } from './fmtDate'

/** 조립이 필요한 계약 한 줄 — 서버가 select 최소로 뽑아 이름까지 붙여 넘긴다. */
export type MoveCalendarLease = {
  id: string
  status: string
  /** 단기 여부. 기하에는 안 쓴다 — 단기의 퇴실 예정일도 expectedMoveOut 에 들어 있어 분기가 필요 없다. */
  isShortTerm: boolean
  moveInDate: string | null
  moveOutDate: string | null
  expectedMoveOut: string | null
  roomId: string
  roomNo: string
  tenantId: string
  /** lib/displayName 이 고른 표기. 조립은 이름을 다시 고르지 않는다. */
  tenantName: string
}

export type MoveBarKind = 'resident' | 'reserved'

/** 트랙 위 막대 하나 — 그 범위에 보이는 구간만큼 잘린 체류. */
export type MoveBar = {
  leaseId: string
  tenantId: string
  tenantName: string
  kind: MoveBarKind
  /** 겹치는 막대끼리 세로로 비켜 앉는 층. 0부터. */
  lane: number
  startDay: number
  endDay: number
  /** 범위 밖에서 이어져 들어온 쪽 — 그 모서리는 직각으로 그린다. */
  clippedStart: boolean
  clippedEnd: boolean
  /** 퇴실일이 아예 없다(무기한 점유·무기한 예약). */
  openEnded: boolean
  /** 입주·퇴실이 이 범위 안에 있는가. 라벨이 무엇을 말할지가 여기서 갈린다. */
  startsInRange: boolean
  endsInRange: boolean
  label: string
  stayFrom: string | null
  stayTo: string | null
  /** 이 막대가 충돌에 걸려 있다 — 행 좌측 팁과 짝이다. */
  conflicted: boolean
}

export type MoveDaySpan = { startDay: number; endDay: number }
export type MoveGap = MoveDaySpan & { days: number }

export type MoveConflictKind = 'overlap' | 'indefinite' | 'reversed'

export type MoveConflict = {
  kind: MoveConflictKind
  roomId: string
  roomNo: string
  /** '계약 보기' 진입 대상 — 손봐야 할 쪽 계약이다. */
  leaseId: string
  tenantId: string
  text: string
}

export type MoveCalendarRow = {
  roomId: string
  roomNo: string
  /** 범위 안 첫 변동일(입주·퇴실 중 이른 것). 월 창의 행 정렬 키다. */
  firstChangeDay: number
  laneCount: number
  bars: MoveBar[]
  gaps: MoveGap[]
  overlaps: MoveDaySpan[]
  conflicts: MoveConflict[]
  /** 범위 밖(오른쪽)의 다음 예약을 한 줄로. 트랙 안에 들어온 예약은 막대가 말하므로 null 이다. */
  tail: string | null
  tailLeaseId: string | null
  tailTenantId: string | null
}

/** 날짜순 한 줄 — 간트와 같은 조립에서 나온 다른 편성이다. */
export type MoveEvent = {
  day: number
  /** 그 변동의 실제 날짜 'YYYY-MM-DD'. 여러 달을 잇는 범위에서는 day 만으로 날짜를 못 만든다. */
  date: string
  type: 'in' | 'out'
  roomId: string
  roomNo: string
  leaseId: string
  tenantId: string
  tenantName: string
  kind: MoveBarKind
  stayFrom: string | null
  stayTo: string | null
}

export type MoveCalendarMonth = {
  month: string
  daysInMonth: number
  /** 보고 있는 달이 오늘의 달일 때만 1~N, 아니면 null. */
  todayDay: number | null
  rows: MoveCalendarRow[]
  events: MoveEvent[]
  conflicts: MoveConflict[]
  /** 그 달 입실·퇴실 건수. 홈 현황 탭의 '이달 입퇴실 N건'이 딛는 수다. */
  eventCount: number
}

/** 연속 트랙 위의 한 달 — 월 밴드 라벨과 경계선, 빈 달 표시가 이 조각을 딛는다. */
export type MoveRangeMonth = {
  month: string
  /** 범위 좌표에서 이 달이 시작하는 날짜 번호. */
  startDay: number
  days: number
  /** 이 달의 입퇴실 건수. 0 이면 '변동 없음'으로 적어 빈 구간이 고장으로 안 읽히게 한다. */
  eventCount: number
}

export type MoveCalendarRange = {
  /** 범위 첫날·마지막날 'YYYY-MM-DD'. 날짜 번호 1 이 곧 from 이다. */
  from: string
  to: string
  days: number
  today: string
  /** 오늘이 범위 안일 때만 1~days, 아니면 null. */
  todayDay: number | null
  /** URL ?month= 가 가리키는 달. 첫 착지 위치와 탭 접미 N 이 이 달을 딛는다. */
  focusMonth: string
  /** 보고 있는 달의 입퇴실 건수 — 홈 '이달 입퇴실 N건'과 같은 수라야 두 화면이 안 갈린다. */
  focusEventCount: number
  months: MoveRangeMonth[]
  rows: MoveCalendarRow[]
  /** 오늘부터 UPCOMING_DAYS 일 안의 변동. 트랙은 넓고 '다음 일정'은 매일 묻는 질문이라 따로 낸다. */
  upcoming: MoveEvent[]
  conflicts: MoveConflict[]
  /** 범위 오른쪽 밖에 남은 예정. 천장에 걸려 안 보이는 것이 있다는 사실을 말한다. */
  beyond: { count: number; firstDate: string } | null
  /** 범위 왼쪽 밖에 더 과거 변동이 있는가. '이전 달 더 보기'가 이 값으로 선다. */
  canExtendPast: boolean
}

/** 고정 요약 줄이 담는 날수. 운영자의 하루 질문("다음에 뭐가 있나")이 닿는 거리다. */
export const UPCOMING_DAYS = 14

/** 그 달의 일수. Date 를 UTC 로만 만져 실행 환경 시간대를 배제한다. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 'YYYY-MM' 에 n 개월을 더한다(음수면 뺀다). 범위 경계 계산의 정본이다. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** 그 달 마지막 날 'YYYY-MM-DD'. */
export function monthLastDay(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
}

const DAY_MS = 86400000
const atUtc = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`)
/** a 에서 b 까지의 날수(b 가 뒤면 양수). 양쪽 다 UTC 자정이라 실행 환경 시간대가 안 섞인다. */
const daysBetween = (a: string, b: string): number => Math.round((atUtc(b) - atUtc(a)) / DAY_MS)
const addDays = (ymd: string, n: number): string => new Date(atUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)

/** 체류의 끝 — 퇴실 완료면 실제 퇴실일, 진행 중이면 퇴실 예정일. 둘 다 없으면 미정이다. */
function stayEnd(l: MoveCalendarLease): string | null {
  return l.moveOutDate ?? l.expectedMoveOut
}

/**
 * 막대 라벨 — 그 범위에 무엇이 바뀌었는가를 말한다.
 *
 * 입주·퇴실이 범위 안이면 그 날짜를 세우고, 둘 다 없을 때만 상태를 말한다. 퇴실일 미정을
 * 늘 붙이면 진행 중 거주 대부분이 같은 말을 달고 서서 정작 변동이 묻힌다 — 무기한 점유가
 * 정보가 되는 자리는 아무 변동도 없이 트랙을 관통하는 막대다(예약과 포개지는 바로 그 경우다).
 */
function barLabel(bar: { startsInRange: boolean; endsInRange: boolean; openEnded: boolean; stayFrom: string | null; stayTo: string | null }): string {
  const parts: string[] = []
  if (bar.startsInRange && bar.stayFrom) parts.push(moveInDateLabel(bar.stayFrom)!)
  if (bar.endsInRange && bar.stayTo) parts.push(checkoutDateLabel(bar.stayTo)!)
  if (parts.length > 0) return parts.join(' · ')
  if (bar.openEnded) return '퇴실일 미정'
  return bar.stayTo ? checkoutDateLabel(bar.stayTo)! : '퇴실일 미정'
}

/** 겹치지 않는 막대끼리 같은 층에 앉힌다. 같은 날 퇴실·입주는 한 칸을 함께 쓰므로 층이 갈린다. */
function packLanes(bars: MoveBar[]): number {
  const laneEnd: number[] = []
  for (const b of [...bars].sort((x, y) => x.startDay - y.startDay || x.endDay - y.endDay)) {
    let lane = laneEnd.findIndex(end => end < b.startDay)
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(b.endDay) }
    else laneEnd[lane] = b.endDay
    b.lane = lane
  }
  return Math.max(laneEnd.length, 1)
}

/** 날짜 번호 집합을 연속 구간으로 접는다. */
function toSpans(days: Set<number>, upTo: number): MoveDaySpan[] {
  const out: MoveDaySpan[] = []
  let start: number | null = null
  for (let d = 1; d <= upTo + 1; d++) {
    const on = d <= upTo && days.has(d)
    if (on && start == null) start = d
    if (!on && start != null) { out.push({ startDay: start, endDay: d - 1 }); start = null }
  }
  return out
}

/**
 * 범위 한 벌의 기하 — 월 창이든 연속 창이든 같은 코드가 그린다.
 *
 * @param changed 그 범위에 입주·퇴실·예약 시작이 있는 계약. 어느 방이 행이 되는지를 정한다.
 * @param context 그 방들의 점유 계약 전부. 행은 안 늘리고 막대만 늘린다 — 관통 점유를 함께
 *                그려야 그 위에 얹힌 예약이 충돌로 보이고, 연속 트랙에서 점유 띠가 안 끊긴다.
 * @param order   행 정렬. 한 달 창은 첫 변동일이 곧 그 달의 이야기 순서지만, 여러 달을 잇는
 *                트랙에서는 그 키가 의미를 잃어(같은 방이 여러 달에 걸쳐 여러 번 바뀐다) 호실번호로 센다.
 */
function assemble(input: {
  from: string
  to: string
  today: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
  order: 'firstChange' | 'roomNo'
}): { days: number; todayDay: number | null; rows: MoveCalendarRow[]; events: MoveEvent[]; conflicts: MoveConflict[] } {
  const { today, order } = input
  const first = input.from
  const last = input.to
  const days = daysBetween(first, last) + 1
  const dayNo = (ymd: string): number => daysBetween(first, ymd) + 1
  const ymdOfDay = (day: number): string => addDays(first, day - 1)

  // 행이 되는 방 — 그 범위에 **실제로** 입주나 퇴실이 있는 방만. 관통 점유는 행을 만들지 않는다.
  //
  // 조회는 세 날짜 중 하나만 창에 걸려도 가져오는 과대근사다(퇴실의 진짜 날짜가 moveOutDate 인지
  // expectedMoveOut 인지는 한 줄의 SQL 조건으로 못 적는다 — 퇴실 완료는 실제일이 이긴다).
  // 그 선을 여기서 한 번만 긋는다. 퇴실 예정일은 8/31 인데 실제로는 9/2 에 나간 계약처럼,
  // 조회에는 걸리지만 이 범위의 변동은 아닌 건이 빈 행으로 서는 것을 막는다.
  const changedIn = (l: MoveCalendarLease): boolean => {
    const from = l.moveInDate
    const to = stayEnd(l)
    return (!!from && from >= first && from <= last) || (!!to && to >= first && to <= last)
  }
  const roomIds = new Set(input.changed.filter(changedIn).map(l => l.roomId))

  // 막대가 되는 계약 — 변동분 + 그 방들의 점유 계약. id 중복은 한 번만.
  const byId = new Map<string, MoveCalendarLease>()
  for (const l of input.changed) if (roomIds.has(l.roomId)) byId.set(l.id, l)
  for (const l of input.context) if (roomIds.has(l.roomId)) byId.set(l.id, l)

  const perRoom = new Map<string, { roomId: string; roomNo: string; leases: MoveCalendarLease[] }>()
  for (const l of byId.values()) {
    const g = perRoom.get(l.roomId)
    if (g) g.leases.push(l)
    else perRoom.set(l.roomId, { roomId: l.roomId, roomNo: l.roomNo, leases: [l] })
  }

  const rows: MoveCalendarRow[] = []
  const allConflicts: MoveConflict[] = []
  const events: MoveEvent[] = []

  for (const g of perRoom.values()) {
    const bars: MoveBar[] = []
    const barLease = new Map<string, MoveCalendarLease>()

    for (const l of g.leases) {
      const rawFrom = l.moveInDate
      const rawTo = stayEnd(l)
      // 날짜 역전은 데이터 사고다. 기하는 뒤집힌 채로 두지 않고 두 날 사이를 칠해 눈에 세운다.
      const reversed = !!rawFrom && !!rawTo && rawFrom > rawTo
      const from = reversed ? rawTo : rawFrom
      const to = reversed ? rawFrom : rawTo
      // 범위와 겹치지 않는 계약은 이 트랙의 막대가 아니다(범위 밖 예약 등 — 꼬리가 따로 말한다).
      if ((to && to < first) || (from && from > last)) continue

      const startsInRange = !!from && from >= first && from <= last
      const endsInRange = !!to && to >= first && to <= last
      const bar: MoveBar = {
        leaseId: l.id,
        tenantId: l.tenantId,
        tenantName: l.tenantName,
        kind: l.status === 'RESERVED' ? 'reserved' : 'resident',
        lane: 0,
        startDay: startsInRange ? dayNo(from!) : 1,
        endDay: endsInRange ? dayNo(to!) : days,
        clippedStart: !from || from < first,
        clippedEnd: !to || to > last,
        openEnded: !rawTo,
        startsInRange,
        endsInRange,
        label: '',
        stayFrom: rawFrom,
        stayTo: rawTo,
        conflicted: false,
      }
      bar.label = barLabel(bar)
      bars.push(bar)
      barLease.set(l.id, l)

      if (startsInRange) events.push({ day: bar.startDay, date: ymdOfDay(bar.startDay), type: 'in', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })
      if (endsInRange) events.push({ day: bar.endDay, date: ymdOfDay(bar.endDay), type: 'out', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })

      if (reversed) {
        bar.conflicted = true
        allConflicts.push({
          kind: 'reversed', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId,
          text: `${fmtRoomNo(g.roomNo)} ${l.tenantName}님 계약의 입주일이 퇴실일보다 뒤입니다.`,
        })
      }
    }

    if (bars.length === 0) continue

    // ── 충돌 ── 방을 잡고 있는 계약끼리만 본다. 퇴실 완료 계약은 방을 잡지 않으므로
    // (lib/roomAssignment roomAssignmentBlockReason 의 같은 선) 같은 날 인수인계는 사고가 아니다.
    const holding = bars.filter(b => (OCCUPYING_STATUSES as string[]).includes(barLease.get(b.leaseId)!.status))
    const overlapDays = new Set<number>()
    const rowConflicts: MoveConflict[] = []
    for (let i = 0; i < holding.length; i++) {
      for (let j = i + 1; j < holding.length; j++) {
        const a = holding[i], b = holding[j]
        if (!occupancyOverlaps({ moveIn: a.stayFrom, moveOut: a.stayTo }, { moveIn: b.stayFrom, moveOut: b.stayTo })) continue
        a.conflicted = true
        b.conflicted = true
        const lo = Math.max(a.startDay, b.startDay)
        const hi = Math.min(a.endDay, b.endDay)
        for (let d = lo; d <= hi; d++) overlapDays.add(d)
        // 무기한 점유 위에 얹힌 예약은 겹침의 특수형이다 — 손봐야 할 곳이 예약이 아니라
        // 거주의 빈 퇴실일이라 문구도 진입 대상도 다르다(roomAssignmentDenial 과 같은 처방).
        const openResident = [a, b].find(x => x.kind === 'resident' && x.openEnded)
        const reserved = [a, b].find(x => x.kind === 'reserved')
        if (openResident && reserved && openResident !== reserved) {
          rowConflicts.push({
            kind: 'indefinite', roomId: g.roomId, roomNo: g.roomNo, leaseId: openResident.leaseId, tenantId: openResident.tenantId,
            text: `${fmtRoomNo(g.roomNo)} ${openResident.tenantName}님 퇴실일이 미정인데 ${reserved.tenantName}님 입실 예약이 잡혀 있습니다.`,
          })
          continue
        }
        const later = a.startDay >= b.startDay ? a : b
        rowConflicts.push({
          kind: 'overlap', roomId: g.roomId, roomNo: g.roomNo, leaseId: later.leaseId, tenantId: later.tenantId,
          text: `${fmtRoomNo(g.roomNo)} ${a.tenantName}·${b.tenantName} 체류가 ${fmtMD(ymdOfDay(lo))}~${fmtMD(ymdOfDay(hi))} 겹칩니다.`,
        })
      }
    }
    allConflicts.push(...rowConflicts)

    const laneCount = packLanes(bars)

    // ── 공백 ── 어느 층에도 막대가 없는 날. 캡션 'N일 공실'이 붙는 자리다.
    const covered = new Set<number>()
    for (const b of bars) for (let d = b.startDay; d <= b.endDay; d++) covered.add(d)
    const free = new Set<number>()
    for (let d = 1; d <= days; d++) if (!covered.has(d)) free.add(d)
    const gaps = toSpans(free, days).map(s => ({ ...s, days: s.endDay - s.startDay + 1 }))

    // ── 꼬리 ── 범위 안에 퇴실이 있는 방인데 다음 사람이 트랙 밖이면, 그 사실을 한 줄로.
    // 연속 뷰에서 다음 달이 트랙 안에 들어오면 그 예약은 막대가 되므로 이 줄은 저절로 사라진다.
    const holdingLeases = g.leases.filter(l => (OCCUPYING_STATUSES as string[]).includes(l.status))
    const nextUp = roomReservationQueue(holdingLeases, primaryRoomLease(holdingLeases))
      .find(l => !!l.moveInDate && l.moveInDate > last)
    const hasExit = bars.some(b => b.endsInRange)
    // 문구의 날짜는 moveInSubText 정본이 만든다 — 이름은 그 뒤에 붙인다(reservationSubText 와 같은 ' · ' 이음).
    const tail = hasExit && nextUp ? `${moveInSubText(nextUp.moveInDate)} · ${nextUp.tenantName}` : null

    const changeDays = bars.flatMap(b => [b.startsInRange ? b.startDay : null, b.endsInRange ? b.endDay : null]).filter((d): d is number => d != null)
    rows.push({
      roomId: g.roomId,
      roomNo: g.roomNo,
      firstChangeDay: changeDays.length > 0 ? Math.min(...changeDays) : days + 1,
      laneCount,
      bars: bars.sort((a, b) => a.lane - b.lane || a.startDay - b.startDay),
      gaps,
      overlaps: toSpans(overlapDays, days),
      conflicts: rowConflicts.concat(allConflicts.filter(c => c.kind === 'reversed' && c.roomId === g.roomId)),
      tail,
      tailLeaseId: nextUp?.id ?? null,
      tailTenantId: nextUp?.tenantId ?? null,
    })
  }

  const byRoomNo = (a: MoveCalendarRow, b: MoveCalendarRow) => (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0)
  rows.sort(order === 'roomNo' ? byRoomNo : (a, b) => a.firstChangeDay - b.firstChangeDay || byRoomNo(a, b))
  // 날짜 오름차순, 같은 날은 퇴실 먼저(방이 비어야 다음 사람이 들어온다), 그다음 호실번호.
  events.sort((a, b) => a.day - b.day || (a.type === b.type ? 0 : a.type === 'out' ? -1 : 1) || (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0))

  return {
    days,
    todayDay: today >= first && today <= last ? dayNo(today) : null,
    rows,
    events,
    conflicts: allConflicts,
  }
}

/**
 * 한 달 창 한 벌 — 홈 '이달 입퇴실 N건'이 딛는 수의 정본이다.
 *
 * @param today KST 'YYYY-MM-DD'. 보고 있는 달과 같은 달일 때만 오늘 표시가 선다.
 */
export function buildMoveCalendar(input: {
  month: string
  today: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
}): MoveCalendarMonth {
  const { month } = input
  const dim = daysInMonth(month)
  const r = assemble({ from: `${month}-01`, to: monthLastDay(month), today: input.today, changed: input.changed, context: input.context, order: 'firstChange' })
  return {
    month,
    daysInMonth: dim,
    todayDay: r.todayDay,
    rows: r.rows,
    events: r.events,
    conflicts: r.conflicts,
    eventCount: r.events.length,
  }
}

/**
 * 연속 창 한 벌 — 여러 달을 이어 붙인 하나의 트랙(2026-08-17 운영자 오더).
 *
 * 범위의 경계(from·to)와 그 밖의 사실(beyond·canExtendPast)은 조회가 정한다. 이 함수는
 * 순수 함수라 스스로 DB 를 못 보고, 경계 계산을 여기 두면 조회가 두 번 필요해진다.
 */
export function buildMoveRange(input: {
  from: string
  to: string
  today: string
  focusMonth: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
  beyond: { count: number; firstDate: string } | null
  canExtendPast: boolean
}): MoveCalendarRange {
  const { from, to, today, focusMonth } = input
  const r = assemble({ from, to, today, changed: input.changed, context: input.context, order: 'roomNo' })

  const months: MoveRangeMonth[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
    const startDay = Math.max(1, daysBetween(from, `${m}-01`) + 1)
    const endDay = Math.min(r.days, daysBetween(from, monthLastDay(m)) + 1)
    months.push({ month: m, startDay, days: endDay - startDay + 1, eventCount: r.events.filter(e => e.date.slice(0, 7) === m).length })
  }

  const horizon = addDays(today, UPCOMING_DAYS)
  return {
    from,
    to,
    days: r.days,
    today,
    todayDay: r.todayDay,
    focusMonth,
    focusEventCount: months.find(m => m.month === focusMonth)?.eventCount ?? 0,
    months,
    rows: r.rows,
    upcoming: r.events.filter(e => e.date >= today && e.date <= horizon),
    conflicts: r.conflicts,
    beyond: input.beyond,
    canExtendPast: input.canExtendPast,
  }
}
