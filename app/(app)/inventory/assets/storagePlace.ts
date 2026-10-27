// 비품 보관 위치(배정 안 한 여분이 놓인 창고·선반)의 판정·표기 순수층. 'use server' 아님. 진리표는 scripts/test-asset-receipt.ts.
//
// 왜 축이 따로인가(2026-10-19 운영자 승인, 신고 195e05c8·09ec10aa). 배정(roomId·assignedLocationId·isCommonAsset)은 '어디에
// 설치·배치했나'다. 미배정(여분)은 배정만 안 됐을 뿐 어느 창고에 있는지가 있어야 찾아온다. 창고를 배정 목록에 넣으면
// 미배정의 뜻이 깨진다(공용부 배정 후보는 기본 창고를 뺀다, getAssignableLocations). 그래서 보관 위치는 Expense.storedLocationId
// 한 칸이고, **받은 + 안 놓인 행에만** 산다. 배정·공용 자재·수령 대기로 가면 비운다. 수령 전 행은 늘 비어 있다.
// 서버 액션(assets/actions)·재무 저장(finance/actions)·화면(AssetsClient)이 이 파일 하나를 부른다.
import { isUnplaced } from './aggregate'

// ── 낱말(운영자 승인안 그대로) ─────────────────────────────────────────────
export const STORE_GROUP_LABEL = '여분으로 보관 (배정 안 함)'   // 옮기기 목록의 무리 이름
export const STORE_UNKNOWN_OPTION = '보관 위치 모름'             // 그 무리 안 '모름' 선택지
export const STORE_UNKNOWN_HEAD = '보관 위치 미정'               // 미배정 묶음 머리(칸이 빈 행)
export const UNASSIGNED_PLACE = '미배정(여분)'                    // 보관 위치가 없는 미배정 카드의 자리 이름(종전 그대로)
// 목적지 세그먼트 칸 이름(가이드 §29 2~6자). 무리 이름 STORE_GROUP_LABEL 은 그 칸 아래 select 의 aria-label 과 수령 창에 남는다
// (2026-10-26 운영자 승인, 신고 0c37bc53 '미배정분 보관 위치 선택항목이 배정하는 방들의 리스트와 섞여').
export const STORE_SEGMENT_LABEL = '여분 보관'
export const STORE_SEGMENT_CAPTION = '배정하지 않고 보관 위치만 적습니다'
/** 옮기기·일괄 옮기기 목록의 보관 선택지. '{경로}에 보관'(공용부 칸의 같은 이름과 안 겹친다). 수령 창·무상 입수는 경로 그대로. */
export const storeOptionLabel = (s: { pathName: string; isHub: boolean }) => `${s.pathName}에 보관${s.isHub ? ' (기본 창고)' : ''}`
/** 보관 위치가 있는 미배정 카드의 자리 이름. '4층 415호 창고 보관'. 이름은 표기 경로(pathName)다. */
export const storedPlaceLabel = (pathName: string) => `${pathName} 보관`

// ── 후보 ──────────────────────────────────────────────────────────────────
export type StorageCandidate = { id: string; pathName: string; isHub: boolean }
/** 보관 위치 후보. 그 영업장 위치 전부(하드코딩 없음), 기본 창고 먼저, 나머지는 받은 차례(트리 DFS) 그대로. */
export function storageCandidates<T extends StorageCandidate>(rows: readonly T[]): T[] {
  return [...rows.filter(r => r.isHub), ...rows.filter(r => !r.isHub)]
}
/** 미리 고를 보관 위치. 기본 창고가 **정확히 하나**일 때만 그 위치, 없거나 여럿이면 null(미리 고르지 않는다). */
export function defaultStorageId(rows: readonly StorageCandidate[]): string | null {
  const hubs = rows.filter(r => r.isHub)
  return hubs.length === 1 ? hubs[0].id : null
}

// ── 불변식 ────────────────────────────────────────────────────────────────
export type StorageRow = { receivedAt: Date | string | null; roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean }
/** 보관 위치를 가질 수 있는 행인가. 받았고 방·공용부·공용 자재 어디에도 안 놓였다(놓인 행 정본 isUnplaced). */
export const canHoldStorage = (r: StorageRow) => !!r.receivedAt && isUnplaced(r.roomId, r.assignedLocationId, r.isCommonAsset)

/**
 * 지출 저장(재무 등록·수정·분배 조각)이 쓸 보관 위치. 재무 폼은 이 칸을 받지 않는다(운영자 승인안). 저장 뒤 행이 비품 물품이고
 * 받았고 안 놓였으면 원래 값을 지키고, 그 밖이면 비운다(배정·소모품 전환 뒤 보관 위치가 남지 않게).
 */
export function storedForSave(i: {
  durableGoods: boolean
  received: boolean
  roomId: string | null
  assignedLocationId: string | null
  isCommonAsset: boolean
  existingStored: string | null
}): string | null {
  if (!i.durableGoods || !i.received) return null
  return isUnplaced(i.roomId, i.assignedLocationId, i.isCommonAsset) ? i.existingStored : null
}

// 서버 거부 문장. 화면이 고른 보관 위치가 이 영업장 위치가 아니다(지웠거나 다른 영업장 id).
export const STORE_NOT_FOUND = '보관 위치를 찾을 수 없습니다. 새로고침한 뒤 다시 골라 주세요.'

// ── 화면 목적지 키 ────────────────────────────────────────────────────────
// 옮기기 셀렉트 값. 'store:<id>' = 그 위치에 보관, 'store:' = 보관 위치 모름(미배정). 방·공용부는 종전 'room:'·'loc:'.
export const storeKey = (id: string | null) => `store:${id ?? ''}`
export function parseStoreKey(v: string): { id: string | null } | null {
  if (!v.startsWith('store:')) return null
  const id = v.slice('store:'.length)
  return { id: id || null }
}

// ── 목적지 무리(세그먼트 칸) ──────────────────────────────────────────────
// 옮기기 목적지는 성격이 다른 셋이다. 여분 보관(미배정 + 보관 위치 메모)·방·공용부(배정). 한 select 의 optgroup 셋이면
// iOS 휠·Android 목록에서 회색 머리줄 하나라 한 두루마리가 된다(신고 0c37bc53, 보관 19 + 방 50 + 공용부 17 = 86행).
// 그래서 세그먼트로 무리를 먼저 고르고 그 무리만 담은 select 를 보인다(가이드 §12 '상호배타는 세그먼트'). 정본 컴포넌트 DestinationPicker.
export type DestGroup = 'store' | 'room' | 'loc'
/** 목적지 키의 무리. 빈 값·모르는 접두어는 null(아직 안 골랐다). */
export function destGroupOf(v: string): DestGroup | null {
  if (v.startsWith('store:')) return 'store'
  if (v.startsWith('room:') && v.length > 'room:'.length) return 'room'
  if (v.startsWith('loc:') && v.length > 'loc:'.length) return 'loc'
  return null
}
/** 처음 고를 칸. 지금 안 놓인(미배정) 것만 옮기면 여분 보관, 하나라도 방·공용부에 놓였으면 방. */
export function defaultDestGroup(allUnplaced: boolean): DestGroup {
  return allUnplaced ? 'store' : 'room'
}

/** 배정 변경 이력 한 줄의 자리 표기. 보관(storage)은 '{경로} 보관', 미배정(none)·빈 라벨은 '미배정'(DB 라벨은 되찾기 열쇠라 안 고친다). */
export function logPlaceLabel(kind: string, label: string | null): string {
  if (kind === 'storage' && label) return storedPlaceLabel(label)
  return label ?? '미배정'
}
