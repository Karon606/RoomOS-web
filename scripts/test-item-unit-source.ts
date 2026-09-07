// 품목 단위 정본 회귀 — 실행: npx tsx scripts/test-item-unit-source.ts
//
// 김치 사건(신고 85343c79·5ba35bfc)에서 나온 진리표 둘.
//   · **단일 품목도 itemsJson 이 정본** — 저장 직전 확인창이 고친 단위·품명은 itemsJson 에만 실린다.
//     낱개 폼 필드가 이기면 '박스로 바꿔 저장' 을 눌러도 '개' 로 들어간다.
//   · **단위가 다른 병합은 카드를 단위 무시로** — 부착 판정이 5튜플 동치라, 라벨만 고치면
//     '개' 지출은 '박스' 카드에 영원히 못 붙는다. 지출 단위를 덮어쓰면 수량이 왜곡되므로 카드를 연다.
import { resolveSingleItemFields, type SingleItemFields } from '../lib/expenseItemSource'
import { shouldLoosenTargetUnit } from '../lib/mergeUnitScope'

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

// ── 단위가 다른 병합 ──────────────────────────────────────────────
eq("'개' 구매를 '박스' 카드에 합치면 카드를 연다", shouldLoosenTargetUnit('개', '박스'), true)
eq('단위가 같으면 카드를 건드리지 않는다', shouldLoosenTargetUnit('박스', '박스'), false)
eq('단위 없는 구매도 카드와 다르면 연다', shouldLoosenTargetUnit(null, '박스'), true)
eq('단위 안 실려 온 결정도 카드와 다르면 연다', shouldLoosenTargetUnit(undefined, '박스'), true)
// 이미 열린 카드(다양한 포장 합산)는 두 번 열 것이 없다 — 원복할 원래 단위도 없다.
eq('이미 단위 무시 카드면 그대로', shouldLoosenTargetUnit('개', null), false)
eq('양쪽 다 단위가 없으면 그대로', shouldLoosenTargetUnit(null, null), false)

console.log(`\n품목 단위 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
