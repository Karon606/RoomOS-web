// 보관 위치 트리 정본(lib/locationTree) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 운영자 요청(2026-09-14)을 그대로 박제한다. "4층 주방에 김치냉장고가 있고 상단·하단이 있는데
// 각각 개별로 놔버리니 한번에 체크를 못 해. 레이어가 하나 밖에 없어서."
//
// 지키는 계약.
//   · 표기는 조상 이름을 공백으로 이어 붙인다 — 루트의 pathName 은 name 그대로(오늘과 글자가 같다).
//   · DFS 는 화면 순서 그대로, 형제는 sortOrder 순.
//   · 순환 없음·깊이 상한 4·형제 이름 유일 셋이 불변식 전부다. 재고는 모든 노드가 가진다.
//   · 고아 parentId 는 루트로 올려 살리고 보고한다 — 조용히 빠지면 그 위치의 재고가 화면에서 증발한다.
import {
  buildTree, flattenDfs, subtreeIds, wouldCycle, siblingNameTaken, depthOf,
  stripPrefixSuggestion, MAX_DEPTH, type LocationRow,
} from '../lib/locationTree'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const row = (id: string, parentId: string | null, name: string, sortOrder: number): LocationRow =>
  ({ id, parentId, name, sortOrder })

// ── 운영자의 실제 모양 ─────────────────────────────────────────────────────
//   415호 창고(허브) · 4층 주방 { 선반, 김치냉장고 { 상단, 하단 } } · 5층 주방 { 상단 }
//   `상단` 이 4층 김치냉장고와 5층 주방 아래 둘 다 있다 — 다른 부모라 허용되어야 한다.
const W = 'w', K4 = 'k4', SH = 'sh', F4 = 'f4', F4U = 'f4u', F4D = 'f4d', K5 = 'k5', F5U = 'f5u'
const ROWS: LocationRow[] = [
  row(W, null, '415호 창고', 0),
  row(K4, null, '4층 주방', 1),
  row(F4, K4, '김치냉장고', 1),
  row(F4U, F4, '상단', 1),
  row(F4D, F4, '하단', 2),
  row(SH, K4, '선반', 0),
  row(K5, null, '5층 주방', 2),
  row(F5U, K5, '상단', 1),
]

const tree = buildTree(ROWS)
const flat = flattenDfs(tree)
const pathOf = (id: string) => flat.find(f => f.id === id)?.pathName

// ── DFS 순서 — 형제는 sortOrder 순, 부모 바로 뒤에 자손 ────────────────────
eq('DFS: 전 행이 한 번씩', flat.length, ROWS.length)
eq('DFS: 순서', flat.map(f => f.id).join(','), 'w,k4,sh,f4,f4u,f4d,k5,f5u')
eq('DFS: 루트 셋', tree.roots.length, 3)
eq('DFS: 형제는 sortOrder 순(선반 0 이 김치냉장고 1 보다 앞)',
  flat.findIndex(f => f.id === SH) < flat.findIndex(f => f.id === F4), true)

// ── pathName 공백 결합 · 루트는 name 그대로(오늘과 동일) ───────────────────
eq('표기: 루트 pathName 은 name 그대로', pathOf(W), '415호 창고')
eq('표기: 루트 pathName 은 name 그대로(4층 주방)', pathOf(K4), '4층 주방')
eq('표기: 2단계는 공백 결합', pathOf(F4), '4층 주방 김치냉장고')
eq('표기: 3단계도 공백 결합', pathOf(F4U), '4층 주방 김치냉장고 상단')
eq('표기: 하단', pathOf(F4D), '4층 주방 김치냉장고 하단')
eq('표기: 다른 가지의 같은 이름은 다른 경로', pathOf(F5U), '5층 주방 상단')
// 평면 이름(오늘 DB 에 들어있는 글자)과 트리 표기가 같은가 — 화면 문자열이 안 바뀌는 근거.
eq('표기: 오늘의 평면 이름과 글자 동일', pathOf(F4U), '4층 주방 김치냉장고 상단'.replace(/\s+/g, ' '))

// ── 깊이 — 루트가 1, 상한 4 ────────────────────────────────────────────────
eq('깊이: 상한은 4', MAX_DEPTH, 4)
eq('깊이: 루트는 1', flat.find(f => f.id === W)?.depth, 1)
eq('깊이: 자식은 2', flat.find(f => f.id === F4)?.depth, 2)
eq('깊이: 손자는 3', flat.find(f => f.id === F4U)?.depth, 3)
eq('깊이: depthOf 와 flattenDfs 일치', depthOf(ROWS, F4U), 3)
eq('깊이: 없는 id 는 0', depthOf(ROWS, 'nope'), 0)
{
  // a > b > c > d 는 4단계라 허용, 그 아래 e 는 5단계라 거부다.
  const chain: LocationRow[] = [
    row('a', null, 'ㄱ', 0), row('b', 'a', 'ㄴ', 0), row('c', 'b', 'ㄷ', 0),
    row('d', 'c', 'ㄹ', 0), row('e', 'd', 'ㅁ', 0),
  ]
  eq('깊이: 4단계는 허용', depthOf(chain, 'd') <= MAX_DEPTH, true)
  eq('깊이: 4단계 실측', depthOf(chain, 'd'), 4)
  eq('깊이: 5단계는 거부', depthOf(chain, 'e') <= MAX_DEPTH, false)
  eq('깊이: 5단계 실측', depthOf(chain, 'e'), 5)
  eq('깊이: DFS 도 같은 값', flattenDfs(buildTree(chain)).find(f => f.id === 'e')?.depth, 5)
  eq('깊이: 5단계 pathName 은 네 칸 공백', flattenDfs(buildTree(chain)).find(f => f.id === 'e')?.pathName, 'ㄱ ㄴ ㄷ ㄹ ㅁ')
}

// ── 순환 거부 ──────────────────────────────────────────────────────────────
eq('서브트리: 김치냉장고 = 자기 + 상단 + 하단', subtreeIds(ROWS, F4).sort().join(','), 'f4,f4d,f4u')
eq('서브트리: 잎은 자기 하나', subtreeIds(ROWS, F4U).join(','), 'f4u')
eq('서브트리: 없는 id 는 빈 배열', subtreeIds(ROWS, 'nope').length, 0)
eq('순환: 자기 자신 아래로 이동 거부', wouldCycle(ROWS, F4, F4), true)
eq('순환: 자기 자식 아래로 이동 거부', wouldCycle(ROWS, F4, F4U), true)
eq('순환: 자기 손자 아래로 이동 거부', wouldCycle(ROWS, K4, F4U), true)
eq('순환: 루트로 빼내기는 허용', wouldCycle(ROWS, F4, null), false)
eq('순환: 남의 가지 아래로 이동 허용', wouldCycle(ROWS, F4, K5), false)
eq('순환: 부모를 자식 아래로는 막고 그 반대는 허용', wouldCycle(ROWS, F4U, K5), false)

// ── 형제 이름 유일 — 루트는 parentId null 끼리 본다 ────────────────────────
eq('이름: 루트 중복 거부(NULL 형제)', siblingNameTaken(ROWS, null, '4층 주방'), true)
eq('이름: 루트에 새 이름은 허용', siblingNameTaken(ROWS, null, '6층 주방'), false)
eq('이름: 같은 부모 아래 중복 거부', siblingNameTaken(ROWS, F4, '상단'), true)
eq('이름: 다른 부모 아래 같은 이름 허용', siblingNameTaken(ROWS, K5, '하단'), false)
eq('이름: 5층 주방 아래 상단은 이미 있다', siblingNameTaken(ROWS, K5, '상단'), true)
eq('이름: 자기 자신은 제외(이름 그대로 저장)', siblingNameTaken(ROWS, F4, '상단', F4U), false)
eq('이름: 앞뒤 공백은 같은 이름으로 본다', siblingNameTaken(ROWS, F4, '  상단 '), true)
eq('이름: 빈 이름은 중복 판정 대상 아님', siblingNameTaken(ROWS, F4, '   '), false)

// ── 떼기 제안 ──────────────────────────────────────────────────────────────
eq('떼기: 접두가 맞으면 뒷부분', stripPrefixSuggestion('4층 김치냉장고 상단', '4층 김치냉장고'), '상단')
eq('떼기: 2단계 부모 경로도 맞는다', stripPrefixSuggestion('4층 주방 김치냉장고 상단', '4층 주방 김치냉장고'), '상단')
eq('떼기: 접두가 안 맞으면 원래 이름', stripPrefixSuggestion('5층 김치냉장고 상단', '4층 김치냉장고'), '5층 김치냉장고 상단')
eq('떼기: 부분 일치는 접두가 아니다(공백 경계)', stripPrefixSuggestion('4층 김치냉장고상단', '4층 김치냉장고'), '4층 김치냉장고상단')
eq('떼기: 다 떼면 빈 이름이라 원래 이름', stripPrefixSuggestion('4층 김치냉장고', '4층 김치냉장고'), '4층 김치냉장고')
eq('떼기: 부모 경로가 비면 원래 이름', stripPrefixSuggestion('상단', ''), '상단')

// ── 고아 parentId — 루트로 취급하고 보고 ───────────────────────────────────
{
  const orphaned: LocationRow[] = [...ROWS, row('ghost', 'no-such-parent', '유령선반', 0)]
  const t = buildTree(orphaned)
  const f = flattenDfs(t)
  eq('고아: 한 행도 안 잃는다', f.length, orphaned.length)
  eq('고아: 보고한다', t.orphanIds.join(','), 'ghost')
  eq('고아: 루트로 올린다', t.roots.some(r => r.id === 'ghost'), true)
  eq('고아: 깊이 1', f.find(x => x.id === 'ghost')?.depth, 1)
  eq('고아: pathName 은 name 그대로', f.find(x => x.id === 'ghost')?.pathName, '유령선반')
  eq('고아: 성한 행은 그대로', f.find(x => x.id === F4U)?.pathName, '4층 주방 김치냉장고 상단')
  eq('고아 없음: 성한 입력은 빈 배열', tree.orphanIds.length, 0)
}

// ── 저장된 데이터가 이미 순환일 때 — 살리고 보고한다 ──────────────────────
{
  const looped: LocationRow[] = [row('x', 'y', 'ㄱ', 0), row('y', 'x', 'ㄴ', 0), row('z', null, 'ㄷ', 0)]
  const t = buildTree(looped)
  eq('순환 데이터: 한 행도 안 잃는다', flattenDfs(t).length, 3)
  eq('순환 데이터: 보고한다', t.cycleIds.length > 0, true)
  eq('순환 데이터: 성한 루트는 그대로', t.roots.some(r => r.id === 'z'), true)
  eq('순환 데이터: depthOf 는 0(셀 수 없음)', depthOf(looped, 'x'), 0)
  eq('순환 없음: 성한 입력은 빈 배열', tree.cycleIds.length, 0)
}

// ── 트리를 안 만든 영업장 — 전부 루트면 오늘과 완전히 같다 ────────────────
{
  const flatOnly: LocationRow[] = [
    row('l1', null, '415호 창고', 0), row('l2', null, '4층 주방', 1),
    row('l3', null, '4층 김치냉장고 상단', 2), row('l4', null, '4층 김치냉장고 하단', 3),
  ]
  const f = flattenDfs(buildTree(flatOnly))
  eq('무트리: pathName 이 전부 name 과 동일', f.every(x => x.pathName === x.name), true)
  eq('무트리: 깊이가 전부 1', f.every(x => x.depth === 1), true)
  eq('무트리: 순서는 sortOrder 그대로', f.map(x => x.id).join(','), 'l1,l2,l3,l4')
}

// ── 실측 줄 ────────────────────────────────────────────────────────────────
console.log('\n실측 — DFS 순서와 표기')
for (const f of flat) console.log(`  ${String(f.depth)}  ${'  '.repeat(f.depth - 1)}${f.name.padEnd(12)} ${f.pathName}`)
console.log(`실측 — 루트 ${tree.roots.length}개 / 전 ${flat.length}행 / 최대 깊이 ${Math.max(...flat.map(f => f.depth))} (상한 ${MAX_DEPTH})`)
console.log(`실측 — 김치냉장고 서브트리 ${subtreeIds(ROWS, F4).length}개: ${subtreeIds(ROWS, F4).join(', ')}`)
console.log(`실측 — 떼기 제안 "4층 김치냉장고 상단" 을 "4층 김치냉장고" 아래로: "${stripPrefixSuggestion('4층 김치냉장고 상단', '4층 김치냉장고')}"`)

console.log(`\n보관 위치 트리 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
