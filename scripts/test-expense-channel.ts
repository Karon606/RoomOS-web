// 구매처·쇼핑몰 저장·표시 규칙(lib/expenseChannel)과 글자 칸 적용취소 토큰(lib/expenseFieldUndo) 진리표. 실행: npx tsx scripts/test-expense-channel.ts
import {
  normalizeChannel, isChannelName, channelForSave, channelKey, buildVendorBizMap, itemVendorFor, bizBackfillAllowed, vendorSuggestionsWithoutChannels,
  channelVendorLabel, commonChannel, externalOrderCaption, orderSellerLabel, orderChannelSplit, channelSplitAgainst, splitSiblingsText, mergeChannelConflict,
} from '../lib/expenseChannel'
import { canonicalExpenseFieldUndo, parseExpenseFieldUndo, planExpenseFieldUndo, EXPENSE_FIELD_UNDO_KINDS } from '../lib/expenseFieldUndo'
import { canonicalOrderMergeUndo, parseOrderMergeUndo, planOrderMergeUndo } from '../lib/orderMergeUndo'

let fail = 0
let pass = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.error(`  FAIL  ${name}\n        기대 ${w}\n        실제 ${g}`)
}

const CH = ['쿠팡', '지마켓']

// ── 쇼핑몰 칸 저장 값 ─────────────────────────────────────────
eq('빈 쇼핑몰은 미기록(null)', normalizeChannel(''), null)
eq('공백만은 미기록', normalizeChannel('   '), null)
eq('null 은 미기록', normalizeChannel(null), null)
eq('앞뒤 공백을 턴다', normalizeChannel('  쿠팡 '), '쿠팡')
eq('쉼표는 목록 구분자라 공백으로', normalizeChannel('쿠팡,로켓'), '쿠팡 로켓')

// ── 쇼핑몰 목록 이름 판정 ─────────────────────────────────────
eq('목록 이름이면 참', isChannelName('쿠팡', CH), true)
eq('앞뒤 공백은 같은 이름', isChannelName(' 쿠팡 ', CH), true)
eq('표기가 다르면 다른 이름(쿠팡(주))', isChannelName('쿠팡(주)', CH), false)
eq('빈 이름은 거짓', isChannelName('', CH), false)
eq('목록이 비면 언제나 거짓', isChannelName('쿠팡', []), false)
eq('라틴 대소문자는 무시한다', isChannelName('COUPANG', ['Coupang']), true)
eq('열쇠는 앞뒤 공백·대소문자만 접는다', channelKey(' GMarket '), 'gmarket')
eq('저장 값은 목록 표기를 따른다(대소문자만 다르면)', channelForSave('coupang', ['Coupang', '쿠팡']), 'Coupang')
eq('목록에 없으면 정규화한 그대로', channelForSave(' 11번가 ', ['쿠팡']), '11번가')
eq('빈 값은 미기록', channelForSave('  ', ['쿠팡']), null)
eq('번호 지도도 대소문자 무시로 쇼핑몰 이름을 뺀다', Object.hasOwn(buildVendorBizMap([{ vendor: 'coupang', vendorBizNo: '1' }], ['Coupang']).vendorToBiz, 'coupang'), false)

// ── 번호 지도: 최근 우선, 쇼핑몰 이름 제외 ────────────────────
{
  const m = buildVendorBizMap([
    { vendor: '철물24', vendorBizNo: '111-11-11111' },
    { vendor: '쿠팡', vendorBizNo: '120-88-00767' },
    { vendor: '철물24', vendorBizNo: '999-99-99999' },
    { vendor: '한빛전자', vendorBizNo: '222-22-22222' },
    { vendor: null, vendorBizNo: '333-33-33333' },
  ], CH)
  eq('구매처별 최근 번호', m.vendorToBiz['철물24'], '111-11-11111')
  eq('쇼핑몰 이름은 번호 지도에 없다', Object.hasOwn(m.vendorToBiz, '쿠팡'), false)
  eq('쇼핑몰 번호로 이름을 안 채운다', Object.hasOwn(m.bizToVendor, '120-88-00767'), false)
  eq('번호별 최근 구매처', m.bizToVendor['222-22-22222'], '한빛전자')
  eq('구매처 없는 번호는 안 싣는다', Object.hasOwn(m.bizToVendor, '333-33-33333'), false)
  eq('쇼핑몰 목록이 비면 쿠팡도 판매자로 싣는다(목록이 경계)', buildVendorBizMap([{ vendor: '쿠팡', vendorBizNo: '1' }], []).vendorToBiz['쿠팡'], '1')
}

// ── 품목별 구매처와 번호(머리 번호 상속 금지) ─────────────────
{
  const head = { vendor: '쿠팡', vendorBizNo: '120-88-00767' }
  const map = { '철물24': '111-11-11111' }
  eq('undefined 는 머리를 따른다', itemVendorFor(head, undefined, map), head)
  eq('null 도 머리를 따른다', itemVendorFor(head, null, map), head)
  eq("'' 는 비운다(구매처·번호 둘 다)", itemVendorFor(head, '', map), { vendor: null, vendorBizNo: null })
  eq('공백만도 비운다', itemVendorFor(head, '  ', map), { vendor: null, vendorBizNo: null })
  eq('머리와 같은 글자면 머리 번호', itemVendorFor(head, ' 쿠팡 ', map), { vendor: '쿠팡', vendorBizNo: '120-88-00767' })
  eq('다른 판매자는 그 판매자의 과거 번호', itemVendorFor(head, '철물24', map), { vendor: '철물24', vendorBizNo: '111-11-11111' })
  eq('과거 번호가 없으면 비운다(머리 번호를 절대 안 쓴다)', itemVendorFor(head, '한빛전자', map), { vendor: '한빛전자', vendorBizNo: null })
  eq('머리 구매처가 비어도 품목 구매처는 제 번호', itemVendorFor({ vendor: null, vendorBizNo: null }, '철물24', map), { vendor: '철물24', vendorBizNo: '111-11-11111' })
  eq('머리 구매처 빈칸 + 품목 undefined 는 빈 구매처', itemVendorFor({ vendor: '', vendorBizNo: null }, undefined, map), { vendor: null, vendorBizNo: null })
  eq('프로토타입 이름은 지도에서 안 집는다', itemVendorFor(head, 'constructor', map), { vendor: 'constructor', vendorBizNo: null })
}

// ── 사업자번호 소급 허용 ───────────────────────────────────────
eq('판매자 이름 + 번호면 소급', bizBackfillAllowed('철물24', '111-11-11111', CH), true)
eq('쇼핑몰 목록 이름은 소급 안 함', bizBackfillAllowed('쿠팡', '120-88-00767', CH), false)
eq('번호가 없으면 안 함', bizBackfillAllowed('철물24', null, CH), false)
eq('구매처가 없으면 안 함', bizBackfillAllowed('', '1', CH), false)

// ── 구매처 자동완성에서 쇼핑몰 이름 빼기 ───────────────────────
eq('자동완성 후보에서 쇼핑몰 이름을 뺀다(순서 유지)', vendorSuggestionsWithoutChannels(['철물24', '쿠팡', '다이소', '지마켓'], CH), ['철물24', '다이소'])

// ── 한 줄 요약('쿠팡 · 철물24') ────────────────────────────────
eq('쇼핑몰 먼저, 구매처 뒤', channelVendorLabel('쿠팡', '철물24'), '쿠팡 · 철물24')
eq('같으면 한 번', channelVendorLabel('다이소', '다이소'), '다이소')
eq('쇼핑몰만', channelVendorLabel('쿠팡', null), '쿠팡')
eq('구매처만', channelVendorLabel(null, '철물24'), '철물24')
eq('둘 다 없으면 null', channelVendorLabel('', '  '), null)

// ── 주문 하나의 쇼핑몰 ─────────────────────────────────────────
eq('한 이름으로 모이면 그 이름(미기록은 안 센다)', commonChannel([{ channel: '쿠팡' }, { channel: null }, { channel: '쿠팡' }]), '쿠팡')
eq('갈리면 null', commonChannel([{ channel: '쿠팡' }, { channel: '지마켓' }]), null)
eq('전부 미기록이면 null', commonChannel([{ channel: null }]), null)
eq('주문번호 캡션: 쇼핑몰 자리에 실제 이름', externalOrderCaption('31000123', [{ channel: '쿠팡' }]), '쿠팡 31000123')
eq('주문번호 캡션: 미기록이면 종전 낱말', externalOrderCaption('31000123', [{ channel: null }]), '쇼핑몰 31000123')
eq('주문번호 캡션: 갈리면 종전 낱말', externalOrderCaption('31000123', [{ channel: '쿠팡' }, { channel: '지마켓' }]), '쇼핑몰 31000123')
eq('주문번호 캡션: 번호가 없으면 null', externalOrderCaption(null, [{ channel: '쿠팡' }]), null)
eq('주문별 요약: 쿠팡 · 철물24 외 1', orderSellerLabel([{ channel: '쿠팡', vendor: '철물24' }, { channel: '쿠팡', vendor: '한빛전자' }, { channel: '쿠팡', vendor: '철물24' }]), '쿠팡 · 철물24 외 1')
eq('주문별 요약: 구매처 하나면 외 없이', orderSellerLabel([{ channel: '쿠팡', vendor: '철물24' }]), '쿠팡 · 철물24')
eq('주문별 요약: 쇼핑몰 미기록이면 종전처럼 구매처 외 N', orderSellerLabel([{ channel: null, vendor: '쿠팡(주)' }, { channel: null, vendor: '철물24' }]), '쿠팡(주) 외 1')
eq('주문별 요약: 구매처가 쇼핑몰과 같은 이름이면 한 번', orderSellerLabel([{ channel: '다이소', vendor: '다이소' }]), '다이소')
eq('주문별 요약: 아무것도 없으면 null', orderSellerLabel([{ channel: null, vendor: null }]), null)

// ── 한 주문 안 갈림 ────────────────────────────────────────────
eq('갈림 없음', orderChannelSplit([{ channel: '쿠팡' }, { channel: '쿠팡' }]), { distinct: ['쿠팡'], unset: 0 })
eq('이름 둘이면 갈림', orderChannelSplit([{ channel: '쿠팡' }, { channel: '지마켓' }]).distinct.length, 2)
eq('미기록 섞임은 따로 센다', orderChannelSplit([{ channel: '쿠팡' }, { channel: null }, { channel: '' }]), { distinct: ['쿠팡'], unset: 2 })
eq('수정 갈림: 다른 2건은 쿠팡', channelSplitAgainst([{ channel: '쿠팡' }, { channel: '쿠팡' }], '지마켓'), { count: 2, names: ['쿠팡'], unset: 0 })
eq('수정 갈림: 빈 형제는 따로 센다', channelSplitAgainst([{ channel: null }], '쿠팡'), { count: 1, names: [], unset: 1 })
eq('수정 갈림: 같으면 null', channelSplitAgainst([{ channel: '쿠팡' }], ' 쿠팡'), null)
eq('수정 갈림: 비우면 값 있는 형제와 갈린다', channelSplitAgainst([{ channel: '쿠팡' }], null), { count: 1, names: ['쿠팡'], unset: 0 })
eq('갈림 문장: 이름만', splitSiblingsText({ names: ['쿠팡'], unset: 0 }), '쿠팡입니다')
eq('갈림 문장: 빈 것만(미기록 낱말 없음)', splitSiblingsText({ names: [], unset: 2 }), '쇼핑몰이 비어 있습니다')
eq('갈림 문장: 섞임', splitSiblingsText({ names: ['쿠팡'], unset: 1 }), '쿠팡이거나 쇼핑몰이 비어 있습니다')
eq('묶기 충돌: 이름 둘', mergeChannelConflict([{ channel: '쿠팡' }, { channel: '지마켓' }, { channel: null }]), ['지마켓', '쿠팡'])
eq('묶기 충돌 없음: 하나 + 미기록', mergeChannelConflict([{ channel: '쿠팡' }, { channel: null }]), null)

// ── 글자 칸 적용취소 토큰 ──────────────────────────────────────
{
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const tok = { v: 1 as const, kind: 'vendor-rename' as const, rows: [
    { id: B, changes: [{ field: 'vendor' as const, before: '쿠팡', after: '쿠팡(주)' }] },
    { id: A, changes: [{ field: 'vendor' as const, before: '쿠팡', after: '쿠팡(주)' }] },
  ] }
  eq('정규 본문은 행 순서와 무관', canonicalExpenseFieldUndo(tok), canonicalExpenseFieldUndo({ ...tok, rows: [...tok.rows].reverse() }))
  eq('용도 라벨이 다르면 본문도 다르다', canonicalExpenseFieldUndo(tok) === canonicalExpenseFieldUndo({ ...tok, kind: 'vendor-to-channel' }), false)
  eq('모양 검사 통과', parseExpenseFieldUndo(tok)?.rows.length, 2)
  eq('없는 용도는 거부', parseExpenseFieldUndo({ ...tok, kind: 'drop-table' }), null)
  eq('허용 안 된 칸은 거부(금액)', parseExpenseFieldUndo({ ...tok, rows: [{ id: A, changes: [{ field: 'amount', before: '1', after: '2' }] }] }), null)
  eq('id 가 uuid 가 아니면 거부', parseExpenseFieldUndo({ ...tok, rows: [{ id: "x' or 1=1", changes: [{ field: 'vendor', before: null, after: 'a' }] }] }), null)
  eq('같은 행 두 번은 거부', parseExpenseFieldUndo({ ...tok, rows: [tok.rows[1], tok.rows[1]] }), null)
  eq('전후가 같으면 거부', parseExpenseFieldUndo({ ...tok, rows: [{ id: A, changes: [{ field: 'vendor', before: 'a', after: 'a' }] }] }), null)
  eq('빈 행 목록은 거부', parseExpenseFieldUndo({ ...tok, rows: [] }), null)
  const now = new Map([[A, { channel: null, vendor: '쿠팡(주)', vendorBizNo: null }], [B, { channel: null, vendor: '쿠팡(주)', vendorBizNo: null }]])
  eq('지금이 쓴 직후면 되돌린다', planExpenseFieldUndo(tok, now)?.map(p => p.data.vendor), ['쿠팡', '쿠팡'])
  const moved = new Map(now); moved.set(B, { channel: null, vendor: '다른 이름', vendorBizNo: null })
  eq('한 행이라도 그사이 바뀌면 전부 안 한다', planExpenseFieldUndo(tok, moved), null)
  const gone = new Map(now); gone.delete(A)
  eq('행이 없어졌으면(남의 영업장·삭제) 안 한다', planExpenseFieldUndo(tok, gone), null)
  eq('용도 라벨마다 서명 domain 이 다르다', new Set(Object.values(EXPENSE_FIELD_UNDO_KINDS)).size, Object.keys(EXPENSE_FIELD_UNDO_KINDS).length)
}

// ── 주문 묶기 적용취소 ────────────────────────────────────────
{
  const T = '33333333-3333-4333-8333-333333333333', O1 = '44444444-4444-4444-8444-444444444444'
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', S = '55555555-5555-4555-8555-555555555555'
  const snap = { id: O1, code: '261019-002', externalOrderNo: null, shippingType: '선불', shippingMemo: null, createdAt: '2026-10-19T01:00:00.000Z' }
  const u = { v: 1 as const, targetOrderId: T, createdTarget: false, moved: [{ id: A, before: null }, { id: B, before: O1 }, { id: S, before: O1 }], deletedOrders: [snap] }
  eq('묶기 토큰 모양 통과', parseOrderMergeUndo(u)?.moved.length, 3)
  eq('정규 본문은 순서 무관', canonicalOrderMergeUndo(u), canonicalOrderMergeUndo({ ...u, moved: [...u.moved].reverse() }))
  eq('되살릴 주문이 옮긴 행의 원래 주문이 아니면 거부', parseOrderMergeUndo({ ...u, moved: [{ id: A, before: null }] }), null)
  eq('대상 주문을 원래 주문이라 하면 거부', parseOrderMergeUndo({ ...u, moved: [{ id: A, before: T }], deletedOrders: [] }), null)
  eq('빈 옮김은 거부', parseOrderMergeUndo({ ...u, moved: [] }), null)
  const now = new Map<string, string | null>([[A, T], [B, T], [S, T]])
  const plan = planOrderMergeUndo(u, now, new Set(), [A, B, S, 'x'])
  eq('묶은 직후면 되돌린다(행은 원래 주문으로)', plan?.moves.map(m => m.to), [null, O1, O1])
  eq('지운 주문을 되살린다', plan?.restoreOrders.map(o => o.id), [O1])
  eq('대상 주문을 새로 만든 게 아니면 안 지운다', plan?.dropTarget, false)
  eq('한 행이라도 다른 주문으로 갔으면 안 한다', planOrderMergeUndo(u, new Map([...now, [B, null]]), new Set(), [A, S]), null)
  eq('되살릴 주문 id 가 이미 있으면 안 한다', planOrderMergeUndo(u, now, new Set([O1]), [A, B, S]), null)
  const fresh = { ...u, createdTarget: true, moved: [{ id: A, before: null }, { id: B, before: null }], deletedOrders: [] }
  eq('새로 만든 대상이 비면 지운다', planOrderMergeUndo(fresh, new Map([[A, T], [B, T]]), new Set(), [A, B])?.dropTarget, true)
  eq('새로 만든 대상에 그 뒤 다른 행이 붙었으면 남긴다', planOrderMergeUndo(fresh, new Map([[A, T], [B, T]]), new Set(), [A, B, S])?.dropTarget, false)
}

console.log(`[구매처·쇼핑몰 규칙] ${pass}건 통과${fail ? `, ${fail}건 실패` : ''}`)
if (fail) process.exit(1)
