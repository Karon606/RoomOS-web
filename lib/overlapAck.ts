// 확인된 겹침(LeaseOverlapAck)의 읽기·기록·해제 — 판정은 lib/roomAssignment 정본을 부른다.
//
// 이 파일이 하는 일은 DB 왕복뿐이다. '무엇이 겹침인가'(occupancyOverlapSpan), '무엇이 당일
// 회전인가'(isSameDayTurnover), '이 확인이 아직 유효한가'(findOverlapAck)는 전부 저쪽 한 벌이다.
// 여기에 판정을 한 줄이라도 베껴 두면 화면·감지망·저장이 서로 다른 답을 말하기 시작한다.
//
// 기록 경로는 셋이다(설계 확정 2026-08-19).
//   ① 예약 확정 확인창 승인   — tenants/actions 의 allowRoomOverlap 표식
//   ② 퇴실일 연장 확인창 승인 — 같은 표식
//   ③ 캘린더 충돌 요약 [겹침 확인] — room-manage/actions 의 acknowledgeOverlap
// ①②는 한 함수(recordOverlapAcksForLease)로 받는다 — 두 확인창이 같은 폼의 같은 표식을 싣고,
// 승인 뒤 실제로 남은 겹침이 무엇인지는 저장이 끝나야 알 수 있기 때문이다.

import prisma from '@/lib/prisma'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'
import { findOverlapAck, isSameDayTurnover, occupancyOverlapSpan, type OverlapAckSpan } from '@/lib/roomAssignment'

/** 캘린더·감지 판정이 읽는 확인 한 줄. 구간은 확인 시점 스냅샷이다. */
export type OverlapAckRow = OverlapAckSpan & {
  id: string
  roomId: string
  createdAt: Date
}

const ymd = (d: Date | null): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null)

/** 그 영업장의 유효한 확인 전부(해제분 제외). 캘린더 조립이 이 목록을 그대로 받는다. */
export async function loadOverlapAcks(propertyId: string): Promise<OverlapAckRow[]> {
  const rows = await prisma.leaseOverlapAck.findMany({
    where: { propertyId, deletedAt: null },
    select: {
      id: true, roomId: true, createdAt: true,
      frontLeaseTermId: true, backLeaseTermId: true, overlapFrom: true, overlapTo: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows
}

/** 확인 판정에 필요한 계약 한 줄 — 날짜는 감지망 축 ②와 같은 칸(입주일·퇴실 예정일)을 쓴다. */
type AckLease = { id: string; roomId: string | null; propertyId: string; status: string; moveInDate: Date | null; expectedMoveOut: Date | null }

const leaseSelect = { id: true, roomId: true, propertyId: true, status: true, moveInDate: true, expectedMoveOut: true } as const

const spanOf = (l: AckLease) => ({ moveIn: ymd(l.moveInDate), moveOut: ymd(l.expectedMoveOut) })

/**
 * 두 계약 사이에 지금 기록해야 할 확인이 있는가 — 있으면 그 구간, 없으면 null.
 *
 * 기록하지 않는 경우가 넷이다. 겹치지 않을 때, 당일 회전일 때(층 1 — 정상이라 확인 대상이 아니다),
 * 구간이 열려 있을 때(무기한은 스냅샷을 뜰 수 없다 — 그건 '퇴실일을 넣으라'는 다른 처방이다),
 * 그리고 이미 유효한 확인이 그 구간을 덮고 있을 때다.
 */
function pendingAckSpan(a: AckLease, b: AckLease, existing: OverlapAckSpan[]): { from: string; to: string } | null {
  const sa = spanOf(a)
  const sb = spanOf(b)
  if (isSameDayTurnover(sa, sb)) return null
  const span = occupancyOverlapSpan(sa, sb)
  if (!span?.from || !span.to) return null
  if (findOverlapAck(existing, a.id, b.id, span)) return null
  return { from: span.from, to: span.to }
}

/** 앞은 입주일이 이른 쪽. 사람이 행을 읽을 때의 순서이고, 판정은 순서를 묻지 않는다. */
function frontBack(a: AckLease, b: AckLease): [AckLease, AckLease] {
  const ai = ymd(a.moveInDate)
  const bi = ymd(b.moveInDate)
  if (ai && bi) return ai <= bi ? [a, b] : [b, a]
  return ai ? [b, a] : [a, b]   // 입주일 없는 쪽이 이미 시작된 점유라 앞이다
}

/**
 * 저장이 확인창을 지나온 뒤 — 그 계약이 실제로 만든 겹침을 확인으로 적는다.
 *
 * 화면이 물은 것은 특정 한 건이지만, 저장 결과 남은 겹침이 그것뿐이라는 보장은 없다(같은 저장이
 * 앞뒤 두 계약과 동시에 겹칠 수 있다). 그래서 화면이 지목한 상대를 받아 적지 않고, 저장이 끝난
 * 상태에서 그 방을 다시 읽어 **지금 실재하는 겹침**을 적는다 — 확인의 근거는 폼이 아니라 사실이다.
 *
 * 실패해도 저장을 되돌리지 않는다. 확인 기록이 없으면 감지망이 그 겹침을 부를 뿐이고,
 * 그건 안전한 쪽의 실패다. 저장을 통째로 굴리는 것이 더 나쁘다.
 */
export async function recordOverlapAcksForLease(leaseTermId: string, ackedById: string | null): Promise<number> {
  const self = await prisma.leaseTerm.findUnique({ where: { id: leaseTermId }, select: leaseSelect })
  if (!self?.roomId || !(OCCUPYING_STATUSES as string[]).includes(self.status)) return 0

  const others = await prisma.leaseTerm.findMany({
    where: { roomId: self.roomId, id: { not: leaseTermId }, status: { in: OCCUPYING_STATUSES } },
    select: leaseSelect,
  })
  if (others.length === 0) return 0

  const existing = await prisma.leaseOverlapAck.findMany({
    where: { roomId: self.roomId, deletedAt: null },
    select: { frontLeaseTermId: true, backLeaseTermId: true, overlapFrom: true, overlapTo: true },
  })

  const rows = others.flatMap(o => {
    const span = pendingAckSpan(self, o, existing)
    if (!span) return []
    const [front, back] = frontBack(self, o)
    return [{
      propertyId: self.propertyId,
      roomId: self.roomId!,
      frontLeaseTermId: front.id,
      backLeaseTermId: back.id,
      overlapFrom: span.from,
      overlapTo: span.to,
      ackedById,
    }]
  })
  if (rows.length === 0) return 0
  await prisma.leaseOverlapAck.createMany({ data: rows })
  return rows.length
}

/**
 * 캘린더 [겹침 확인] — 두 계약을 지목해 확인 한 줄을 남긴다.
 *
 * 구간은 화면이 보낸 날짜를 믿지 않고 서버가 다시 읽어 계산한다. 화면이 본 트랙과 지금 DB 가
 * 다를 수 있고(다른 창에서 날짜를 옮겼다), 그때 확인해야 할 것은 화면이 그린 어제가 아니라 지금이다.
 */
export async function createOverlapAck(input: {
  propertyId: string
  frontLeaseTermId: string
  backLeaseTermId: string
  ackedById: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const leases = await prisma.leaseTerm.findMany({
    where: { id: { in: [input.frontLeaseTermId, input.backLeaseTermId] }, propertyId: input.propertyId },
    select: leaseSelect,
  })
  const a = leases.find(l => l.id === input.frontLeaseTermId)
  const b = leases.find(l => l.id === input.backLeaseTermId)
  if (!a || !b || a.id === b.id) return { ok: false, error: '확인할 계약을 찾을 수 없습니다.' }
  if (!a.roomId || a.roomId !== b.roomId) return { ok: false, error: '두 계약이 같은 호실이 아닙니다.' }
  if (!(OCCUPYING_STATUSES as string[]).includes(a.status) || !(OCCUPYING_STATUSES as string[]).includes(b.status)) {
    return { ok: false, error: '방을 잡고 있는 계약끼리만 확인할 수 있습니다.' }
  }

  const existing = await prisma.leaseOverlapAck.findMany({
    where: { roomId: a.roomId, deletedAt: null },
    select: { frontLeaseTermId: true, backLeaseTermId: true, overlapFrom: true, overlapTo: true },
  })
  const span = pendingAckSpan(a, b, existing)
  if (!span) return { ok: false, error: '지금은 확인할 겹침이 없습니다. 화면을 새로고침해 주세요.' }

  const [front, back] = frontBack(a, b)
  await prisma.leaseOverlapAck.create({
    data: {
      propertyId: input.propertyId,
      roomId: a.roomId,
      frontLeaseTermId: front.id,
      backLeaseTermId: back.id,
      overlapFrom: span.from,
      overlapTo: span.to,
      ackedById: input.ackedById,
    },
  })
  return { ok: true }
}

/** 확인 해제 — 소프트삭제다. 다시 확인하면 그때의 구간으로 새 행이 쌓인다. */
export async function softDeleteOverlapAck(id: string, propertyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const hit = await prisma.leaseOverlapAck.updateMany({
    where: { id, propertyId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return hit.count > 0 ? { ok: true } : { ok: false, error: '이미 해제된 확인입니다.' }
}
