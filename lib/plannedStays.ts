// 남이 임시 거처로 잡아 둔 구간을 방별로 읽는 조회 정본 — 방 배정 가드 네 문이 같이 쓴다.

import prisma from '@/lib/prisma'
import { Prisma, type LeaseStatus } from '@prisma/client'
import { RESIDENT_STATUSES, type PlannedStaySpan } from '@/lib/roomAssignment'
import { parseRoomSchedule, hasRoomSchedule } from '@/lib/roomSchedule'

/**
 * 그 방을 **임시 거처로** 잡아 둔 다른 계약의 구간 — 방 배정 가드가 읽어 넘기는 재료.
 *
 * 계획은 계약 안의 Json 이라 방으로 역조회가 안 된다. 그래서 일정을 가진 거주계 계약을
 * 통째로 끌어와 JS 에서 편다 — 일정을 쓰는 계약은 소수라 싸다.
 *
 * **마지막 줄은 담지 않는다.** 그 줄의 방은 그 계약의 roomId 라 기존 가드가 이미 본다.
 * 여기까지 담으면 같은 사실에 판정이 두 벌 선다(lib/roomAssignment PlannedStaySpan 주석).
 *
 * 조회를 여기 한 벌로 둔 이유는 문이 넷이라서다(입주자 등록·수정, 가져오기 미리보기·적용).
 * 세 벌로 흩어 두면 언젠가 한 벌만 조건이 달라진다.
 */
export async function plannedStaysInRoom(
  propertyId: string, roomId: string, exceptLeaseId: string | null,
): Promise<PlannedStaySpan[]> {
  const leases = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: RESIDENT_STATUSES as LeaseStatus[] },
      // 일정 해제는 DbNull 한 벌이다(clearStaleRoomSchedule·clearRoomSchedulePlan).
      // JsonNull 로 쓰는 경로가 생기면 이 필터가 샌다 — 해제는 DbNull 로만 쓴다.
      roomSchedule: { not: Prisma.DbNull },
      ...(exceptLeaseId ? { id: { not: exceptLeaseId } } : {}),
    },
    select: { roomSchedule: true, tenant: { select: { name: true } } },
  })
  const out: PlannedStaySpan[] = []
  for (const l of leases) {
    const plan = parseRoomSchedule(l.roomSchedule)
    if (!hasRoomSchedule(plan)) continue
    for (const e of plan) {
      if (e.to !== null && e.roomId === roomId) out.push({ tenantName: l.tenant.name, from: e.from, to: e.to })
    }
  }
  return out
}
