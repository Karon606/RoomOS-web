// 비품 수령의 판정 순수층(소모품 거부·배정 예정 호실). 'use server' 아님. 진리표는 scripts/test-asset-receipt.ts.
//
// 왜 뺐나. 서버 액션(assets/actions)은 async 함수만 내보낼 수 있어 그 안의 판정에 진리표가 못 붙는다
// (scripts/check-server-action-exports). aggregate.ts·lineage.ts 와 같은 배치다.
import { fmtRoomNo, roomNoWithRo } from '@/lib/roomNo'
import { hasFinalConsonant, withParticle } from '@/lib/koParticle'
import { fmtQty } from './aggregate'

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
  return rows.some(r => !isPlaceable(r)) ? ASSET_ASSIGN_DENY_UNRECEIVED : null
}

/** 수령 대기로 돌리기 거부. 방·공용부에 놓인 물품 행이 섞이면 막는다. */
export function unreceiveDenialPlaced(rows: { roomId: string | null; assignedLocationId: string | null; excludeFromInventory: boolean }[]): string | null {
  return rows.some(r => !r.excludeFromInventory && (r.roomId || r.assignedLocationId)) ? ASSET_UNRECEIVE_DENY_PLACED : null
}

// ── S5 수령 배정(F2) ─────────────────────────────────────────────────
// 비품 화면 수령 대기 '수령 완료'에서 받는 몫이 배정 예정 호실을 가졌고 아직 어디에도 안 놓였으면 그 방에 배정할지
// 묻는다. 화면(창을 띄울지·문구)과 서버(배정을 허락할지)가 **같은 판정**을 부른다. 갈리면 화면이 묻지 않은 배정을
// 서버가 하거나, 물어 놓고 서버가 거부한다.
//
// '이미 배정됨'은 assignedAt 이 아니라 '방·공용부·공용 자재에 놓였나'로 본다(수령·방 있고 배정일 빈 비품 57건 실측).

/** 수령 대기 카드의 한 행. 수량 미기록은 1로 센다(게이트·분할과 같은 셈, aggregate liveUnits). */
export type ReceiptRow = {
  id: string
  units: number                    // qtyValue ?? 1
  targetRoomId: string | null
  targetRoomNo: string | null      // 그 영업장에 지금 있는 방일 때만. 지운 방이면 null(예정 없음으로 본다)
  unplaced: boolean                // 방·공용부·공용 자재 어디에도 안 놓였다
}
export type PlanRoom = { roomId: string; roomNo: string; units: number }
export type ReceiptPlan =
  | { kind: 'none' }                                                                  // 묻지 않는다
  | { kind: 'single'; room: PlanRoom; units: number; total: number; partial: boolean } // 받는 몫 전부 한 방
  | { kind: 'multi'; rooms: PlanRoom[]; units: number; rest: number }                  // 전량, 여러 방(rest = 예정 없는 몫)
  | { kind: 'some'; room: PlanRoom; targeted: number; total: number }                 // 전량, 일부만 한 방
  | { kind: 'ambiguous'; units: number; total: number }                               // 부분 도착인데 몫이 갈린다. 창 없이 미배정

const EPS = 1e-9
const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * 받을 때 배정을 물을지와 그 모양. qty 는 부분 도착 수량(null·전체 이상 = 전량).
 * 부분 도착은 어느 행을 받는지 서버의 분할 순서가 정한다. 그래서 받는 몫이 한 방 것이라고 단정할 수 있는 경우
 * (모든 행이 같은 한 방을 예정으로 가짐)에만 묻고, 몫이 갈리면(여러 방·일부만 호실) 묻지 않고 미배정으로 받는다.
 */
export function receiptPlacementPlan(rows: ReceiptRow[], qty: number | null): ReceiptPlan {
  const total = r3(rows.reduce((s, r) => s + r.units, 0))
  const units = qty == null || qty >= total - EPS ? total : r3(qty)
  const partial = units < total - EPS
  const cands = rows.filter(r => r.unplaced && r.targetRoomId && r.targetRoomNo)
  if (!cands.length) return { kind: 'none' }
  const byRoom = new Map<string, PlanRoom>()
  for (const c of cands) {
    const cur = byRoom.get(c.targetRoomId!) ?? { roomId: c.targetRoomId!, roomNo: c.targetRoomNo!, units: 0 }
    cur.units = r3(cur.units + c.units)
    byRoom.set(c.targetRoomId!, cur)
  }
  const rooms = [...byRoom.values()].sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))
  const targeted = r3(cands.reduce((s, c) => s + c.units, 0))
  const allTargeted = targeted >= total - EPS
  if (partial) return rooms.length === 1 && allTargeted ? { kind: 'single', room: rooms[0], units, total, partial: true } : { kind: 'ambiguous', units, total }
  if (rooms.length === 1) return allTargeted ? { kind: 'single', room: rooms[0], units: total, total, partial: false } : { kind: 'some', room: rooms[0], targeted, total }
  return { kind: 'multi', rooms, units: total, rest: r3(total - targeted) }
}

/** 이 판정에서 창을 띄우는가(= '배정'을 고를 수 있는가). 서버는 이 값이 거짓이면 배정 요청을 거부한다. */
export const planAsks = (p: ReceiptPlan): p is Exclude<ReceiptPlan, { kind: 'none' } | { kind: 'ambiguous' }> =>
  p.kind === 'single' || p.kind === 'multi' || p.kind === 'some'

/** 배정을 고르면 어느 행을 어느 방에 놓는가. 예정 호실이 살아 있고 안 놓인 행만. 나머지는 그대로(미배정). */
export function planTargetOf(row: ReceiptRow): string | null {
  return row.unplaced && row.targetRoomId && row.targetRoomNo ? row.targetRoomId : null
}

// 서버가 배정을 받았는데 지금 판정으로는 물을 일이 없다. 화면을 연 뒤 예정 호실이 바뀌었거나 방이 지워졌다.
export const ASSET_RECEIPT_PLAN_STALE = '배정할 호실 정보가 바뀌었습니다. 새로고침한 뒤 다시 수령해 주세요.'

/** 화면이 창에 띄운 계획(행별 놓을 방). 배정을 고르면 서버에 같이 보낸다(검수 N-4). */
export type ReceiptPlanExpect = { id: string; targetRoomId: string | null }[]
export const planExpectOf = (rows: ReceiptRow[]): ReceiptPlanExpect => rows.map(r => ({ id: r.id, targetRoomId: planTargetOf(r) }))
/**
 * 화면이 본 계획과 지금 서버 계획이 다른가. 창이 떠 있는 동안 예정 호실이 바뀌면(다른 탭에서 지출 수정) 운영자가
 * 본 적 없는 방으로 배정된다. 행 집합이 다르거나 한 행이라도 놓을 방이 다르면 다르다.
 */
export function planExpectMismatch(rows: ReceiptRow[], expect: ReceiptPlanExpect | undefined): boolean {
  if (!expect) return true
  const want = new Map(expect.map(e => [e.id, e.targetRoomId ?? null]))
  if (want.size !== rows.length) return true
  return rows.some(r => !want.has(r.id) || want.get(r.id) !== planTargetOf(r))
}

const qtyText = (n: number, unit: string) => `${fmtQty(n)}${unit}`
const quoted = (label: string) => `'${label}'${hasFinalConsonant(label) ? '을' : '를'}`   // 따옴표 뒤 조사는 품명 받침으로(정본 판정)

export type ReceiptAssignCopy = { title: string; message: string; confirmLabel: string; altLabel: string }

/**
 * F2 창 문구(UX 패널 보고 F2 대사 그대로). 버튼은 [취소][수령만][{방}에 배정]이고 단계는 normal(계획을 확인하는 물음).
 * 호실은 '에'를 써서 조사가 바뀌지 않게 하고, 품명·수량 뒤 조사는 정본(koParticle·roomNo)으로 붙인다.
 */
export function receiptAssignCopy(plan: ReceiptPlan, label: string, unit: string): ReceiptAssignCopy | null {
  const alt = '수령만'
  if (plan.kind === 'single') {
    const room = fmtRoomNo(plan.room.roomNo, '')
    if (!plan.partial) return {
      title: `${quoted(label)} ${room}에 배정할까요?`,
      message: `구매할 때 대상 호실을 ${roomNoWithRo(plan.room.roomNo, '')} 적었습니다. 수령만 하면 미배정에 둡니다.`,
      confirmLabel: `${room}에 배정`, altLabel: alt,
    }
    return {
      title: `'${label}' ${withParticle(qtyText(plan.units, unit), '을/를')} ${room}에 배정할까요?`,
      message: `${qtyText(plan.total, unit)} 중 ${withParticle(qtyText(plan.units, unit), '이/가')} 도착했습니다. 남은 ${withParticle(qtyText(r3(plan.total - plan.units), unit), '은/는')} 수령 대기에 남습니다.`,
      confirmLabel: `${room}에 배정`, altLabel: alt,
    }
  }
  if (plan.kind === 'multi') {
    const parts = plan.rooms.map(r => `${fmtRoomNo(r.roomNo, '')} ${qtyText(r.units, unit)}`)
    const last = parts.length - 1
    parts[last] = withParticle(parts[last], '으로/로')
    const rest = plan.rest > EPS ? ` 나머지 ${withParticle(qtyText(plan.rest, unit), '은/는')} 미배정에 둡니다.` : ''
    return {
      title: `'${label}' ${withParticle(qtyText(plan.units, unit), '을/를')} 적어 둔 방에 배정할까요?`,
      message: `구매할 때 ${parts.join(' · ')} 적었습니다.${rest}`,
      confirmLabel: '적은 대로 배정', altLabel: alt,
    }
  }
  if (plan.kind === 'some') {
    const room = fmtRoomNo(plan.room.roomNo, '')
    return {
      title: `'${label}' ${qtyText(plan.total, unit)} 중 ${withParticle(qtyText(plan.targeted, unit), '을/를')} ${room}에 배정할까요?`,
      message: `구매할 때 ${qtyText(plan.targeted, unit)}만 ${roomNoWithRo(plan.room.roomNo, '')} 적었습니다. 나머지 ${withParticle(qtyText(r3(plan.total - plan.targeted), unit), '은/는')} 미배정에 둡니다.`,
      confirmLabel: `${room}에 배정`, altLabel: alt,
    }
  }
  return null
}

/**
 * 받은 뒤 토스트(UX 패널 F2 토스트). choice: 'assign' = 배정을 골랐다, 'receive' = 수령만.
 * 적용취소 라벨은 배정을 함께 했으면 '적용취소', 수령만이면 형제(재고 수령 확인)와 같은 '수령 취소'.
 * 묻지 않은 수령(none)은 null. 화면이 종전 문구('수령 완료'·부분 수령 문구)를 그대로 쓴다.
 */
export function receiptToast(plan: ReceiptPlan, choice: 'assign' | 'receive', unit: string): { text: string; detail?: string; actionLabel: string } | null {
  if (plan.kind === 'none') return null
  if (choice === 'assign' && planAsks(plan)) {
    if (plan.kind === 'single') return plan.partial
      ? { text: `${qtyText(plan.units, unit)} 수령 완료 · ${fmtRoomNo(plan.room.roomNo, '')} 배정`, detail: `남은 ${withParticle(qtyText(r3(plan.total - plan.units), unit), '은/는')} 수령 대기에 남습니다.`, actionLabel: '적용취소' }
      : { text: `수령 완료 · ${fmtRoomNo(plan.room.roomNo, '')} 배정`, actionLabel: '적용취소' }
    if (plan.kind === 'multi') return {
      text: `수령 완료 · ${plan.rooms.map(r => fmtRoomNo(r.roomNo, '')).join('·')} 배정`,
      ...(plan.rest > EPS ? { detail: `나머지 ${withParticle(qtyText(plan.rest, unit), '은/는')} 미배정에 두었습니다.` } : {}),
      actionLabel: '적용취소',
    }
    return { text: `수령 완료 · ${fmtRoomNo(plan.room.roomNo, '')} 배정`, detail: `나머지 ${withParticle(qtyText(r3(plan.total - plan.targeted), unit), '은/는')} 미배정에 두었습니다.`, actionLabel: '적용취소' }
  }
  if (plan.kind === 'ambiguous') return {
    text: `${qtyText(plan.units, unit)} 수령 완료 · 미배정`,
    detail: '어느 방 몫인지 정할 수 없어 미배정에 두었습니다. 나눠 배정으로 옮기세요.',
    actionLabel: '수령 취소',
  }
  // 수령만. 미배정에 뒀다고 말한다.
  if (plan.kind === 'single' && plan.partial) return {
    text: `${qtyText(plan.units, unit)} 수령 완료 · 미배정`,
    detail: `남은 ${withParticle(qtyText(r3(plan.total - plan.units), unit), '은/는')} 수령 대기에 남습니다.`,
    actionLabel: '수령 취소',
  }
  return { text: '수령 완료 · 미배정', actionLabel: '수령 취소' }
}

// 적용취소가 막히는 때. 받은 뒤 그 행이 옮겨지거나 폐기·분할·수정됐다. 되돌리면 그 뒤 일이 사라진다.
export const ASSET_RECEIPT_UNDO_STALE = '수령 이후 이 비품이 옮겨지거나 바뀌어 되돌릴 수 없습니다. 비품 화면에서 직접 고쳐 주세요.'
// 서버가 만든 토큰이 아니거나(서명 불일치) 모양이 틀렸다. 무엇도 쓰지 않는다(검수 N-1, 위조 토큰).
export const ASSET_RECEIPT_UNDO_INVALID = '적용취소 정보가 유효하지 않습니다.'

// ── 수령 전 비품에 자리를 쓰지 않는다. 집는 행의 정본(검수 F-1·F-2) ─────────────────────────────
/** 방·공용부에 놓을 수 있는 행인가. 받은 물품이거나 서비스(수령 개념 없음). assignDenialUnreceived 와 같은 판정. */
export const isPlaceable = (r: { receivedAt: Date | null; excludeFromInventory: boolean }) => !!r.receivedAt || r.excludeFromInventory
/** isPlaceable 의 조회 조건. 속성으로 행을 집는 쓰기(배정 이력 되돌리기·미배정 묶음 합치기)가 where 에 건다. */
export const PLACEABLE_WHERE = { OR: [{ receivedAt: { not: null } }, { excludeFromInventory: true }] }

// ── 비품 수령 적용취소 토큰(검수 N-1) ─────────────────────────────────────────
// 토큰은 화면을 거쳐 돌아오는 값이다. 종전 토큰은 행마다 '원상태' 칸 전부(금액·세부·수량까지)를 실어 그대로 썼다.
// 그래서 같은 영업장 안의 무관한 지출 id 와 금액을 지어내면(공과금 50,000원을 1원으로) 그대로 써졌다. 지금은 셋으로 닫는다.
//   1. 서명. 현금영수증 적용취소와 같은 정본(rooms/cashReceiptLine signUndoBody, 용도 'asset-receipt')으로 서명하고 대조한다.
//   2. 범위. 대상 행은 그 영업장 비품 모집단 안이어야 한다(서버가 다시 조회).
//   3. 칸. 이번 수령이 바꾼 칸만 되돌린다. 받은 행은 수령 시각과(배정했으면) 자리 넷, 분할 원행은 수량·금액·세부·묶음.
//      수량·금액은 토큰 값을 쓰지 않고 서버가 원행과 조각에서 다시 더한다. 묶음 id 는 null 이나 지금 값만 받는다.
export type AssetReceiptUndo = {
  v: 1
  at: string   // 이번 수령 시각(ISO). 받은 행의 receivedAt 이 이 값 그대로일 때만 되돌린다
  // 통째로 받은 행. assigned 면 자리 넷(roomId·공용부·공용 표식·배정일)도 이번에 바꾼 것이다.
  received: { id: string; assigned: boolean; prevAssignedAt: string | null; now: { roomId: string | null; isCommonAsset: boolean; itemLabel: string | null; qtyValue: number | null; amount: number } }[]
  // 부분 도착으로 쪼갠 원행(지금은 수령 대기 잔여). 원래 묶음 id·세부만 싣는다(수량·금액은 서버가 다시 센다).
  split: { id: string; prevGroupId: string | null; prevDetail: string | null; now: { qtyValue: number; amount: number; groupId: string; itemLabel: string | null } }[]
  // 분할로 생긴 수령 조각. fromId 는 그 원행.
  created: { id: string; fromId: string; roomId: string | null; isCommonAsset: boolean; qtyValue: number; amount: number }[]
  logIds: string[]
  sig?: string
}
export const ASSET_RECEIPT_UNDO_MAX_ROWS = 500
/** 서명 용도(domain). 현금영수증 토큰과 같은 키라도 용도가 달라 서로의 서명이 안 맞는다. */
export const ASSET_RECEIPT_UNDO_DOMAIN = 'asset-receipt'

/** 서명할 정본 문자열. 필드 순서를 고정한 배열의 JSON 이라 객체 키 순서·시각 표기가 달라져도 같다. */
export function canonicalAssetReceiptUndo(u: AssetReceiptUndo): string {
  const ts = (v: string | null) => (v == null ? null : new Date(v).toISOString())
  return JSON.stringify([
    u.v, ts(u.at),
    u.received.map(r => [r.id, r.assigned, ts(r.prevAssignedAt), r.now.roomId, r.now.isCommonAsset, r.now.itemLabel, r.now.qtyValue, r.now.amount]),
    u.split.map(s => [s.id, s.prevGroupId, s.prevDetail, s.now.qtyValue, s.now.amount, s.now.groupId, s.now.itemLabel]),
    u.created.map(c => [c.id, c.fromId, c.roomId, c.isCommonAsset, c.qtyValue, c.amount]),
    u.logIds,
  ])
}

/** 화면을 거쳐 돌아온 값이 토큰 모양인가. 아니면 null(모양이 틀린 값으로는 아무것도 안 쓴다). */
export function parseAssetReceiptUndo(x: unknown): AssetReceiptUndo | null {
  if (!x || typeof x !== 'object') return null
  const u = x as Partial<AssetReceiptUndo>
  const str = (v: unknown) => typeof v === 'string'
  const strOrNull = (v: unknown) => v === null || typeof v === 'string'
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const numOrNull = (v: unknown) => v === null || num(v)
  const isTs = (v: unknown) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
  if (u.v !== 1 || !isTs(u.at) || !Array.isArray(u.received) || !Array.isArray(u.split) || !Array.isArray(u.created) || !Array.isArray(u.logIds)) return null
  if (u.received.length + u.split.length > ASSET_RECEIPT_UNDO_MAX_ROWS || u.created.length > u.split.length || u.logIds.length > ASSET_RECEIPT_UNDO_MAX_ROWS) return null
  if (u.sig !== undefined && !str(u.sig)) return null
  for (const r of u.received) {
    if (!r || !str(r.id) || typeof r.assigned !== 'boolean' || !(r.prevAssignedAt === null || isTs(r.prevAssignedAt))) return null
    const n = r.now
    if (!n || !strOrNull(n.roomId) || typeof n.isCommonAsset !== 'boolean' || !strOrNull(n.itemLabel) || !numOrNull(n.qtyValue) || !num(n.amount)) return null
    // 배정한 행은 방에 놓였고 공용 표식이 꺼져 있어야 한다(이번 쓰기가 만든 모양).
    if (r.assigned && (!n.roomId || n.isCommonAsset)) return null
  }
  const splitIds = new Set<string>()
  for (const s of u.split) {
    if (!s || !str(s.id) || !strOrNull(s.prevGroupId) || !strOrNull(s.prevDetail)) return null
    const n = s.now
    if (!n || !num(n.qtyValue) || !num(n.amount) || !str(n.groupId) || !strOrNull(n.itemLabel)) return null
    // 묶음 id 는 원래 없었거나(이번에 새로 만든 것) 지금 값 그대로다. 그 밖의 값으로는 못 바꾼다.
    if (s.prevGroupId !== null && s.prevGroupId !== n.groupId) return null
    splitIds.add(s.id)
  }
  for (const c of u.created) {
    if (!c || !str(c.id) || !str(c.fromId) || !splitIds.has(c.fromId) || !strOrNull(c.roomId) || typeof c.isCommonAsset !== 'boolean' || !num(c.qtyValue) || !num(c.amount)) return null
  }
  if (!u.logIds.every(str)) return null
  const ids = [...u.received.map(r => r.id), ...u.split.map(s => s.id), ...u.created.map(c => c.id)]
  if (new Set(ids).size !== ids.length) return null
  return u as AssetReceiptUndo
}
