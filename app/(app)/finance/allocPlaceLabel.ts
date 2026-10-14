// 재무 지출 목록의 방별 분배 묶음 자리 라벨(방 · 공용부 · 미배정) 순수층. 진리표는 scripts/test-asset-disposal ⑭.
//
// 왜 갈랐나. FinanceClient 는 'use client' 라 이 안의 함수에 진리표가 못 붙는다. 이 두 함수는 계산만
// 하므로 밖으로 빼고 화면은 부르기만 한다(dayExpenseTotal 과 같은 배치).
//
// 왜 고쳤나(신고 3e861137 후속, 2026-10-10). 종전 라벨은 방 축만 알아서 공용부(StorageLocation)에
// 배정한 행을 '미배정'으로 적었다. 고압호스 60cm 9/11 묶음은 5층 공용 화장실에 1개가 가 있는데
// 재무에서는 `미배정` 칩으로 읽혀 그 1개의 행방이 흐려졌다. 순서는 방, 공용부, 진짜 미배정이고
// '미배정'은 방도 공용부도 없는 행에만 붙는다. 공용부 이름은 표기 경로(pathName)다. 비품 화면과
// 같은 위치가 다른 이름으로 보이면 안 된다(getExpenses 가 loadLocationPaths 정본으로 싣는다).
import { fmtRoomNo } from '@/lib/roomNo'
import { plannedRoomsMeta } from '@/app/(app)/inventory/assets/receiptPlacement'

export type AllocPlaceRow = {
  room: { roomNo: string } | null
  assignedLocationName?: string | null   // 공용부 표기 경로. 방이 있는 행에서는 안 본다(방이 먼저다)
  qtyValue?: number | null
  qtyUnit?: string | null
  // 받기 전 비품의 배정 예정 호실 번호(살아 있는 방만, 화면이 채운다). 방·공용부가 있는 행에서는 안 본다.
  // 수령 전 비품의 자리는 예정 호실뿐이라(inventory/assets/receiptPlacement) 이 칸이 없으면 '미배정'으로 읽힌다.
  plannedRoomNo?: string | null
}

const isLoc = (r: AllocPlaceRow) => !r.room && !!r.assignedLocationName
const isPlanned = (r: AllocPlaceRow) => !r.room && !isLoc(r) && !!r.plannedRoomNo

/** 방별 분배 묶음의 자리 개수 칩. 방이 있으면 방 수, 방 없이 공용부만이면 공용부 수, 예정 호실만이면 `방 N개 예정`, 아무것도 없으면 미배정. */
export function roomChipText(rows: AllocPlaceRow[]): string {
  const n = new Set(rows.filter(r => r.room).map(r => r.room!.roomNo)).size
  if (n > 0) return `방 ${n}개`
  const locs = new Set(rows.filter(isLoc).map(r => r.assignedLocationName!)).size
  if (locs > 0) return `공용부 ${locs}곳`
  const planned = new Set(rows.filter(isPlanned).map(r => r.plannedRoomNo!)).size
  return planned > 0 ? `방 ${planned}개 예정` : '미배정'
}

/** 방별 분배 묶음의 자리 목록. '101·102·103호' / 방이 많으면 '101호·외 N곳' / 공용부는 늘 이름으로 뒤에 /
 *  예정 호실은 '519호 배정 예정'(비품 수령 대기 카드 메타와 같은 말) / 진짜 미배정은 수량과 함께. */
export function roomsLabel(rows: AllocPlaceRow[]): string {
  const rooms = [...new Set(rows.filter(r => r.room).map(r => r.room!.roomNo))].map(no => fmtRoomNo(no, ''))
  const locs = [...new Set(rows.filter(isLoc).map(r => r.assignedLocationName!))]
  // 접기는 방에만 건다. 공용부까지 한데 세어 접으면 이번 수정이 드러내려던 그 이름이 `외 N곳`에 다시 묻히고
  // (7/20 묶음 `502호·외 3곳`), 칩 `방 3개`와 라벨의 자리 수가 어긋난다(디자이너 패스 2026-10-10).
  const parts = rooms.length <= 3 ? [...rooms] : [rooms[0], `외 ${rooms.length - 1}곳`]
  parts.push(...locs)
  // 예정 호실 몫(받기 전). 같은 방이 이미 앞에 섰으면(부분 도착 뒤 받은 조각이 그 방에 배정됨) 방 이름을 또 쓰지 않고
  // '수령 대기 N개'로 사실만 말한다. 종전에는 '519호·519호 배정 예정'으로 같은 방이 두 번 섰다(검수 N-6).
  // 아직 방에 없는 예정 몫은 다른 몫(방·공용부·미배정)과 함께 설 때만 '519호 배정 예정 N개'(미배정 몫과 같은 수량 꼬리).
  // 예정 몫뿐이면 묶음 전체가 그 말이라 꼬리 없이 짧게 둔다(목록 라벨은 한 줄 말줄임이다).
  const qtyTail = (rs: AllocPlaceRow[]) => {
    const q = rs.reduce((s, r) => s + (r.qtyValue ?? 0), 0)
    return q > 0 ? ` ${q}${rs.find(r => r.qtyUnit)?.qtyUnit ?? '개'}` : ''
  }
  const placedNos = new Set(rows.filter(r => r.room).map(r => r.room!.roomNo))
  const plannedRows = rows.filter(isPlanned)
  const plannedNew = plannedRows.filter(r => !placedNos.has(r.plannedRoomNo!))
  const pendingHere = plannedRows.filter(r => placedNos.has(r.plannedRoomNo!))
  const unassigned = rows.filter(r => !r.room && !isLoc(r) && !isPlanned(r))
  const mixed = rooms.length + locs.length + unassigned.length > 0
  const planned = plannedRoomsMeta(plannedNew.map(r => r.plannedRoomNo!))
  if (planned) parts.push(`${planned}${mixed ? qtyTail(plannedNew) : ''}`)
  if (pendingHere.length) parts.push(`수령 대기${qtyTail(pendingHere)}`)
  if (unassigned.length > 0) {
    const qty = unassigned.reduce((s, r) => s + (r.qtyValue ?? 0), 0)
    const unit = unassigned.find(r => r.qtyUnit)?.qtyUnit ?? '개'
    parts.push(qty > 0 ? `미배정 ${qty}${unit}` : '미배정')
  }
  return parts.join('·')
}
