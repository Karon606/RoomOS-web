// 입퇴실 캘린더 조회 정본 — 그 범위의 변동 계약과 거주 구간을 한 벌로 뽑는다.
//
// 조립(lib/moveCalendar)에서 갈라 둔 이유는 하나다. 감지망이 화면과 **같은 조회**를 지나야
// "화면이 그린 것"과 "DB 에 있는 것"을 맞댈 수 있다. 조회를 서버 액션 파일 안에 두면 감지망은
// 사본을 들 수밖에 없고, 그 사본은 조회가 바뀔 때 옛 규칙에 남아 그물이 통과를 말한다.
// (액션 파일은 'use server' 라 async 함수만 내보낼 수 있고, 내보내는 순간 인증 없는 입구가 된다.)

import type { PrismaDb } from '@/lib/prisma'
import { displayName } from '@/lib/displayName'
import { ymdToDbDate } from '@/lib/kstDate'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'
import type { MoveCalendarLease } from '@/lib/moveCalendar'

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
  const roomIds = [...new Set(changed.flatMap(l => [l.roomId!, ...l.roomStays.map(s => s.roomId)]))]
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

  return { changed: changed.map(toMoveLease), context: context.map(toMoveLease) }
}
