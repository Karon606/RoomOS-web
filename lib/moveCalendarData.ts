// 입퇴실 캘린더 조회 정본 — 그 범위의 변동 계약과 거주 구간을 한 벌로 뽑는다.
//
// 조립(lib/moveCalendar)에서 갈라 둔 이유는 하나다. 감지망이 화면과 **같은 조회**를 지나야
// "화면이 그린 것"과 "DB 에 있는 것"을 맞댈 수 있다. 조회를 서버 액션 파일 안에 두면 감지망은
// 사본을 들 수밖에 없고, 그 사본은 조회가 바뀔 때 옛 규칙에 남아 그물이 통과를 말한다.
// (액션 파일은 'use server' 라 async 함수만 내보낼 수 있고, 내보내는 순간 인증 없는 입구가 된다.)

import type { PrismaDb } from '@/lib/prisma'
import { parseRoomSchedule, hasRoomSchedule } from './roomSchedule'
import { displayName } from '@/lib/displayName'
import { ymdToDbDate } from '@/lib/kstDate'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'
import { isVacancyExcluded } from '@/lib/vacancy'
import type { MoveCalendarLease, MoveWorkInput } from '@/lib/moveCalendar'
import {
  CLEANING_PERFORMER_LABEL, CLEANING_REASON_LABEL,
  type CleaningPerformer, type CleaningReason,
} from '@/app/(app)/room-manage/cleaningConstants'

/** 취소를 뺀 전 생애 — 퇴실 완료까지 읽어야 지난 달의 퇴실이 트랙에서 안 사라진다. */
export const MOVE_LEASE_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING', 'CHECKED_OUT'] as const

/**
 * select 최소 — 이 화면은 날짜·상태·이름만 쓴다. 이름은 lib/displayName 이 고른다(홈 타일과 같은 규칙).
 *
 * roomStays 가 여기 있는 이유. 계약의 roomId 는 '지금 방' 한 칸뿐이라, 그것만 읽으면 방을 옮긴
 * 계약은 옛 방에 0칸이고 새 방에 최초 입주일부터 통째로 그려진다. 막대의 방·기간은 구간이 낸다
 * (lib/moveCalendar MoveStaySpan). 조회를 둘로 쪼개지 않는 이유는 하나다 — 계약과 구간을 다시
 * 이어 붙이는 코드가 생기면 그 이음이 곧 두 번째 진실이 된다.
 */
export const MOVE_LEASE_SELECT = {
  id: true,
  status: true,
  isShortTerm: true,
  moveInDate: true,
  moveOutDate: true,
  expectedMoveOut: true,
  roomId: true,
  room: { select: { roomNo: true } },
  tenant: { select: { id: true, name: true, englishName: true, nickname: true, displayNameStyle: true } },
  roomStays: {
    select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { roomNo: true } } },
    orderBy: { startDate: 'asc' },
  },
  // 미리 잡아 둔 호실 일정 — 아직 입실 처리 전이라 구간이 없다. 계획도 캘린더에 서야
  // 운영자가 "그날 402호에 사람이 온다"를 본다(운영자 지적 2026-08-26).
  roomSchedule: true,
} as const

/** MOVE_LEASE_SELECT 가 뽑는 모양. 추론에 맡기면 select 가 두 곳에서 불릴 때 원본 모델로 넓어진다. */
export type MoveLeaseRow = {
  id: string
  status: string
  isShortTerm: boolean
  moveInDate: Date | null
  moveOutDate: Date | null
  expectedMoveOut: Date | null
  roomId: string | null
  room: { roomNo: string } | null
  tenant: { id: string; name: string; englishName: string | null; nickname: string | null; displayNameStyle: string | null }
  roomStays: { id: string; roomId: string; startDate: Date | null; endDate: Date | null; room: { roomNo: string } }[]
  roomSchedule?: unknown
}

/** 날짜는 'YYYY-MM-DD' 문자열로 고정 — getRooms·수납 관리와 같은 문법이라야 월 비교가 같은 값을 낸다. */
export const dbYmd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null

export const toMoveLease = (l: MoveLeaseRow): MoveCalendarLease => ({
  id: l.id,
  status: l.status,
  isShortTerm: l.isShortTerm,
  moveInDate: dbYmd(l.moveInDate),
  moveOutDate: dbYmd(l.moveOutDate),
  expectedMoveOut: dbYmd(l.expectedMoveOut),
  // context 조회는 구간의 방으로도 걸리므로 '지금 방'이 비어 있는 계약이 섞일 수 있다(호실 해제).
  // 그런 계약의 막대는 구간이 내므로 이 칸은 안 쓰이고, 빈 문자열은 어느 방 id 와도 안 맞는다.
  roomId: l.roomId ?? '',
  roomNo: l.room?.roomNo ?? '',
  tenantId: l.tenant.id,
  tenantName: displayName(l.tenant, l.tenant.displayNameStyle),
  stays: l.roomStays.map(s => ({
    id: s.id,
    roomId: s.roomId,
    roomNo: s.room.roomNo,
    startDate: dbYmd(s.startDate),
    endDate: dbYmd(s.endDate),
  })),
})

/**
 * 그 범위의 변동 계약과, 변동이 있는 방의 점유 계약 전부.
 *
 * ①은 과대근사다 — 퇴실의 진짜 날짜가 실제일인지 예정일인지는 한 줄의 SQL 조건으로 못 적는다.
 * 그 선은 조립(lib/moveCalendar)이 한 번만 긋는다. 충돌 판정도 거기서 occupancyOverlaps 를
 * 부른다 — 화면도 액션도 감지망도 사본을 들지 않는다.
 *
 * 구간 경계도 창 조건에 든다. 이사는 계약의 세 날짜를 하나도 안 건드리므로(입주일은 최초
 * 입주일 그대로, 퇴실일은 비어 있다), 계약 날짜만 보면 **이사일만 이 창에 있는 계약**이 통째로
 * 빠진다. 김태란 건이 정확히 그 모양이다(입주 2024-03 · 이사 2026-07 · 퇴실 미정).
 *
 * ②의 방 목록도 구간을 본다. 옛 방 구간을 가진 계약은 그 방의 roomId 를 **이미 안 갖고 있어**
 * `roomId in roomIds` 로는 안 걸린다 — 옛 방 행에 그 사람의 거주가 다시 사라진다.
 */
export async function fetchMoveLeases(
  db: PrismaDb,
  propertyId: string,
  from: string,
  to: string,
  /**
   * 작업(청소)이 있는 방 — **행 목록은 안 늘린다.** 점유 계약만 함께 읽는다.
   *
   * 조립이 '공실 작업은 행을 만들고 거주 중 작업은 안 만든다'를 판정하려면 그날 그 방에
   * 사람이 있었는지를 알아야 하는데, 창 안에 입퇴실이 하나도 없는 방(관통 거주)은 changed 에
   * 안 걸려 그 방의 계약이 조립에 아예 안 닿는다. 그러면 사람이 사는 방에 행이 하나 선다.
   */
  workRoomIds: string[] = [],
): Promise<{ changed: MoveCalendarLease[]; context: MoveCalendarLease[] }> {
  const first = ymdToDbDate(from)
  const last = ymdToDbDate(to)
  const changed = await db.leaseTerm.findMany({
    where: {
      propertyId,
      roomId: { not: null },
      status: { in: [...MOVE_LEASE_STATUSES] },
      OR: [
        { moveInDate:      { gte: first, lte: last } },
        { expectedMoveOut: { gte: first, lte: last } },
        { moveOutDate:     { gte: first, lte: last } },
        { roomStays: { some: { propertyId, OR: [
          { startDate: { gte: first, lte: last } },
          { endDate:   { gte: first, lte: last } },
        ] } } },
      ],
    },
    select: MOVE_LEASE_SELECT,
  })
  // 행이 될 수 있는 방 — 계약이 지금 있는 방과 그 계약이 거쳐 간 방 전부. 과대근사라도 좋다,
  // 어느 방이 실제로 행이 되는지는 조립이 다시 한 번 거른다.
  // 계획의 방도 창 조건에 든다 — 안 넣으면 임시 호실 행이 통째로 빠진다.
  const plannedRoomIds = changed.flatMap(l => parseRoomSchedule(l.roomSchedule).map(e => e.roomId))
  const roomIds = [...new Set([
    ...changed.flatMap(l => [l.roomId!, ...l.roomStays.map(s => s.roomId)]),
    ...plannedRoomIds, ...workRoomIds,
  ])]
  const context = roomIds.length === 0 ? [] : await db.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: OCCUPYING_STATUSES },
      OR: [
        { roomId: { in: roomIds } },
        { roomStays: { some: { propertyId, roomId: { in: roomIds } } } },
      ],
    },
    select: MOVE_LEASE_SELECT,
  })

  // 계획 구간에 방 이름을 붙여 실제 구간과 같은 모양으로 만든다 — 그래야 조립·화면이
  // 계획인지 실제인지 몰라도 된다(막대를 내는 축은 구간 하나뿐이다).
  const planRoomIds = [...new Set([...changed, ...context]
    .flatMap(l => parseRoomSchedule(l.roomSchedule).map(e => e.roomId)))]
  const planRooms = planRoomIds.length === 0 ? [] : await db.room.findMany({
    where: { id: { in: planRoomIds } }, select: { id: true, roomNo: true },
  })
  const roomNoOf = new Map(planRooms.map(r => [r.id, r.roomNo]))
  const planStay = (l: MoveLeaseRow, e: { roomId: string; from: string; to: string | null }, i: number) => ({
    id: `plan-${l.id}-${i}`,
    roomId: e.roomId,
    startDate: new Date(`${e.from}T00:00:00.000Z`),
    endDate: e.to ? new Date(`${e.to}T00:00:00.000Z`) : null,
    room: { roomNo: roomNoOf.get(e.roomId) ?? '' },
  })
  const withPlan = (l: MoveLeaseRow): MoveLeaseRow => {
    const plan = parseRoomSchedule(l.roomSchedule)
    if (!hasRoomSchedule(plan)) return l
    // 아직 안 들어왔으면 계획이 그 사람의 전부다.
    if (l.roomStays.length === 0) {
      return { ...l, roomStays: plan.map((e, i) => planStay(l, e, i)) }
    }
    /**
     * 이미 들어왔으면 **실제 구간이 진실이고, 아직 안 옮긴 뒷 구간은 예정으로 잇는다**
     * (2026-08-31 운영자 지적).
     *
     * 종전에는 실제 구간이 하나라도 있으면 계획을 통째로 버렸다. 그래서 임시 호실에 입실
     * 처리를 하는 순간 계약 호실 막대가 캘린더에서 사라졌다. 402호에 사람이 있는 것은 보이는데
     * 그 사람이 며칠 뒤 404호로 온다는 사실이 방 기준 화면 어디에도 안 남았다.
     *
     * 운영자 원문 — "404호에도 9월2일에 이사를 할 예정이니까 404호의 거주 이력에 날짜가
     * 8/31이 아니라 9/2이 되어야지... 이 날짜는 입주자 기준이 아니라 방 기준이니까".
     *
     * 실제로 산 방은 계획에서 빼고(실제가 이긴다), 아직 안 간 방만 예정으로 덧붙인다.
     * 그리고 열린 실제 구간은 다음 이사일에서 닫는다 — 안 그러면 두 방이 같은 날 겹쳐 보인다.
     * 이것은 화면용 파생일 뿐 RoomStay 자체는 손대지 않는다(이사는 그날 사람이 확인해 옮긴다).
     */
    const stayed = new Set(l.roomStays.map(s => s.roomId))
    const rest = plan.filter(e => !stayed.has(e.roomId))
    if (rest.length === 0) return l
    const nextFrom = rest[0].from
    return {
      ...l,
      roomStays: [
        ...l.roomStays.map(s => s.endDate == null
          ? { ...s, endDate: new Date(`${nextFrom}T00:00:00.000Z`) }
          : s),
        ...rest.map((e, i) => planStay(l, e, l.roomStays.length + i)),
      ],
    }
  }
  return {
    changed: changed.map(withPlan).map(toMoveLease),
    context: context.map(withPlan).map(toMoveLease),
  }
}

// ── 작업(청소) 조회 ───────────────────────────────────────────────
//
// 형제로 두는 이유는 위 fetchMoveLeases 와 같다 — 감지망이 화면과 **같은 조회**를 지나야
// 한다. 조회를 서버 액션 파일 안에 두면 그물은 사본을 들 수밖에 없고, 그 사본은 조회가
// 바뀔 때 옛 규칙에 남아 통과를 말한다.
//
// 1단계는 청소(RoomCleaning)만 싣는다. 도배·장판 같은 일반 작업 모델은 별도 승인 항목이다.

/** 완료 건은 완료일, 그 외는 예정일이 그 작업이 서는 날이다. 상태를 안 보고 고르면 갈린다. */
const MOVE_WORK_STATUSES = ['PLANNED', 'DONE'] as const

/**
 * **청소 종목의** 종류 문구 — 사유 라벨에 명사가 없으면 '청소'를 잇는다.
 *
 * CLEANING_REASON_LABEL 은 청소 목록용이라 그 화면의 열이 이미 '청소'를 말하고 있다. 그래서
 * '공사·도배 후'·'입실 중 요청'·'기타' 처럼 명사가 없는 낱말이 섞여 있는데, 캘린더에는 그런
 * 열이 없다. 그대로 쓰면 소리로 "404호 공사·도배 후 완료" 가 되어 **무엇이 완료됐는지가
 * 문장에서 사라진다**(헤드리스 실측에서 열넷 중 다섯이 그 모양이었다).
 *
 * **이 규칙은 청소 밖으로 나가면 안 된다.** 종전에는 이 함수가 export 된 채 이름도 'work…'
 * 라, 종목이 늘면 도배 사유가 여기를 지나 '도배 청소'가 될 자리에 있었다. 청소 공급자 안에
 * 가둬 두면 다음 종목은 자기 규칙으로 자기 kindLabel 을 내고, 조립·화면은 그 값을 그대로
 * 쓴다(lib/moveCalendar moveWorkRailLabel).
 *
 * 사유 어휘를 여기서 다시 적지 않는다 — 사본이 곧 두 번째 진실이 된다. 정본 라벨을 그대로
 * 쓰되 명사가 없을 때만 한 낱말을 잇는다.
 */
const cleaningKindLabel = (reason: CleaningReason): string => {
  const label = CLEANING_REASON_LABEL[reason] ?? CLEANING_REASON_LABEL.OTHER
  return label.includes('청소') ? label : `${label} 청소`
}

/**
 * 그 범위의 작업 — 트랙에 그릴 것만. **청소와 그 밖의 작업(RoomWork) 두 표를 합친다**
 * (2026-08-25). 캘린더는 종류를 `kindLabel` 문자열 하나로만 말하므로 원천이 둘이어도
 * 아래 조립(packWorkLanes·placeWork)은 그대로다.
 *
 * **'안 함'(SKIPPED)은 안 싣는다.** 하지 않기로 한 일은 일정이 아니고, 그리면 트랙에서
 * 예정·완료와 나란히 서서 "이 방에 청소가 잡혀 있다"로 읽힌다. 그 기록은 목록이 지킨다.
 *
 * **소프트삭제분도 안 싣는다.** 호실 관리 '청소' 뷰는 복원 진입점 때문에 삭제분을 함께
 * 받지만(getPropertyCleanings), 캘린더는 복원할 자리가 아니라 지운 것은 지운 것이다.
 *
 * 방은 따로 한 번 읽는다. 관계 include 로 달면 조회가 청소 행 수만큼 중첩되고, 여기 필요한
 * 것은 50행 남짓의 호실번호와 공실 집계 플래그뿐이라 통째로 읽는 편이 싸다.
 */
export async function fetchMoveWorks(
  db: PrismaDb,
  propertyId: string,
  from: string,
  to: string,
): Promise<MoveWorkInput[]> {
  const first = ymdToDbDate(from)
  const last = ymdToDbDate(to)
  const [rows, workRows, rooms] = await Promise.all([
    db.roomCleaning.findMany({
      where: {
        propertyId,
        deletedAt: null,
        status: { in: [...MOVE_WORK_STATUSES] },
        OR: [
          { status: 'PLANNED', scheduledDate: { gte: first, lte: last } },
          { status: 'DONE', doneDate: { gte: first, lte: last } },
        ],
      },
      select: {
        id: true, roomId: true, reason: true, status: true,
        scheduledDate: true, doneDate: true,
        plannedPerformer: true, performer: true, performerName: true,
      },
    }),
    // 그 밖의 작업 — 같은 규율(삭제분 제외·날짜 있는 것만). 상태는 둘뿐이라 SKIPPED 가 없다.
    db.roomWork.findMany({
      where: {
        propertyId,
        deletedAt: null,
        OR: [
          { status: 'PLANNED', scheduledDate: { gte: first, lte: last } },
          { status: 'DONE', doneDate: { gte: first, lte: last } },
        ],
      },
      select: {
        id: true, roomId: true, kind: true, status: true,
        scheduledDate: true, doneDate: true,
        performer: true, performerName: true,
      },
    }),
    db.room.findMany({
      where: { propertyId },
      select: { id: true, roomNo: true, nonResidentVacant: true },
    }),
  ])
  const roomById = new Map(rooms.map(r => [r.id, r]))

  const out: MoveWorkInput[] = []
  for (const r of rows) {
    const done = r.status === 'DONE'
    const date = done ? dbYmd(r.doneDate) : dbYmd(r.scheduledDate)
    const room = roomById.get(r.roomId)
    // 날짜 없는 예정은 트랙에 세울 자리가 없다(그 방 목록에는 그대로 남는다).
    if (!date || !room) continue
    // 완료 건은 적어 둔 이름이 이긴다 — '업체'보다 '고시클린'이 그 줄을 읽는 사람에게 답이다.
    // 예정 건에는 이름 칸이 없다(계획 단계에서 받는 것은 누가 하느냐뿐이다).
    const performer = (done ? r.performer : r.plannedPerformer) as CleaningPerformer | null
    out.push({
      id: r.id,
      roomId: r.roomId,
      roomNo: room.roomNo,
      date,
      done,
      kindLabel: cleaningKindLabel(r.reason as CleaningReason),
      performerLabel: (done ? r.performerName?.trim() : null)
        || (performer ? CLEANING_PERFORMER_LABEL[performer] : null),
      vacancyExcluded: isVacancyExcluded(room),
    })
  }
  // 그 밖의 작업 — 같은 모양으로 낸다. 종류는 운영자가 지은 이름 그대로다(청소처럼 라벨 표가
  // 없다). 완료 건은 적어 둔 이름이 이긴다는 규칙도 같다.
  for (const r of workRows) {
    const done = r.status === 'DONE'
    const date = done ? dbYmd(r.doneDate) : dbYmd(r.scheduledDate)
    const room = roomById.get(r.roomId)
    if (!date || !room) continue
    const performer = r.performer as CleaningPerformer | null
    out.push({
      id: r.id,
      roomId: r.roomId,
      roomNo: room.roomNo,
      date,
      done,
      kindLabel: r.kind,
      performerLabel: (done ? r.performerName?.trim() : null)
        || (performer ? CLEANING_PERFORMER_LABEL[performer] : null),
      vacancyExcluded: isVacancyExcluded(room),
    })
  }
  return out
}
