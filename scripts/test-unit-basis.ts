// 단가 기준 정본 진리표 — 실행: npx tsx scripts/test-unit-basis.ts
//
// 여기서 고정하는 것(2026-09-17, 신고 73c18e13).
//   · **기록이 없으면 null 이다.** 규격 값이 있다는 이유로 'spec' 을 지어내면 그 값이 사람이 고른
//     값으로 대접받아 부피·길이 판정을 통째로 끈다 — 이번 신고의 급소가 정확히 거기였다.
//   · 봉투는 매당이다. 종량제봉투 50L 20매 25,000원은 1매 1,250원이지 리터당 25원이 아니다
//     (운영자 지적 2026-08-05).
//   · 길이 규격은 개당이다(오류신고 4e2ffe04). 서술 규격도 개당이다(계산 비관여).
//   · 추적 단위가 '수량'이면 개당이다(오류신고 c7cf6180).
import { storedUnitBasis, inferUnitBasis, resolveUnitBasis } from '../lib/unitBasis'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 기록 판정 ──────────────────────────────────────────────────────
eq('기록된 spec 은 기록이다', storedUnitBasis('spec'), 'spec')
eq('기록된 qty 는 기록이다', storedUnitBasis('qty'), 'qty')
for (const raw of [null, undefined, '', ' ', 'SPEC', 'Spec', 'volume', '규격당']) {
  eq(`'${String(raw)}' 은 기록이 아니다`, storedUnitBasis(raw), null)
}

// ── 규칙 ───────────────────────────────────────────────────────────
eq('부피 규격 + 매 = 개당(종량제봉투 50L 20매)', inferUnitBasis({ specUnit: 'L', qtyUnit: '매' }), 'qty')
eq('부피 규격 + 장 = 개당', inferUnitBasis({ specUnit: 'L', qtyUnit: '장' }), 'qty')
eq('소문자 l 도 같은 답', inferUnitBasis({ specUnit: 'l', qtyUnit: '매' }), 'qty')
eq('리터(한글)도 같은 답', inferUnitBasis({ specUnit: '리터', qtyUnit: '매' }), 'qty')
eq('ml 도 같은 답', inferUnitBasis({ specUnit: 'ml', qtyUnit: '매' }), 'qty')
eq('부피 규격 + 통 = 규격당(세제 1.5L 2통)', inferUnitBasis({ specUnit: 'L', qtyUnit: '통' }), 'spec')
eq('길이 규격은 개당(장판 1롤)', inferUnitBasis({ specUnit: 'm', qtyUnit: '롤' }), 'qty')
eq('센티(한글 별칭)도 길이', inferUnitBasis({ specUnit: '센티', qtyUnit: '롤' }), 'qty')
eq('서술 규격은 개당', inferUnitBasis({ specUnit: '', qtyUnit: '개', specText: '1200x600mm' }), 'qty')
eq('공백뿐인 서술 규격은 서술이 아니다', inferUnitBasis({ specUnit: 'g', qtyUnit: '개', specText: '   ' }), 'spec')
eq('추적 단위가 수량이면 개당', inferUnitBasis({ specUnit: 'g', qtyUnit: '개', trackUnit: 'qty' }), 'qty')
eq('개입 수 규격은 규격당(40개입 3박스)', inferUnitBasis({ specUnit: '개', qtyUnit: '박스' }), 'spec')
eq('무게 규격은 규격당(라면 120g 125개)', inferUnitBasis({ specUnit: 'g', qtyUnit: '개' }), 'spec')
eq('아무것도 모르면 규격당', inferUnitBasis({}), 'spec')

// ── 기록이 규칙을 이긴다 ────────────────────────────────────────────
eq('기록된 규격당은 부피 규칙을 이긴다',
  resolveUnitBasis({ recorded: 'spec', specUnit: 'L', qtyUnit: '매' }), 'spec')
eq('기록된 개당은 그대로',
  resolveUnitBasis({ recorded: 'qty', specUnit: 'g', qtyUnit: '개' }), 'qty')
eq('기록이 없으면 규칙이 답한다(이번 신고의 봉투)',
  resolveUnitBasis({ recorded: null, specUnit: 'L', qtyUnit: '매' }), 'qty')
eq('빈 문자열은 기록이 아니라 규칙으로 간다',
  resolveUnitBasis({ recorded: '', specUnit: 'L', qtyUnit: '매' }), 'qty')

// ── 실측 27건이 전부 개당으로 읽히는가 ───────────────────────────────
// scripts/check-unit-basis-drift.ts 가 DB 에서 재는 것과 같은 판정이다. 여기서는 실측에서
// 나온 (규격단위, 수량단위) 짝을 고정해 판정이 조용히 뒤집히지 않게 한다.
for (const [su, qu] of [['L', '매'], ['L', '장']] as const) {
  eq(`실측 짝 ${su}/${qu} 는 기록이 없으면 개당`, resolveUnitBasis({ specUnit: su, qtyUnit: qu }), 'qty')
}

console.log(`\n[단가 기준 정본] 통과 ${pass}건 / 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
