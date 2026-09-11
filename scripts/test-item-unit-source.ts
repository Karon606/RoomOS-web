// 품목 단위 정본 회귀 — 실행: npx tsx scripts/test-item-unit-source.ts
//
// 김치 사건(신고 85343c79·5ba35bfc)에서 나온 진리표 둘.
//   · **단일 품목도 itemsJson 이 정본** — 저장 직전 확인창이 고친 단위·품명은 itemsJson 에만 실린다.
//     낱개 폼 필드가 이기면 '박스로 바꿔 저장' 을 눌러도 '개' 로 들어간다.
//   · **단위가 다른 병합은 카드를 단위 무시로** — 부착 판정이 5튜플 동치라, 라벨만 고치면
//     '개' 지출은 '박스' 카드에 영원히 못 붙는다. 지출 단위를 덮어쓰면 수량이 왜곡되므로 카드를 연다.
import { resolveSingleItemFields, type SingleItemFields } from '../lib/expenseItemSource'
import { shouldLoosenTargetUnit } from '../lib/mergeUnitScope'
import { splitQuickPickRows } from '../lib/itemQuickPicks'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// 낱개 폼 필드 기준선 — 폼이 실어 보내는 '옛 값' 한 벌.
const form: SingleItemFields = {
  itemLabel: '김치', specValue: '10', specUnit: 'kg', specText: '',
  brand: '', productName: '', qtyValue: '2', qtyUnit: '개',
}

// ── 단일 품목 저장 정본 ────────────────────────────────────────────
// 김치 사건 그대로 — 확인창에서 '박스' 로 고친 값이 저장까지 흘러야 한다.
eq('단일 품목은 itemsJson 단위가 이긴다',
  resolveSingleItemFields([{ label: '김치', qtyUnit: '박스' }], false, form).qtyUnit, '박스')
// 같은 클래스 — 품명 분리 게이트가 고친 이름도 itemsJson 에만 실린다.
eq('단일 품목은 itemsJson 품명이 이긴다',
  resolveSingleItemFields([{ label: '김치 10kg (박스)' }], false, form).itemLabel, '김치 10kg (박스)')
// itemsJson 에 없는 칸까지 지우면 안 된다 — 없는 값만 낱개 필드로 채운다.
eq('itemsJson 에 없는 칸은 낱개 필드로 채운다',
  resolveSingleItemFields([{ label: '김치', qtyUnit: '박스' }], false, form),
  { ...form, qtyUnit: '박스' })
// 빈 문자열은 '지웠다' 는 뜻이라 정본이다(undefined 만 없음으로 본다).
eq('itemsJson 의 빈 값은 지운 것으로 존중한다',
  resolveSingleItemFields([{ label: '김치', qtyUnit: '' }], false, form).qtyUnit, '')

// ── 무회귀 — 예전과 똑같이 낱개 필드로 저장되어야 하는 갈래들 ────────
eq('itemsJson 이 없으면 낱개 필드 그대로', resolveSingleItemFields(null, false, form), form)
eq('itemsJson 이 비면 낱개 필드 그대로', resolveSingleItemFields([], false, form), form)
eq('다품목 경로는 손대지 않는다',
  resolveSingleItemFields([{ label: '김치', qtyUnit: '박스' }], true, form), form)
eq('품목이 둘이면 낱개 필드 그대로',
  resolveSingleItemFields([{ label: '김치' }, { label: '두부' }], false, form), form)

// ── 수정 저장(updateExpense)의 정본 ───────────────────────────────
// 등록과 같은 결함이 수정에도 남아 있었다. 수정 폼에는 단위 게이트가 없어 김치 신고는 안 나지만,
// **내구재 세트 환산 확인창**이 고친 값은 여기서도 itemsJson 에만 실린다. 낱개 필드가 이기면
// '4개로 등록' 을 눌러도 '1세트' 로 들어간다. 수정 폼에만 있는 unitBasis 칸도 환산이 바꾼다.
//
// 낱개 hidden 은 확인창 **전** 값이다 — 폼은 다시 그려지지 않으므로 옛 값 그대로 실려 온다.
const editForm: SingleItemFields = {
  itemLabel: '의자', specValue: '4', specUnit: '개', specText: '',
  brand: '', productName: '', qtyValue: '1', qtyUnit: '세트', unitBasis: 'spec',
}
// 환산 승인 — durableSetCountPatch 가 qty×N·'개'·규격 비움·unitBasis 'qty' 로 바꾼 한 벌.
eq('세트 환산 승인이 아홉 칸 전부 정본으로 저장된다',
  resolveSingleItemFields(
    [{ label: '의자', qtyValue: '4', qtyUnit: '개', specValue: '', specUnit: '', unitBasis: 'qty' }],
    false, editForm),
  { itemLabel: '의자', specValue: '', specUnit: '', specText: '',
    brand: '', productName: '', qtyValue: '4', qtyUnit: '개', unitBasis: 'qty' })
// 규격 비움은 빈 문자열이라 '지웠다' 는 뜻이다 — 낱개의 옛 '4개' 가 되살아나면 안 된다.
eq('환산이 비운 규격은 낱개 옛 값으로 되살아나지 않는다',
  resolveSingleItemFields([{ label: '의자', specValue: '', specUnit: '' }], false, editForm).specValue, '')
// '1개 그대로' — setHint 만 지우고 값은 그대로라 itemsJson 과 낱개가 같은 값이다(저장 결과 불변).
eq("'1개 그대로' 는 저장 결과가 안 바뀐다",
  resolveSingleItemFields(
    [{ label: '의자', qtyValue: '1', qtyUnit: '세트', specValue: '4', specUnit: '개', unitBasis: 'spec' }],
    false, editForm),
  editForm)
// 환산 대상 없음 — 확인창이 아예 안 뜨면 itemsJson 은 폼이 그린 그대로다.
// 이때 JSON.stringify 가 undefined 키를 빼므로 선택 칸들이 아예 없이 오는데, 낱개 폴백으로 메워
// **저장 결과가 종전과 한 글자도 달라지지 않아야 한다**(수정 저장 전체의 무회귀 근거).
eq('환산 대상이 없으면 저장 결과가 종전과 같다',
  resolveSingleItemFields([{ label: '의자', qtyValue: '1', qtyUnit: '세트', specValue: '4', specUnit: '개' }], false, editForm),
  editForm)
// JSON 에 없는 칸은 낱개로 — 세트 환산 patch 는 specText·brand·productName 을 안 건드린다.
eq('JSON 에 없는 서술규격·브랜드·품명은 낱개로 채운다',
  resolveSingleItemFields([{ label: '의자', qtyValue: '4', qtyUnit: '개', unitBasis: 'qty' }], false,
    { ...editForm, specText: '접이식', brand: '한샘', productName: 'CH-100' }),
  { itemLabel: '의자', specValue: '4', specUnit: '개', specText: '접이식',
    brand: '한샘', productName: 'CH-100', qtyValue: '4', qtyUnit: '개', unitBasis: 'qty' })
// 0품목(카테고리만 수정) — 정본이 없으니 resolver 는 아무것도 얹지 않는다.
// 실제 보존은 서버의 formData.has() 게이트가 하고, 이 함수는 그 게이트에 값을 만들어 주지 않는다.
eq('0품목 수정은 resolver 가 아무 값도 만들지 않는다',
  resolveSingleItemFields([], false, editForm), editForm)
// 다품목·방별 분배는 이미 itemsJson 정본 갈래다 — unitBasis 를 넘겨도 손대지 않는다.
eq('다품목 수정 경로는 unitBasis 도 손대지 않는다',
  resolveSingleItemFields([{ label: '의자', unitBasis: 'qty' }], true, editForm), editForm)
// itemsJson 파싱 실패는 서버에서 빈 배열이 된다 — 낱개가 유일한 원천으로 남는다.
eq('itemsJson 파싱 실패는 낱개 아홉 칸 그대로',
  resolveSingleItemFields([], false, editForm), editForm)
// 재고 전파 게이트(labelAfter·qtyUnitAfter·qtyValueAfter)가 보는 값도 정본이어야 한다 —
// 추적 소모품의 수량 정정·단위 변경 판정이 환산 전 옛 값으로 내려지면 잔량이 어긋난다.
{
  const r = resolveSingleItemFields(
    [{ label: '종량제봉투', qtyValue: '30', qtyUnit: '박스' }], false,
    { ...editForm, itemLabel: '종량제봉투', qtyValue: '10', qtyUnit: '개' })
  eq('게이트가 보는 수량이 정본값이다', r.qtyValue, '30')
  eq('게이트가 보는 수량단위가 정본값이다', r.qtyUnit, '박스')
  eq('게이트가 보는 품목명이 정본값이다', r.itemLabel, '종량제봉투')
}
// 등록 폼에는 unitBasis 칸이 없다 — 선택 짝이라 안 넘기면 결과에도 없어야 한다(addExpense 무회귀).
eq('등록 폼 호출은 unitBasis 를 만들어 내지 않는다',
  resolveSingleItemFields([{ label: '김치', qtyUnit: '박스', unitBasis: 'qty' }], false, form).unitBasis,
  undefined)

// ── 단위가 다른 병합 ──────────────────────────────────────────────
eq("'개' 구매를 '박스' 카드에 합치면 카드를 연다", shouldLoosenTargetUnit('개', '박스'), true)
eq('단위가 같으면 카드를 건드리지 않는다', shouldLoosenTargetUnit('박스', '박스'), false)
eq('단위 없는 구매도 카드와 다르면 연다', shouldLoosenTargetUnit(null, '박스'), true)
eq('단위 안 실려 온 결정도 카드와 다르면 연다', shouldLoosenTargetUnit(undefined, '박스'), true)
// 이미 열린 카드(다양한 포장 합산)는 두 번 열 것이 없다 — 원복할 원래 단위도 없다.
eq('이미 단위 무시 카드면 그대로', shouldLoosenTargetUnit('개', null), false)
eq('양쪽 다 단위가 없으면 그대로', shouldLoosenTargetUnit(null, null), false)

// ── 품목 빠른선택 칩의 유형 분리 ──────────────────────────────────
// 신고 "최근 내역을 여기서 고를 수 있게 하는게 아니었나?" — 9/5 '옥상 폐기물처리'(서비스)를
// 다음날 물품 폼에서 못 찾은 자리다. 칩이 유형별로 갈린 것은 운영자 확정 규칙이라 그대로 두고,
// 반대편에 이력이 있다는 사실만 한 질의에서 함께 세어 온다.
// 여기서 고정하는 것은 그 가르기 하나다 — 순위·보충(2·3단계)은 이 함수 밖이고 손대지 않았다.
type QPRow = Parameters<typeof splitQuickPickRows>[0][number]
const qp = (itemLabel: string, excl: boolean, count: number, day: number): QPRow =>
  ({ itemLabel, excludeFromInventory: excl, _count: { _all: count }, _max: { date: new Date(2026, 8, day) } })
const labels = (rows: QPRow[]) => rows.map(r => r.itemLabel)
// 종전 질의의 where 가 하던 일 — 같은 유형만 남기기. 2·3단계에 들어가는 입력의 정의다.
const oldWhere = (rows: QPRow[], service: boolean) => rows.filter(r => r.excludeFromInventory === service)

// 폐기물 처리비 한 카테고리 — 물품 둘(봉투)과 서비스 하나(옥상 폐기물처리)가 섞여 있다.
const mixed: QPRow[] = [
  qp('종량제쓰레기봉투 50L', false, 3, 1),
  qp('옥상 폐기물처리', true, 1, 5),
  qp('음식물쓰레기봉투 10L', false, 2, 3),
]
eq('물품 모드 칩은 물품 이력만', labels(splitQuickPickRows(mixed, false).same), ['종량제쓰레기봉투 50L', '음식물쓰레기봉투 10L'])
eq('물품 모드는 서비스 건수를 센다', splitQuickPickRows(mixed, false).otherTypeCount, 1)
eq('서비스 모드 칩은 서비스 이력만', labels(splitQuickPickRows(mixed, true).same), ['옥상 폐기물처리'])
eq('서비스 모드는 물품 건수를 센다', splitQuickPickRows(mixed, true).otherTypeCount, 5)
// 건수는 행 수가 아니라 지출 건수 합이다 — 화면이 '{n}건' 이라고 말한다.
eq('반대편 건수는 행 수가 아니라 건수 합', splitQuickPickRows([qp('벽지도배', true, 14, 2), qp('장판 시공', true, 7, 4)], false).otherTypeCount, 21)

// 같은 이름이 양쪽에 다 있으면 — 칩은 같은 유형 행만, 반대편은 건수로만 잡힌다.
const both: QPRow[] = [qp('종량제쓰레기봉투 50L', false, 3, 1), qp('종량제쓰레기봉투 50L', true, 1, 6)]
eq('같은 이름이 양쪽에 있어도 칩은 같은 유형 행만', labels(splitQuickPickRows(both, false).same), ['종량제쓰레기봉투 50L'])
eq('같은 이름이어도 반대편 건수는 잡힌다', splitQuickPickRows(both, false).otherTypeCount, 1)

// ── 무회귀 — 반대편이 없으면 지금과 같아야 한다 ────────────────────
const goodsOnly: QPRow[] = [qp('쌀', false, 4, 2), qp('김치', false, 9, 7)]
eq('물품만 있는 카테고리는 안내 줄이 설 데이터가 없다', splitQuickPickRows(goodsOnly, false).otherTypeCount, 0)
eq('물품만 있는 카테고리의 칩 입력은 종전 그대로', splitQuickPickRows(goodsOnly, false).same, oldWhere(goodsOnly, false))
const serviceOnly: QPRow[] = [qp('벽지도배', true, 14, 2), qp('실리콘 제거 및 재시공', true, 5, 8)]
eq('서비스만 있는 카테고리는 안내 줄이 설 데이터가 없다', splitQuickPickRows(serviceOnly, true).otherTypeCount, 0)
eq('서비스만 있는 카테고리의 칩 입력은 종전 그대로', splitQuickPickRows(serviceOnly, true).same, oldWhere(serviceOnly, true))
eq('빈 이력은 양쪽 0', splitQuickPickRows([], false), { same: [], otherTypeCount: 0 })
// 반환 모양이 넓어져도 2·3단계가 보는 것은 same 하나다 — 그 값이 종전 where 결과와 원소·순서까지 같다.
eq('섞여 있어도 2·3단계 입력은 종전 where 결과와 같다', splitQuickPickRows(mixed, false).same, oldWhere(mixed, false))
eq('서비스 쪽도 2·3단계 입력이 종전 where 결과와 같다', splitQuickPickRows(mixed, true).same, oldWhere(mixed, true))

console.log(`\n품목 단위 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
