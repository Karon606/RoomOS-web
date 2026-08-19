'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { triggerRedeploy } from '@/lib/redeployHook'
import {
  createDriveResumableSession,
  setDrivePublicReadable,
  buildDriveThumbnailUrl,
  deleteFromDrive,
} from '@/lib/google-drive'
import { looksLike360 } from '@/lib/driveImage'
import { applyScheduledRentsFor } from '@/lib/scheduledRent'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'
import { displayName } from '@/lib/displayName'
import { kstMonthStr, kstYmdStr, ymdToDbDate } from '@/lib/kstDate'
import { buildMoveCalendar, buildMoveRange, monthLastDay, shiftMonth, type MoveCalendarLease, type MoveCalendarMonth, type MoveCalendarRange } from '@/lib/moveCalendar'
import { createOverlapAck, loadOverlapAcks, softDeleteOverlapAck } from '@/lib/overlapAck'

async function getPropertyId() {
  const { userId, propertyId, role } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId, role }
}

// 호실 목록 조회
export async function getRooms() {
  const { propertyId, role } = await getPropertyId()
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    include: {
      photos: { orderBy: { sortOrder: 'asc' } },
      leaseTerms: {
        // NON_RESIDENT 포함 — 창고·사무실 점유 표시(방 nonResidentVacant 설정과 연동, 2026-07-06)
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: {
          id: true,
          status: true,
          tenantId: true,
          // 별칭·영어이름·표시 선택도 내려보낸다 — 카드가 부를 이름은 lib/displayName 이 고른다(홈 타일과 같은 규칙).
          tenant: { select: { id: true, name: true, englishName: true, nickname: true, displayNameStyle: true } },
          // 방 어레인지 — 카드에 퇴실·입주 예정일을 병기하고, 단기 퇴실 도래를 파생 판정한다.
          isShortTerm: true,
          moveInDate: true,
          expectedMoveOut: true,
        },
        // status asc 는 LeaseStatus 선언 순서 — RESERVED · ACTIVE · CHECKOUT_PENDING · NON_RESIDENT 다.
        // 즉 예약이 거주보다 앞선다. 종전 주석은 그 반대로 적혀 있었고, 화면이 주석을 믿고 '첫 계약'을
        // 주 계약으로 쓰다가 예약 걸린 방에서 실거주자를 잃었다. 주 계약 선택은 화면(primaryLease)이
        // 의미로 하고, 여기 정렬은 take 로 잘릴 때 점유 계약이 먼저 남게 하는 역할만 한다.
        orderBy: { status: 'asc' },
        take: 3,   // 예약 + 거주 + 비거주 동시 존재 대비(2 면 비거주가 잘려 창고·사무실 표시가 사라진다)
      },
    },
    orderBy: { roomNo: 'asc' },
  })

  // 금액 읽기 차단(제한 스태프) — 기준·예정·비거주 이용료를 응답에서 제거. 조회 전용, 결제 수식 무관.
  if (!canReadScope(role, 'money')) {
    for (const r of rooms) {
      ;(r as { baseRent: number | null }).baseRent = null
      ;(r as { scheduledRent: number | null }).scheduledRent = null
      ;(r as { nonResidentRent: number | null }).nonResidentRent = null
    }
  }
  // 날짜는 'YYYY-MM-DD' 문자열로 고정해 내려보낸다 — 수납 관리(rooms/actions.ts)와 같은 문법이라야
  // 카드의 D-day·월 비교가 두 화면에서 같은 값을 낸다.
  const ymd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null
  return rooms.map(r => ({
    ...r,
    leaseTerms: r.leaseTerms.map(l => ({
      ...l,
      moveInDate: ymd(l.moveInDate),
      expectedMoveOut: ymd(l.expectedMoveOut),
    })),
  }))
}

// ── 입퇴실 캘린더 공통 재료 ────────────────────────────────────────
// 월 창(홈 '이달 입퇴실 N건')과 연속 범위(호실 관리 입퇴실 탭)가 같은 select·같은 변환을 쓴다.
// 둘이 사본을 들면 같은 계약이 두 화면에서 다른 이름·다른 날짜로 뜬다.

/** 취소를 뺀 전 생애 — 퇴실 완료까지 읽어야 지난 달의 퇴실이 트랙에서 안 사라진다. */
const MOVE_LEASE_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING', 'CHECKED_OUT'] as const

/**
 * select 최소 — 이 화면은 날짜·상태·이름만 쓴다. 이름은 lib/displayName 이 고른다(홈 타일과 같은 규칙).
 *
 * roomStays 가 여기 있는 이유. 계약의 roomId 는 '지금 방' 한 칸뿐이라, 그것만 읽으면 방을 옮긴
 * 계약은 옛 방에 0칸이고 새 방에 최초 입주일부터 통째로 그려진다. 막대의 방·기간은 구간이 낸다
 * (lib/moveCalendar MoveStaySpan). 조회를 둘로 쪼개지 않는 이유는 하나다 — 계약과 구간을 다시
 * 이어 붙이는 코드가 생기면 그 이음이 곧 두 번째 진실이 된다.
 */
const MOVE_LEASE_SELECT = {
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
type MoveLeaseRow = {
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
const dbYmd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null

const toMoveLease = (l: MoveLeaseRow): MoveCalendarLease => ({
  id: l.id,
  status: l.status,
  isShortTerm: l.isShortTerm,
  moveInDate: dbYmd(l.moveInDate),
  moveOutDate: dbYmd(l.moveOutDate),
  expectedMoveOut: dbYmd(l.expectedMoveOut),
  roomId: l.roomId!,
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

/** 연속 범위 경계 — 과거는 한 달, 미래는 데이터가 정하되 바닥 +2 · 천장 +6 개월. */
const RANGE_PAST_MONTHS = 1
const RANGE_MIN_AHEAD = 2
const RANGE_MAX_AHEAD = 6

/**
 * 그 범위의 변동 계약과, 변동이 있는 방의 점유 계약 전부.
 *
 * ①은 과대근사다 — 퇴실의 진짜 날짜가 실제일인지 예정일인지는 한 줄의 SQL 조건으로 못 적는다.
 * 그 선은 조립(lib/moveCalendar)이 한 번만 긋는다. 충돌 판정도 거기서 occupancyOverlaps 를
 * 부른다 — 화면도 이 액션도 사본을 들지 않는다.
 *
 * 구간 경계도 창 조건에 든다. 이사는 계약의 세 날짜를 하나도 안 건드리므로(입주일은 최초
 * 입주일 그대로, 퇴실일은 비어 있다), 계약 날짜만 보면 **이사일만 이 창에 있는 계약**이 통째로
 * 빠진다. 김태란 건이 정확히 그 모양이다(입주 2024-03 · 이사 2026-07 · 퇴실 미정).
 *
 * ②의 방 목록도 구간을 본다. 옛 방 구간을 가진 계약은 그 방의 roomId 를 **이미 안 갖고 있어**
 * `roomId in roomIds` 로는 안 걸린다 — 옛 방 행에 그 사람의 거주가 다시 사라진다.
 */
async function fetchMoveLeases(propertyId: string, from: string, to: string): Promise<{ changed: MoveCalendarLease[]; context: MoveCalendarLease[] }> {
  const first = ymdToDbDate(from)
  const last = ymdToDbDate(to)
  const changed = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      roomId: { not: null },
      status: { in: [...MOVE_LEASE_STATUSES] },
      OR: [
        { moveInDate:      { gte: first, lte: last } },
        { expectedMoveOut: { gte: first, lte: last } },
        { moveOutDate:     { gte: first, lte: last } },
        { roomStays: { some: { OR: [
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
  const context = roomIds.length === 0 ? [] : await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: OCCUPYING_STATUSES },
      OR: [
        { roomId: { in: roomIds } },
        { roomStays: { some: { roomId: { in: roomIds } } } },
      ],
    },
    select: MOVE_LEASE_SELECT,
  })

  return { changed: changed.map(toMoveLease), context: context.map(toMoveLease) }
}

/**
 * 입퇴실 캘린더 한 달치 — 그 달에 입주·퇴실·예약 시작이 있는 방의 체류 구간.
 *
 * 위 getRooms 를 재사용하지 않는 이유가 셋이다. `take: 3` 이라 계약이 넷인 방에서 하나가 잘리고,
 * 퇴실 완료(CHECKED_OUT)를 아예 안 읽어 과거 달의 퇴실이 통째로 사라지며, 사진·상세까지 딸려 와
 * 이 화면이 쓰지 않는 것을 실어 나른다. 이 화면의 질문은 '이 달에 무엇이 바뀌었나'라 조회도
 * 그 모양이어야 한다.
 *
 * 홈 현황의 '이달 입퇴실 N건'이 이 함수의 eventCount 를 딛는다 — 호실 관리는 연속 범위를
 * 보지만 그 탭 접미 N 도 같은 '이 달'의 수라야 두 화면이 다른 숫자를 말하지 않는다.
 */
export async function getMoveCalendarMonth(month: string): Promise<MoveCalendarMonth> {
  const { propertyId } = await getPropertyId()
  const target = /^\d{4}-\d{2}$/.test(month) ? month : kstMonthStr()
  const { changed, context } = await fetchMoveLeases(propertyId, `${target}-01`, monthLastDay(target))

  return buildMoveCalendar({
    month: target,
    today: kstYmdStr(),
    changed,
    context,
  })
}

/**
 * 입퇴실 캘린더 연속 범위 한 벌 — 여러 달을 이어 붙인 하나의 트랙(2026-08-17 운영자 오더).
 *
 * 종전에는 달마다 한 번씩 조회해 월 페이지를 그렸다. 운영자가 넘긴 질문은 "이 달"이 아니라
 * "다음에 무엇이 오는가"라, 경계를 달이 아니라 **데이터가 끝나는 곳**에 두고 한 번에 조회한다.
 *
 * 경계 규칙(패널 확정).
 *   · 왼쪽 = 이번 달 -1. 지난달 퇴실을 보며 다음 사람을 잡는 것이 이 화면의 일상 동선이다.
 *   · 오른쪽 = 마지막 변동이 있는 달. 단 바닥 +2 개월(끝이 오늘에 붙어 스크롤할 곳이 없는 상태 방지),
 *     천장 +6 개월(예약 하나가 반년 뒤에 있을 때 빈 트랙을 수천 px 끌지 않게).
 *   · 천장 밖에 남은 예정은 건수와 최초 날짜로만 말하고(beyond), 점프로 닿는다.
 *   · ?month= 가 범위 밖이면 그쪽으로 범위를 넓힌다 — 딥링크 착지와 '이전 달 더 보기'가
 *     이 한 규칙을 함께 쓴다(파라미터를 새로 만들지 않는다).
 *
 * 조회는 셋이다. ①은 날짜 세 칸만 뽑는 스캔이라 조인이 없고, ②③은 종전 월 조회와 같은 모양이다.
 */
export async function getMoveCalendarRange(focus?: string): Promise<MoveCalendarRange> {
  const { propertyId } = await getPropertyId()
  const today = kstYmdStr()
  const todayMonth = today.slice(0, 7)
  const focusMonth = focus && /^\d{4}-\d{2}$/.test(focus) ? focus : todayMonth

  // ① 변동 날짜 스캔 — 범위의 끝과 '범위 밖에 남은 예정'을 한 번에 읽는다.
  const marks = await prisma.leaseTerm.findMany({
    where: { propertyId, roomId: { not: null }, status: { in: [...MOVE_LEASE_STATUSES] } },
    select: { moveInDate: true, moveOutDate: true, expectedMoveOut: true },
  })
  const changeDates: string[] = []
  for (const l of marks) {
    // 퇴실의 진짜 날짜는 실제일이 이긴다 — lib/moveCalendar stayEnd 와 같은 선.
    const from = dbYmd(l.moveInDate)
    const to = dbYmd(l.moveOutDate) ?? dbYmd(l.expectedMoveOut)
    if (from) changeDates.push(from)
    if (to) changeDates.push(to)
  }
  const lastChange = changeDates.reduce((a, b) => (a > b ? a : b), today)
  const firstChange = changeDates.reduce((a, b) => (a < b ? a : b), today)

  const minEnd = shiftMonth(todayMonth, RANGE_MIN_AHEAD)
  const maxEnd = shiftMonth(todayMonth, RANGE_MAX_AHEAD)
  const lastMonth = lastChange.slice(0, 7)
  let endMonth = lastMonth < minEnd ? minEnd : lastMonth > maxEnd ? maxEnd : lastMonth
  let startMonth = shiftMonth(todayMonth, -RANGE_PAST_MONTHS)
  if (focusMonth < startMonth) startMonth = focusMonth
  if (focusMonth > endMonth) endMonth = focusMonth

  const from = `${startMonth}-01`
  const to = monthLastDay(endMonth)
  const beyondDates = changeDates.filter(d => d > to).sort()

  const { changed, context } = await fetchMoveLeases(propertyId, from, to)
  return buildMoveRange({
    from,
    to,
    today,
    focusMonth,
    changed,
    context,
    beyond: beyondDates.length > 0 ? { count: beyondDates.length, firstDate: beyondDates[0] } : null,
    canExtendPast: firstChange < from,
    // 확인된 겹침 — 조립은 DB 를 못 보고, 확인 여부는 계산이 아니라 사실이라 조회가 넘긴다.
    acks: await loadOverlapAcks(propertyId),
  })
}

/**
 * 캘린더 [겹침 확인] — 이 겹침은 의도된 것이라고 기록한다(겹침 판정 개정 2026-08-19).
 *
 * 판정·기록은 lib/overlapAck 정본이 한다. 화면이 보낸 날짜는 믿지 않는다 — 여기 오는 것은
 * 두 계약의 id 뿐이고, 구간은 서버가 지금 DB 를 다시 읽어 계산한다.
 */
export async function acknowledgeOverlap(frontLeaseTermId: string, backLeaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const res = await createOverlapAck({ propertyId, frontLeaseTermId, backLeaseTermId, ackedById: user.sub })
    if (!res.ok) return res
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '확인 처리 중 오류가 발생했습니다.' }
  }
}

/** 확인 해제 — 소프트삭제다. 되돌리면 그 겹침은 다시 답하지 않은 상태로 돌아간다. */
export async function releaseOverlapAck(ackId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const res = await softDeleteOverlapAck(ackId, propertyId)
    if (!res.ok) return res
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '해제 처리 중 오류가 발생했습니다.' }
  }
}

// 호실 추가
export async function addRoom(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const roomNo = formData.get('roomNo') as string
  const type = formData.get('type') as string
  const tier = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo = formData.get('memo') as string

  if (!roomNo?.trim()) return { ok: false, error: '호실 번호는 필수입니다.' }

  const existing = await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo: roomNo.trim() } },
  })
  if (existing) return { ok: false, error: `${roomNo}호는 이미 존재합니다.` }

  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null

  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  const room = await prisma.room.create({
    data: {
      propertyId,
      roomNo:   roomNo.trim(),
      type:     type || null,
      tier:     tier || null,
      baseRent,
      memo:     memo || null,
      isVacant: true,
      floor,
      windowType: windowType || null,
      direction:  direction || null,
      areaPyeong,
      areaM2,
      nonResidentRent,
      nonResidentScheduled,
      nonResidentRentDate,
    },
  })

  revalidatePath('/room-manage')
  return { ok: true, id: room.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 수정
export async function updateRoom(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit()

  const id      = formData.get('id') as string
  const roomNo  = formData.get('roomNo') as string
  const type    = formData.get('type') as string
  const tier    = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo    = formData.get('memo') as string
  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null
  // 방 특성 (2026-07-06) — 체크박스: 켜짐 '1', 꺼짐 미전송
  const noMoveInReport    = formData.get('noMoveInReport') === '1'
  const nonResidentVacant = formData.get('nonResidentVacant') !== '0'   // 기본 켜짐(공실로 표시)
  // 단독 계약 가능 여부(2026-08-13) — 반전 체크박스라 hidden 값이 '0' 일 때만 불가다. 기본 켜짐(가능).
  const standaloneLeaseAllowed = formData.get('standaloneLeaseAllowed') !== '0'

  // 가격 예약 시스템 필드
  const scheduledRentRaw = formData.get('scheduledRent')
  const scheduledRent    = scheduledRentRaw ? (Number(scheduledRentRaw) || null) : null
  const rentUpdateDateRaw = formData.get('rentUpdateDate') as string
  const rentUpdateDate   = rentUpdateDateRaw ? new Date(rentUpdateDateRaw) : null

  // 예약 인상/인하: 적용일 없는 예약은 청구(effectiveBaseRent)도 적용 스케줄러도 동작 안 함(영구 방치).
  // → 예약 이용료와 적용 예정일은 반드시 함께 입력(둘 다 있거나 둘 다 없거나).
  if ((scheduledRent != null) !== (rentUpdateDate != null)) {
    return { ok: false, error: '예약 이용료와 적용 예정일은 함께 입력해야 합니다. (적용일이 없으면 인상·인하가 적용되지 않습니다)' }
  }

  // 비거주 이용료 필드
  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  // 비거주 축도 같은 규칙 — 금액만 있고 적용일이 없으면 청구에도 스케줄러에도 안 잡혀 고아 예약으로 남는다.
  if ((nonResidentScheduled != null) !== (nonResidentRentDate != null)) {
    return { ok: false, error: '비거주 예약 이용료와 적용 예정일은 함께 입력해야 합니다. (적용일이 없으면 인상·인하가 적용되지 않습니다)' }
  }

  const prevRoom = await prisma.room.findUnique({ where: { id }, select: { baseRent: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } })

  await prisma.room.update({
    where: { id },
    data: {
      roomNo:    roomNo.trim(),
      type:      type || null,
      tier:      tier || null,
      baseRent,
      memo:      memo || null,
      floor,
      windowType: windowType || null,
      direction:  direction || null,
      noMoveInReport,
      nonResidentVacant,
      standaloneLeaseAllowed,
      areaPyeong,
      areaM2,
      scheduledRent,
      rentUpdateDate,
      nonResidentRent,
      nonResidentScheduled,
      nonResidentRentDate,
    },
  })

  // baseRent 변경 시 활성 계약의 rentAmount 동기화
  if (prevRoom && prevRoom.baseRent !== baseRent) {
    await prisma.leaseTerm.updateMany({
      where: {
        roomId: id,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
      },
      data: { rentAmount: baseRent },
    })
  }

  // 인상 예약 변경 → 락인 되쓰기. 없으면 이미 선납된 달의 락이 인상을 이겨 인상분이 영원히 미청구로 남는다
  // (할인에는 같은 장치가 이미 있다 — rewriteLockedExpectedForDiscountChange, 신고 70cde9d6).
  // 비거주 예약도 같은 축이다 — 한쪽만 걸면 비거주 선납 락에 인상분이 영원히 안 붙는다.
  if (prevRoom && (prevRoom.scheduledRent !== scheduledRent
      || (prevRoom.rentUpdateDate?.getTime() ?? null) !== (rentUpdateDate?.getTime() ?? null)
      || prevRoom.nonResidentScheduled !== nonResidentScheduled
      || (prevRoom.nonResidentRentDate?.getTime() ?? null) !== (nonResidentRentDate?.getTime() ?? null))) {
    const { rewriteLockedExpectedForRentSchedule } = await import('@/app/(app)/rooms/paymentEngine')
    await rewriteLockedExpectedForRentSchedule(
      id,
      { scheduledRent: prevRoom.scheduledRent, rentUpdateDate: prevRoom.rentUpdateDate, nonResidentScheduled: prevRoom.nonResidentScheduled, nonResidentRentDate: prevRoom.nonResidentRentDate },
      { scheduledRent, rentUpdateDate, nonResidentScheduled, nonResidentRentDate },
    )
  }

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')
  return { ok: true }
}

// 호실 삭제 — 과거 계약·수납(매출) 기록까지 연쇄 영구 삭제되므로,
// 이력이 있으면 1차 호출은 건수를 알려주며 거부하고 force 재호출에서만 실제 삭제(정보 동의 단계).
export async function deleteRoom(id: string, opts?: { force?: boolean }): Promise<
  { ok: true } | { ok: false; error: string; needsForce?: boolean; leases?: number; payments?: number }
> {
  try {
  await requireEdit()

  const activeLeases = await prisma.leaseTerm.count({
    where: {
      roomId: id,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
    },
  })
  if (activeLeases > 0) return { ok: false, error: '거주중인 입주자가 있어 삭제할 수 없습니다.' }

  // 과거 이력 확인 — 복구 불가 삭제임을 건수와 함께 동의받는다
  const pastLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))
  if (pastLeaseIds.length > 0 && !opts?.force) {
    const payments = await prisma.paymentRecord.count({ where: { leaseTermId: { in: pastLeaseIds } } })
    return {
      ok: false, needsForce: true, leases: pastLeaseIds.length, payments,
      error: `과거 계약 ${pastLeaseIds.length}건·수납 기록 ${payments}건이 함께 영구 삭제됩니다.`,
    }
  }

  // Drive 파일 정리
  const photos = await prisma.roomPhoto.findMany({ where: { roomId: id }, select: { driveFileId: true } })
  await Promise.allSettled(
    photos.filter(p => p.driveFileId).map(p => deleteFromDrive(p.driveFileId!))
  )

  // 과거 계약 기록 정리 (LeaseTerm → Room FK에 cascade 없어서 수동 처리)
  // 삭제 순서: TenantStatusLog → LeaseTerm (PaymentRecord는 LeaseTerm cascade로 자동 삭제)
  const oldLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))

  if (oldLeaseIds.length > 0) {
    await prisma.tenantStatusLog.deleteMany({ where: { leaseTermId: { in: oldLeaseIds } } })
    await prisma.leaseTerm.deleteMany({ where: { id: { in: oldLeaseIds } } })
  }

  await prisma.room.delete({ where: { id } })
  revalidatePath('/room-manage')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 사진 업로드 — 클라이언트 직접 업로드 방식 (Vercel 페이로드 한도 우회)
// 흐름: createPhotoUploadSession → 클라이언트가 Drive에 직접 PUT → finalizeRoomPhoto

const MAX_PHOTO_BYTES = 50 * 1024 * 1024 // 50MB

export async function createPhotoUploadSession(input: {
  roomId: string
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.roomId) return { ok: false, error: '호실 정보가 없습니다.' }
    // 영업장 스코프 — 없으면 타 영업장 roomId로 업로드 가능(격리가 UUID 비밀성에 의존, 신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_PHOTO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }

    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `room_${input.roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[createPhotoUploadSession] failed:', err)
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeRoomPhoto(input: {
  roomId: string
  driveFileId: string
  fileName: string
}): Promise<{ ok: true; id: string; driveFileId: string; storageUrl: string; fileName: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    // 영업장 스코프 — 타 영업장 호실에 사진 행 삽입 차단(신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }

    // 링크 있는 사람 누구나 열람 가능하도록 권한 설정
    await setDrivePublicReadable(input.driveFileId)

    const lastPhoto = await prisma.roomPhoto.findFirst({
      where: { roomId: input.roomId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const photo = await prisma.roomPhoto.create({
      data: {
        roomId: input.roomId,
        storageUrl: buildDriveThumbnailUrl(input.driveFileId, 400),
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        sortOrder: (lastPhoto?.sortOrder ?? 0) + 1,
        // 파일명으로 360 판정을 값으로 굳힌다 — 하드코딩 360 부채 재발 방지(공개 API 가 매번 재파싱 안 하게)
        is360: looksLike360(input.fileName),
      },
    })

    revalidatePath('/room-manage')
    return {
      ok: true,
      id: photo.id,
      driveFileId: photo.driveFileId!,
      storageUrl: photo.storageUrl,
      fileName: photo.fileName ?? input.fileName,
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[finalizeRoomPhoto] failed:', err)
    // DB 저장 실패 시 Drive 파일은 정리 (orphan 방지)
    if (input.driveFileId) {
      try { await deleteFromDrive(input.driveFileId) } catch { /* 정리 실패는 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

// 호실 사진 삭제 (Google Drive)
export async function deleteRoomPhoto(photoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()

    // 영업장 스코프 — 타 영업장 사진 id로 삭제 차단(신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }

    if (photo.driveFileId) {
      await deleteFromDrive(photo.driveFileId)
    }

    await prisma.roomPhoto.delete({ where: { id: photoId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 공개 소개 페이지 갤러리에 이 방 사진을 노출할지 토글 — 켤 땐 사진이 최소 1장 있어야 한다.
// 공실 여부와 독립(운영자가 직접 켠다). 되돌리기는 반대 값으로 다시 호출.
export async function setRoomShowOnSite(roomId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, _count: { select: { photos: true } } },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (show && room._count.photos === 0) return { ok: false, error: '등록된 사진이 없어요. 사진을 먼저 올린 뒤 공개할 수 있습니다.' }
    await prisma.room.update({ where: { id: roomId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    revalidatePath('/dashboard')
    revalidatePath('/settings')   // 웹사이트 탭의 '소개 페이지 반영 대기' 목록이 이 값으로 서 있다
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 사진 단위 공개 토글 — 방 공개가 켜졌을 때 이 사진을 소개 페이지에 노출할지. 대표(카드 썸네일·공개 첫 장)는
// 별도 필드 없이 '공개·비360 첫 장'으로 계산되므로 이 토글 하나로 대표 자동 승격까지 처리된다.
export async function setRoomPhotoShowOnSite(photoId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.roomPhoto.update({ where: { id: photoId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 소개 페이지 대표 썸네일 재배포 요청 — 사진을 여러 개 바꾼 뒤 편집 모달을 닫을 때 한 번 호출(변경 묶어 1회).
// Vercel 은 런타임에 정적 HTML 을 못 고쳐, 재배포 빌드에서 대표 썸네일이 최신화된다. 훅 미설정이면 무동작.
export async function requestGalleryRedeploy(): Promise<{ ok: true }> {
  try { await requireEdit(); await triggerRedeploy() } catch { /* 트리거 실패는 무시(다음 배포 때 반영) */ }
  return { ok: true }
}

// 사진의 360 지정 토글 — 파일명 자동판정이 놓친 360 파노라마를 운영자가 직접 표시. 저장하면 공개 웹(평면
// 목록에서 빠지고 360 버튼)·호실관리 뷰어·카드 대표 계산(360 제외)에 모두 반영된다.
export async function setRoomPhotoIs360(photoId: string, is360: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.roomPhoto.update({ where: { id: photoId }, data: { is360 } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 사진 순서 저장 (오류신고 8dba0177) — 편집 UI가 최종 배열(photoIds, 표시 순서대로)을 넘기면 인덱스대로 sortOrder 재기록.
// 대표 이미지 = 첫 장(photos[0]) 규칙이라 '대표로 설정'도 이 액션(맨 앞 이동 배열)으로 처리된다.
// 부분 배열은 미포함 사진과의 상대 순서가 흔들리므로 전체 집합 일치일 때만 저장(reorderAssetItems와 동일 문법).
export async function reorderRoomPhotos(roomId: string, photoIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (photoIds.length === 0) return { ok: false, error: '정렬할 사진이 없습니다.' }
    if (new Set(photoIds).size !== photoIds.length) return { ok: false, error: '중복된 사진이 있습니다.' }
    const rows = await prisma.roomPhoto.findMany({ where: { roomId }, select: { id: true } })
    const current = new Set(rows.map(r => r.id))
    if (current.size !== photoIds.length || !photoIds.every(id => current.has(id)))
      return { ok: false, error: '사진 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.' }
    await prisma.$transaction(photoIds.map((id, i) =>
      prisma.roomPhoto.update({ where: { id }, data: { sortOrder: i } })
    ))
    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── [Trigger B] 예약된 가격 일괄 적용 ────────────────────────────────
// 규칙 본문은 lib/scheduledRent applyScheduledRentsFor 정본이다. 여기는 접근 검사를 거쳐
// 자기 영업장 id 를 넘기는 서버 액션 껍데기고, 크론(/api/cron/apply-rents)은 CRON_SECRET 을
// 거쳐 전 영업장에 대해 **같은 함수**를 부른다 — 두 경로가 갈릴 자리를 안 만든다.
// 호실 관리 페이지는 로드 시 await, 홈·고객 관리는 응답 후 after() 로 부른다.
export async function applyScheduledRents() {
  const { propertyId } = await getPropertyId()
  return applyScheduledRentsFor(propertyId)
}

// ── 단일 호실 즉시 적용 ──────────────────────────────────────────────
// 공실 상태에서 예정 가격을 즉시 baseRent에 반영. 활성 계약이 있으면 rentAmount도 동기화.
export type ScheduledRentUndo = {
  roomId: string; prevBaseRent: number; prevScheduledRent: number; prevRentUpdateDate: string | null
  leases: { id: string; prevRentAmount: number }[]
}

export async function applyScheduledRentNow(roomId: string): Promise<{ ok: true; newRent: number; undo: ScheduledRentUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { baseRent: true, scheduledRent: true, rentUpdateDate: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (room.scheduledRent == null) return { ok: false, error: '예정 가격이 설정되어 있지 않습니다.' }

    const newRent = room.scheduledRent
    // 되돌리기 스냅샷 — 적용 전 월세·예약 필드·활성 계약별 rentAmount (감사 2026-07-10)
    const leases = await prisma.leaseTerm.findMany({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { id: true, rentAmount: true },
    })
    const undo: ScheduledRentUndo = {
      roomId, prevBaseRent: room.baseRent, prevScheduledRent: newRent,
      prevRentUpdateDate: room.rentUpdateDate ? room.rentUpdateDate.toISOString() : null,
      leases: leases.map(l => ({ id: l.id, prevRentAmount: l.rentAmount })),
    }

    await prisma.room.update({
      where: { id: roomId },
      data: {
        baseRent:       newRent,
        scheduledRent:  null,
        rentUpdateDate: null,
      },
    })

    await prisma.leaseTerm.updateMany({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      data: { rentAmount: newRent },
    })

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, newRent, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 예정 가격 즉시 적용 적용취소 — 월세·예약 필드·계약별 금액을 스냅샷으로 복원
export async function undoApplyScheduledRent(u: ScheduledRentUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: u.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.room.update({ where: { id: u.roomId }, data: {
        baseRent: u.prevBaseRent, scheduledRent: u.prevScheduledRent,
        rentUpdateDate: u.prevRentUpdateDate ? new Date(u.prevRentUpdateDate) : null,
      } }),
      ...u.leases.map(l => prisma.leaseTerm.update({ where: { id: l.id }, data: { rentAmount: l.prevRentAmount } })),
    ])
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 일괄 편집
export async function batchUpdateRooms(
  roomIds: string[],
  data: {
    type?: string | null
    tier?: string | null
    baseRent?: number
    scheduledRent?: number | null
    rentUpdateDate?: Date | string | null
    windowType?: string | null
    direction?: string | null
  },
): Promise<{ ok: true; count: number; skippedNegotiated?: number; undo: BatchRoomsUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (roomIds.length === 0) return { ok: false, error: '선택된 호실이 없습니다.' }
    if (Object.keys(data).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }

    // 예약 이용료는 적용 예정일과 함께여야 함(적용일 없으면 인상·인하가 적용 안 됨). 예약 삭제 시 적용일도 함께 제거.
    if (data.scheduledRent != null && data.rentUpdateDate == null) {
      return { ok: false, error: '예약 이용료를 설정하려면 적용 예정일도 함께 지정해야 합니다.' }
    }
    if (data.scheduledRent === null) data.rentUpdateDate = null
    if (typeof data.rentUpdateDate === 'string') data.rentUpdateDate = new Date(data.rentUpdateDate)

    // baseRent 동기화 판정용 — 변경 전 기준가 확보 (updateMany 가 덮어쓰기 전에)
    const prevRents = data.baseRent != null
      ? await prisma.room.findMany({ where: { id: { in: roomIds }, propertyId }, select: { id: true, baseRent: true } })
      : []

    // 되돌리기 스냅샷 — 바뀔 필드들의 원값(감사 백로그 2026-07-10)
    const keys = Object.keys(data)
    const beforeRooms = await prisma.room.findMany({
      where: { id: { in: roomIds }, propertyId },
      select: { id: true, type: true, tier: true, baseRent: true, scheduledRent: true, rentUpdateDate: true, windowType: true, direction: true, nonResidentScheduled: true, nonResidentRentDate: true },
    })
    const beforeLeases = data.baseRent != null
      ? await prisma.leaseTerm.findMany({
          where: { roomId: { in: roomIds }, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          select: { id: true, rentAmount: true },
        })
      : []
    const undo: BatchRoomsUndo = {
      rooms: beforeRooms.map(b => ({ id: b.id, fields: Object.fromEntries(keys.map(k => {
        const v = (b as Record<string, unknown>)[k]
        return [k, v instanceof Date ? v.toISOString() : (v ?? null)]
      })) })),
      leases: beforeLeases.map(l => ({ id: l.id, rentAmount: l.rentAmount })),
    }

    const r = await prisma.room.updateMany({
      where: { id: { in: roomIds }, propertyId },
      data,
    })

    // baseRent 변경 시 활성 계약의 rentAmount 동기화 — 단, 계약별 협의 임대료
    // (방 기준가와 다르게 설정된 rentAmount)는 덮어쓰지 않는다. 일괄 변경이
    // 개별 협의가를 흔적 없이 지우던 문제 방지.
    let skippedNegotiated = 0
    if (data.baseRent != null) {
      for (const room of prevRents) {
        const synced = await prisma.leaseTerm.updateMany({
          where: {
            roomId: room.id,
            status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
            rentAmount: room.baseRent,   // 기준가 그대로 쓰던 계약만 따라감
          },
          data: { rentAmount: data.baseRent },
        })
        const total = await prisma.leaseTerm.count({
          where: { roomId: room.id, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        })
        skippedNegotiated += total - synced.count
      }
    }

    // 인상 예약 일괄 변경 → 락인 되쓰기 (단건 경로와 동일 규칙). 한쪽만 걸면 다른 경로로 빠져나간다.
    if ('scheduledRent' in data || 'rentUpdateDate' in data) {
      const { rewriteLockedExpectedForRentSchedule } = await import('@/app/(app)/rooms/paymentEngine')
      const nextSched = 'scheduledRent' in data ? (data.scheduledRent ?? null) : undefined
      const nextDate = 'rentUpdateDate' in data ? ((data.rentUpdateDate as Date | null) ?? null) : undefined
      for (const b of beforeRooms) {
        const after = {
          scheduledRent: nextSched !== undefined ? nextSched : b.scheduledRent,
          rentUpdateDate: nextDate !== undefined ? nextDate : b.rentUpdateDate,
        }
        if (b.scheduledRent === after.scheduledRent
            && (b.rentUpdateDate?.getTime() ?? null) === (after.rentUpdateDate?.getTime() ?? null)) continue
        // 비거주 축은 일괄 수정 대상이 아니라 전후 동일하게 넘긴다(비거주 계약은 before === after 로 자동 skip).
        await rewriteLockedExpectedForRentSchedule(
          b.id,
          { scheduledRent: b.scheduledRent, rentUpdateDate: b.rentUpdateDate, nonResidentScheduled: b.nonResidentScheduled, nonResidentRentDate: b.nonResidentRentDate },
          { ...after, nonResidentScheduled: b.nonResidentScheduled, nonResidentRentDate: b.nonResidentRentDate },
        )
      }
    }

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, count: r.count, skippedNegotiated, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 일괄 수정 적용취소 — 방 필드·동기화된 계약 임대료를 스냅샷으로 복원(v2.0 §16)
export type BatchRoomsUndo = {
  rooms: { id: string; fields: Record<string, unknown> }[]
  leases: { id: string; rentAmount: number }[]
}

export async function undoBatchUpdateRooms(u: BatchRoomsUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      ...u.rooms.map(x => prisma.room.updateMany({ where: { id: x.id, propertyId }, data: Object.fromEntries(Object.entries(x.fields).map(([k, v]) => [k, k === 'rentUpdateDate' && typeof v === 'string' ? new Date(v) : v])) as never })),
      ...u.leases.map(l => prisma.leaseTerm.updateMany({ where: { id: l.id }, data: { rentAmount: l.rentAmount } })),
    ])
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// ============================================================
// 공용·외관 사진 (PropertyPhoto) — 방이 아닌 영업장에 묶인 소개 페이지 사진. 방 사진 액션과 평행 구조.
// ============================================================

// 기본 카테고리 세트 — 카테고리가 하나도 없을 때 자동 생성(멀티테넌트 lazy seed). 이후 운영자가 추가·이름변경·순서·삭제.
const DEFAULT_PHOTO_CATEGORIES = ['외관', '현관/로비', '복도', '주방/세탁', '샤워/화장실']

// 카테고리 + 사진 조회. 없으면 기본 세트를 만든 뒤 반환.
export async function getPropertyPhotoData() {
  await requireEdit()
  const { propertyId } = await getPropertyId()
  const query = () => prisma.propertyPhotoCategory.findMany({
    where: { propertyId },
    orderBy: { sortOrder: 'asc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  let categories = await query()
  if (categories.length === 0) {
    await prisma.propertyPhotoCategory.createMany({
      data: DEFAULT_PHOTO_CATEGORIES.map((name, i) => ({ name, sortOrder: i, propertyId })),
    })
    categories = await query()
  }
  return categories
}

export async function createPhotoCategory(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '카테고리 이름을 입력하세요.' }
    const last = await prisma.propertyPhotoCategory.findFirst({ where: { propertyId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const cat = await prisma.propertyPhotoCategory.create({ data: { name: trimmed, sortOrder: (last?.sortOrder ?? -1) + 1, propertyId } })
    revalidatePath('/room-manage')
    return { ok: true, id: cat.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function renamePhotoCategory(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '카테고리 이름을 입력하세요.' }
    const r = await prisma.propertyPhotoCategory.updateMany({ where: { id, propertyId }, data: { name: trimmed } })
    if (r.count === 0) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function reorderPhotoCategories(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const rows = await prisma.propertyPhotoCategory.findMany({ where: { propertyId }, select: { id: true } })
    const own = new Set(rows.map(r => r.id))
    if (ids.length !== rows.length || !ids.every(id => own.has(id))) return { ok: false, error: '카테고리 목록이 일치하지 않습니다.' }
    await prisma.$transaction(ids.map((id, i) => prisma.propertyPhotoCategory.update({ where: { id }, data: { sortOrder: i } })))
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 카테고리 삭제 — 속한 사진의 Drive 파일을 정리한 뒤 삭제(사진 행은 FK CASCADE). 사진이 있으면 클라에서 확인받는다.
export async function deletePhotoCategory(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id, propertyId }, select: { id: true, photos: { select: { driveFileId: true } } } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    await Promise.allSettled(cat.photos.filter(p => p.driveFileId).map(p => deleteFromDrive(p.driveFileId!)))
    await prisma.propertyPhotoCategory.delete({ where: { id } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function createPropertyPhotoUploadSession(input: {
  categoryId: string; fileName: string; mimeType: string; fileSize: number; origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: input.categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_PHOTO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `prop_${input.categoryId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const uploadUrl = await createDriveResumableSession({ fileName: uniqueName, mimeType: input.mimeType, fileSize: input.fileSize, origin: input.origin })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[createPropertyPhotoUploadSession] failed:', err)
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizePropertyPhoto(input: {
  categoryId: string; driveFileId: string; fileName: string
}): Promise<{ ok: true; id: string; driveFileId: string; storageUrl: string; fileName: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: input.categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    await setDrivePublicReadable(input.driveFileId)
    const last = await prisma.propertyPhoto.findFirst({ where: { categoryId: input.categoryId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const photo = await prisma.propertyPhoto.create({
      data: {
        storageUrl: buildDriveThumbnailUrl(input.driveFileId, 400),
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        is360: looksLike360(input.fileName),
        categoryId: input.categoryId,
        propertyId,
      },
    })
    revalidatePath('/room-manage')
    return { ok: true, id: photo.id, driveFileId: photo.driveFileId!, storageUrl: photo.storageUrl, fileName: photo.fileName ?? input.fileName }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[finalizePropertyPhoto] failed:', err)
    if (input.driveFileId) { try { await deleteFromDrive(input.driveFileId) } catch { /* 정리 실패 무시 */ } }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deletePropertyPhoto(photoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    if (photo.driveFileId) { try { await deleteFromDrive(photo.driveFileId) } catch { /* 정리 실패 무시 */ } }
    await prisma.propertyPhoto.delete({ where: { id: photoId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function reorderPropertyPhotos(categoryId: string, photoIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    const rows = await prisma.propertyPhoto.findMany({ where: { categoryId }, select: { id: true } })
    const own = new Set(rows.map(r => r.id))
    if (photoIds.length !== rows.length || !photoIds.every(id => own.has(id))) return { ok: false, error: '사진 목록이 일치하지 않습니다.' }
    await prisma.$transaction(photoIds.map((id, i) => prisma.propertyPhoto.update({ where: { id }, data: { sortOrder: i } })))
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setPropertyPhotoShowOnSite(photoId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.propertyPhoto.update({ where: { id: photoId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setPropertyPhotoIs360(photoId: string, is360: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.propertyPhoto.update({ where: { id: photoId }, data: { is360 } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
