// 거주 구간(RoomStay) 이력 기록 헬퍼 — lease 의 호실·종료 상태가 바뀌는 서버 경로에서 '추가 write' 로 부른다.
// 현재 방의 진실은 계속 LeaseTerm.roomId 이고 여기 기록은 파생 이력이다(아키텍트 설계 2026-07-28).
// 세 연산(열린 구간 생성·호실 변경·퇴실 마감)과 종료 복귀용 재개방만 두고, 호출부의 기존 분기는 건드리지 않는다.
// 드리프트(열린 구간 없음·중복·roomId 불일치)는 scripts/check-room-stay-drift.mjs 가 읽기 전용으로 감지한다.

import { parseRoomSchedule, scheduledSegmentOn } from './roomSchedule'
import type { PrismaDb } from '@/lib/prisma'
import { kstYmdStr } from '@/lib/kstDate'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'
import { isSameDayTurnover, occupancyOverlaps } from '@/lib/roomAssignment'

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
    select: {
      roomId: true, propertyId: true, moveInDate: true, status: true,
      // 호실 일정 — 있으면 '오늘의 방'이 계약 호실이 아닐 수 있다.
      roomSchedule: true,
    },
  })
  if (!lease?.roomId) return
  // 자격 게이트 — 예약·문의·투어 등 비점유 상태는 구간을 만들지 않는다(박의균 신고, 클래스 봉합).
  if (!STAY_ELIGIBLE_STATUSES.includes(lease.status)) return

  // **오늘 있어야 할 방을 일정에서 읽는다.** 종전에는 계약 호실 하나가 진실이라, 임시 방에 있는
  // 사람을 아무 저장에서나 계약 호실로 강제 이사시켰다. 그것을 막으려고 예외 게이트를 따로
  // 세웠는데, 일정을 두면 그 예외 자체가 없어진다 — 자가 치유가 옳은 답을 알기 때문이다.
  // 일정이 없는 계약(대다수)은 계약 호실이 곧 오늘의 방이라 종전과 완전히 같다.
  const today = kstYmdStr()
  const seg = scheduledSegmentOn(parseRoomSchedule(lease.roomSchedule), today)
  const targetRoomId = seg?.roomId ?? lease.roomId

  const open = await openStayOf(db, leaseTermId)
  if (open?.roomId === targetRoomId) return
  if (open) {
    // 이사일은 '오늘'이 아니라 **그 구간이 시작된 날**이다. 며칠 뒤에 앱을 열어도 구간이
    // 일정대로 나뉘어야 이력이 사실과 같아진다(9/1에 옮기기로 한 것을 9/3에 열었다고 9/3으로
    // 적으면 이틀이 엉뚱한 방에 붙는다).
    await recordRoomChange(db, leaseTermId, open.roomId, targetRoomId, seg?.from ?? null)
    return
  }
  // 일정이 있으면 **오늘까지의 구간을 다 만든다.** 미리 잡아 둔 일정을 며칠 늦게 처리해도
  // 지나간 방들이 이력에서 빠지면 안 된다(하루 402호에서 잔 사실이 통째로 사라진다).
  const schedule = parseRoomSchedule(lease.roomSchedule)
  const past = schedule.filter(e => e.from <= today)
  if (past.length > 0) {
    for (const e of past) {
      await db.roomStay.create({
        data: {
          leaseTermId,
          roomId: e.roomId,
          propertyId: lease.propertyId,
          startDate: stayDate(e.from),
          // 마지막(오늘의) 구간만 열어 둔다. 지나간 구간은 다음 방으로 넘어간 날 마감된다.
          endDate: e === past[past.length - 1] ? null : stayDate(e.to as string),
        },
      })
    }
    return
  }
  await db.roomStay.create({
    data: {
      leaseTermId,
      roomId: targetRoomId,
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

// 'YYYY-MM-DD' 비교용 — @db.Date 는 UTC 자정 저장이라 toISOString 슬라이스가 정확(actions.ts ymdOf 관례).
function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * 입주일 정정 전파 — '입주 구간'의 startDate 를 새 입주일로 맞춘다(507호 신헌석 사건, 2026-08-07).
 * 구간 의미는 둘이다. 그 lease 의 최초 구간 = 입주 구간(startDate 가 moveInDate),
 * 이후 구간 = 이동 구간(startDate 가 이동일 — 입주일을 절대 따라가면 안 된다).
 */
async function syncMoveInStart(
  db: RoomStayDb,
  leaseTermId: string,
  prevMoveIn: Date | null,
  nextMoveIn: Date | null,
): Promise<void> {
  if (!prevMoveIn || !nextMoveIn) return                    // 입주일 신설·삭제는 전파 대상이 아니다
  if (ymdOf(prevMoveIn) === ymdOf(nextMoveIn)) return       // 날짜 변화 없음
  const open = await db.roomStay.findFirst({
    where: { leaseTermId, endDate: null },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, startDate: true },
  })
  if (!open?.startDate) return
  // 1차 가드 — 열린 구간의 시작이 구 입주일과 다르면 이동일 등 따로 정해진 날짜라 건드리지 않는다.
  if (ymdOf(open.startDate) !== ymdOf(prevMoveIn)) return
  // 2차 가드 — 이 구간보다 이른 구간이 있으면 열린 구간은 이동 구간이다(이사 이력 존재).
  // 이동일이 우연히 구 입주일과 같아 1차 가드를 통과하는 경계까지 여기서 배제한다.
  const earlier = await db.roomStay.findFirst({
    where: { leaseTermId, id: { not: open.id }, startDate: { lt: open.startDate } },
    select: { id: true },
  })
  if (earlier) return
  await db.roomStay.update({ where: { id: open.id }, data: { startDate: nextMoveIn } })
}

/**
 * 이사일 검증 — 이 하루가 옛 구간의 끝이자 새 구간의 시작이 된다(recordRoomChange 가 같은 값을
 * 두 칸에 쓴다). 그래서 틀린 날짜 하나가 곧바로 사고가 된다. 이른 날짜는 시작보다 끝이 앞선
 * 역전 구간을 만들고, 늦은 날짜는 옛 방에 이미 들어온 다음 사람과 없던 겹침을 만든다. 둘 다
 * 캘린더에서 빨간 충돌 줄로 올라오고, 그때 운영자는 방금 자기가 만든 것인 줄 모른다.
 *
 * 정본을 여기 두는 이유는 recordRoomChange 가 at 을 아무 검증 없이 그대로 쓰기 때문이다.
 * 호출부가 각자 검사하면 검사를 안 하는 호출부가 반드시 생긴다.
 *
 * 어긋나면 사람이 읽을 문장을, 괜찮으면 null 을 돌려준다.
 */
export async function validateMoveDate(
  db: RoomStayDb,
  leaseTermId: string,
  p: {
    at: string                  // 'YYYY-MM-DD'
    fromRoomId: string
    today: string               // KST 오늘
    /** 이 저장으로 확정될 값 — DB 의 현재 값이 아니다. 호실과 날짜를 한 번에 바꾸는 저장이 있다. */
    moveInDate: string | null
    moveOutDate: string | null
  },
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.at)) return '이사일 형식이 올바르지 않습니다.'
  // 미래 이사는 못 받는다 — RoomStay 는 실제 점유 이력이고, 감지망(check-room-stay-drift ⑥)이
  // 미래에 시작하는 열린 구간을 사고로 부른다. 앞으로의 이사는 예약이 받는 자리다.
  if (p.at > p.today) return '이사일은 오늘보다 뒤로 잡을 수 없습니다.'

  // 옛 구간의 시작보다 이를 수 없다. 열린 구간이 없으면(드리프트) 이 저장으로 확정될 입주일로 본다.
  const open = await db.roomStay.findFirst({
    where: { leaseTermId, endDate: null },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: { startDate: true },
  })
  const start = open?.startDate ? ymdOf(open.startDate) : p.moveInDate
  if (start && p.at < start) return `이사일은 지금 방에 들어온 날(${start})보다 이를 수 없습니다.`
  if (p.moveOutDate && p.at > p.moveOutDate) return `이사일은 퇴실일(${p.moveOutDate})보다 뒤일 수 없습니다.`

  // 옛 방의 다음 사람 — 이사일을 늦게 잡으면 이미 들어온 사람과 겹친다. 호실 선택은 '지금'
  // 빈 방만 고르게 하므로 새 방 쪽은 이미 막혀 있지만, 옛 방을 보는 가드는 어디에도 없었다.
  const others = await db.leaseTerm.findMany({
    where: { roomId: p.fromRoomId, id: { not: leaseTermId }, status: { in: OCCUPYING_STATUSES } },
    select: { moveInDate: true, moveOutDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
  })
  for (const o of others) {
    const inYmd = o.moveInDate ? ymdOf(o.moveInDate) : null
    const outYmd = o.moveOutDate ? ymdOf(o.moveOutDate) : o.expectedMoveOut ? ymdOf(o.expectedMoveOut) : null
    if (!occupancyOverlaps({ moveIn: start, moveOut: p.at }, { moveIn: inYmd, moveOut: outYmd })) continue
    if (isSameDayTurnover({ moveIn: start, moveOut: p.at }, { moveIn: inYmd, moveOut: outYmd })) continue
    return `이사일을 ${p.at} 로 두면 ${o.tenant.name}님 체류와 겹칩니다. 실제로 옮긴 날을 확인해 주세요.`
  }
  return null
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
    prevMoveInDate?: Date | null   // 입주일 정정 전파용(둘 다 주는 호출부에서만 동작)
    nextMoveInDate?: Date | null
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
  // 입주일 정정 전파는 recordRoomChange 보다 먼저다 — 호실과 입주일을 같이 바꾸면 입주 구간이
  // 아직 열려 있는 이 시점에 날짜를 맞춰야 한다. 순서를 뒤집으면 입주 구간이 이미 마감돼
  // 열린 구간이 이동 구간이 되고, 2차 가드에 걸려 입주일 정정이 통째로 유실된다.
  await syncMoveInStart(db, leaseTermId, p.prevMoveInDate ?? null, p.nextMoveInDate ?? null)
  if (p.prevRoomId !== p.nextRoomId) {
    await recordRoomChange(db, leaseTermId, p.prevRoomId, p.nextRoomId, p.at)
  }
  // 자격 상태로의 저장은 열린 구간을 보장 — 게이트 도입으로 예약 단계엔 구간이 없으므로,
  // 폼 경로의 예약 → 입실 전환도 여기서 구간이 생긴다(멱등, 같은 호실이면 no-op).
  await ensureOpenStay(db, leaseTermId)
}
