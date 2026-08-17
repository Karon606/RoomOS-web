// 입퇴실 캘린더 조립 — 그 달의 방별 체류 구간을 월 창에 잘라 행·바·공백·충돌로 세운다.
//
// 왜 조립을 여기 두는가. 같은 달을 데스크톱은 간트로, 모바일(768px 미만)은 날짜순 리스트로 그린다.
// 두 편성이 각자 조립하면 같은 방이 두 화면에서 다른 날짜·다른 순서로 뜬다 — 이 앱이 primaryRoomLease
// 때 이미 지나온 길이다. 조회는 한 번, 조립도 한 번, 편성만 둘이다.
//
// 판정은 전부 정본을 부른다.
//   · 겹침 여부 = lib/roomAssignment occupancyOverlaps (같은 날 퇴실·입주도 겹침으로 세는 그 선).
//   · 다음 예약 = lib/leaseStatus roomReservationQueue.
//   · 날짜 문구 = checkoutDateLabel · moveInDateLabel · moveInSubText.
// 화면이 자기 사본을 들면 감지망(check-room-availability-drift)이 사고라 부르는 상태와 화면이 갈린다.
//
// 날짜는 전부 'YYYY-MM-DD' 문자열이다. 사전순 비교가 곧 날짜 비교라 Date 를 만들지 않는다
// (lib/kstDate 규약 — 서버 UTC·기기 KST 가 하루 다른 오늘을 보는 함정을 애초에 열지 않는다).

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

/** 트랙 위 막대 하나 — 그 달에 보이는 구간만큼 잘린 체류. */
export type MoveBar = {
  leaseId: string
  tenantId: string
  tenantName: string
  kind: MoveBarKind
  /** 겹치는 막대끼리 세로로 비켜 앉는 층. 0부터. */
  lane: number
  startDay: number
  endDay: number
  /** 월 밖에서 이어져 들어온 쪽 — 그 모서리는 직각으로 그린다. */
  clippedStart: boolean
  clippedEnd: boolean
  /** 퇴실일이 아예 없다(무기한 점유·무기한 예약). */
  openEnded: boolean
  startsInMonth: boolean
  endsInMonth: boolean
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
  /** 그 달 첫 변동일(입주·퇴실 중 이른 것). 행 정렬 키다. */
  firstChangeDay: number
  laneCount: number
  bars: MoveBar[]
  gaps: MoveGap[]
  overlaps: MoveDaySpan[]
  conflicts: MoveConflict[]
  /** 그 달 퇴실 방의 다음 예약이 다음 달일 때의 꼬리 한 줄. */
  tail: string | null
  tailLeaseId: string | null
  tailTenantId: string | null
}

/** 모바일 리스트의 한 줄 — 간트와 같은 조립에서 나온 다른 편성이다. */
export type MoveEvent = {
  day: number
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

/** 그 달의 일수. Date 를 UTC 로만 만져 실행 환경 시간대를 배제한다. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const dayOf = (ymd: string): number => Number(ymd.slice(8, 10))
const ymdOf = (month: string, day: number): string => `${month}-${String(day).padStart(2, '0')}`

/** 체류의 끝 — 퇴실 완료면 실제 퇴실일, 진행 중이면 퇴실 예정일. 둘 다 없으면 미정이다. */
function stayEnd(l: MoveCalendarLease): string | null {
  return l.moveOutDate ?? l.expectedMoveOut
}

/**
 * 막대 라벨 — 그 달에 무엇이 바뀌었는가를 말한다.
 *
 * 입주·퇴실이 그 달 안이면 그 날짜를 세우고, 둘 다 없을 때만 상태를 말한다. 퇴실일 미정을
 * 늘 붙이면 진행 중 거주 대부분이 같은 말을 달고 서서 정작 그 달의 변동이 묻힌다 — 무기한
 * 점유가 정보가 되는 자리는 그 달에 아무 변동도 없이 트랙을 관통하는 막대다(예약과 포개지는
 * 바로 그 경우다).
 */
function barLabel(bar: { startsInMonth: boolean; endsInMonth: boolean; openEnded: boolean; stayFrom: string | null; stayTo: string | null }): string {
  const parts: string[] = []
  if (bar.startsInMonth && bar.stayFrom) parts.push(moveInDateLabel(bar.stayFrom)!)
  if (bar.endsInMonth && bar.stayTo) parts.push(checkoutDateLabel(bar.stayTo)!)
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
 * 그 달의 입퇴실 화면 한 벌.
 *
 * @param changed 그 달에 입주·퇴실·예약 시작이 있는 계약. 어느 방이 행이 되는지를 정한다.
 * @param context 그 방들의 점유 계약 전부. 행은 안 늘리고 막대만 늘린다 — 관통 점유를 함께
 *                그려야 그 위에 얹힌 예약이 충돌로 보인다.
 * @param today   KST 'YYYY-MM-DD'. 보고 있는 달과 같은 달일 때만 오늘 표시가 선다.
 */
export function buildMoveCalendar(input: {
  month: string
  today: string
  changed: MoveCalendarLease[]
  context: MoveCalendarLease[]
}): MoveCalendarMonth {
  const { month, today } = input
  const dim = daysInMonth(month)
  const first = ymdOf(month, 1)
  const last = ymdOf(month, dim)

  // 행이 되는 방 — 변동이 있는 방만. 관통 점유는 행을 만들지 않는다.
  const roomIds = new Set(input.changed.map(l => l.roomId))

  // 막대가 되는 계약 — 변동분 + 그 방들의 점유 계약. id 중복은 한 번만.
  const byId = new Map<string, MoveCalendarLease>()
  for (const l of input.changed) byId.set(l.id, l)
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
      // 월 창과 겹치지 않는 계약은 이 달의 막대가 아니다(다음 달 예약 등 — 꼬리가 따로 말한다).
      if ((to && to < first) || (from && from > last)) continue

      const startsInMonth = !!from && from >= first && from <= last
      const endsInMonth = !!to && to >= first && to <= last
      const bar: MoveBar = {
        leaseId: l.id,
        tenantId: l.tenantId,
        tenantName: l.tenantName,
        kind: l.status === 'RESERVED' ? 'reserved' : 'resident',
        lane: 0,
        startDay: startsInMonth ? dayOf(from!) : 1,
        endDay: endsInMonth ? dayOf(to!) : dim,
        clippedStart: !from || from < first,
        clippedEnd: !to || to > last,
        openEnded: !rawTo,
        startsInMonth,
        endsInMonth,
        label: '',
        stayFrom: rawFrom,
        stayTo: rawTo,
        conflicted: false,
      }
      bar.label = barLabel(bar)
      bars.push(bar)
      barLease.set(l.id, l)

      if (startsInMonth) events.push({ day: bar.startDay, type: 'in', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })
      if (endsInMonth) events.push({ day: bar.endDay, type: 'out', roomId: g.roomId, roomNo: g.roomNo, leaseId: l.id, tenantId: l.tenantId, tenantName: l.tenantName, kind: bar.kind, stayFrom: rawFrom, stayTo: rawTo })

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
          text: `${fmtRoomNo(g.roomNo)} ${a.tenantName}·${b.tenantName} 체류가 ${fmtMD(ymdOf(month, lo))}~${fmtMD(ymdOf(month, hi))} 겹칩니다.`,
        })
      }
    }
    allConflicts.push(...rowConflicts)

    const laneCount = packLanes(bars)

    // ── 공백 ── 어느 층에도 막대가 없는 날. 캡션 'N일 공실'이 붙는 자리다.
    const covered = new Set<number>()
    for (const b of bars) for (let d = b.startDay; d <= b.endDay; d++) covered.add(d)
    const free = new Set<number>()
    for (let d = 1; d <= dim; d++) if (!covered.has(d)) free.add(d)
    const gaps = toSpans(free, dim).map(s => ({ ...s, days: s.endDay - s.startDay + 1 }))

    // ── 꼬리 ── 그 달에 퇴실이 있는 방인데 다음 사람이 다음 달이면, 트랙 밖의 그 사실을 한 줄로.
    const holdingLeases = g.leases.filter(l => (OCCUPYING_STATUSES as string[]).includes(l.status))
    const nextUp = roomReservationQueue(holdingLeases, primaryRoomLease(holdingLeases))
      .find(l => !!l.moveInDate && l.moveInDate > last)
    const hasExit = bars.some(b => b.endsInMonth)
    // 문구의 날짜는 moveInSubText 정본이 만든다 — 이름은 그 뒤에 붙인다(reservationSubText 와 같은 ' · ' 이음).
    const tail = hasExit && nextUp ? `${moveInSubText(nextUp.moveInDate)} · ${nextUp.tenantName}` : null

    const changeDays = bars.flatMap(b => [b.startsInMonth ? b.startDay : null, b.endsInMonth ? b.endDay : null]).filter((d): d is number => d != null)
    rows.push({
      roomId: g.roomId,
      roomNo: g.roomNo,
      firstChangeDay: changeDays.length > 0 ? Math.min(...changeDays) : dim + 1,
      laneCount,
      bars: bars.sort((a, b) => a.lane - b.lane || a.startDay - b.startDay),
      gaps,
      overlaps: toSpans(overlapDays, dim),
      conflicts: rowConflicts.concat(allConflicts.filter(c => c.kind === 'reversed' && c.roomId === g.roomId)),
      tail,
      tailLeaseId: nextUp?.id ?? null,
      tailTenantId: nextUp?.tenantId ?? null,
    })
  }

  // 그 달 첫 변동일 오름차순, 동률은 호실번호(조회 정렬과 같은 문자열 순).
  rows.sort((a, b) => a.firstChangeDay - b.firstChangeDay || (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0))
  // 날짜 오름차순, 같은 날은 퇴실 먼저(방이 비어야 다음 사람이 들어온다), 그다음 호실번호.
  events.sort((a, b) => a.day - b.day || (a.type === b.type ? 0 : a.type === 'out' ? -1 : 1) || (a.roomNo < b.roomNo ? -1 : a.roomNo > b.roomNo ? 1 : 0))

  return {
    month,
    daysInMonth: dim,
    todayDay: today.slice(0, 7) === month ? dayOf(today) : null,
    rows,
    events,
    conflicts: allConflicts,
    eventCount: events.length,
  }
}
