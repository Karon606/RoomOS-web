// 방 이용료(거주 기본 이용료·비거주 이용료)를 바꿀 때 그 방 계약의 이용료(rentAmount)를 함께 옮기는 정본. 쓰기 경로는 모두 여기를 지난다.
//
// 왜(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 호실 수정(updateRoom)은 기본 이용료가 바뀌면 그 방 거주 계약을 협의가까지
// 확인 없이 전부 덮었고, 비거주 이용료가 바뀌면 비거주 계약을 아예 안 건드렸다. 602호 비거주 이용료를 15만 원으로 정해도 3만 원 계약이
// 그대로 남은 까닭이다. 일괄 편집만 '기준가 그대로 쓰던 계약만 따라간다' 는 맞는 문법을 갖고 있었다. 그래서 갈래를 셋으로 정한다.
//   · followers(기본): 옛 기준가를 그대로 쓰던 계약만 새 기준가로 옮긴다. 옛 기준가가 없던 축(비거주 이용료가 비었던 방)은 따라갈 계약이 없다.
//   · leaseIds: 운영자가 확인창에서 고른 계약만 옮긴다(협의가·기준가 없던 계약). expect(계약별 updatedAt)가 있으면 조건부로 쓰고,
//     하나라도 0건이면 RoomRentSyncStale 을 던져 부르는 쪽 트랜잭션 전체(방 저장 포함)를 되감는다. 남의 영업장·다른 방·다른 축·단기 계약 id 도 같다.
//   · all: 축의 계약 전부(협의가 포함). 예약 가격변경 도래·즉시 적용 전용이다(2026-06-29 운영자 결정, 동작 불변).
// 이미 청구된 달은 손대지 않는다. 그 달 수납 기록의 expectedAmount(락)가 청구액을 쥐고 있어(lib/billing billForLeaseMonth ②) 락 없는 달부터
// 새 금액으로 청구된다. 여기서는 락을 되쓰지 않는다.
import type { LeaseStatus } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'

export type RentAxis = 'resident' | 'nonResident'
export const RENT_AXIS_STATUSES: Record<RentAxis, LeaseStatus[]> = {
  resident: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'],
  nonResident: ['NON_RESIDENT'],
}

export const ROOM_RENT_SYNC_STALE = '창을 연 뒤 다른 곳에서 계약 이용료가 바뀌었습니다. 창을 닫고 다시 열어 주세요.'
export class RoomRentSyncStale extends Error {
  constructor() { super(ROOM_RENT_SYNC_STALE); this.name = 'RoomRentSyncStale' }
}

// 전역 클라이언트와 트랜잭션 클라이언트 둘 다 받는다(lib/roomStay 와 같은 모양).
type Db = Pick<PrismaDb, 'leaseTerm'>

export type RentSyncApplied = { id: string; from: number; to: number }
export type RentSyncResult = { applied: RentSyncApplied[]; skipped: { id: string; rentAmount: number }[] }

export async function syncLeaseRentForRoom(db: Db, p: {
  propertyId: string
  roomId: string
  axis: RentAxis
  /** 바꾸기 전 방 기준가. 비거주 이용료가 비어 있었으면 null(따라갈 계약 없음). */
  prevRent: number | null
  nextRent: number
  leaseIds?: string[]
  /** 계약 id 별 updatedAt(ISO). 확인창을 띄운 뒤 그 계약이 바뀌었으면 STALE. */
  expect?: Record<string, string>
  all?: boolean
  /** followers 에서 단기 계약을 뺀다(호실 수정). 일괄 편집은 종전 동작대로 넣는다. */
  excludeShortTerm?: boolean
}): Promise<RentSyncResult> {
  const statuses = RENT_AXIS_STATUSES[p.axis]
  const scope = { roomId: p.roomId, propertyId: p.propertyId, status: { in: statuses } }

  if (p.all) {
    const leases = await db.leaseTerm.findMany({ where: scope, select: { id: true, rentAmount: true } })
    if (leases.length > 0) await db.leaseTerm.updateMany({ where: scope, data: { rentAmount: p.nextRent } })
    return { applied: leases.map(l => ({ id: l.id, from: l.rentAmount, to: p.nextRent })), skipped: [] }
  }

  // 0원 이하는 '칸을 비운 저장' 이다. 기준가를 지운 것이지 계약을 0원으로 하자는 뜻이 아니라 계약은 그대로 둔다(독립 검수 B1).
  if (p.nextRent <= 0) return { applied: [], skipped: [] }

  if (p.leaseIds) {
    const applied: RentSyncApplied[] = []
    for (const id of [...new Set(p.leaseIds)]) {
      const at = p.expect?.[id]
      const where = { ...scope, id, isShortTerm: false, ...(at ? { updatedAt: new Date(at) } : {}) }
      const cur = await db.leaseTerm.findFirst({ where, select: { rentAmount: true } })
      if (!cur) throw new RoomRentSyncStale()
      if (cur.rentAmount === p.nextRent) continue
      const r = await db.leaseTerm.updateMany({ where: { ...where, rentAmount: cur.rentAmount }, data: { rentAmount: p.nextRent } })
      if (r.count !== 1) throw new RoomRentSyncStale()
      applied.push({ id, from: cur.rentAmount, to: p.nextRent })
    }
    return { applied, skipped: [] }
  }

  // followers. 옛 기준가 그대로인 계약만. 나머지(협의가)는 skipped 로 알린다(일괄 편집의 '덮어쓰지 않았습니다' 건수).
  const leases = await db.leaseTerm.findMany({ where: { ...scope, ...(p.excludeShortTerm ? { isShortTerm: false } : {}) }, select: { id: true, rentAmount: true } })
  const followers = p.prevRent == null ? [] : leases.filter(l => l.rentAmount === p.prevRent)
  const skipped = leases.filter(l => !followers.includes(l)).map(l => ({ id: l.id, rentAmount: l.rentAmount }))
  if (p.prevRent == null || p.prevRent === p.nextRent || followers.length === 0) return { applied: [], skipped }
  const r = await db.leaseTerm.updateMany({ where: { ...scope, ...(p.excludeShortTerm ? { isShortTerm: false } : {}), id: { in: followers.map(l => l.id) }, rentAmount: p.prevRent }, data: { rentAmount: p.nextRent } })
  // 읽은 뒤 바뀐 계약은 조건에 안 걸려 그대로다. 실제로 옮긴 수만큼만 알린다(드문 경합, 그 계약은 손대지 않았다).
  const moved = r.count === followers.length ? followers : (await db.leaseTerm.findMany({ where: { id: { in: followers.map(l => l.id) }, rentAmount: p.nextRent }, select: { id: true, rentAmount: true } }))
  return { applied: moved.map(l => ({ id: l.id, from: p.prevRent as number, to: p.nextRent })), skipped }
}

/** 기록(수납 기록)이 없는 지난 달 수. firstMonth 부터 이번 달 앞까지 중 recorded 에 없는 달. 확인창이 '새 금액으로 계산되는 지난 달' 을 미리 말한다. */
export function unrecordedPastMonths(firstMonth: string | null, curMonth: string, recorded: Set<string>): number {
  if (!firstMonth || firstMonth >= curMonth) return 0
  let [y, m] = firstMonth.split('-').map(Number)
  let n = 0
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (key >= curMonth) break
    if (!recorded.has(key)) n++
    m++; if (m > 12) { m = 1; y++ }
  }
  return n
}
