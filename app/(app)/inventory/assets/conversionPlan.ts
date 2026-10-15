// 소모품으로 적은 구매를 비품으로 바꿀지 묻는 판정·문구·적용취소 토큰의 순수층(계획서 2단계 F1·F3). 진리표 scripts/test-durable-convert.ts.
//
// 왜 묻나(2026-10-13 냉장고 519호). 비품과 소모품은 지출 카테고리 하나로 갈린다. 냉장고를 소모품비 + 대상 호실 519호로
// 적자 소모품 재고에 잡히고 비품 화면에서는 빠져 앱 어디에도 519호로 서지 않았다. '추적 카테고리 + 대상 호실'은
// 이 영업장 491건 중 그 한 건뿐인 구조 신호다(금액 문턱·가전 낱말은 영업장마다 달라 쓰지 않는다, 멀티테넌트).
// 화면(저장 직전 물음 사슬의 맨 앞)과 서버(전환을 받을지)가 이 판정 하나를 부른다. 갈리면 화면이 묻지 않은 전환을
// 서버가 하거나, 물어 놓고 서버가 거부한다. 'use server' 아님(서버 액션 파일은 async 함수만 내보낸다).
import { fmtRoomNo } from '@/lib/roomNo'
import { hasFinalConsonant, withParticle } from '@/lib/koParticle'
import { OPTION_LIST_DEFAULTS } from '@/lib/optionLists'
import { WORK_EXPENSE_CATEGORY } from '@/app/(app)/room-manage/cleaningConstants'
import type { LedgerShiftUndo } from '@/app/(app)/inventory/ledgerShift'
import type { TrackedItemDeleteUndo } from '@/app/(app)/inventory/trackedItemSnapshot'

// ── 판정 ───────────────────────────────────────────────────────────

/** 저장하려는 지출의 품목 한 줄. roomIds 는 방별 분배면 각 조각의 호실, 아니면 폼의 대상 호실 하나(없으면 빈 배열). */
export type ConvertItem = { label: string; roomIds: string[] }
export type ConvertInput = {
  category: string                 // 지금 저장하려는 카테고리('그대로 저장'이면 이 값으로 저장된다)
  items: ConvertItem[]
  received: boolean                // 수정 폼이고 이미 수령한 구매(F3)
  original?: { category: string; roomIds: string[] } | null   // 수정 폼이면 저장돼 있던 값. 등록이면 없음
}
/** 영업장 사실(서버 loadDurableConvertFacts 가 모은다). */
export type ConvertFacts = {
  trackedCats: readonly string[]
  trackedHistoryLabels: readonly string[]                      // 이 지출 말고 추적 카테고리 구매가 있는 품명
  durableCounts: readonly { category: string; count: number }[] // 비품 물품(비품 화면 모집단의 물품 갈래) 카테고리별 건수
  propertyCategories: readonly string[]                         // 그 영업장 지출 카테고리 목록
}
export type ConvertPlan =
  | { kind: 'none' }
  | {
      kind: 'F1' | 'F3'      // F1 = 받기 전(등록·수정), F3 = 이미 받은 소모품의 수정
      target: string          // 바꿀 비품 카테고리
      lead: string            // 창 제목에 이름이 서는 품목(호실이 있고 소모품 이력이 없는 첫 품목)
      others: string[]        // 함께 비품이 되는 나머지 품목(카테고리는 지출 하나에 하나다, 운영자 결정 6)
      roomIds: string[]       // 적힌 대상 호실(순서 유지, 중복 없음)
    }

/**
 * 폼의 품목 목록에서 판정 입력을 만든다. 화면(저장 직전)과 서버(addExpense·updateExpense)가 같은 함수로 만든다.
 * 방별 분배가 있으면 그 조각들의 호실, 없으면 폼의 대상 호실 하나(formRoomId, 폼이 실은 roomId 값 그대로).
 * 분배 조각 중 호실이 빈 것(미지정 나머지)은 호실이 아니다. 저장 경로의 행 펼치기(expandExpenseRows)와 같은 셈이다.
 */
export function convertItemsFrom(items: { label?: string | null; allocations?: { roomId?: string | null; qty?: string | null }[] | null }[], formRoomId: string | null): ConvertItem[] {
  return items.map(it => {
    const allocs = (Array.isArray(it.allocations) ? it.allocations : []).filter(a => a && (a.roomId || a.qty))
    return { label: (it.label ?? '').trim(), roomIds: allocs.length ? allocs.map(a => a.roomId ?? '').filter(Boolean) : (formRoomId ? [formRoomId] : []) }
  })
}

/** 비품 이력이 없을 때 쓰는 카테고리. 앱 기본 지출 목록의 수선유지비(작업 완료가 이 이름으로 지출을 만든다). */
export const DURABLE_FALLBACK_CATEGORY: string | null =
  OPTION_LIST_DEFAULTS.expenseCategories.includes(WORK_EXPENSE_CATEGORY) ? WORK_EXPENSE_CATEGORY : null

/**
 * 비품으로 바꿀 때의 카테고리(운영자 결정 1). 그 영업장 비품 물품을 가장 많이 담은 카테고리다(동수면 가나다 앞).
 * 영업장 지출 카테고리 목록에 있는 것만 본다. 목록에서 뺀 이름으로 저장하면 저장 경로가 목록에 되살린다
 * (finance resolveExpenseCategoryForSave). 비품 이력이 없으면 기본 목록의 수선유지비가 목록에 있을 때만 그것,
 * 아니면 null(묻지 않는다). 추적 카테고리는 대상이 될 수 없다(소모품이다).
 */
export function durableTargetCategory(f: Pick<ConvertFacts, 'trackedCats' | 'durableCounts' | 'propertyCategories'>): string | null {
  const ok = (c: string) => !f.trackedCats.includes(c) && f.propertyCategories.includes(c)
  const ranked = f.durableCounts.filter(d => d.count > 0 && ok(d.category))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ko'))
  if (ranked.length) return ranked[0].category
  return DURABLE_FALLBACK_CATEGORY && ok(DURABLE_FALLBACK_CATEGORY) ? DURABLE_FALLBACK_CATEGORY : null
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
const sameSet = (a: string[], b: string[]) => { const A = uniq(a), B = uniq(b); return A.length === B.length && A.every(x => B.includes(x)) }

/**
 * 영업장 사실 없이 가를 수 있는 앞 조건(추적 카테고리·호실 있는 품목·수정이면 이번에 바꿨나). 거짓이면 판정은 반드시 묻지
 * 않음이다. 화면은 이것이 참일 때만 서버에 사실을 묻는다(저장마다 왕복하지 않게). conversionPlan 도 이 함수로 시작한다.
 */
export function conversionPrecheck(input: ConvertInput, trackedCats: readonly string[]): boolean {
  if (!trackedCats.includes(input.category)) return false
  const items = input.items.map(it => ({ label: it.label.trim(), roomIds: uniq(it.roomIds) })).filter(it => it.label)
  if (!items.some(it => it.roomIds.length > 0)) return false
  const roomIds = uniq(items.flatMap(it => it.roomIds))
  if (input.original && input.original.category === input.category && sameSet(input.original.roomIds, roomIds)) return false
  return true
}

/**
 * 묻는가와 그 모양. 발동은 셋이 다 맞을 때다(계획서 설계 2단계).
 *   1. 저장하려는 카테고리가 추적(소모품) 카테고리다.
 *   2. 대상 호실이 적힌 품목이 있고, 그 품명에 이 지출 말고 추적 카테고리 구매 이력이 없다(이력이 곧 기억이다).
 *   3. 수정 폼이면 이번에 카테고리나 호실을 바꿨다('그대로 저장'을 골랐던 구매는 다시 묻지 않는다, 결정 3).
 * 대상 카테고리가 없으면(비품 이력도 기본 목록 이름도 없음) 묻지 않는다. 이미 받은 소모품(F3)은 품목 하나·호실 하나일
 * 때만 묻는다(그 방에 바로 배정한다. 받은 구매의 품목 나누기·방별 분배는 저장 경로가 먼저 수령 취소를 요구한다).
 */
export function conversionPlan(input: ConvertInput, facts: ConvertFacts): ConvertPlan {
  if (!conversionPrecheck(input, facts.trackedCats)) return { kind: 'none' }
  const items = input.items.map(it => ({ label: it.label.trim(), roomIds: uniq(it.roomIds) })).filter(it => it.label)
  const roomIds = uniq(items.flatMap(it => it.roomIds))
  const lead = items.find(it => it.roomIds.length > 0 && !facts.trackedHistoryLabels.includes(it.label))
  if (!lead) return { kind: 'none' }
  const target = durableTargetCategory(facts)
  if (!target) return { kind: 'none' }
  if (input.received && (items.length !== 1 || roomIds.length !== 1)) return { kind: 'none' }
  const others = uniq(items.map(it => it.label)).filter(l => l !== lead.label)
  return { kind: input.received ? 'F3' : 'F1', target, lead: lead.label, others, roomIds }
}

// ── 문구(UX 패널 보고 F1·F3 대사, 1단계 낱말: 배정·수령 완료·배정할 호실·'수령할 때 … 배정을 묻습니다') ──────────

const quoted = (label: string) => `'${label}'${hasFinalConsonant(label) ? '을' : '를'}`
/** 호실 목록 표기. 셋까지 '519호·520호', 넷 이상이면 '519호·외 3곳'(수령 대기 메타 plannedRoomsMeta 와 같은 접기). */
export function convertRoomsText(roomNos: string[]): string {
  const rooms = uniq(roomNos).map(n => fmtRoomNo(n, ''))
  return (rooms.length <= 3 ? rooms : [rooms[0], `외 ${rooms.length - 1}곳`]).join('·')
}
const othersText = (others: string[]) => others.length <= 2 ? others.join('·') : `${others[0]} 외 ${others.length - 1}개 품목`
const durableLabel = (target: string) => `비품(${target})`

export type ConvertCopy = { title: string; message: string; confirmLabel: string; altLabel: string }
export const CONVERT_CONFIRM_LABEL = '비품으로 저장'
export const CONVERT_ALT_LABEL = '그대로 저장'

/**
 * 저장 직전 창 문구. 버튼은 [취소][그대로 저장][비품으로 저장], 단계는 caution(물건이 반대편 장부로 가는 물음, 형제
 * 카테고리 이력 확인창과 같은 축). roomNos 는 plan.roomIds 의 호실 번호, from 은 '그대로 저장'이면 쓰일 카테고리.
 * F3 은 receivedMd(수령일 M/D)와 adjustChecks(이 수령분을 반영한 이후 점검 수, 함께 뺀다)를 받는다.
 */
export function conversionCopy(
  plan: Exclude<ConvertPlan, { kind: 'none' }>, ctx: { from: string; roomNos: string[]; receivedMd?: string; adjustChecks?: number },
): ConvertCopy {
  const rooms = convertRoomsText(ctx.roomNos)
  const durable = durableLabel(plan.target)
  if (plan.kind === 'F3') {
    const adjust = ctx.adjustChecks && ctx.adjustChecks > 0 ? ` 이 수령분을 이미 반영한 재고 점검 ${ctx.adjustChecks}건에서 그만큼을 함께 뺍니다.` : ''
    return {
      title: `${quoted(plan.lead)} 비품으로 바꿔 ${rooms}에 배정할까요?`,
      message: `이미 수령한 구매입니다. ${withParticle(durable, '으로/로')} 바꾸면 소모품 목록에서 빠지고 비품·자재의 ${rooms}에 들어갑니다. 배정일은 수령일(${ctx.receivedMd ?? ''})로 기록됩니다.${adjust}`,
      confirmLabel: CONVERT_CONFIRM_LABEL, altLabel: CONVERT_ALT_LABEL,
    }
  }
  const title = plan.others.length
    ? `'${plan.lead}' 외 ${plan.others.length}개 품목을 비품으로 바꿀까요?`
    : `${quoted(plan.lead)} 비품으로 바꿀까요?`
  const together = plan.others.length
    ? ` 카테고리는 지출 하나에 하나라 함께 적은 ${othersText(plan.others)}도 ${withParticle(durable, '이/가')} 됩니다.`
    : ''
  return {
    title,
    message: `대상 호실을 ${withParticle(rooms, '으로/로')} 적었습니다. ${withParticle(ctx.from, '으로/로')} 저장하면 소모품 재고로 잡혀 ${rooms}에 배정되지 않습니다. `
      + `${withParticle(durable, '으로/로')} 바꾸면 수령할 때 ${rooms} 배정을 묻습니다.${together}`,
    confirmLabel: CONVERT_CONFIRM_LABEL, altLabel: CONVERT_ALT_LABEL,
  }
}

/** 저장 뒤 토스트의 둘째 줄. 앱이 아직 배정하지 않은 F1 은 '배정했습니다'라고 쓰지 않는다. */
export function conversionToastDetail(kind: 'F1' | 'F3', target: string, roomNos: string[]): string {
  const rooms = convertRoomsText(roomNos)
  return kind === 'F3'
    ? `비품으로 바꾸고 ${rooms}에 배정했습니다.`
    : `${withParticle(durableLabel(target), '으로/로')} 저장했습니다. 수령할 때 ${rooms} 배정을 묻습니다.`
}

/** 적용취소 결과(§16 형식 '…를 적용취소했습니다 · …', 감지망 check-undo-verb). */
export function conversionUndoneText(kind: 'F1' | 'F3', from: string): string {
  return `${kind === 'F3' ? '비품 전환과 배정을' : '비품 전환을'} 적용취소했습니다 · ${withParticle(from, '으로/로')} 복귀`
}

/** F3 이 막혔을 때(창 대신) 저장 토스트 둘째 줄. 저장은 '그대로 저장'으로 간다. */
export const CONVERT_BLOCKED_MERGED = '직접 센 재고 점검이 이 수령에 합쳐져 있어 비품으로 바꾸지 않았습니다.'
export const CONVERT_BLOCKED_LEDGER = '이후 재고 점검과 수량이 맞지 않아 비품으로 바꾸지 않았습니다.'

// 서버가 전환 요청을 받았는데 지금 판정으로는 물을 일이 없다(화면을 연 뒤 이력·카테고리 목록이 바뀌었다).
export const DURABLE_CONVERT_STALE = '비품 전환 정보가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.'

// ── 적용취소 토큰 ────────────────────────────────────────────────────
// 토큰은 화면을 거쳐 돌아오는 값이다. 셋으로 닫는다(1단계 비품 수령 토큰과 같은 규칙, 검수 N-1).
//   1. 서명. 현금영수증 적용취소와 같은 정본(rooms/cashReceiptLine signUndoBody, 용도 DURABLE_CONVERT_UNDO_DOMAIN).
//   2. 범위. 대상 행은 그 영업장 비품 모집단 안이고 from 은 지금 추적 카테고리다(서버가 다시 본다).
//   3. 칸. 전환이 바꾼 칸만 되돌리고, 행마다 '전환 직후 그대로인가'를 조건으로 건다(CAS). 금액·수량은 건드리지 않는다.
export type AutoCheckSnap = {
  id: string; trackedItemId: string; date: string; createdAt: string
  remainingQty: number; memo: string | null; isReconcile: boolean; sourceExpenseId: string | null
  locations: { id: string; storageLocationId: string; remainingQty: number; restockedQty: number | null; fromHubQty: number | null; fromLocationId: string | null; carried: boolean | null }[]
}
export type DurableConvertUndo = {
  v: 1
  kind: 'F1' | 'F3'
  from: string            // 되돌릴 카테고리('그대로 저장'이면 쓰였을 추적 카테고리)
  to: string              // 바꾼 비품 카테고리
  // F1. 받기 전 행. 전환 직후 roomId 는 비고 자리는 targetRoomId 다. 되돌리면 roomId 가 그 방, targetRoomId 는 빈다.
  rows: { id: string; targetRoomId: string | null }[]
  // F3. 받은 행 하나. 그 방에 배정했다(roomId 는 전환 전후 같다). prev 는 배정 세 칸의 전환 전 값.
  placed: { id: string; roomId: string; assignedAt: string; prev: { assignedAt: string | null; assignedLocationId: string | null; isCommonAsset: boolean } } | null
  checks: AutoCheckSnap[]         // F3 이 걷은 수령 자동 점검(바이트 그대로 되살린다)
  shift: LedgerShiftUndo | null   // F3 이 이후 점검에서 함께 뺀 조정
  cards: TrackedItemDeleteUndo[]  // 지운 빈 자동 카드(같은 id 로 되살린다)
  seedLabels: string[]            // 등록 F1. 되돌리면 소모품 카드를 그때처럼 만든다
  logIds: string[]                // F3 배정 이력 줄
  sig?: string
}
export const DURABLE_CONVERT_UNDO_DOMAIN = 'expense-durable-convert'
export const DURABLE_CONVERT_UNDO_INVALID = '적용취소 정보가 유효하지 않습니다.'
export const DURABLE_CONVERT_UNDO_STALE = '비품으로 바꾼 뒤 이 지출이나 재고 기록이 바뀌어 되돌릴 수 없습니다. 재무 화면에서 직접 고쳐 주세요.'
export const DURABLE_CONVERT_UNDO_MAX = 500

/** 키 순서와 무관한 정본 문자열(객체 키를 정렬해 직렬화). 서명 대상이다. sig 는 뺀다. */
export function canonicalDurableConvertUndo(u: DurableConvertUndo): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm)
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      return Object.keys(o).filter(k => o[k] !== undefined).sort().reduce((acc, k) => { acc[k] = norm(o[k]); return acc }, {} as Record<string, unknown>)
    }
    return x
  }
  const { sig: _sig, ...body } = u
  void _sig
  return JSON.stringify(norm(body))
}

/** 화면을 거쳐 돌아온 값이 토큰 모양인가. 아니면 null. 이 동작이 만들 수 있는 모양만 받는다. */
export function parseDurableConvertUndo(x: unknown): DurableConvertUndo | null {
  if (!x || typeof x !== 'object') return null
  const u = x as Partial<DurableConvertUndo>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const strOrNull = (v: unknown) => v === null || typeof v === 'string'
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const numOrNull = (v: unknown) => v === null || num(v)
  const isTs = (v: unknown) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
  if (u.v !== 1 || (u.kind !== 'F1' && u.kind !== 'F3') || !str(u.from) || !str(u.to) || u.from === u.to) return null
  if (!Array.isArray(u.rows) || !Array.isArray(u.checks) || !Array.isArray(u.cards) || !Array.isArray(u.seedLabels) || !Array.isArray(u.logIds)) return null
  if (u.sig !== undefined && typeof u.sig !== 'string') return null
  if (u.rows.length > DURABLE_CONVERT_UNDO_MAX || u.checks.length > DURABLE_CONVERT_UNDO_MAX || u.cards.length > DURABLE_CONVERT_UNDO_MAX
    || u.seedLabels.length > DURABLE_CONVERT_UNDO_MAX || u.logIds.length > DURABLE_CONVERT_UNDO_MAX) return null
  for (const r of u.rows) if (!r || !str(r.id) || !strOrNull(r.targetRoomId)) return null
  if (!u.seedLabels.every(str) || !u.logIds.every(str)) return null
  if (u.kind === 'F1') {
    // F1 은 받기 전 행만 바꾼다. 배정·점검·조정·이력이 없다.
    if (!u.rows.length || u.placed != null || u.checks.length || u.shift != null || u.logIds.length) return null
  } else {
    const p = u.placed
    if (!p || !str(p.id) || !str(p.roomId) || !isTs(p.assignedAt) || !p.prev) return null
    if (!(p.prev.assignedAt === null || isTs(p.prev.assignedAt)) || !strOrNull(p.prev.assignedLocationId) || typeof p.prev.isCommonAsset !== 'boolean') return null
    // F3 은 받은 행 하나만 바꾼다. 예정 호실 행(rows)·등록 시드가 없다.
    if (u.rows.length || u.seedLabels.length || u.logIds.length !== 1) return null
    for (const c of u.checks) {
      if (!c || !str(c.id) || !str(c.trackedItemId) || !isTs(c.date) || !isTs(c.createdAt) || !num(c.remainingQty) || !strOrNull(c.memo)
        || typeof c.isReconcile !== 'boolean' || c.sourceExpenseId !== p.id || !Array.isArray(c.locations)) return null
      for (const l of c.locations) {
        if (!l || !str(l.id) || !str(l.storageLocationId) || !num(l.remainingQty) || !numOrNull(l.restockedQty) || !numOrNull(l.fromHubQty)
          || !strOrNull(l.fromLocationId) || !(l.carried === null || typeof l.carried === 'boolean')) return null
      }
    }
    if (u.shift != null) {
      const s = u.shift as Partial<LedgerShiftUndo>
      if (!str(s.trackedItemId) || !Array.isArray(s.checks) || !Array.isArray(s.createdLinks)) return null
    }
  }
  for (const c of u.cards) {
    const it = (c as Partial<TrackedItemDeleteUndo> | null)?.item
    // 카드의 카테고리는 저장돼 있던 소모품 카테고리다(from 과 다를 수 있다. 서버가 지금 추적 카테고리인지 본다).
    if (!c || !it || !str(it.id) || !str(it.category) || !str(it.label) || !Array.isArray(c.locations) || !Array.isArray(c.drafts) || !Array.isArray(c.mergeRules)) return null
  }
  const ids = [...u.rows.map(r => r.id), ...(u.placed ? [u.placed.id] : [])]
  if (new Set(ids).size !== ids.length) return null
  return u as DurableConvertUndo
}
