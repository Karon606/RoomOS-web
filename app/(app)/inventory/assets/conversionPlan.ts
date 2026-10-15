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
import { cleanUnit } from '@/lib/receiptOcr'
import { WORK_EXPENSE_CATEGORY } from '@/app/(app)/room-manage/cleaningConstants'
import type { LedgerShiftUndo } from '@/app/(app)/inventory/ledgerShift'
import type { TrackedItemDeleteUndo } from '@/app/(app)/inventory/trackedItemSnapshot'
import { DOT, SEP } from '@/app/(app)/inventory/assets/receiptPlacement'

// ── 판정 ───────────────────────────────────────────────────────────

/** 품목의 정체·수량 칸(받은 소모품 전환 F3 가 '같은 저장에서 안 바꿨나'를 보는 칸). 원장 델타를 정하는 칸이다. */
export type ItemFacets = { label: string; qty: number; qtyUnit: string | null; specValue: number | null; specUnit: string | null }
/**
 * 저장하려는 지출의 품목 한 줄. roomIds 는 방별 분배면 각 조각의 호실, 아니면 폼의 대상 호실 하나(없으면 빈 배열).
 * allocated 는 방별 분배가 켜졌는가(저장 경로가 품목 나누기·분배 갈래로 간다).
 */
export type ConvertItem = { label: string; roomIds: string[]; allocated?: boolean; facets?: ItemFacets }
export type ConvertInput = {
  category: string                 // 지금 저장하려는 카테고리('그대로 저장'이면 이 값으로 저장된다)
  items: ConvertItem[]
  received: boolean                // 수정 폼이고 이미 수령한 구매(F3)
  // 수정 폼이면 저장돼 있던 값. 등록이면 없음
  original?: { category: string; roomIds: string[]; facets?: ItemFacets | null } | null
}
/** 받은 소모품의 수령 자동 점검을 정본 수령 취소로 걷을 수 있는가(서버 receiptConvertPreview). */
export type ReceiptFact = { blocked: 'merged' | 'ledger' | null; needsAdjust: boolean; adjustChecks: number }
/** 영업장 사실(서버 loadDurableConvertFacts 가 모은다). */
export type ConvertFacts = {
  trackedCats: readonly string[]
  trackedHistoryLabels: readonly string[]                      // 이 지출 말고 추적 카테고리 구매가 있는 품명
  durableCounts: readonly { category: string; count: number }[] // 비품 물품(비품 화면 모집단의 물품 갈래) 카테고리별 건수
  labelDurableCounts?: readonly { label: string; category: string; count: number }[] // 그 품명들의 비품 카테고리별 건수
  propertyCategories: readonly string[]                         // 그 영업장 지출 카테고리 목록
  receipt?: ReceiptFact | null                                  // 수정 폼의 받은 소모품이면 수령 취소 미리보기
}
export type ConvertPlan =
  | { kind: 'none' }
  | {
      kind: 'F1' | 'F3'      // F1 = 받기 전(등록·수정), F3 = 이미 받은 소모품의 수정
      target: string          // 바꿀 비품 카테고리
      lead: string            // 창 제목에 이름이 서는 품목(호실이 있고 소모품 이력이 없는 첫 품목)
      others: string[]        // 함께 비품이 되는 나머지 품목(카테고리는 지출 하나에 하나다, 운영자 결정 6)
      roomIds: string[]       // 적힌 대상 호실(순서 유지, 중복 없음)
      adjust: { needs: boolean; checks: number }   // F3 이후 점검 함께 조정(정본 adjustFollowing)이 필요한가와 그 수
    }
  | {
      // 물을 조건은 맞지만 바꿀 수 없다. '비품으로 저장'을 주지 않고 [취소][그대로 저장]만 묻는다.
      //   mixed  함께 적은 품목에 소모품 이력이 있다(같은 품명이 양쪽에 서서 장부 축 1 갈림이 생긴다, 결정 6 을 좁힘)
      //   merged 받은 소모품의 자동 점검에 직접 센 점검이 합쳐졌다   ledger 이후 점검과 수량이 맞지 않는다
      kind: 'blocked'
      reason: 'mixed' | 'merged' | 'ledger'
      lead: string
      others: string[]
      mixedLabels: string[]
      roomIds: string[]
    }

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
/** 품목 칸을 비교할 모양으로. 단위는 저장 경로와 같은 정화(cleanUnit), 수량 미기록은 1(재고 셈과 같다). */
export function itemFacets(x: { label?: string | null; qtyValue?: unknown; qtyUnit?: string | null; specValue?: unknown; specUnit?: string | null }): ItemFacets {
  return { label: (x.label ?? '').trim(), qty: num(x.qtyValue) ?? 1, qtyUnit: cleanUnit(x.qtyUnit) ?? null, specValue: num(x.specValue), specUnit: cleanUnit(x.specUnit) ?? null }
}
const sameFacets = (a: ItemFacets | null | undefined, b: ItemFacets | null | undefined) =>
  !!a && !!b && a.label === b.label && Math.abs(a.qty - b.qty) < 1e-9 && a.qtyUnit === b.qtyUnit && a.specValue === b.specValue && a.specUnit === b.specUnit

/**
 * 폼의 품목 목록에서 판정 입력을 만든다. 화면(저장 직전)과 서버(addExpense·updateExpense)가 같은 함수로 만든다.
 * 방별 분배가 있으면 그 조각들의 호실, 없으면 폼의 대상 호실 하나(formRoomId, 폼이 실은 roomId 값 그대로).
 * 분배 조각 중 호실이 빈 것(미지정 나머지)은 호실이 아니다. 저장 경로의 행 펼치기(expandExpenseRows)와 같은 셈이다.
 */
export function convertItemsFrom(
  items: { label?: string | null; allocations?: { roomId?: string | null; qty?: string | null }[] | null; qtyValue?: unknown; qtyUnit?: string | null; specValue?: unknown; specUnit?: string | null }[],
  formRoomId: string | null,
): ConvertItem[] {
  return items.map(it => {
    const allocs = (Array.isArray(it.allocations) ? it.allocations : []).filter(a => a && (a.roomId || a.qty))
    return {
      label: (it.label ?? '').trim(),
      roomIds: allocs.length ? allocs.map(a => a.roomId ?? '').filter(Boolean) : (formRoomId ? [formRoomId] : []),
      allocated: allocs.length > 0,
      facets: itemFacets(it),
    }
  })
}

/** 비품 이력이 없을 때 쓰는 카테고리. 앱 기본 지출 목록의 수선유지비(작업 완료가 이 이름으로 지출을 만든다). */
export const DURABLE_FALLBACK_CATEGORY: string | null =
  OPTION_LIST_DEFAULTS.expenseCategories.includes(WORK_EXPENSE_CATEGORY) ? WORK_EXPENSE_CATEGORY : null

/**
 * 비품으로 바꿀 때의 카테고리(운영자 결정 1, 2단계 검수 R7 로 품명 이력을 앞에).
 *   1. 그 품명(lead)에 비품 이력이 있으면 그 품명의 최빈 비품 카테고리.
 *   2. 없으면 그 영업장 비품 물품을 가장 많이 담은 카테고리(동수면 가나다 앞).
 *   3. 비품 이력이 아예 없으면 기본 목록의 수선유지비가 그 영업장 목록에 있을 때만, 아니면 null(묻지 않는다).
 * 영업장 지출 카테고리 목록에 있는 것만 본다(목록에서 뺀 이름으로 저장하면 저장 경로가 목록에 되살린다). 추적 카테고리는 대상이 아니다.
 */
export function durableTargetCategory(
  f: Pick<ConvertFacts, 'trackedCats' | 'durableCounts' | 'propertyCategories' | 'labelDurableCounts'>, lead?: string | null,
): string | null {
  const ok = (c: string) => !f.trackedCats.includes(c) && f.propertyCategories.includes(c)
  const top = (rows: readonly { category: string; count: number }[]) => rows.filter(d => d.count > 0 && ok(d.category))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ko'))[0]?.category ?? null
  const byLabel = lead ? top((f.labelDurableCounts ?? []).filter(d => d.label === lead)) : null
  if (byLabel) return byLabel
  const byProperty = top(f.durableCounts)
  if (byProperty) return byProperty
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
 * 대상 카테고리가 없으면(비품 이력도 기본 목록 이름도 없음) 묻지 않는다.
 * 함께 적은 품목에 소모품 이력이 있으면 'blocked'(mixed)다. 바꾸면 그 품명이 소모품·비품 양쪽에 서기 때문이다(검수 R6).
 * 이미 받은 소모품(F3)은 저장 경로가 단일 갈래일 때(품목 하나·방별 분배 없음·호실 하나)만, 그리고 같은 저장에서 품명·수량·
 * 규격·단위를 안 바꿨을 때만 묻는다(바꾸면 원장 델타가 달라져 적용취소가 맞지 않는다, 검수 R1·R3). 수령 자동 점검을 걷을
 * 수 없으면 'blocked'(merged·ledger)다. 수령 취소 미리보기(facts.receipt)가 없으면 판정할 수 없어 묻지 않는다.
 */
export function conversionPlan(input: ConvertInput, facts: ConvertFacts): ConvertPlan {
  if (!conversionPrecheck(input, facts.trackedCats)) return { kind: 'none' }
  const items = input.items.map(it => ({ ...it, label: it.label.trim(), roomIds: uniq(it.roomIds) })).filter(it => it.label)
  const roomIds = uniq(items.flatMap(it => it.roomIds))
  const lead = items.find(it => it.roomIds.length > 0 && !facts.trackedHistoryLabels.includes(it.label))
  if (!lead) return { kind: 'none' }
  const target = durableTargetCategory(facts, lead.label)
  if (!target) return { kind: 'none' }
  const others = uniq(items.map(it => it.label)).filter(l => l !== lead.label)
  const mixedLabels = others.filter(l => facts.trackedHistoryLabels.includes(l))
  if (input.received) {
    if (items.length !== 1 || lead.allocated || roomIds.length !== 1) return { kind: 'none' }
    if (!sameFacets(lead.facets, input.original?.facets)) return { kind: 'none' }
    const rc = facts.receipt
    if (!rc) return { kind: 'none' }
    if (rc.blocked) return { kind: 'blocked', reason: rc.blocked, lead: lead.label, others, mixedLabels: [], roomIds }
    return { kind: 'F3', target, lead: lead.label, others, roomIds, adjust: { needs: rc.needsAdjust, checks: rc.adjustChecks } }
  }
  if (mixedLabels.length) return { kind: 'blocked', reason: 'mixed', lead: lead.label, others, mixedLabels, roomIds }
  return { kind: 'F1', target, lead: lead.label, others, roomIds, adjust: { needs: false, checks: 0 } }
}

// ── 문구(UX 패널 F1·F3 대사, 1단계 낱말, 2단계 웹디자이너 패스 1·2·3·4·5·6·9, 2b) ─────────────────
// 가운뎃점은 1단계 정본 표기를 쓴다. 목록 안은 DOT, 띄운 구분점은 SEP(줄머리에 점이 서지 않게, 웹디자이너 2b N1·R1).

const quoted = (label: string) => `'${label}'${hasFinalConsonant(label) ? '을' : '를'}`
/** 소모품 이력이 있는 함께 적은 품목(주제). 둘까지 '휴지'·'물티슈'는, 셋 이상이면 '휴지' 외 2개 품목은. */
const mixedTopic = (labels: string[]) => labels.length <= 2
  ? `${labels.map(l => `'${l}'`).join(DOT)}${hasFinalConsonant(labels[labels.length - 1]) ? '은' : '는'}`
  : `'${labels[0]}' 외 ${labels.length - 1}개 품목은`
/** 호실 목록 표기(문장용). 셋까지 '519호·520호', 넷 이상이면 '519호 외 3곳'(디자이너 5, 문장 안에서는 가운뎃점을 안 붙인다). */
export function convertRoomsText(roomNos: string[]): string {
  const rooms = uniq(roomNos).map(n => fmtRoomNo(n, ''))
  return rooms.length <= 3 ? rooms.join(DOT) : `${rooms[0]} 외 ${rooms.length - 1}곳`
}
const othersText = (others: string[]) => others.length <= 2 ? others.join(DOT) : `${others[0]} 외 ${others.length - 1}개 품목`
/** 대상 카테고리로 바꾸면 무엇이 되는가. 이름에 '비품'이 이미 있으면 되풀이하지 않는다(디자이너 4). */
const becomeDurable = (target: string) => /비품/.test(target) ? '' : '비품이 되어 '
const titleSubject = (lead: string, others: string[]) => others.length ? `'${lead}' 외 ${others.length}개 품목을` : quoted(lead)

export type ConvertCopy = { title: string; message: string; confirmLabel: string; altLabel?: string }
export const CONVERT_CONFIRM_LABEL = '비품으로 저장'
export const CONVERT_ALT_LABEL = '그대로 저장'
/** 전환 토스트의 적용취소 라벨(§16 명사 보강, 같은 저장의 다른 입력은 안 무른다는 뜻, 디자이너 2). */
export const CONVERT_UNDO_LABEL = '전환 적용취소'

/**
 * 저장 직전 창 문구. 단계는 caution(물건이 반대편 장부로 가는 물음, 형제 카테고리 이력 확인창과 같은 축).
 * 바꿀 수 있으면 [취소][그대로 저장][비품으로 저장], 막혔으면(blocked) [취소][그대로 저장]이다(디자이너 1·검수 R6).
 * roomNos 는 plan.roomIds 의 호실 번호, from 은 '그대로 저장'이면 쓰일 카테고리. F3 은 receivedMd(수령일 M/D)를 받는다.
 * 카테고리는 괄호로 달지 않고 목적어로 쓴다(디자이너 3, 좁은 폭에서 괄호 뒤 조사가 줄 머리로 떨어졌다).
 */
export function conversionCopy(plan: Exclude<ConvertPlan, { kind: 'none' }>, ctx: { from: string; roomNos: string[]; receivedMd?: string }): ConvertCopy {
  const rooms = convertRoomsText(ctx.roomNos)
  if (plan.kind === 'blocked') {
    const why = plan.reason === 'merged' ? '이미 수령한 소모품이고 직접 센 재고 점검이 이 수령에 합쳐져 있어'
      : plan.reason === 'ledger' ? '이미 수령한 소모품이고 이후 재고 점검과 수량이 맞지 않아'
      : `함께 적은 ${mixedTopic(plan.mixedLabels)} 지금까지 소모품으로 구매해 온 품목이라 이\u00a0지출은`   // '이 지출은' 은 한 덩이(2b R4)
    const split = plan.reason === 'mixed' ? ` ${quoted(plan.lead)} 따로 등록하면 비품으로 바꿀 수 있습니다.` : ''
    return {
      title: `${titleSubject(plan.lead, plan.others)} 소모품으로 저장할까요?`,
      message: `대상 호실을 ${withParticle(rooms, '으로/로')} 적었지만 ${why} 비품으로 바꿀 수 없습니다.${split} 그대로 저장하면 ${rooms}에 배정되지 않습니다.`,
      confirmLabel: CONVERT_ALT_LABEL,
    }
  }
  const to = `${withParticle(plan.target, '으로/로')} 바꾸면 ${becomeDurable(plan.target)}`
  if (plan.kind === 'F3') {
    const adjust = plan.adjust.checks > 0 ? ` 이 수령분을 이미 반영한 재고 점검 ${plan.adjust.checks}건의 잔량도 함께 줄입니다.` : ''
    return {
      title: `${quoted(plan.lead)} 비품으로 바꿔 ${rooms}에 배정할까요?`,
      message: `이미 수령한 구매입니다. ${to}소모품 재고에서 빠지고 비품 화면의 ${rooms}에 들어갑니다. 배정일은 수령일인 ${withParticle(ctx.receivedMd ?? '', '으로/로')} 기록됩니다.${adjust}`,
      confirmLabel: CONVERT_CONFIRM_LABEL, altLabel: CONVERT_ALT_LABEL,
    }
  }
  // '함께 비품이 됩니다.'는 한 덩이로 묶는다. 끝줄에 '됩니다.'만 남지 않게(웹디자이너 2b R2).
  const together = plan.others.length ? ` 카테고리는 지출 단위라 ${othersText(plan.others)}도 함께\u00a0비품이\u00a0됩니다.` : ''
  return {
    title: `${titleSubject(plan.lead, plan.others)} 비품으로 바꿀까요?`,
    message: `대상 호실을 ${withParticle(rooms, '으로/로')} 적었습니다. ${withParticle(ctx.from, '으로/로')} 저장하면 소모품 재고로 잡혀 ${rooms}에 배정되지 않습니다. `
      + `${to}수령할 때 ${rooms} 배정을 묻습니다.${together}`,
    confirmLabel: CONVERT_CONFIRM_LABEL, altLabel: CONVERT_ALT_LABEL,
  }
}

/**
 * 저장 뒤 토스트(디자이너 2·2b R3). 결과는 머리줄에 올린다. F1·F3 모두 '지출 등록됨 · 비품'(귀속월이 다르면 '· 9월분' 뒤에).
 * F1 의 둘째 줄은 앱이 아직 배정하지 않았으므로 '배정을 묻습니다'. F3 는 배정까지 했으므로 둘째 줄이 결과다('비품으로 바꿔'는
 * 머리줄이 말하므로 되풀이하지 않는다). base 는 형제 토스트의 머리('지출 등록됨'·'지출 등록됨 · 9월분'·'지출 수정됨').
 */
export function conversionToast(kind: 'F1' | 'F3', base: string, roomNos: string[], adjustChecks = 0): { text: string; detail: string } {
  const rooms = convertRoomsText(roomNos)
  const text = `${base}${SEP}비품`
  if (kind === 'F3') {
    return { text, detail: adjustChecks > 0 ? `${rooms}에 배정하고 재고 점검 ${adjustChecks}건을 조정했습니다.` : `${rooms}에 배정했습니다.` }
  }
  return { text, detail: `수령할 때 ${rooms} 배정을 묻습니다.` }
}

/** 적용취소 결과(§16 형식 '…를 적용취소했습니다 · …', 감지망 check-undo-verb). 구분점은 SEP, '…로 복귀'는 줄이 갈리지 않게 묶는다. */
export function conversionUndoneText(kind: 'F1' | 'F3', from: string): string {
  return `${kind === 'F3' ? '비품 전환과 배정을' : '비품 전환을'} 적용취소했습니다${SEP}${withParticle(from, '으로/로')}\u00a0복귀`
}

// 서버가 전환 요청을 받았는데 지금 판정과 다르다(화면을 연 뒤 이력·카테고리 목록이 바뀌었다). 다시 저장을 누르면 화면이 새 사실로
// 다시 판정한다. 새로고침하면 적던 입력이 사라지므로 새로고침을 권하지 않는다(검수 R1, X4).
export const DURABLE_CONVERT_STALE = '비품 전환 정보가 바뀌었습니다. 다시 저장을 눌러 주세요.'

// ── 적용취소 토큰 ────────────────────────────────────────────────────
// 토큰은 화면을 거쳐 돌아오는 값이다. 셋으로 닫는다(1단계 비품 수령 토큰과 같은 규칙, 검수 N-1).
//   1. 서명. 현금영수증 적용취소와 같은 정본(rooms/cashReceiptLine signUndoBody, 용도 DURABLE_CONVERT_UNDO_DOMAIN).
//   2. 범위. 대상 행은 그 영업장 것이고 from 은 지금 추적 카테고리다(서버가 다시 본다).
//   3. 칸. 전환이 바꾼 칸만 되돌리고, 행마다 '전환 직후 그대로인가'를 조건으로 건다(CAS). 품명·수량·규격·단위도 전환 직후
//      그대로여야 한다. 그 뒤 바뀌었으면 되살린 자동 점검·카드와 원장 델타가 어긋난다(검수 R3, X2·X2b·X3).
export type AutoCheckSnap = {
  id: string; trackedItemId: string; date: string; createdAt: string
  remainingQty: number; memo: string | null; isReconcile: boolean; sourceExpenseId: string | null
  locations: { id: string; storageLocationId: string; remainingQty: number; restockedQty: number | null; fromHubQty: number | null; fromLocationId: string | null; carried: boolean | null }[]
}
/** 전환 직후 행의 품목 칸(적용취소 CAS). DB 값 그대로다. */
export type RowNow = { itemLabel: string | null; qtyValue: number | null; qtyUnit: string | null; specValue: number | null; specUnit: string | null }
export type DurableConvertUndo = {
  v: 1
  kind: 'F1' | 'F3'
  from: string            // 되돌릴 카테고리('그대로 저장'이면 쓰였을 추적 카테고리)
  to: string              // 바꾼 비품 카테고리
  // F1. 받기 전 행. 전환 직후 roomId 는 비고 자리는 targetRoomId 다. 되돌리면 roomId 가 그 방, targetRoomId 는 빈다.
  rows: { id: string; targetRoomId: string | null; now: RowNow }[]
  // F3. 받은 행 하나. 그 방에 배정했다(roomId 는 전환 전후 같다). prev 는 배정 세 칸의 전환 전 값.
  placed: { id: string; roomId: string; assignedAt: string; now: RowNow; prev: { assignedAt: string | null; assignedLocationId: string | null; isCommonAsset: boolean } } | null
  checks: AutoCheckSnap[]         // F3 이 걷은 수령 자동 점검(바이트 그대로 되살린다)
  shift: LedgerShiftUndo | null   // F3 이 이후 점검에서 함께 뺀 조정
  cards: TrackedItemDeleteUndo[]  // 지운 빈 자동 카드(같은 id 로 되살린다)
  seedLabels: string[]            // 등록 F1. 되돌리면 소모품 카드를 그때처럼 만든다
  logIds: string[]                // F3 배정 이력 줄
  sig?: string
}
export const rowNowOf = (r: RowNow): RowNow => ({ itemLabel: r.itemLabel, qtyValue: r.qtyValue, qtyUnit: r.qtyUnit, specValue: r.specValue, specUnit: r.specUnit })
export const DURABLE_CONVERT_UNDO_DOMAIN = 'expense-durable-convert'
export const DURABLE_CONVERT_UNDO_INVALID = '적용취소 정보가 유효하지 않습니다.'
export const DURABLE_CONVERT_UNDO_STALE = '비품으로 바꾼 뒤 기록이 바뀌어 적용취소할 수 없습니다. 지출 상세에서 직접 고쳐 주세요.'
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
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const numOrNull = (v: unknown) => v === null || isNum(v)
  const isTs = (v: unknown) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
  const nowOk = (n: unknown) => {
    const r = n as Partial<RowNow> | null
    return !!r && strOrNull(r.itemLabel) && numOrNull(r.qtyValue) && strOrNull(r.qtyUnit) && numOrNull(r.specValue) && strOrNull(r.specUnit)
  }
  if (u.v !== 1 || (u.kind !== 'F1' && u.kind !== 'F3') || !str(u.from) || !str(u.to) || u.from === u.to) return null
  if (!Array.isArray(u.rows) || !Array.isArray(u.checks) || !Array.isArray(u.cards) || !Array.isArray(u.seedLabels) || !Array.isArray(u.logIds)) return null
  if (u.sig !== undefined && typeof u.sig !== 'string') return null
  if (u.rows.length > DURABLE_CONVERT_UNDO_MAX || u.checks.length > DURABLE_CONVERT_UNDO_MAX || u.cards.length > DURABLE_CONVERT_UNDO_MAX
    || u.seedLabels.length > DURABLE_CONVERT_UNDO_MAX || u.logIds.length > DURABLE_CONVERT_UNDO_MAX) return null
  for (const r of u.rows) if (!r || !str(r.id) || !strOrNull(r.targetRoomId) || !nowOk(r.now)) return null
  if (!u.seedLabels.every(str) || !u.logIds.every(str)) return null
  if (u.kind === 'F1') {
    // F1 은 받기 전 행만 바꾼다. 배정·점검·조정·이력이 없다.
    if (!u.rows.length || u.placed != null || u.checks.length || u.shift != null || u.logIds.length) return null
  } else {
    const p = u.placed
    if (!p || !str(p.id) || !str(p.roomId) || !isTs(p.assignedAt) || !p.prev || !nowOk(p.now)) return null
    if (!(p.prev.assignedAt === null || isTs(p.prev.assignedAt)) || !strOrNull(p.prev.assignedLocationId) || typeof p.prev.isCommonAsset !== 'boolean') return null
    // F3 은 받은 행 하나만 바꾼다. 예정 호실 행(rows)·등록 시드가 없다.
    if (u.rows.length || u.seedLabels.length || u.logIds.length !== 1) return null
    for (const c of u.checks) {
      if (!c || !str(c.id) || !str(c.trackedItemId) || !isTs(c.date) || !isTs(c.createdAt) || !isNum(c.remainingQty) || !strOrNull(c.memo)
        || typeof c.isReconcile !== 'boolean' || c.sourceExpenseId !== p.id || !Array.isArray(c.locations)) return null
      for (const l of c.locations) {
        if (!l || !str(l.id) || !str(l.storageLocationId) || !isNum(l.remainingQty) || !numOrNull(l.restockedQty) || !numOrNull(l.fromHubQty)
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
