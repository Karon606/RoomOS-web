// 거주 구간(RoomStay) 이력 기록 헬퍼 — lease 의 호실·종료 상태가 바뀌는 서버 경로에서 '추가 write' 로 부른다.
// 현재 방의 진실은 계속 LeaseTerm.roomId 이고 여기 기록은 파생 이력이다(아키텍트 설계 2026-07-28).
// 세 연산(열린 구간 생성·호실 변경·퇴실 마감)과 종료 복귀용 재개방만 두고, 호출부의 기존 분기는 건드리지 않는다.
// 드리프트(열린 구간 없음·중복·roomId 불일치)는 scripts/check-room-stay-drift.mjs 가 읽기 전용으로 감지한다.

import type { PrismaDb } from '@/lib/prisma'
import { kstYmdStr } from '@/lib/kstDate'

// 트랜잭션 클라이언트 — lib/prisma 익스텐션이 적용된 타입이라야 tx 안에서도 규칙이 같다(syncShortStayCharge 관례).
export type RoomStayDb = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// 종료 상태 — 이 상태로 넘어가면 열린 구간을 마감한다(백필 스크립트의 OPEN_STATUSES 와 여집합).
const TERMINAL_STATUSES = ['CHECKED_OUT', 'CANCELLED']

// 열린 구간 자격 — RoomStay 는 "실제 점유" 이력이므로 이 3상태만 구간을 만든다(아키텍트 오더 2026-07-28).
// 예약(RESERVED)·문의·투어는 점유가 아니라 제외 — 입실 처리(ACTIVE 전환)가 ensureOpenStay 를 부르므로 손실 없음.
export const STAY_ELIGIBLE_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']

export function isStayTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// 'YYYY-MM-DD' → UTC 자정 Date(@db.Date 절삭, 기존 저장 관행). 비면 오늘(KST).
function stayDate(at?: Date | string | null): Date {
  if (at instanceof Date) return at
  return new Date(at || kstYmdStr())
}

async function openStayOf(db: RoomStayDb, leaseTermId: string) {
  return db.roomStay.findFirst({
    where: { leaseTermId, endDate: null },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, roomId: true },
  })
}

/**
 * ① 열린 구간 생성 — 입주자/계약 생성·입실 처리 시. 호실이 없으면 아무것도 하지 않는다.
 * 이미 같은 호실의 열린 구간이 있으면 no-op(멱등). 다른 호실이면 이사로 보고 마감 후 새 구간(자가 치유).
 */
export async function ensureOpenStay(db: RoomStayDb, leaseTermId: string): Promise<void> {
  const lease = await db.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, propertyId: true, moveInDate: true, status: true },
  })
  if (!lease?.roomId) return
  // 자격 게이트 — 예약·문의·투어 등 비점유 상태는 구간을 만들지 않는다(박의균 신고, 클래스 봉합).
  if (!STAY_ELIGIBLE_STATUSES.includes(lease.status)) return
  const open = await openStayOf(db, leaseTermId)
  if (open?.roomId === lease.roomId) return
  if (open) {
    await recordRoomChange(db, leaseTermId, open.roomId, lease.roomId, null)
    return
  }
  await db.roomStay.create({
    data: {
      leaseTermId,
      roomId: lease.roomId,
      propertyId: lease.propertyId,
      startDate: lease.moveInDate ?? stayDate(),
      endDate: null,
    },
  })
}

/**
 * ② 호실 변경 기록 — 열린 구간을 at(기본 오늘 KST)으로 마감하고 새 호실의 열린 구간을 연다.
 * 열린 구간이 없으면 새 구간만 생긴다(드리프트 자가 치유). 새 호실이 없으면(호실 해제) 마감만 한다.
 * 같은 저장 흐름의 적용취소는 역방향으로 다시 부르면 된다 — 이력 2건이 남지만 그대로 사실이다.
 */
export async function recordRoomChange(
  db: RoomStayDb,
  leaseTermId: string,
  fromRoomId: string | null,
  toRoomId: string | null,
  at?: Date | string | null,
): Promise<void> {
  if (fromRoomId === toRoomId) return   // 변경 없음
  const open = await openStayOf(db, leaseTermId)
  // 이중 제출 가드 — 이미 새 호실의 열린 구간이면 다시 쪼개지 않는다.
  if (toRoomId && open?.roomId === toRoomId) return
  const when = stayDate(at)
  await db.roomStay.updateMany({ where: { leaseTermId, endDate: null }, data: { endDate: when } })
  if (!toRoomId) return
  const lease = await db.leaseTerm.findUnique({ where: { id: leaseTermId }, select: { propertyId: true } })
  if (!lease) return
  await db.roomStay.create({
    data: { leaseTermId, roomId: toRoomId, propertyId: lease.propertyId, startDate: when, endDate: null },
  })
}

/**
 * ③ 퇴실 마감 — 종료 상태(CHECKED_OUT·CANCELLED) 전환 시 열린 구간을 마감한다.
 * at 을 안 주면 계약의 moveOutDate, 그것도 없으면 오늘(KST). 계약 저장 '뒤에' 불러야 최신 퇴실일을 읽는다.
 */
export async function closeStay(db: RoomStayDb, leaseTermId: string, at?: Date | string | null): Promise<void> {
  let when = at ?? null
  if (!when) {
    const lease = await db.leaseTerm.findUnique({ where: { id: leaseTermId }, select: { moveOutDate: true } })
    when = lease?.moveOutDate ?? null
  }
  await db.roomStay.updateMany({ where: { leaseTermId, endDate: null }, data: { endDate: stayDate(when) } })
}

/** 퇴실 취소(종료 → 활성 복귀) — 가장 최근 구간을 다시 연다. 구간이 없으면 아무것도 하지 않는다. */
export async function reopenStay(db: RoomStayDb, leaseTermId: string): Promise<void> {
  const last = await db.roomStay.findFirst({
    where: { leaseTermId },
    orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  })
  if (!last) return
  await db.roomStay.update({ where: { id: last.id }, data: { endDate: null } })
}

/**
 * 저장 경로 공용 — 호실·상태 변경을 위 세 연산으로 옮긴다(관련 변화가 없으면 DB 를 건드리지 않는다).
 * 종료 전환은 마감이 최종 사실이라 호실 변경보다 우선한다. 계약 저장 뒤에 호출한다.
 */
export async function syncRoomStayOnSave(
  db: RoomStayDb,
  leaseTermId: string,
  p: {
    prevRoomId: string | null
    nextRoomId: string | null
    prevStatus: string
    nextStatus: string
    at?: Date | string | null   // 이사·퇴실 시점(없으면 퇴실일 또는 오늘 KST)
  },
): Promise<void> {
  const prevTerminal = isStayTerminalStatus(p.prevStatus)
  const nextTerminal = isStayTerminalStatus(p.nextStatus)
  if (nextTerminal) {
    if (!prevTerminal) { await closeStay(db, leaseTermId, p.at); return }
    // 종료 상태 유지 중 저장 — 퇴실일 사후 정정이 이력 종료일에도 따라가게 마지막 구간을 갱신한다.
    const lease = await db.leaseTerm.findUnique({ where: { id: leaseTermId }, select: { moveOutDate: true } })
    if (!lease?.moveOutDate) return
    const last = await db.roomStay.findFirst({
      where: { leaseTermId, endDate: { not: null } },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, endDate: true },
    })
    if (last && last.endDate?.getTime() !== lease.moveOutDate.getTime()) {
      await db.roomStay.update({ where: { id: last.id }, data: { endDate: lease.moveOutDate } })
    }
    return
  }
  // 자격 게이트 — 종료도 자격도 아닌 상태(예약으로 되돌리기, 입실 취소 undo 등)면 미점유 열린 구간을 지운다.
  if (!STAY_ELIGIBLE_STATUSES.includes(p.nextStatus)) {
    await db.roomStay.deleteMany({ where: { leaseTermId, endDate: null } })
    return
  }
  if (prevTerminal) await reopenStay(db, leaseTermId)
  if (p.prevRoomId !== p.nextRoomId) {
    await recordRoomChange(db, leaseTermId, p.prevRoomId, p.nextRoomId, p.at)
  }
  // 자격 상태로의 저장은 열린 구간을 보장 — 게이트 도입으로 예약 단계엔 구간이 없으므로,
  // 폼 경로의 예약 → 입실 전환도 여기서 구간이 생긴다(멱등, 같은 호실이면 no-op).
  await ensureOpenStay(db, leaseTermId)
}
