// 시공/자재 표식 회귀 — 실행: npx tsx scripts/test-labor-mark.ts
//
// 고정하는 것 셋(운영자 확정 2026-08-27).
//   · **표식이 글자보다 강하다** — "지출을 통해서 들어온다면 거기에 선택하면 이건 자재가
//     아니라 시공, 서비스인거야. 이러면 명확하지? 용어에 상관없이."
//   · **표식이 없으면 종전대로 글자로 판정한다** — 옛 지출 수천 건이 그대로 돌아야 한다.
//   · **작업에 걸렸다고 무조건 시공이 아니다** — 자재를 방별로 쪼개 붙인 것이 실측 10여 건
//     있다. 그것까지 시공으로 세면 자재비가 통째로 사라진다.
import { isLaborItem, splitWorkCost } from '../lib/roomWorkCost'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}

// ── 표식이 글자를 이긴다 ────────────────────────────────────────────
// 이것이 '용어에 상관없이'의 실체다. 실리콘·에어컨 등 새 종류가 생겨도 판정어를 안 고친다.
eq('실리콘은 글자로는 자재', isLaborItem('실리콘', ''), false)
eq('표식이 있으면 시공', isLaborItem('실리콘', '', 'LABOR'), true)
eq('에어컨 수리도 표식으로 시공', isLaborItem('에어컨 수리', '', 'LABOR'), true)
// 반대도 성립해야 한다 — 글자가 공임이어도 운영자가 자재라면 자재다.
eq('벽지도배는 글자로는 시공', isLaborItem('벽지도배', ''), true)
eq('자재 표식이면 자재', isLaborItem('벽지도배', '', 'MATERIAL'), false)

// ── 표식이 없으면 종전 그대로 ───────────────────────────────────────
eq('장판 시공은 종전대로 시공', isLaborItem('장판 시공', '', null), true)
eq('원목무늬 장판은 종전대로 자재', isLaborItem('원목무늬 장판', '', null), false)
eq('돌출부도 종전대로 시공', isLaborItem('도배(돌출부)', '', undefined), true)

// ── 집계 ────────────────────────────────────────────────────────────
// 자재를 작업에 거는 것은 정상이다(살 때 나간 돈을 방별로 쪼갠 것). 표식이 그 둘을 지킨다.
eq('표식 없는 혼합은 글자로 갈린다',
  splitWorkCost([
    { amount: 140000, itemLabel: '벽지도배' },
    { amount: 44550, itemLabel: '원목무늬 장판' },
  ]), { labor: 140000, material: 44550, total: 184550 })
eq('표식이 있으면 그것을 따른다',
  splitWorkCost([
    { amount: 50000, itemLabel: '실리콘', costKind: 'LABOR' },
    { amount: 44550, itemLabel: '원목무늬 장판', costKind: 'MATERIAL' },
  ]), { labor: 50000, material: 44550, total: 94550 })
// 작업에 걸렸다고 전부 시공으로 세면 이 자재비가 사라진다 — 그렇게 하지 않는다.
eq('자재가 걸려 있어도 자재로 남는다',
  splitWorkCost([{ amount: 44550, itemLabel: '원목무늬 장판' }]),
  { labor: 0, material: 44550, total: 44550 })

console.log(`\n시공/자재 표식 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
