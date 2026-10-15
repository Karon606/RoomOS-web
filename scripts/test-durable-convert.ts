// 비품 전환 판정·문구·토큰 순수층(app/(app)/inventory/assets/conversionPlan) 진리표. 실패 시 exit 1.
// 실행: npx tsx scripts/test-durable-convert.ts
//
// 왜(2026-10-15 계획서 비품-전환-배정 2단계). 화면(저장 직전 창)과 서버(저장이 받을지)가 이 판정 하나를 부른다.
// 발동 셋(추적 카테고리·대상 호실·그 품명 소모품 이력 없음)과 수정 폼의 '이번에 바꿨을 때만', 대상 카테고리 규칙
// (그 영업장 비품 최빈, 없으면 기본 목록의 수선유지비가 목록에 있을 때만)을 여기서 고정한다. 금액·낱말은 안 본다.
import {
  conversionPlan, conversionPrecheck, durableTargetCategory, conversionCopy, conversionToastDetail, conversionUndoneText, convertItemsFrom, convertRoomsText,
  canonicalDurableConvertUndo, parseDurableConvertUndo, DURABLE_FALLBACK_CATEGORY, CONVERT_BLOCKED_MERGED, CONVERT_BLOCKED_LEDGER,
  DURABLE_CONVERT_STALE, DURABLE_CONVERT_UNDO_INVALID, DURABLE_CONVERT_UNDO_STALE,
  type ConvertFacts, type ConvertInput, type DurableConvertUndo,
} from '../app/(app)/inventory/assets/conversionPlan'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fails.push(`${name}\n    기대 ${w}\n    실제 ${g}`)
}

const TRACKED = ['부식비', '소모품비', '폐기물 처리비']
const LIST = ['부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '집기 비품']
const facts = (o: Partial<ConvertFacts> = {}): ConvertFacts => ({
  trackedCats: TRACKED, trackedHistoryLabels: [], durableCounts: [{ category: '수선유지비', count: 316 }], propertyCategories: LIST, ...o,
})
const FRIDGE = '갈란츠 미니 1도어 냉장고'
const add = (o: Partial<ConvertInput> = {}): ConvertInput => ({ category: '소모품비', items: [{ label: FRIDGE, roomIds: ['R519'] }], received: false, original: null, ...o })

// ── 발동
const f1 = conversionPlan(add(), facts())
eq('냉장고: 소모품비 + 519호 + 이력 없음은 F1', f1, { kind: 'F1', target: '수선유지비', lead: FRIDGE, others: [], roomIds: ['R519'] })
eq('호실이 없으면 묻지 않는다', conversionPlan(add({ items: [{ label: FRIDGE, roomIds: [] }] }), facts()), { kind: 'none' })
eq('비품 카테고리로 저장하면 묻지 않는다', conversionPlan(add({ category: '수선유지비' }), facts()), { kind: 'none' })
eq('서비스성 카테고리(공과금)도 추적 밖이라 묻지 않는다', conversionPlan(add({ category: '공과금' }), facts()), { kind: 'none' })
eq('그 품명에 소모품 이력이 있으면 침묵(이력이 곧 기억)', conversionPlan(add(), facts({ trackedHistoryLabels: [FRIDGE] })), { kind: 'none' })
eq('다른 품명의 이력은 상관없다', conversionPlan(add(), facts({ trackedHistoryLabels: ['쌀 20kg'] })).kind, 'F1')
eq('금액·낱말을 안 본다(쌀 20kg 도 호실 + 이력 없음이면 묻는다)', conversionPlan(add({ items: [{ label: '쌀 20kg', roomIds: ['R519'] }] }), facts()).kind, 'F1')
eq('사용자 정의 추적 카테고리(멀티테넌트)', conversionPlan(add({ category: '식자재' }), facts({ trackedCats: ['식자재'] })).kind, 'F1')
eq('품명이 비면 묻지 않는다', conversionPlan(add({ items: [{ label: '  ', roomIds: ['R519'] }] }), facts()), { kind: 'none' })

// ── 앞 조건(화면이 서버에 사실을 물을지). 거짓이면 판정은 늘 묻지 않음
eq('앞 조건: 소모품 + 호실이면 참', conversionPrecheck(add(), TRACKED), true)
eq('앞 조건: 비품 카테고리는 거짓', conversionPrecheck(add({ category: '수선유지비' }), TRACKED), false)
eq('앞 조건: 호실 없으면 거짓', conversionPrecheck(add({ items: [{ label: FRIDGE, roomIds: [] }] }), TRACKED), false)
eq('앞 조건: 수정에서 안 바꿨으면 거짓', conversionPrecheck(add({ original: { category: '소모품비', roomIds: ['R519'] } }), TRACKED), false)
eq('앞 조건이 거짓이면 판정도 묻지 않음(같은 함수로 시작)', [add({ category: '공과금' }), add({ items: [{ label: FRIDGE, roomIds: [] }] }), add({ original: { category: '소모품비', roomIds: ['R519'] } })]
  .map(i => conversionPrecheck(i, TRACKED) || conversionPlan(i, facts()).kind === 'none'), [true, true, true])

// ── 다품목·방별 분배
const multi = conversionPlan(add({ items: [{ label: FRIDGE, roomIds: ['R519'] }, { label: '멀티탭', roomIds: [] }] }), facts())
eq('다품목: 한 품목만 호실이어도 묻고 함께 바뀌는 품목을 싣는다', multi, { kind: 'F1', target: '수선유지비', lead: FRIDGE, others: ['멀티탭'], roomIds: ['R519'] })
eq('다품목: 호실 있는 품목에 이력이 있고 다른 품목에 없으면 그 품목이 앞', conversionPlan(add({ items: [{ label: '휴지', roomIds: ['R519'] }, { label: FRIDGE, roomIds: ['R520'] }] }), facts({ trackedHistoryLabels: ['휴지'] })),
  { kind: 'F1', target: '수선유지비', lead: FRIDGE, others: ['휴지'], roomIds: ['R519', 'R520'] })
eq('다품목: 호실 있는 품목이 전부 이력이 있으면 침묵', conversionPlan(add({ items: [{ label: '휴지', roomIds: ['R519'] }, { label: FRIDGE, roomIds: [] }] }), facts({ trackedHistoryLabels: ['휴지'] })), { kind: 'none' })
eq('방별 분배: 조각 호실 전부를 싣는다(중복 없이)', conversionPlan(add({ items: [{ label: '선풍기', roomIds: ['R519', 'R520', 'R519'] }] }), facts()).kind === 'F1'
  && (conversionPlan(add({ items: [{ label: '선풍기', roomIds: ['R519', 'R520', 'R519'] }] }), facts()) as { roomIds: string[] }).roomIds.join(), 'R519,R520')

// ── 폼 품목에서 판정 입력 만들기(화면·서버 공용, 저장 경로의 행 펼치기와 같은 셈)
eq('분배 없으면 폼 호실 하나', convertItemsFrom([{ label: FRIDGE }], 'R519'), [{ label: FRIDGE, roomIds: ['R519'] }])
eq('분배가 있으면 조각 호실(호실 빈 나머지 조각은 호실 아님)', convertItemsFrom([{ label: '선풍기', allocations: [{ roomId: 'R519', qty: '1' }, { roomId: '', qty: '1' }] }], null), [{ label: '선풍기', roomIds: ['R519'] }])
eq('빈 분배 칸만 있으면 분배 아님(폼 호실)', convertItemsFrom([{ label: '선풍기', allocations: [{ roomId: '', qty: '' }] }], 'R1'), [{ label: '선풍기', roomIds: ['R1'] }])
eq('폼 호실이 비면 호실 없음', convertItemsFrom([{ label: FRIDGE }], null), [{ label: FRIDGE, roomIds: [] }])

// ── 수정 폼: 이번에 카테고리나 호실을 바꿨을 때만
const orig = { category: '소모품비', roomIds: ['R519'] }
eq('수정: 아무것도 안 바꾸면 묻지 않는다(그대로 저장했던 구매)', conversionPlan(add({ original: orig }), facts()), { kind: 'none' })
eq('수정: 호실을 바꾸면 묻는다', conversionPlan(add({ original: { category: '소모품비', roomIds: [] } }), facts()).kind, 'F1')
eq('수정: 다른 호실로 바꿔도 묻는다', conversionPlan(add({ original: { category: '소모품비', roomIds: ['R520'] } }), facts()).kind, 'F1')
eq('수정: 소모품끼리 카테고리를 바꾸면 묻는다', conversionPlan(add({ original: { category: '부식비', roomIds: ['R519'] } }), facts()).kind, 'F1')
eq('수정: 비품에서 소모품으로 바꾸면 묻는다', conversionPlan(add({ original: { category: '수선유지비', roomIds: ['R519'] } }), facts()).kind, 'F1')

// ── 이미 받은 소모품(F3)
eq('F3: 받은 소모품 + 호실 하나 + 이력 없음', conversionPlan(add({ received: true, original: { category: '소모품비', roomIds: [] } }), facts()),
  { kind: 'F3', target: '수선유지비', lead: FRIDGE, others: [], roomIds: ['R519'] })
eq('F3: 호실이 둘이면 묻지 않는다(한 방에 배정)', conversionPlan(add({ received: true, items: [{ label: FRIDGE, roomIds: ['R519', 'R520'] }], original: { category: '소모품비', roomIds: [] } }), facts()), { kind: 'none' })
eq('F3: 품목이 둘이면 묻지 않는다', conversionPlan(add({ received: true, items: [{ label: FRIDGE, roomIds: ['R519'] }, { label: '멀티탭', roomIds: [] }], original: { category: '소모품비', roomIds: [] } }), facts()), { kind: 'none' })
eq('F3: 이번에 안 바꿨으면 묻지 않는다', conversionPlan(add({ received: true, original: orig }), facts()), { kind: 'none' })

// ── 대상 카테고리(운영자 결정 1)
eq('대상: 그 영업장 비품 최빈', durableTargetCategory(facts({ durableCounts: [{ category: '수선유지비', count: 3 }, { category: '집기 비품', count: 9 }] })), '집기 비품')
eq('대상: 하드코딩이 아니다(이력이 집기 비품이면 그것)', conversionPlan(add(), facts({ durableCounts: [{ category: '집기 비품', count: 1 }] })).kind === 'F1'
  && (conversionPlan(add(), facts({ durableCounts: [{ category: '집기 비품', count: 1 }] })) as { target: string }).target, '집기 비품')
eq('대상: 동수면 가나다 앞', durableTargetCategory(facts({ durableCounts: [{ category: '집기 비품', count: 5 }, { category: '수선유지비', count: 5 }] })), '수선유지비')
eq('대상: 목록에서 뺀 이름은 건너뛴다(저장이 목록에 되살린다)', durableTargetCategory(facts({ durableCounts: [{ category: '옛 비품', count: 50 }, { category: '집기 비품', count: 1 }] })), '집기 비품')
eq('대상: 추적 카테고리는 대상이 아니다', durableTargetCategory(facts({ durableCounts: [{ category: '소모품비', count: 99 }] })), '수선유지비')
eq('대상: 이력 0 이면 기본 목록의 수선유지비(목록에 있을 때)', durableTargetCategory(facts({ durableCounts: [] })), '수선유지비')
eq('대상: 이력 0 이고 목록에 수선유지비가 없으면 없음', durableTargetCategory(facts({ durableCounts: [], propertyCategories: ['소모품비', '집기 비품'] })), null)
eq('대상이 없으면 묻지 않는다', conversionPlan(add(), facts({ durableCounts: [], propertyCategories: ['소모품비'] })), { kind: 'none' })
eq('기본 목록 이름은 앱 기본 지출 목록의 수선유지비', DURABLE_FALLBACK_CATEGORY, '수선유지비')
eq('대상: 건수 0 행은 무시', durableTargetCategory(facts({ durableCounts: [{ category: '집기 비품', count: 0 }] })), '수선유지비')

// ── 문구(UX 패널 F1·F3 대사, 1단계 낱말)
const p1 = f1 as Exclude<typeof f1, { kind: 'none' }>
const c1 = conversionCopy(p1, { from: '소모품비', roomNos: ['519'] })
eq('F1 제목', c1.title, `'${FRIDGE}'를 비품으로 바꿀까요?`)
eq('F1 본문', c1.message, '대상 호실을 519호로 적었습니다. 소모품비로 저장하면 소모품 재고로 잡혀 519호에 배정되지 않습니다. 비품(수선유지비)으로 바꾸면 수령할 때 519호 배정을 묻습니다.')
eq('F1 버튼', [c1.altLabel, c1.confirmLabel], ['그대로 저장', '비품으로 저장'])
const cm = conversionCopy(multi as Exclude<typeof multi, { kind: 'none' }>, { from: '소모품비', roomNos: ['519'] })
eq('다품목 제목', cm.title, `'${FRIDGE}' 외 1개 품목을 비품으로 바꿀까요?`)
eq('다품목 본문 끝', cm.message.endsWith('카테고리는 지출 하나에 하나라 함께 적은 멀티탭도 비품(수선유지비)이 됩니다.'), true)
const many = conversionPlan(add({ items: [{ label: FRIDGE, roomIds: ['R1'] }, { label: 'A', roomIds: [] }, { label: 'B', roomIds: [] }, { label: 'C', roomIds: [] }] }), facts())
eq('다품목 셋 이상은 첫 이름 외 N개', conversionCopy(many as Exclude<typeof many, { kind: 'none' }>, { from: '소모품비', roomNos: ['101'] }).message.includes('함께 적은 A 외 2개 품목도'), true)
eq('받침 있는 품명은 을', conversionCopy({ ...p1, lead: '선풍기 받침' }, { from: '소모품비', roomNos: ['519'] }).title, "'선풍기 받침'을 비품으로 바꿀까요?")
eq('부식비면 부식비로', conversionCopy(p1, { from: '부식비', roomNos: ['519'] }).message.includes('부식비로 저장하면'), true)
eq('여러 방', conversionCopy(p1, { from: '소모품비', roomNos: ['519', '520'] }).message.startsWith('대상 호실을 519호·520호로 적었습니다.'), true)
eq('방 넷 이상은 접는다', convertRoomsText(['101', '102', '103', '104']), '101호·외 3곳')
eq('숫자 아닌 호실은 호 없이, 조사는 받침으로', conversionCopy(p1, { from: '소모품비', roomNos: ['옥탑방'] }).message.startsWith('대상 호실을 옥탑방으로 적었습니다.'), true)
const p3 = conversionPlan(add({ received: true, original: { category: '소모품비', roomIds: [] } }), facts()) as Exclude<ReturnType<typeof conversionPlan>, { kind: 'none' }>
const c3 = conversionCopy(p3, { from: '소모품비', roomNos: ['519'], receivedMd: '10/14' })
eq('F3 제목', c3.title, `'${FRIDGE}'를 비품으로 바꿔 519호에 배정할까요?`)
eq('F3 본문', c3.message, '이미 수령한 구매입니다. 비품(수선유지비)으로 바꾸면 소모품 목록에서 빠지고 비품·자재의 519호에 들어갑니다. 배정일은 수령일(10/14)로 기록됩니다.')
eq('F3 이후 점검을 함께 빼면 그 수를 적는다', conversionCopy(p3, { from: '소모품비', roomNos: ['519'], receivedMd: '10/14', adjustChecks: 2 }).message.endsWith('이 수령분을 이미 반영한 재고 점검 2건에서 그만큼을 함께 뺍니다.'), true)
eq('F1 토스트 둘째 줄(아직 배정 안 했다고 말하지 않는다)', conversionToastDetail('F1', '수선유지비', ['519']), '비품(수선유지비)으로 저장했습니다. 수령할 때 519호 배정을 묻습니다.')
eq('F3 토스트 둘째 줄', conversionToastDetail('F3', '수선유지비', ['519']), '비품으로 바꾸고 519호에 배정했습니다.')
eq('F1 적용취소 결과(§16 형식)', conversionUndoneText('F1', '소모품비'), '비품 전환을 적용취소했습니다 · 소모품비로 복귀')
eq('F3 적용취소 결과(§16 형식)', conversionUndoneText('F3', '부식비'), '비품 전환과 배정을 적용취소했습니다 · 부식비로 복귀')

// §29 지문 0(em dash·느낌표·이모지·화살표). 문장은 콜론으로 끝나지 않는다
const strings = [c1.title, c1.message, cm.title, cm.message, c3.title, c3.message, conversionToastDetail('F1', '수선유지비', ['519']), conversionToastDetail('F3', '수선유지비', ['519']),
  conversionUndoneText('F1', '소모품비'), conversionUndoneText('F3', '소모품비'), CONVERT_BLOCKED_MERGED, CONVERT_BLOCKED_LEDGER, DURABLE_CONVERT_STALE, DURABLE_CONVERT_UNDO_INVALID, DURABLE_CONVERT_UNDO_STALE]
eq('§29 지문 0', strings.filter(s => /[—!→]|\p{Extended_Pictographic}/u.test(s) || /:$/.test(s.trim())), [])

// ── 토큰 모양·정본 문자열
const base: DurableConvertUndo = { v: 1, kind: 'F1', from: '소모품비', to: '수선유지비', rows: [{ id: 'e1', targetRoomId: 'R519' }], placed: null, checks: [], shift: null, cards: [], seedLabels: [FRIDGE], logIds: [] }
eq('F1 토큰 통과', parseDurableConvertUndo(base) != null, true)
eq('키 순서가 달라도 정본 문자열이 같다', canonicalDurableConvertUndo({ ...base }) === canonicalDurableConvertUndo(JSON.parse(JSON.stringify({ seedLabels: base.seedLabels, logIds: [], cards: [], shift: null, checks: [], placed: null, rows: base.rows, to: base.to, from: base.from, kind: 'F1', v: 1 }))), true)
eq('서명은 정본 문자열에서 빠진다', canonicalDurableConvertUndo({ ...base, sig: 'x' }) === canonicalDurableConvertUndo(base), true)
eq('from 과 to 가 같으면 거부', parseDurableConvertUndo({ ...base, to: '소모품비' }), null)
eq('F1 이 배정 칸을 실으면 거부', parseDurableConvertUndo({ ...base, placed: { id: 'e1', roomId: 'R', assignedAt: '2026-10-14T00:00:00.000Z', prev: { assignedAt: null, assignedLocationId: null, isCommonAsset: false } } }), null)
eq('F1 이 이력 줄을 실으면 거부', parseDurableConvertUndo({ ...base, logIds: ['l1'] }), null)
eq('F1 행이 없으면 거부', parseDurableConvertUndo({ ...base, rows: [] }), null)
eq('모양이 틀린 값 거부', [parseDurableConvertUndo(null), parseDurableConvertUndo({ ...base, v: 2 }), parseDurableConvertUndo({ ...base, rows: [{ id: 1 }] })], [null, null, null])
const f3: DurableConvertUndo = {
  v: 1, kind: 'F3', from: '소모품비', to: '수선유지비', rows: [], seedLabels: [], logIds: ['l1'], shift: null, cards: [],
  placed: { id: 'e1', roomId: 'R519', assignedAt: '2026-10-14T00:00:00.000Z', prev: { assignedAt: null, assignedLocationId: null, isCommonAsset: false } },
  checks: [{ id: 'c1', trackedItemId: 't1', date: '2026-10-13T21:05:33.000Z', createdAt: '2026-10-13T21:05:33.000Z', remainingQty: 1, memo: '[수령 자동] +1개', isReconcile: false, sourceExpenseId: 'e1',
    locations: [{ id: 'l', storageLocationId: 's', remainingQty: 1, restockedQty: null, fromHubQty: null, fromLocationId: null, carried: null }] }],
}
eq('F3 토큰 통과', parseDurableConvertUndo(f3) != null, true)
eq('F3 자동 점검이 다른 지출 것이면 거부(무관한 점검을 되살리지 못한다)', parseDurableConvertUndo({ ...f3, checks: [{ ...f3.checks[0], sourceExpenseId: 'other' }] }), null)
eq('F3 이력 줄이 하나가 아니면 거부', parseDurableConvertUndo({ ...f3, logIds: [] }), null)
eq('F3 이 예정 호실 행을 실으면 거부', parseDurableConvertUndo({ ...f3, rows: [{ id: 'e2', targetRoomId: null }] }), null)

console.log(`\n[비품 전환 판정·문구·토큰 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
