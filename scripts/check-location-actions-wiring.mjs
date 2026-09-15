// 보관 위치 트리 쓰기 액션의 배선 감지망 — 여덟 축이 살아 있는가. 읽기 전용, 위반 시 exit 1.
//
// 왜 소스 가드인가. 이동·생성·삭제·순서의 거부 규칙은 DB 가 있어야 실행되는 서버 액션이라
// 순수 진리표(scripts/test-location-tree.ts)로 덮을 수 없다. 순수 판정 함수는 이미 그 진리표가
// 지키고 있으므로, 여기서는 **액션이 그 판정 함수를 실제로 부르는가**를 본다. 판정이 멀쩡해도
// 호출이 빠지면 순환·깊이 초과·형제 중복이 그대로 저장된다 — 값 대조로는 안 잡히는 구멍이다.
//
// 여섯 축.
//   ⓐ 이동이 wouldCycle·depthOf·siblingNameTaken 셋을 다 부른다(하나라도 빠지면 그 축이 뚫린다).
//   ⓑ 생성이 형제 중복을 본다(루트끼리는 Postgres 유니크가 NULL 을 구분 못 해 서버가 유일한 관문이다).
//   ⓒ 삭제가 하위를 센다(parentId 는 SetNull 이라 지우면 자식이 조용히 루트로 튀어 오른다).
//   ⓓ 순서가 형제 집합 전체성을 본다(부분 배열이면 안 보낸 형제의 상대 순서가 흔들린다).
//   ⓔ 모든 쓰기가 소속 영업장을 확인한다(남의 영업장 위치를 옮기거나 지우지 못하게).
//   ⓕ 쓰기 셋(생성·이름 바꾸기·이동)이 영업장 안 pathName 유일 검사를 부른다 — 형제 유일은 같은
//     부모 안만 보므로 루트 `4층 김치냉장고 상단` 과 `4층 김치냉장고` 아래 `상단` 이 둘 다 통과한다.
//   ⓖ 부모를 넘나드는 드래그(2026-09-16)가 **원자**인가. 드롭 한 번은 '부모가 바뀌고 자리도
//     정해진다' 는 한 동작인데 move + reorder 2연타로 치면 앞이 성공하고 뒤가 실패할 때 부모만
//     바뀌고 자리는 맨 뒤인 반쪽이 남는다 — 화면은 이미 놓은 자리를 보여 주니 아무도 모른다.
//     그래서 (1) placeStorageLocation 이 이동과 **글자까지 같은** 다섯 규칙을 부르고 한
//     트랜잭션으로 쓰는가, (2) 화면 드롭 핸들러가 2연타 대신 그 액션을 부르는가, (3) 드래그와
//     옮기기 모달이 **같은 reasonOf** 를 부르는가(막은 자리와 서버가 거부하는 자리가 갈리지 않게).
//   ⓗ 적용취소도 **원자**인가(2026-09-16 검수). 이름 제안이 pathName 보존이 된 뒤로 rename → move
//     → reorder 3연타는 넓히는 방향에서 1단계부터 막힌다 — 늘어난 이름(`김치냉장고 상단`)을 얕은
//     부모에 놓은 뒤 그 층에서 짧은 옛 이름(`상단`)을 먼저 세우려 하면, 이름을 늘린 이유였던 그
//     형제와 겹친다. 순서를 뒤집으면 깊어지는 방향이 깨진다. 그래서 되돌리기도 한 트랜잭션이고
//     규칙은 **최종 상태에 대해서만** 본다.
//
// 실행: node scripts/check-location-actions-wiring.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/inventory/actions.ts'
const UI = 'app/(app)/inventory/InventoryClient.tsx'
const violations = []

// 문자열·템플릿 안의 // 를 주석으로 오인하지 않도록 상태를 들고 걷는다. 줄 수는 보존한다.
function stripComments(src) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++; continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? c : ' '
      i++; continue
    }
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    out += c; i++
  }
  return out
}

let src
try { src = stripComments(readFileSync(FILE, 'utf8')) }
catch { console.error(`FAIL  ${FILE} — 파일이 없다. 경로가 바뀌었으면 이 그물도 같이 고쳐야 한다.`); process.exit(1) }

let ui
try { ui = stripComments(readFileSync(UI, 'utf8')) }
catch { console.error(`FAIL  ${UI} — 파일이 없다. 경로가 바뀌었으면 이 그물도 같이 고쳐야 한다.`); process.exit(1) }

function block(startMarker, endMarker, source = src) {
  const from = source.indexOf(startMarker)
  if (from < 0) { violations.push(`블록 시작을 못 찾았다: ${startMarker}`); return null }
  const to = source.indexOf(endMarker, from + startMarker.length)
  if (to < 0) { violations.push(`블록 끝을 못 찾았다: ${endMarker}`); return null }
  return source.slice(from, to)
}

function must(b, label, pattern, why) {
  if (b == null) return
  if (!pattern.test(b)) violations.push(`${label} — ${why} (${pattern})`)
}

function mustNot(b, label, pattern, why) {
  if (b == null) return
  if (pattern.test(b)) violations.push(`${label} — ${why} (${pattern})`)
}

// ── 공통 전제: 순수 판정 함수를 실제로 import 하고 있는가 ────────────────────────────
for (const fn of ['wouldCycle', 'depthOf', 'siblingNameTaken', 'preserveName', 'subtreeIds', 'MAX_DEPTH', 'conflictingPathName']) {
  if (!new RegExp(`\\b${fn}\\b`).test(src.slice(0, src.indexOf('async function getPropertyId')))) {
    violations.push(`import 에 ${fn} 이 없다 — 판정 정본(lib/locationTree · lib/locationPaths)을 안 쓰고 있다.`)
  }
}

// ⓐ 이동 — 순환·깊이·형제 중복 셋 전부.
{
  const b = block('export async function moveStorageLocation', 'export async function placeStorageLocation')
  must(b, '이동', /wouldCycle\(rows, id, parentId\)/, '자기 서브트리 이동 거부(wouldCycle)를 안 부른다')
  must(b, '이동', /depthOf\(rows, parentId\)/, '깊이 계산(depthOf)을 안 부른다')
  must(b, '이동', /subtreeRelativeDepth\(rows, id\)/, '서브트리 깊이까지 안 센다 — 자손 단 노드가 상한을 넘겨 앉는다')
  must(b, '이동', /> MAX_DEPTH/, '깊이 상한(MAX_DEPTH) 비교가 없다')
  must(b, '이동', /siblingNameTaken\(rows, parentId, nextName, id\)/, '형제 중복 거부(siblingNameTaken)를 안 부른다')
  // 이름 제안은 두 입구가 **한 규칙**이다(2026-09-16). 여기만 name 에서 떼면 같은 자리에 드래그와
  // 모달이 다른 이름을 놓는다 — 얕아지는 방향에서 이쪽만 이름이 안 늘어 pathName 이 깨진다.
  must(b, '이동', /preserveName\(oldPath, parentPath\)/, '이름 제안이 pathName 보존 정본(preserveName)이 아니다')
  must(b, '이동', /renameLabel: `\$\{self\.name\} → \$\{nextName\}`/, '이름 전환 미리보기 문자열을 서버가 안 돌려준다')
  must(b, '이동', /undo: LocationMoveUndo/, '적용취소 페이로드(이전 parentId·name·sortOrder)가 없다')
  must(b, '이동', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다 — 소속 검사의 전제다')
  must(b, '이동', /상위 위치를 찾을 수 없습니다/, '다른 영업장 부모를 거부하지 않는다')
  // ⓕ 떼기 적용 **후** 이름으로 봐야 한다. self.name 으로 보면 `상단` 으로 떼어 놓고 옛 이름을 검사한다.
  must(b, '이동', /conflictingPathName\(rows, id, parentId, nextName\)/, '영업장 안 전체 이름 유일을 안 본다 — 자손 경로까지 겹칠 수 있다')
}

// ⓑ 생성 — 형제 중복 + 깊이 + 소속.
{
  const b = block('export async function createStorageLocation', 'export async function updateStorageLocation')
  must(b, '생성', /siblingNameTaken\(rows, parentId, trimmed\)/, '형제 중복을 안 본다 — 루트끼리는 DB 유니크가 못 막는다')
  must(b, '생성', /depthOf\(rows, parentId\)/, '부모 깊이를 안 센다')
  must(b, '생성', /> MAX_DEPTH/, '깊이 상한 비교가 없다')
  must(b, '생성', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다 — 소속 검사의 전제다')
  must(b, '생성', /conflictingPathName\(rows, null, parentId, trimmed\)/, '영업장 안 전체 이름 유일을 안 본다 — 형제 유일은 같은 부모 안만 본다')
}

// ⓑ' 이름 바꾸기 — 형제 중복 보강 + 적용취소.
{
  const b = block('export async function updateStorageLocation', 'export type LocationDeleteImpact')
  must(b, '이름 바꾸기', /siblingNameTaken\(rows, self\.parentId, trimmed, id\)/, '형제 중복을 안 본다')
  must(b, '이름 바꾸기', /undo: \{ id, name: self\.name \}/, '적용취소용 이전 이름을 안 돌려준다')
  must(b, '이름 바꾸기', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다')
  must(b, '이름 바꾸기', /conflictingPathName\(rows, id, self\.parentId, trimmed\)/, '영업장 안 전체 이름 유일을 안 본다 — 이름이 바뀌면 자손 경로도 통째로 바뀐다')
}

// ⓒ 삭제 — 하위 거부.
{
  const b = block('export async function deleteStorageLocation', 'export async function setItemLocations')
  must(b, '삭제', /storageLocation\.count\(\{ where: \{ propertyId, parentId: id \} \}\)/, '하위 개수를 안 센다')
  must(b, '삭제', /아래에 위치 \$\{childCount\}개가 있습니다/, '하위가 있을 때 거부 문구가 없다')
  must(b, '삭제', /findFirst\(\{ where: \{ id, propertyId \} \}\)/, '소속 영업장을 확인하지 않는다')
}

// ⓓ 순서 — 형제 집합 전체성.
{
  const b = block('export async function reorderStorageLocations', 'export type LocationMoveUndo')
  must(b, '순서', /count\(\{ where: \{ propertyId, parentId \} \}\)/, '형제 집합 전체 개수를 안 센다')
  must(b, '순서', /count\(\{ where: \{ id: \{ in: ids \}, propertyId, parentId \} \}\)/, '보낸 id 가 그 형제 집합 소속인지 안 본다')
  must(b, '순서', /owned !== ids\.length \|\| total !== ids\.length/, '전체성 비교가 없다 — 부분 배열이 통과한다')
  must(b, '순서', /undo: \{ parentId, ids: before\.map/, '적용취소용 이전 순서를 안 돌려준다')
  must(b, '순서', /findFirst\(\{ where: \{ id: parentId, propertyId \}/, '부모의 소속 영업장을 확인하지 않는다')
}

// ⓔ 모든 쓰기가 쓰기 권한과 영업장을 통과하는가.
for (const fn of [
  ['createStorageLocation', 'export async function updateStorageLocation'],
  ['updateStorageLocation', 'export type LocationDeleteImpact'],
  ['moveStorageLocation', 'export async function placeStorageLocation'],
  ['placeStorageLocation', 'export async function restoreStorageLocation'],
  ['restoreStorageLocation', 'export async function reorderTrackedItems'],
  ['reorderStorageLocations', 'export type LocationMoveUndo'],
  ['deleteStorageLocation', 'export async function setItemLocations'],
]) {
  const b = block(`export async function ${fn[0]}`, fn[1])
  must(b, fn[0], /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  must(b, fn[0], /const propertyId = await getPropertyId\(\)/, '영업장을 안 집는다')
}

// ⓖ 부모를 넘나드는 드래그 — 원자 배치(placeStorageLocation)와 화면 배선.
{
  const b = block('export async function placeStorageLocation', 'export async function restoreStorageLocation')
  // (1) 거부 규칙은 이동과 **글자까지 같은 호출**이다. 한 줄이라도 사본이 되면 두 입구가 허용하는
  //     자리가 언젠가 갈리고, 그날 화면이 놓게 해 준 자리를 서버가 거부한다.
  must(b, '배치', /wouldCycle\(rows, id, parentId\)/, '자기 서브트리 이동 거부(wouldCycle)를 안 부른다')
  must(b, '배치', /depthOf\(rows, parentId\)/, '깊이 계산(depthOf)을 안 부른다')
  must(b, '배치', /subtreeRelativeDepth\(rows, id\)/, '서브트리 깊이까지 안 센다 — 자손 단 노드가 상한을 넘겨 앉는다')
  must(b, '배치', /> MAX_DEPTH/, '깊이 상한(MAX_DEPTH) 비교가 없다')
  must(b, '배치', /siblingNameTaken\(rows, parentId, nextName, id\)/, '형제 중복 거부(siblingNameTaken)를 안 부른다')
  must(b, '배치', /conflictingPathName\(rows, id, parentId, nextName\)/, '영업장 안 전체 이름 유일을 안 본다 — 자손 경로까지 겹칠 수 있다')
  must(b, '배치', /preserveName\(oldPath, parentPath\)/, '이름 제안이 pathName 보존 정본(preserveName)이 아니다')
  must(b, '배치', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다 — 소속 검사의 전제다')
  must(b, '배치', /상위 위치를 찾을 수 없습니다/, '다른 영업장 부모를 거부하지 않는다')
  // (2) 쓰기는 한 트랜잭션이다. 나뉘면 부모만 바뀌고 자리는 맨 뒤인 반쪽이 남는다.
  //     `$transaction(` 이 있는지만 보면 sortOrder 재기록을 그 **배열 밖** for 루프로 빼도 초록이다.
  //     그래서 형제 재기록이 그 배열 **안에** 있는지를 본다(`[^\]]*` 라 배열을 못 벗어난다).
  must(b, '배치', /prisma\.\$transaction\(\[[^\]]*nextIds\.map\(/,
    '형제 sortOrder 재기록이 그 트랜잭션 배열 안에 없다 — 부모만 바뀌고 자리는 맨 뒤인 반쪽이 다시 생긴다')
  must(b, '배치', /count\(\{ where: \{ propertyId, parentId \} \}\)/, '새 형제 집합 전체 개수를 안 센다')
  must(b, '배치', /total !== siblings\.length/, '형제 전체성 비교가 없다 — 부분 집합 위에 순서를 다시 쓴다')
  // 자리 산수도 못 물러선다. `at = siblings.length` 로 바꾸면 어디에 놓아도 맨 뒤로 가는데,
  // 화면은 놓은 자리를 이미 보여 주고 있어 그 어긋남이 조용하다.
  must(b, '배치', /const at = Math\.min\(index, siblings\.length\)/, '놓을 자리 산수가 index 를 안 쓴다 — 전부 맨 뒤로 간다')
  must(b, '배치', /undo: LocationMoveUndo/, '적용취소 페이로드(이전 parentId·name·sortOrder·형제 순서)가 없다')
}

// ⓗ 적용취소는 **한 걸음**이다 — 서버 한 트랜잭션 + 화면 한 호출.
{
  const b = block('export async function restoreStorageLocation', 'export async function reorderTrackedItems')
  must(b, '적용취소', /wouldCycle\(rows, id, parentId\)/, '되돌린 자리의 순환을 안 본다')
  must(b, '적용취소', /> MAX_DEPTH/, '되돌린 자리의 깊이 상한 비교가 없다')
  must(b, '적용취소', /siblingNameTaken\(rows, parentId, name, id\)/, '되돌린 이름의 형제 중복을 안 본다')
  must(b, '적용취소', /conflictingPathName\(rows, id, parentId, name\)/, '되돌린 이름의 전체 이름 유일을 안 본다')
  must(b, '적용취소', /prisma\.\$transaction\(\[[^\]]*order\.map\(/,
    'parentId·name 되돌리기와 옛 형제 순서 재기록이 한 트랜잭션 배열 안에 있지 않다')

  // 화면 — 3연타가 돌아오면 넓히는 방향에서 1단계(rename)부터 막힌다. 늘어난 이름을 얕은 부모에
  // 놓은 뒤 그 층에서 짧은 옛 이름을 먼저 세우려 하면, 이름을 늘린 이유였던 그 형제와 겹친다.
  const undoBlock = block('const onMoved = (', 'const handleDelete = async (', ui)
  must(undoBlock, '적용취소 배선', /restoreStorageLocation\(/, '한 걸음 되돌리기 액션을 안 부른다')
  mustNot(undoBlock, '적용취소 배선', /updateStorageLocation\(/, 'rename → move → reorder 3연타로 돌아갔다 — 넓히는 방향에서 1단계부터 막힌다')
  mustNot(undoBlock, '적용취소 배선', /moveStorageLocation\(/, 'rename → move → reorder 3연타로 돌아갔다 — 넓히는 방향에서 1단계부터 막힌다')
  mustNot(undoBlock, '적용취소 배선', /reorderStorageLocations\(/, 'rename → move → reorder 3연타로 돌아갔다 — 넓히는 방향에서 1단계부터 막힌다')
}

// ⓖ' 화면 — 드롭 핸들러가 2연타를 안 하고, 드래그와 모달이 같은 판정을 부른다.
{
  const drop = block('const commitLocDrop = async (', 'const handleAdd = async (', ui)
  must(drop, '드롭 핸들러', /placeStorageLocation\(/, '원자 배치 액션을 안 부른다')
  mustNot(drop, '드롭 핸들러', /moveStorageLocation\(/, 'move + reorder 2연타로 돌아갔다 — 반쪽 저장이 다시 생긴다')
  mustNot(drop, '드롭 핸들러', /reorderStorageLocations\(/, 'move + reorder 2연타로 돌아갔다 — 반쪽 저장이 다시 생긴다')

  // 포인터 이동에서 목록 state 를 건드리면 한 프레임에 여러 번 오는 이동마다 트리를 다시 엮게 되고
  // 402px 에서 행이 눈에 띄게 튄다. 움직이는 것은 ref 로 DOM 을 직접 쓰는 고스트 하나뿐이다.
  const move = block('const onLocHandleMove = ', 'const onLocHandleUp = ', ui)
  mustNot(move, '포인터 이동', /setLocs\(/, '포인터 이동에서 목록 state 를 다시 쓴다 — 실시간 재배열이 되살아났다')
  mustNot(move, '포인터 이동', /locReflow/, '실시간 재배열(locReflow)이 되살아났다')

  // 캡션은 손잡이가 무엇을 하는지 미리 말하는 한 줄이다. 옛 문구가 남으면 화면은 부모를 넘나드는데
  // 안내는 '같은 부모 안에서만' 이라고 말한다 — 기능이 있어도 아무도 안 쓴다.
  must(ui, '캡션', /손잡이를 잡아 끌어 순서와 상위 위치를 바꿉니다\. 행 가운데에 놓으면 그 위치 아래로 들어갑니다\./,
    '드래그 안내 문구가 없다')
  mustNot(ui, '캡션', /손잡이는 같은 부모 아래에서만 순서를 바꿉니다/, '옛 안내 문구(형제 안 순서 전용)가 남아 있다')

  // 판정은 한 벌이다. 드래그는 모듈 레벨 locHitOf 를 거쳐, 모달은 직접 같은 reasonOf 를 부른다.
  if (!/\nfunction reasonOf\(/.test(ui)) violations.push('화면 — 모듈 레벨 reasonOf 가 없다(드래그와 모달이 나눠 쓰는 판정 한 벌).')
  must(block('function locHitOf(', 'function LocationSettingsModal(', ui), '드래그 판정', /reasonOf\(ctx, parentId, nextName, samePlace\)/,
    '히트 판정이 공용 reasonOf 를 안 부른다 — 사본이 생기면 화면이 막은 자리와 서버가 거부하는 자리가 갈린다')
  must(block('function LocationSettingsModal(', 'function LocationMoveModal(', ui), '드래그 배선', /locHitOf\(s, /,
    '드래그가 공용 히트 판정(locHitOf)을 안 부른다')
  must(block('function LocationMoveModal(', 'function BatchLocationModal(', ui), '옮기기 모달', /reasonOf\(ctx, target\?\.id \?\? null, nameFor\(target\), /,
    '목적지 판정이 공용 reasonOf 를 안 부른다 — 두 입구가 회색으로 막는 자리가 갈린다')
  mustNot(block('function LocationMoveModal(', 'function BatchLocationModal(', ui), '옮기기 모달', /const reasonOf = /,
    '모달 안에 reasonOf 사본이 되살아났다')
}

if (violations.length > 0) {
  for (const v of violations) console.error(`FAIL  ${v}`)
  console.error(`\n위치 트리 쓰기 배선 위반 ${violations.length}건. 판정 정본은 lib/locationTree, 진리표는 scripts/test-location-tree.ts.`)
  process.exit(1)
}
console.log('OK    위치 트리 쓰기 여덟 축(순환·깊이·형제 중복·하위 거부·형제 전체성·전체 이름 유일·원자 배치·원자 적용취소)이 배선돼 있다.')
