// 희망 호실·조건 매칭 정본 — 어느 방이 언제 비고, 그 방을 기다리는 사람 중 누가 그 날짜에 맞는가.
//
// 배경 (2026-08-11, 운영자 승인):
//   홈 매칭 알림이 자기 방 축을 따로 들고 있었다 — 'isVacant 인 방 + 퇴실 예정 방'. 호실 관리
//   '입주 가능'(roomAvailability)은 퇴실일이 잡힌 예약이 걸린 방(409·404호)까지 세는데 매칭은
//   그 방을 아예 몰랐고, 반대로 퇴실 예정이어도 뒤에 예약이 이어 붙은 방(503호)을 빈 방처럼 불렀다.
//   같은 질문의 두 번째 사본이라 방 축을 lib/leaseStatus.roomAvailability 하나로 수렴한다.
//
//   그리고 날짜를 묻지 않았다. "402호가 8/30에 빈다"와 "이 사람은 8/16에 들어오고 싶다"를
//   나란히 놓고도 둘이 맞는지 판단하지 않아, 두 달을 기다려야 하는 사람이 1순위로 떴다.
//
// 두 축으로 나눈다.
//   방 축   = roomAvailability (now | soon(availableFrom) | 모름)
//   사람 축 = 날짜 게이트 (ok | flexible | unconfirmed | excluded)
//
// 게이트는 리드 3상태(WAITING_TOUR·TOUR_DONE·RESERVED 미확정)에만 건다. 거주중 이동 희망은
// 방을 비우는 약속이 아니라 메모라 날짜로 자르지 않고, 예약 확정자는 이미 방이 정해져 매칭에서 빠진다.
//
// 제외한 사람도 세어서 돌려준다. 운영자 오더 그대로다 — "제외는 하되 notice 는 줘야 돼.
// 그래야 기다리는 사람에게 방이 없다고 알려줄 수 있으니까." 그래서 통과 후보가 0명이어도
// 제외자가 있으면 알림은 뜨고, 모든 희망 방에서 제외된 사람은 고객 목록 카드에 사유가 붙는다.

import type { PrismaDb } from '@/lib/prisma'
import { availableFromLabel, roomAvailability, type RoomAvailability } from '@/lib/leaseStatus'

/** 날짜 게이트를 적용하는 단계 — 아직 방이 확정되지 않은 리드. */
export const WISH_LEAD_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] as const

/**
 * 이 저장 결과가 리드 게이트를 떠나는가 — 떠나면 조절 여부(moveInFlexible)를 함께 접어야 한다.
 * 매칭(wishDateGate)은 리드에서만 이 값을 읽으므로, 그 밖의 상태(예약 확정 포함)에 남은 값은
 * 화면에 '조절 가능'만 계속 말하는 거짓 표시다. check-wish-match-drift 축 3과 같은 판정.
 */
export function leavesWishLead(status: string, reservationConfirmedAt: Date | null): boolean {
  return !(WISH_LEAD_STATUSES as readonly string[]).includes(status) || reservationConfirmedAt != null
}

/**
 * 희망일보다 방이 늦게 비어도 후보로 남겨 두는 최대 일수.
 * 30일 = 한 달. 그 이상 기다리라고 연락하는 것은 매칭이 아니라 다른 방 안내다(운영자 승인 2026-08-11).
 */
export const GAP_CAP_DAYS = 30

/**
 * 미루기 권고를 띄우는 최대 대기 일수. 지금 바로 갈 방이 없고 가장 빠른 방이 이 안쪽이면
 * "며칠만 늦추면 됩니다"라고 말할 값어치가 있다. 등급 문구에만 쓰고 후보 집합은 자르지 않는다
 * (후보는 GAP_CAP_DAYS 30일 그대로 — 운영자 확정 2026-08-11).
 */
export const DELAY_HINT_DAYS = 7

/** 날짜 게이트 판정. excluded 만 후보에서 빠지고, 나머지 셋은 남는다. */
export type WishGate = 'ok' | 'flexible' | 'unconfirmed' | 'excluded'

export type WishCandidate = {
  leaseId: string
  tenantId: string
  tenantName: string
  status: string
  matchedBy: 'rooms' | 'conditions'
  gate: WishGate
  /** 그 사람의 입주 희망일 'YYYY-MM-DD'. 없으면 null(게이트는 unconfirmed). */
  wishMoveIn: string | null
  /** 희망일보다 방이 며칠 늦게 비는가. 0 이하·판정 불필요면 0. */
  waitDays: number
}

export type WishRoomMatch = {
  roomNo: string
  availability: RoomAvailability
  /** 통과한 후보 — 날짜 맞는 사람 먼저, 각 군 안에서 문의 순. rank 는 통과자만 1..N. */
  candidates: (WishCandidate & { rank: number })[]
  /** 날짜가 안 맞아 빠진 사람 수 — 알림 하단 캡션에 쓴다. */
  excludedCount: number
}

/** 사람 축 한 줄 — 그 사람이 들어갈 수 있는 방 하나. 방 축 후보의 전치라 판정 필드가 같다. */
export type WishLeaseRoom = {
  roomNo: string
  roomId: string
  /** 방 타입(원룸·미니룸 등). 영업장이 자유로 편집하는 값이라 비어 있을 수 있다. 판정에는 쓰지 않는다. */
  roomType: string | null
  availability: RoomAvailability
  matchedBy: 'rooms' | 'conditions'
  gate: WishGate
  waitDays: number
}

/** 사람 축 한 칸 — "이 사람은 어느 방에 들어갈 수 있는가". 방 축(WishRoomMatch)을 뒤집은 것이다. */
export type WishLeaseMatch = {
  leaseId: string
  tenantId: string
  tenantName: string
  status: string
  /** 그 사람의 입주 희망일 'YYYY-MM-DD'. 없으면 null. */
  wishMoveIn: string | null
  /** 날짜 게이트를 통과한 방 — ok 먼저, 그 안에서 대기 짧은 순. */
  rooms: WishLeaseRoom[]
  /** 희망했지만 날짜가 안 맞아 빠진 방 수. */
  excludedCount: number
}

export type WishMatchResult = {
  rooms: WishRoomMatch[]
  /** 같은 판정의 사람 축 전치 — 방 축을 다시 계산하지 않는다(§ 두 축은 같은 한 판정이다). */
  leases: WishLeaseMatch[]
  /** 희망한 방이 하나 이상 매칭됐지만 전부 날짜에서 빠진 사람 — 카드에 사유를 붙일 대상. */
  noDateFitLeaseIds: string[]
}

type WishRoomInfo = {
  roomNo: string
  roomId: string
  type: string | null
  floor: string | null
  windowType: string | null
  direction: string | null
  baseRent: number
  availability: RoomAvailability
}

type WishLease = {
  id: string
  status: string
  wishRooms: string | null
  wishConditions: string | null
  moveInDate: Date | string | null
  moveInFlexible: boolean | null
  keepAlertAfterInquiry: boolean
  reservationConfirmedAt: Date | string | null
  inquiryAt: Date | string | null
  createdAt: Date | string
  tenant: { id: string; name: string }
  room: { roomNo: string } | null
}

type WishConditionsObj = { floor?: string; windowType?: string; type?: string; direction?: string; minRent?: number; maxRent?: number }

const ymd = (d: Date | string | null): string | null =>
  d == null ? null : typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)

/** 'YYYY-MM-DD' 두 개의 일수 차 (b - a). UTC 로만 계산해 기기 시간대를 배제한다. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** 호실번호에서 층 추정 — Room.floor 가 비어 있을 때의 폴백(종전 매칭과 같은 규칙). */
function floorOf(room: { roomNo: string; floor: string | null }): string {
  if (room.floor) return room.floor
  const n = room.roomNo.replace(/[^0-9]/g, '')
  return n.length >= 3 ? n.slice(0, n.length - 2) : ''
}

/** 조건(wishConditions JSON)이 그 방과 맞는가. 빈 객체 "{}" 는 조건 무관이라 모든 방과 맞는다. */
export function matchesWishConditions(room: WishRoomInfo, raw: string | null): boolean {
  if (raw == null) return false
  let cond: WishConditionsObj
  try { cond = JSON.parse(raw) } catch { return false }
  if (!cond) return false
  if (cond.floor && cond.floor !== floorOf(room)) return false
  if (cond.windowType && cond.windowType !== room.windowType) return false
  if (cond.type && cond.type !== room.type) return false
  if (cond.direction && cond.direction !== room.direction) return false
  if (cond.minRent != null && room.baseRent < cond.minRent) return false
  if (cond.maxRent != null && room.baseRent > cond.maxRent) return false
  return true
}

/**
 * 날짜 게이트 — 이 사람이 이 방의 입주 가능일에 맞는가.
 *
 *   지금 비어 있는 방(now)      → 언제 들어오든 맞다.
 *   희망일이 입주 가능일 이후    → 맞다.
 *   30일 넘게 기다려야 함        → 제외(그래도 세어서 알린다).
 *   조절 가능(true)             → 남는다(2군).
 *   그 날짜여야 함(false)        → 제외.
 *   안 물어봤다(null)           → 남는다(2군). null 을 false 로 읽으면 안 물어본 사람이 사라진다.
 */
export function wishDateGate(
  availability: RoomAvailability,
  wishMoveIn: string | null,
  moveInFlexible: boolean | null,
): { gate: WishGate; waitDays: number } {
  if (availability.kind === 'now') return { gate: 'ok', waitDays: 0 }
  if (!wishMoveIn) return { gate: 'unconfirmed', waitDays: 0 }
  const wait = daysBetween(wishMoveIn, availability.availableFrom)
  if (wait <= 0) return { gate: 'ok', waitDays: 0 }
  if (wait > GAP_CAP_DAYS) return { gate: 'excluded', waitDays: wait }
  if (moveInFlexible === true) return { gate: 'flexible', waitDays: wait }
  if (moveInFlexible === false) return { gate: 'excluded', waitDays: wait }
  return { gate: 'unconfirmed', waitDays: wait }
}

/**
 * 순서 — 날짜 맞는 사람(ok)이 먼저고, 그 다음이 기다릴 수 있는 사람(flexible·unconfirmed).
 * 각 군 안에서는 문의 순(오래 기다린 사람 먼저)이다. 운영자 승인 2026-08-11.
 */
function sortCandidates(list: (WishCandidate & { orderAt: number })[]): (WishCandidate & { orderAt: number })[] {
  return [...list].sort((a, b) => {
    const ga = a.gate === 'ok' ? 0 : 1
    const gb = b.gate === 'ok' ? 0 : 1
    if (ga !== gb) return ga - gb
    return a.orderAt - b.orderAt
  })
}

/**
 * 사람 축 한 칸 안의 방 순서 — 날짜가 맞는 방(ok)이 먼저고, 그 다음은 덜 기다리는 방이다.
 * 같은 날 비는 방끼리는 호실번호 순(사람이 목록을 눈으로 훑는 순서).
 */
function sortLeaseRooms(list: WishLeaseRoom[]): WishLeaseRoom[] {
  return [...list].sort((a, b) => {
    const ga = a.gate === 'ok' ? 0 : 1
    const gb = b.gate === 'ok' ? 0 : 1
    if (ga !== gb) return ga - gb
    if (a.waitDays !== b.waitDays) return a.waitDays - b.waitDays
    return a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
  })
}

/**
 * 방 축·사람 축을 붙여 방별 후보 목록을 만든다. 조회는 loadWishMatch 가 하고 여기는 순수 계산이다
 * (감지망 스크립트가 같은 함수를 DB 값으로 되돌려 검사할 수 있게).
 *
 * todayYmd 는 KST 오늘 'YYYY-MM-DD' — 지난 희망일 만료(keepAlertAfterInquiry) 판정에만 쓴다.
 */
export function buildWishMatch(
  rooms: WishRoomInfo[],
  leases: WishLease[],
  todayYmd: string,
): WishMatchResult {
  const leadStatuses: string[] = [...WISH_LEAD_STATUSES]
  type Raw = WishCandidate & { orderAt: number }
  const byRoom = new Map<string, Raw[]>()
  const roomByNo = new Map(rooms.map(r => [r.roomNo, r]))

  // 제외자도 같은 자리에 담는다(gate==='excluded'). 두 번 훑으면 그 두 번째가 매칭 규칙의 사본이 되고,
  // 규칙이 바뀔 때 한쪽만 고쳐진다 — 통과와 제외를 한 번에 모아 마지막에 가른다.
  const push = (info: WishRoomInfo, l: WishLease, matchedBy: 'rooms' | 'conditions') => {
    const list = byRoom.get(info.roomNo) ?? []
    byRoom.set(info.roomNo, list)
    if (list.some(c => c.tenantId === l.tenant.id)) return   // 호실로도 조건으로도 걸린 같은 사람은 한 번만
    const isLead = leadStatuses.includes(l.status)
    const wishMoveIn = isLead ? ymd(l.moveInDate) : null
    // 거주중 이동 희망은 날짜로 자르지 않는다 — 방을 비우는 약속이 아니라 메모다.
    const { gate, waitDays } = isLead
      ? wishDateGate(info.availability, wishMoveIn, l.moveInFlexible)
      : { gate: 'ok' as WishGate, waitDays: 0 }
    list.push({
      leaseId: l.id, tenantId: l.tenant.id, tenantName: l.tenant.name, status: l.status,
      matchedBy, gate, wishMoveIn, waitDays,
      orderAt: new Date(l.inquiryAt ?? l.createdAt).getTime(),
    })
  }

  for (const l of leases) {
    // 입주 희망일이 지난 리드는 옵션이 켜져 있지 않으면 매칭 제외(종전 규칙 유지)
    if (!l.keepAlertAfterInquiry) {
      const mi = ymd(l.moveInDate)
      if (mi && mi < todayYmd) continue
    }
    // 예약 확정자는 이미 호실이 정해진 상태 → 매칭 알림에서 제외
    if (l.reservationConfirmedAt) continue

    // 1) 호실 직접 매칭
    for (const no of (l.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
      const info = roomByNo.get(no)
      if (!info) continue
      if (l.room?.roomNo === no) continue
      push(info, l, 'rooms')
    }

    // 2) 조건 매칭 — 호실 미지정자가 wishConditions 를 등록한 경우, 조건에 부합하는 모든 방에 후보로 등록.
    //    단 '조건 무관'(빈 객체 "{}")은 '호실 미지정 seeker'에게만. 이미 방 배정된 거주중·퇴실예정의 잔여 "{}"는
    //    '아무 방이나'로 잘못 매칭되므로 제외(구체 조건이 있는 실제 이동희망은 그대로 매칭). 2026-07-01 오탐 수정(412호 등).
    if (l.wishConditions) {
      const hasRealCond = (() => {
        try { const c = JSON.parse(l.wishConditions!); return !!c && Object.values(c).some(v => v != null && v !== '') } catch { return false }
      })()
      if (hasRealCond || !l.room?.roomNo) for (const info of rooms) {
        if (!matchesWishConditions(info, l.wishConditions)) continue
        if (l.room?.roomNo === info.roomNo) continue
        push(info, l, 'conditions')
      }
    }
  }

  const result: WishRoomMatch[] = []
  // 사람 축 — 방 축을 세는 이 자리에서 같은 후보를 뒤집어 담는다. 여기서 다시 순회하며 게이트를
  // 물으면 그 순간 판정이 두 벌이 되고, 규칙이 바뀔 때 한쪽만 고쳐진다(제외 카운트가 그렇게 샜다).
  const perLease = new Map<string, WishLeaseMatch>()
  for (const [roomNo, raw] of byRoom) {
    const info = roomByNo.get(roomNo)
    if (!info || raw.length === 0) continue
    for (const c of raw) {
      let t = perLease.get(c.leaseId)
      if (!t) {
        t = {
          leaseId: c.leaseId, tenantId: c.tenantId, tenantName: c.tenantName, status: c.status,
          wishMoveIn: c.wishMoveIn, rooms: [], excludedCount: 0,
        }
        perLease.set(c.leaseId, t)
      }
      if (c.gate === 'excluded') t.excludedCount += 1
      else t.rooms.push({
        roomNo, roomId: info.roomId, roomType: info.type, availability: info.availability,
        matchedBy: c.matchedBy, gate: c.gate, waitDays: c.waitDays,
      })
    }
    const passers = sortCandidates(raw.filter(c => c.gate !== 'excluded'))
    result.push({
      roomNo,
      availability: info.availability,
      excludedCount: raw.length - passers.length,
      candidates: passers.map((c, idx) => ({
        leaseId: c.leaseId, tenantId: c.tenantId, tenantName: c.tenantName, status: c.status,
        matchedBy: c.matchedBy, gate: c.gate, wishMoveIn: c.wishMoveIn, waitDays: c.waitDays,
        rank: idx + 1,
      })),
    })
  }
  result.sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))

  // 통과한 방이 하나도 없고 빠진 방만 있는 사람 = 종전 'matched > 0 && excluded === matched'.
  // 같은 집합을 새 구조에서 파생시킨다 — 두 번 세지 않는다.
  const leaseAxis: WishLeaseMatch[] = []
  const noDateFitLeaseIds: string[] = []
  for (const t of perLease.values()) {
    t.rooms = sortLeaseRooms(t.rooms)
    leaseAxis.push(t)
    if (t.rooms.length === 0 && t.excludedCount > 0) noDateFitLeaseIds.push(t.leaseId)
  }

  return { rooms: result, leases: leaseAxis, noDateFitLeaseIds }
}

/**
 * 방 축·사람 축 조회 + 계산 — 홈(매칭 알림)과 고객 목록(제외 사유 캡션)이 같은 값을 쓰도록 여기 하나다.
 * 방 축은 roomAvailability 가 판정하므로 점유 계약을 자르지 않고 전부 읽는다(take 금지 — 계약이 셋인 방이 있다).
 */
export async function loadWishMatch(
  prisma: PrismaDb,
  propertyId: string,
  todayYmd: string,
): Promise<WishMatchResult> {
  const [roomRows, leases] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      select: {
        // id — 사람 축 줄에서 호실 면을 여는 데 쓴다(호실번호는 영업장 안에서만 유일해 키가 못 된다).
        id: true, roomNo: true, type: true, floor: true, windowType: true, direction: true, baseRent: true, nonResidentVacant: true,
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          select: { status: true, expectedMoveOut: true },
        },
      },
    }),
    prisma.leaseTerm.findMany({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE'] },
        OR: [{ wishRooms: { not: null } }, { wishConditions: { not: null } }],
      },
      select: {
        id: true, status: true, wishRooms: true, wishConditions: true, inquiryAt: true, createdAt: true,
        moveInDate: true, moveInFlexible: true, keepAlertAfterInquiry: true, reservationConfirmedAt: true,
        tenant: { select: { name: true, id: true } },
        room: { select: { roomNo: true } },
      },
    }),
  ])

  const rooms: WishRoomInfo[] = []
  for (const r of roomRows) {
    const availability = roomAvailability(r)
    if (!availability) continue   // 언제 비는지 모르는 방은 매칭 축에 없다
    rooms.push({
      roomNo: r.roomNo, roomId: r.id, type: r.type, floor: r.floor ?? null,
      windowType: r.windowType, direction: r.direction, baseRent: r.baseRent,
      availability,
    })
  }
  return buildWishMatch(rooms, leases, todayYmd)
}

/** 'YYYY-MM-DD' → 'M/D'. 알림 제목·캡션의 짧은 날짜(TZ 영향 없이 문자열 파싱). */
export function fmtWishMD(ymdStr: string): string {
  const [, m, d] = ymdStr.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 방 상태 한 마디 — "공실" 또는 "8/30 입주 가능". 알림 제목의 날짜화(운영자 승인 2026-08-11). */
export function wishRoomStateLabel(a: RoomAvailability): string {
  return a.kind === 'now' ? '공실' : `${fmtWishMD(a.availableFrom)} 입주 가능`
}

/**
 * 후보 한 줄 캡션 — "희망 8/25 · 조건 매칭 · 일정 조절 가능".
 * 뱃지를 새로 만들지 않는다(§11 자리 부족). 기존 캡션 문법대로 가운뎃점으로만 잇는다.
 */
export function wishCandidateCaption(c: Pick<WishCandidate, 'matchedBy' | 'gate' | 'wishMoveIn' | 'waitDays'>): string {
  const parts: string[] = []
  if (c.wishMoveIn) parts.push(`희망 ${fmtWishMD(c.wishMoveIn)}`)
  parts.push(c.matchedBy === 'conditions' ? '조건 매칭' : '호실 지정')
  if (c.gate === 'flexible') parts.push('일정 조절 가능')
  else if (c.gate === 'unconfirmed' && c.waitDays > 0) parts.push('일정 조절 확인 필요')
  return parts.join(' · ')
}

/** 후보가 한 명일 때 상세에 덧붙이는 문장 — 왜 이 사람이 2군인지. 1군이면 덧붙일 말이 없다. */
export function wishGateDetail(c: Pick<WishCandidate, 'gate' | 'waitDays'>): string {
  if (c.waitDays <= 0) return ''
  if (c.gate === 'flexible') return `희망일보다 ${c.waitDays}일 늦게 비지만 일정 조절이 가능한 분입니다.`
  if (c.gate === 'unconfirmed') return `희망일보다 ${c.waitDays}일 늦게 빕니다. 일정을 조절할 수 있는지 확인해 주세요.`
  return ''
}

/** 방이 언제부터 되는가 — "8/18부터". 지금 빈 방은 날짜가 없으니 기존 어휘 그대로 '공실'. */
export function wishRoomFromLabel(a: RoomAvailability): string {
  return a.kind === 'now' ? '공실' : availableFromLabel(a.availableFrom)
}

/** 사람 축 한 줄의 우측 캡션 — "8/18부터" 또는 "8/30부터 · 5일 늦음". */
export function wishLeaseRoomCaption(r: Pick<WishLeaseRoom, 'availability' | 'waitDays'>): string {
  const from = wishRoomFromLabel(r.availability)
  return r.waitDays > 0 ? `${from} · ${r.waitDays}일 늦음` : from
}

/**
 * 미루기 권고 한 줄 — 지금 바로 갈 방이 0실이고 가장 빠른 방이 DELAY_HINT_DAYS 안쪽일 때만 나온다.
 * 문장은 wishGateDetail 원문에 방 번호만 앞에 붙인 것이다(어휘를 새로 만들지 않는다).
 * 대상이 아니면 빈 문자열 — 호출부는 그때 줄 자체를 그리지 않는다.
 */
export function wishDelayHint(rooms: WishLeaseRoom[]): string {
  if (rooms.length === 0) return ''
  if (rooms.some(r => r.gate === 'ok')) return ''
  const soonest = rooms.reduce((m, r) => (r.waitDays < m.waitDays ? r : m), rooms[0])
  if (soonest.waitDays <= 0 || soonest.waitDays > DELAY_HINT_DAYS) return ''
  const detail = wishGateDetail(soonest)
  return detail ? `${soonest.roomNo}호는 ${detail}` : ''
}
