// 품목 고르기 맥락 진리표(lib/heldContext). 실행: npx tsx scripts/test-held-context.ts
//
// 고정하는 것(2026-11-03 독립 검수 차단 2). 이전 품목의 지난 제품 칩·세부스펙 칩·단위 안내가 다음 품목에 남지 않는다.
//   · 쥔 품명과 지금 품명이 같을 때만 맥락을 내준다('라면' 맥락은 '라면 컵' 에서 안 보인다).
//   · 앞뒤 공백은 같은 품명으로 본다. 빈 품명(고르기 닫힘·담은 뒤)에는 아무 맥락도 없다.
import { holdFor, contextFor } from '../lib/heldContext'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const ramen = holdFor('라면', { products: ['오뚜기 진라면 매운맛', '삼양 삼양라면 깔끔한 감칠맛'] })
eq('같은 품명이면 맥락', contextFor(ramen, '라면')?.products.length, 2)
eq('라면 맥락은 라면 컵에서 안 보인다', contextFor(ramen, '라면 컵'), null)
eq('앞뒤 공백은 같은 품명', contextFor(ramen, '  라면 '), contextFor(ramen, '라면'))
eq('빈 품명이면 맥락 없음', contextFor(ramen, ''), null)
eq('품명 없음(null)이면 맥락 없음', contextFor(ramen, null), null)
eq('쥔 것이 없으면 맥락 없음', contextFor(null, '라면'), null)
eq('맥락 없이 쥐면 null', holdFor('라면', null), null)
eq('쥘 때 공백을 뗀다', holdFor(' 라면 ', 1)?.label, '라면')

console.log(`\n[품목 고르기 맥락 진리표] 통과 ${pass} · 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
