// 재단 축(잘라 쓰는 품목인가) 판정 진리표 — 실행: npx tsx scripts/test-cut-axis-gate.ts
//
// 고정하는 것 넷.
//   · **묻는 조건 넷의 경계** — 추적 카테고리·카드 없음·길이 규격·개수 단위. 하나라도 빠지면 침묵.
//   · **장판은 안 묻는다** — 수량 자체를 m 로 적는 품목은 잘라 쓴다는 것이 자명하다.
//     애매한 것은 길이 규격에 개수 단위가 붙은 경우 하나뿐이다(빨래줄 10m 1세트).
//   · **물을 수 없는 경로의 기본값은 qty** — 영수증 없이 들어오는 카드는 안전한 쪽으로 만든다.
//     운영자가 선언한 답이 있으면 그 답이 언제나 이긴다.
//   · **단위를 보간한 문구가 한국어로 읽힌다** — '팩로'·'통로' 가 확인창에 나가지 않는다.
import { isCutAxisAmbiguous, shouldAskCutAxis, resolveTrackUnitForNewCard, unitWithRo } from '../lib/trackUnitGate'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 애매한 조합인가 ────────────────────────────────────────────────
eq('빨래줄 10m 1세트는 애매하다', isCutAxisAmbiguous('m', '세트'), true)
eq('장판 m 를 12m 샀으면 애매하지 않다', isCutAxisAmbiguous('m', 'm'), false)
eq('규격 단위가 없으면 애매하지 않다', isCutAxisAmbiguous('', '세트'), false)
eq('규격 단위가 null 이면 애매하지 않다', isCutAxisAmbiguous(null, '세트'), false)
eq('수량 단위가 없으면 애매하지 않다', isCutAxisAmbiguous('m', ''), false)
eq('수량 단위가 null 이면 애매하지 않다', isCutAxisAmbiguous('m', null), false)
eq('공백만 있는 수량 단위는 없는 것이다', isCutAxisAmbiguous('m', '  '), false)
// 부피·무게 규격은 이 축의 물음이 아니다 — 봉투 50L 20매는 다른 게이트가 본다.
eq('부피 규격은 애매하지 않다', isCutAxisAmbiguous('L', '매'), false)
eq('무게 규격은 애매하지 않다', isCutAxisAmbiguous('kg', '포대'), false)
// 길이 판정은 lib/units 정본이라 별칭·대소문자가 함께 따라온다.
eq('센티도 길이다', isCutAxisAmbiguous('센티', '롤'), true)
eq('인치도 길이다', isCutAxisAmbiguous('인치', '개'), true)
eq('대문자 M 도 길이다', isCutAxisAmbiguous('M', '세트'), true)
eq('앞뒤 공백은 턴다', isCutAxisAmbiguous(' cm ', ' 롤 '), true)
eq('미터 규격에 인치 수량이면 양쪽 다 길이라 애매하지 않다', isCutAxisAmbiguous('cm', '인치'), false)

// ── 물어야 하는가(조건 넷) ─────────────────────────────────────────
const base = { tracked: true, hasCard: false, specUnit: 'm', qtyUnit: '세트' }
eq('넷 다 만족하면 묻는다', shouldAskCutAxis(base), true)
eq('비추적 카테고리면 안 묻는다', shouldAskCutAxis({ ...base, tracked: false }), false)
eq('활성 카드가 있으면 안 묻는다', shouldAskCutAxis({ ...base, hasCard: true }), false)
eq('규격이 없으면 안 묻는다', shouldAskCutAxis({ ...base, specUnit: '' }), false)
eq('수량 단위가 없으면 안 묻는다', shouldAskCutAxis({ ...base, qtyUnit: '' }), false)
eq('장판(길이+길이)이면 안 묻는다', shouldAskCutAxis({ ...base, qtyUnit: 'm' }), false)
eq('부피 규격이면 안 묻는다', shouldAskCutAxis({ ...base, specUnit: 'L', qtyUnit: '매' }), false)
// 카드가 생긴 다음 구매부터는 침묵한다 — 기억은 카드의 trackUnit 자체다.
eq('두 번째 구매는 카드가 답을 갖고 있어 침묵', shouldAskCutAxis({ ...base, hasCard: true, qtyUnit: '롤' }), false)

// ── 새 카드의 trackUnit ────────────────────────────────────────────
const amb = { specUnit: 'm', qtyUnit: '세트' } as const
eq('선언한 답이 있으면 그 답', resolveTrackUnitForNewCard({ ...amb, categoryDefault: 'spec', declared: 'qty' }), 'qty')
eq('선언이 spec 이면 애매해도 spec', resolveTrackUnitForNewCard({ ...amb, categoryDefault: 'qty', declared: 'spec' }), 'spec')
eq('못 물은 애매한 조합은 안전한 쪽 qty', resolveTrackUnitForNewCard({ ...amb, categoryDefault: 'spec' }), 'qty')
eq('선언이 null 이어도 애매하면 qty', resolveTrackUnitForNewCard({ ...amb, categoryDefault: 'spec', declared: null }), 'qty')
// 애매하지 않으면 종전 그대로 — 회귀 0 의 근거다.
eq('장판은 카테고리 기본값 그대로 spec',
  resolveTrackUnitForNewCard({ specUnit: 'm', qtyUnit: 'm', categoryDefault: 'spec' }), 'spec')
eq('부피 규격은 카테고리 기본값 그대로 spec',
  resolveTrackUnitForNewCard({ specUnit: 'L', qtyUnit: '매', categoryDefault: 'spec' }), 'spec')
eq('폐기물 카테고리는 종전대로 qty',
  resolveTrackUnitForNewCard({ specUnit: 'L', qtyUnit: '매', categoryDefault: 'qty' }), 'qty')
eq('규격이 아예 없으면 카테고리 기본값 그대로',
  resolveTrackUnitForNewCard({ specUnit: null, qtyUnit: '개', categoryDefault: 'spec' }), 'spec')

// ── 문구의 조사 ────────────────────────────────────────────────────
eq('세트는 세트로', unitWithRo('세트'), '세트로')
eq('롤은 ㄹ 받침이라 롤로', unitWithRo('롤'), '롤로')
eq('팩은 받침이 있어 팩으로', unitWithRo('팩'), '팩으로')
eq('통은 받침이 있어 통으로', unitWithRo('통'), '통으로')
eq('개는 받침이 없어 개로', unitWithRo('개'), '개로')
eq('영문 단위는 띄어 쓴다', unitWithRo('m'), 'm 로')
eq('cm 도 띄어 쓴다', unitWithRo('cm'), 'cm 로')
eq('빈 값은 빈 값', unitWithRo(''), '')

console.log(`\n[재단 축 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
