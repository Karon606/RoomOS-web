// 비품 수령의 판정 순수층(소모품 거부·배정 예정 호실). 'use server' 아님. 진리표는 scripts/test-asset-receipt.ts.
//
// 왜 뺐나. 서버 액션(assets/actions)은 async 함수만 내보낼 수 있어 그 안의 판정에 진리표가 못 붙는다
// (scripts/check-server-action-exports). aggregate.ts·lineage.ts 와 같은 배치다.
import { fmtRoomNo } from '@/lib/roomNo'

// ── S1 소모품 거부 ─────────────────────────────────────────────────────
// 비품 화면의 수령 버튼은 비품 모집단(durableExpenseWhere)에 든 행만 그린다. 그런데 화면을 연 뒤 다른
// 탭에서 카테고리를 소모품으로 바꾸면 그 id 가 그대로 날아온다. true 쪽은 자동 점검 없이 receivedAt 만
// 찍혀 유령수령이 되고, false 쪽은 자동 점검을 남긴 채 receivedAt 만 지워 다시 받을 때 입고가 두 번 잡힌다
// (cancelReceiptCore 우회 뒷문). 소모품 수령은 재고 화면의 정본(confirmReceipt) 한 길뿐이다.
export const ASSET_RECEIPT_DENY_TRACKED = '소모품으로 바뀐 품목입니다. 새로고침한 뒤 재고 화면에서 수령해 주세요.'
// 비품 모집단 밖인데 소모품도 아닌 행(지워졌거나 배송비·서비스로 바뀐 행). 어느 쪽이든 화면이 낡았다.
export const ASSET_RECEIPT_DENY_STALE = '비품 목록이 바뀌었습니다. 새로고침한 뒤 다시 시도해 주세요.'

export type ReceiptGateRow = { id: string; category: string }

/**
 * 비품 수령(받음·수령 대기로) 거부 판정. 통과면 null.
 * @param found      요청 id 중 이 영업장에서 찾은 행(카테고리와 함께)
 * @param inPopulation 그중 비품 모집단(durableExpenseWhere)에 든 id
 */
export function assetReceiptDenial(
  requestedIds: string[], found: ReceiptGateRow[], inPopulation: Set<string>, trackedCats: string[],
): string | null {
  const ids = [...new Set(requestedIds)]
  if (found.some(r => trackedCats.includes(r.category))) return ASSET_RECEIPT_DENY_TRACKED
  if (found.length !== ids.length || ids.some(id => !inPopulation.has(id))) return ASSET_RECEIPT_DENY_STALE
  return null
}

// ── S4 배정 예정 호실(targetRoomId) ────────────────────────────────────
// 비품에서 roomId 는 곧 '배정된 자리'다(비품 화면 버킷). 수령 전에 roomId 가 있으면 받는 순간 말없이 그 방에
// 서고(배정일·이력 없음), 이미 그 방이면 배정 이력이 '변화 없음'으로 안 남는다. 그래서 **수령 전 비품 물품의
// 자리는 targetRoomId(배정 예정 호실) 하나뿐**이다. 받을 때 그 방에 배정할지 묻고(F2), 고르면 정본 배정 규칙대로
// roomId·배정일·이력을 쓴다. targetRoomId 는 text 칸이라 FK 가 없다. 서버가 그 영업장 방인지 본다.

/** 비품 물품인가. 추적 카테고리 밖이고, 재고 제외(서비스·무형)·배송비가 아니며, 품명이 있다.
 *  비품 화면 모집단(durableExpenseWhere)의 물품 갈래와 같은 축이다. */
export function isDurableGoods(row: { category: string; excludeFromInventory: boolean; itemLabel: string | null; isShipping: boolean }, trackedCats: readonly string[]): boolean {
  return !!row.itemLabel && !row.excludeFromInventory && !row.isShipping && !trackedCats.includes(row.category)
}

/**
 * 지출 저장(등록·수정·분배 조각)이 쓸 호실 두 칸.
 * - 비품 물품이 아니면 targetRoomId 는 비운다(소모품·서비스의 호실은 roomId 그대로, 비용 귀속).
 * - 받은 비품은 지금처럼 roomId 를 폼 값대로 두고 targetRoomId 는 원래 값을 지킨다(기록이다).
 * - 받기 전 비품은 roomId 를 비우고 자리는 targetRoomId 로만 둔다. 폼이 '배정할 호실' 칸을 실어 오면 그 값,
 *   옛 화면이 roomId 로 실어 오면 그 값을 예정으로 옮긴다(지우지 않는다). 칸도 roomId 도 없으면 원래 값을 지킨다.
 *   칸을 실어 왔는데 비었으면 비운다(form-clear-vs-absent: 빈 값은 지움, 부재는 보존).
 */
export function placementForSave(input: {
  durableGoods: boolean
  received: boolean
  roomId: string | null                    // 폼이 실은 호실(방별 분배 조각이면 그 조각의 방)
  formTarget: string | null | undefined    // 폼의 '배정할 호실' 칸. 부재 undefined, 빈 값 null
  existingTarget: string | null
}): { roomId: string | null; targetRoomId: string | null } {
  if (!input.durableGoods) return { roomId: input.roomId, targetRoomId: null }
  if (input.received) return { roomId: input.roomId, targetRoomId: input.existingTarget }
  if (input.roomId) return { roomId: null, targetRoomId: input.formTarget ?? input.roomId }
  return { roomId: null, targetRoomId: input.formTarget === undefined ? input.existingTarget : input.formTarget }
}

/** 수령 대기 카드 메타 조각. '519호 배정 예정' · '519호·520호 배정 예정' · '519호·외 3곳 배정 예정'.
 *  접기는 재무 방별 분배 라벨(allocPlaceLabel roomsLabel)과 같은 문법(넷 이상이면 첫 방과 '외 N곳'). */
export function plannedRoomsMeta(roomNos: (string | null)[]): string | null {
  const rooms = [...new Set(roomNos.filter((n): n is string => !!n))].map(n => fmtRoomNo(n, ''))
  if (rooms.length === 0) return null
  const parts = rooms.length <= 3 ? rooms : [rooms[0], `외 ${rooms.length - 1}곳`]
  return `${parts.join('·')} 배정 예정`
}

// 수령 전 비품을 방·공용부에 넣는 길은 막는다. 그 자리는 받을 때 정한다(배정 예정 호실은 지출에서 적는다).
export const ASSET_ASSIGN_DENY_UNRECEIVED = '아직 받지 않은 비품입니다. 수령 대기에서 수령 완료를 먼저 눌러 주세요.'
// 방·공용부에 놓인 비품을 수령 대기로 돌리면 '수령 전인데 자리가 있는' 행이 생긴다(위 규칙의 뒷문).
export const ASSET_UNRECEIVE_DENY_PLACED = '방이나 공용부에 배정된 비품은 수령 대기로 돌릴 수 없습니다. 먼저 미배정으로 옮겨 주세요.'

/** 배정(옮기기·나눠 배정·일괄 배정) 거부. 받기 전 물품 행이 섞이면 막는다. 서비스는 수령 개념이 없어 면제. */
export function assignDenialUnreceived(rows: { receivedAt: Date | null; excludeFromInventory: boolean }[]): string | null {
  return rows.some(r => !r.receivedAt && !r.excludeFromInventory) ? ASSET_ASSIGN_DENY_UNRECEIVED : null
}

/** 수령 대기로 돌리기 거부. 방·공용부에 놓인 물품 행이 섞이면 막는다. */
export function unreceiveDenialPlaced(rows: { roomId: string | null; assignedLocationId: string | null; excludeFromInventory: boolean }[]): string | null {
  return rows.some(r => !r.excludeFromInventory && (r.roomId || r.assignedLocationId)) ? ASSET_UNRECEIVE_DENY_PLACED : null
}
