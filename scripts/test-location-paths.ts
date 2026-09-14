// 보관 위치 표기 경로 색인 정본(lib/locationPaths) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
//
// 왜 따로 필요한가(독립 검수 2026-09-14). 화면 축 그물(check-location-name-axis)은 "표시 자리가
// `.pathName` 을 읽는가" 만 본다. 색인 안에서 `pathName: id => byId.get(id)?.row.name` 한 줄로
// 되돌리면 **감지망 전체가 초록인 채** 열세 자리가 평면 이름으로 돌아간다 — 어떤 테스트도
// indexLocations 자체를 안 봤기 때문이다. 그래서 색인을 lib 로 내리고(prisma 미의존) 여기서 본다.
//
// 지키는 계약.
//   · pathName 은 조상 이름을 공백으로 이은 경로. 루트는 name 그대로(오늘의 평면 데이터와 글자 동일).
//   · rank 는 화면 순서(DFS). 미등록 id 는 NO_RANK 라 순서에서 맨 뒤로 간다.
//   · byPathName·byName 은 **유일할 때만** 찍는다. 중복이면 undefined — 아무거나 찍으면 비품 배정
//     이력 되돌리기가 엉뚱한 위치로 간다(표시 오염이 아니라 데이터 오염).
//   · conflictingPathName 은 영업장 안 전체 이름 유일의 1차 관문. 서브트리 자손 경로까지 본다.
import { indexLocations, conflictingPathName, NO_RANK } from '../lib/locationPaths'
import type { LocationRow } from '../lib/locationTree'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const row = (id: string, parentId: string | null, name: string, sortOrder: number): LocationRow =>
  ({ id, parentId, name, sortOrder })

// ── 중첩 픽스처 ────────────────────────────────────────────────────────────
//   415호 창고 · 4층 김치냉장고 { 상단, 하단 } · 5층 주방 { 상단 }
//   `상단` 이 두 부모 아래 있다 — 이름은 중복이고 전체 이름은 다르다.
const W = 'w', K = 'k', KU = 'ku', KD = 'kd', F5 = 'f5', F5U = 'f5u'
const ROWS: LocationRow[] = [
  row(W, null, '415호 창고', 0),
  row(K, null, '4층 김치냉장고', 1),
  row(KU, K, '상단', 0),
  row(KD, K, '하단', 1),
  row(F5, null, '5층 주방', 2),
  row(F5U, F5, '상단', 0),
]
const idx = indexLocations(ROWS)

// ── pathName — 공백 결합, 루트는 name 그대로 ───────────────────────────────
eq('pathName: 루트는 name 그대로', idx.pathName(K), '4층 김치냉장고')
eq('pathName: 자식은 조상과 공백 결합', idx.pathName(KU), '4층 김치냉장고 상단')
eq('pathName: 하단', idx.pathName(KD), '4층 김치냉장고 하단')
eq('pathName: 다른 가지의 같은 이름은 다른 경로', idx.pathName(F5U), '5층 주방 상단')
eq('pathName: 미등록 id 는 undefined', idx.pathName('nope'), undefined)
// 색인이 name 으로 되돌아가면 여기서 즉시 빨강 — 검수가 설계한 우회 그 자리다.
eq('pathName: name 과 다르다(중첩 노드)', idx.pathName(KU) === ROWS.find(r => r.id === KU)?.name, false)

// ── rank — 화면 순서(DFS), 부모 바로 뒤에 자손 ─────────────────────────────
eq('rank: DFS 순서', idx.rows.map(r => r.id).join(','), 'w,k,ku,kd,f5,f5u')
eq('rank: 루트 첫 칸은 0', idx.rank(W), 0)
eq('rank: 자식이 부모 바로 뒤', idx.rank(KU), idx.rank(K) + 1)
eq('rank: 다음 루트는 서브트리 뒤', idx.rank(F5) > idx.rank(KD), true)
eq('rank: 미등록 id 는 NO_RANK', idx.rank('nope'), NO_RANK)
eq('rank: NO_RANK 는 맨 뒤', idx.rank('nope') > idx.rank(F5U), true)
eq('rank: rows 길이는 입력 그대로', idx.rows.length, ROWS.length)

// ── 역조회 — 유일할 때만 ───────────────────────────────────────────────────
eq('byPathName: 유일하면 찍는다', idx.byPathName('4층 김치냉장고 상단')?.id, KU)
eq('byPathName: 없는 경로는 undefined', idx.byPathName('6층 주방 상단'), undefined)
eq('byName: 유일하면 찍는다', idx.byName('415호 창고')?.id, W)
eq('byName: 중복이면 undefined(상단이 둘)', idx.byName('상단'), undefined)
{
  // 전체 이름까지 겹치는 데이터(ⓕ 위반이 이미 저장된 상태) — 역조회는 아무것도 안 찍는다.
  const dup: LocationRow[] = [...ROWS, row('flat', null, '4층 김치냉장고 상단', 3)]
  const d = indexLocations(dup)
  eq('byPathName: 중복이면 undefined', d.byPathName('4층 김치냉장고 상단'), undefined)
  eq('byPathName: 성한 경로는 그대로', d.byPathName('5층 주방 상단')?.id, F5U)
  eq('중복 데이터: 한 행도 안 잃는다', d.rows.length, dup.length)
}

// ── 오늘의 평면 데이터 — pathName 이 name 과 글자가 같다 ───────────────────
{
  const flatOnly: LocationRow[] = [
    row('l1', null, '415호 창고', 0), row('l2', null, '4층 주방', 1),
    row('l3', null, '4층 김치냉장고 상단', 2), row('l4', null, '4층 김치냉장고 하단', 3),
  ]
  const f = indexLocations(flatOnly)
  eq('무트리: pathName 이 전부 name 과 동일', f.rows.every(r => r.pathName === r.name), true)
  eq('무트리: rank 는 sortOrder 순', f.rows.map(r => r.id).join(','), 'l1,l2,l3,l4')
  eq('무트리: byName 으로 다 찾힌다', f.byName('4층 김치냉장고 상단')?.id, 'l3')
  eq('무트리: byPathName 과 byName 이 같은 행', f.byPathName('4층 김치냉장고 상단')?.id, f.byName('4층 김치냉장고 상단')?.id)
}

// ── conflictingPathName — 영업장 안 전체 이름 유일 ─────────────────────────
eq('유일: 새 루트가 겹치면 그 전체 이름',
  conflictingPathName(ROWS, null, null, '4층 김치냉장고'), '4층 김치냉장고')
eq('유일: 안 겹치는 새 루트는 null',
  conflictingPathName(ROWS, null, null, '6층 주방'), null)
// 핵심 케이스 — 루트 `4층 김치냉장고 상단` 은 형제 검사를 통과하지만 트리 노드와 전체 이름이 같다.
eq('유일: 평면 이름이 중첩 경로와 겹친다',
  conflictingPathName(ROWS, null, null, '4층 김치냉장고 상단'), '4층 김치냉장고 상단')
eq('유일: 다른 부모 아래 같은 이름은 허용',
  conflictingPathName(ROWS, null, F5, '하단'), null)
eq('유일: 같은 부모 아래 중복은 거부(형제 검사와 같은 판정)',
  conflictingPathName(ROWS, null, K, '상단'), '4층 김치냉장고 상단')
eq('유일: 빈 이름은 판정 대상 아님', conflictingPathName(ROWS, null, null, '   '), null)
eq('유일: 자기 이름 그대로 저장은 자기와 안 겹친다',
  conflictingPathName(ROWS, KU, K, '상단'), null)
{
  // 이동·이름 바꾸기 — **자기 이름은 안 겹치는데 자손 경로가 겹치는** 자리가 핵심이다.
  //   4층 { 김치냉장고 상단 }  ·  김치냉장고 { 상단 }
  //   `김치냉장고` 를 `4층` 아래로 떼지 않고 옮기면 자손이 `4층 김치냉장고 상단` 이 돼 겹친다.
  const moving: LocationRow[] = [
    row('a', null, '4층', 0),
    row('b', 'a', '김치냉장고 상단', 0),
    row('c', null, '김치냉장고', 1),
    row('d', 'c', '상단', 0),
  ]
  eq('유일: 옮긴 노드 자신은 안 겹친다', indexLocations(moving).byPathName('4층 김치냉장고'), undefined)
  eq('유일: 옮기면 자손 경로가 겹친다',
    conflictingPathName(moving, 'c', 'a', '김치냉장고'), '4층 김치냉장고 상단')
  eq('유일: 떼기로 이름이 바뀌면 안 겹친다',
    conflictingPathName(moving, 'c', 'a', '냉장고'), null)
  eq('유일: 이름 바꾸기도 자손 경로를 본다',
    conflictingPathName(moving, 'b', 'a', '김치냉장고 하단'), null)
  eq('유일: 자기 서브트리는 비교군에서 뺀다',
    conflictingPathName(moving, 'c', null, '김치냉장고'), null)
  eq('유일: 없는 id 는 판정 대상 아님',
    conflictingPathName(moving, 'nope', null, '4층'), null)
}

// ── 실측 줄 ────────────────────────────────────────────────────────────────
console.log('\n실측 — DFS 랭크와 표기 경로')
for (const r of idx.rows) console.log(`  ${String(idx.rank(r.id))}  ${'  '.repeat(r.depth - 1)}${r.name.padEnd(12)} ${r.pathName}`)
console.log(`실측 — 이름 중복 "상단" ${idx.rows.filter(r => r.name === '상단').length}개 / byName 결과 ${String(idx.byName('상단'))}`)

console.log(`\n보관 위치 표기 경로 색인 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
