// 방 이용료 저장의 계약 동기화 적용취소 토큰 모양 정본(순수). 서명·적용은 room-manage 액션이 한다(lib/roomRecordEditUndo 와 같은 문법).
//
// 왜(2026-10-27 운영자 승인, 홍은주 602호 사건). 방 이용료를 저장하며 계약 이용료까지 옮긴 것을 토스트 [적용취소] 한 번에 되돌린다.
// 방 값(기본·비거주 이용료)과 계약 금액을 **쓰기 전·쓴 직후** 로 함께 쥐고, 지금이 쓴 직후 그대로일 때만 전부 되돌린다(전부 아니면 안 함).
// 그사이 다른 화면이 방 이용료나 그 계약 이용료를 바꿨으면 덮지 않는다. 토큰은 화면을 거쳐 돌아오므로 서버가 서명으로 위조를 막고
// 여기 parse 가 모양을 다시 본다.

export const ROOM_RENT_SYNC_UNDO_DOMAIN = 'room-rent-sync-v1'

export type RoomRentSnap = { baseRent: number; nonResidentRent: number | null }
export type RoomRentSyncUndo = {
  v: 1
  roomId: string
  room: { before: RoomRentSnap; after: RoomRentSnap }
  leases: { id: string; before: number; after: number }[]
  /** 쓴 시각(ISO). 그 뒤 그 계약에 수납 기록(락)이 새로 생겼으면 되돌리지 않는다(새 금액으로 이미 청구가 잠겼다, 독립 검수 권고 3). */
  at: string
  sig?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function canonicalRoomRentSyncUndo(u: Omit<RoomRentSyncUndo, 'sig'>): string {
  const snap = (s: RoomRentSnap) => ({ baseRent: s.baseRent, nonResidentRent: s.nonResidentRent })
  return JSON.stringify({
    v: 1, roomId: u.roomId, at: u.at,
    room: { before: snap(u.room.before), after: snap(u.room.after) },
    leases: [...u.leases].sort((a, b) => a.id.localeCompare(b.id)).map(l => ({ id: l.id, before: l.before, after: l.after })),
  })
}

function parseSnap(raw: unknown): RoomRentSnap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).length !== 2 || !isInt(o.baseRent) || !(o.nonResidentRent === null || isInt(o.nonResidentRent))) return null
  return { baseRent: o.baseRent, nonResidentRent: o.nonResidentRent as number | null }
}

/** 화면에서 돌아온 토큰의 모양 검사. 어긋나면 null(아무것도 안 고친다). 계약이 하나도 없으면 되돌릴 것이 없어 null. */
export function parseRoomRentSyncUndo(raw: unknown): RoomRentSyncUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || typeof u.roomId !== 'string' || !UUID.test(u.roomId)) return null
  if (typeof u.at !== 'string' || Number.isNaN(new Date(u.at).getTime())) return null
  const r = u.room as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return null
  const before = parseSnap(r.before), after = parseSnap(r.after)
  if (!before || !after) return null
  if (!Array.isArray(u.leases) || u.leases.length === 0 || u.leases.length > 200) return null
  const leases: RoomRentSyncUndo['leases'] = []
  const seen = new Set<string>()
  for (const x of u.leases) {
    if (!x || typeof x !== 'object') return null
    const l = x as Record<string, unknown>
    if (typeof l.id !== 'string' || !UUID.test(l.id) || seen.has(l.id) || !isInt(l.before) || !isInt(l.after)) return null
    seen.add(l.id)
    leases.push({ id: l.id, before: l.before, after: l.after })
  }
  return { v: 1, roomId: u.roomId, at: u.at, room: { before, after }, leases, ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

export const ROOM_RENT_SYNC_UNDO_INVALID = '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.'
export const ROOM_RENT_SYNC_UNDO_CONFLICT = '그사이 이 호실 이용료나 계약 이용료가 다시 바뀌어 되돌리지 않았습니다. 지금 금액을 확인해 주세요.'
export const ROOM_RENT_SYNC_UNDO_BILLED = '그사이 이 계약에 새 금액으로 수납 기록이 생겨 되돌리지 않았습니다. 수납 내역에서 지금 상태를 확인해 주세요.'
