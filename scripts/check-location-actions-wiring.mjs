// 보관 위치 트리 쓰기 액션의 배선 감지망 — 열한 축이 살아 있는가. 읽기 전용, 위반 시 exit 1.
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
//   ⓘ 품목 위치 숨김(옮기고 숨기기, 2026-10-28 1단계)이 **원자**이고 되돌림이 안전한가. (1) 이관 점검이 숨김·창고 승격과
//     같은 트랜잭션 배열 안에서 선다(종전엔 따로 만들어 뒤가 실패하면 재고만 옮겨진 반쪽이 남았다). (2) 창고 승격 값이
//     정본 hubAfterClose 를 지난다(새 창고가 영업장 기본 창고면 null). (3) 적용취소가 이관 점검의 기대값(만든 시각·행 수·
//     보충 마커)을 대조해 얹힌 점검을 지우지 않는다. (4) 화면이 그 두 액션을 부르고, 수령 위치 고르기가 숨긴 위치를 거른다.
//   ⓙ 위치 사용 중지(2026-10-28 2단계)가 **원자**이고 되돌림이 안전한가. 미리보기와 쓰기가 같은 계획 함수(planLocationClose)를
//     부르고, 서브트리·새 기본 창고는 정본(closeTargetIds·newDefaultProblem)을 지나며, 쓰기는 한 인터랙티브 트랜잭션이다.
//     적용취소는 closedAt 시각·기본 창고 집합·품목 창고·이관 기대값·보관 비품을 대조해 하나라도 어긋나면 전체를 거부한다.
//     다시 사용은 조상이 열려 있을 때만(closedAncestorOf). 화면 메뉴가 두 동작을 부르고, 창이 같은 쓰기를 부른다.
//   ⓚ 열린 술어를 **정본으로만** 쓰는가. 허브 리졸버·수령·창고 지정이 OPEN_LINK_WHERE, 화면 쌍둥이(overview)가 isOpenLink,
//     getStockAsOf 가 셋째 정의 대신 리졸버를 부른다. 새 값을 쓰는 자리(입수·폐기·일괄·생성·옮기기·기본 창고)가 사용 중지한
//     위치를 거부하고, 고르는 화면(점검 패널·일괄 추가·품목 칩·입수·폐기·수령)이 locationClosedAt 을 거른다.
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

// ⓘ 품목 위치 숨김 — 원자 · 허브 승격 정본 · 적용취소 기대값 · 화면 배선.
{
  const b = block('export async function closeItemLocation', 'export async function reopenItemLocation')
  must(b, '숨김', /tx\.stockCheck\.create\(\{ data: transferCheckCreateData\(/, '이관 점검이 트랜잭션 안에서 서지 않는다')
  mustNot(b, '숨김', /await prisma\.stockCheck\.create\(/, '이관 점검을 트랜잭션 밖에서 따로 만든다 — 뒤 쓰기가 실패하면 재고만 옮겨진 반쪽이 남는다')
  must(b, '숨김', /await prisma\.\$transaction\(async tx =>/, '이관·숨김·창고 승격이 한 트랜잭션이 아니다')
  // 계획(잔량)은 트랜잭션 밖에서 세우므로 안에서 재고 기록 열쇠를 다시 대조하고, 숨김은 closedAt: null 조건으로 정확히 한 행(독립 검수 권고 2).
  must(b, '숨김', /if \(\(await stockSnapshotKey\(tx, data\.trackedItemId\)\) !== snap\) throw new Error\(STOCK_CHANGED_RETRY\)/, '트랜잭션 안에서 재고 기록 열쇠를 다시 대조하지 않는다 — 같은 날 수령이 끼면 낡은 잔량으로 옮긴다')
  must(b, '숨김', /storageLocationId: data\.storageLocationId, closedAt: null \},[\s\S]{0,80}if \(hid\.count !== 1\) throw new Error\(STOCK_CHANGED_RETRY\)/, '숨김이 closedAt: null 조건 한 행 대조를 안 한다')
  must(b, '숨김', /hubAfterClose\(newHub, /, '창고 승격 값이 정본(hubAfterClose)을 안 지난다 — 기본 창고를 따르던 품목이 명시값에 묶인다')
  must(b, '숨김', /transferExpect: created \?/, '적용취소 기대값(transferExpect)을 안 돌려준다')
  must(b, '숨김', /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  const u = block('export async function undoCloseItemLocation', 'export async function getHiddenLocationMoves')
  must(u, '숨김 적용취소', /c\.createdAt\.getTime\(\) === exp\.createdAtMs/, '이관 점검 만든 시각을 대조하지 않는다')
  must(u, '숨김 적용취소', /c\.locationBreakdown\.length === exp\.rowCount/, '이관 점검 행 수를 대조하지 않는다 — 머지된 실측까지 지운다')
  must(u, '숨김 적용취소', /markerSum - exp\.markerSum/, '보충 마커 합을 대조하지 않는다')
  must(u, '숨김 적용취소', /stockCheck\.count\(\{ where: \{ trackedItemId: undo\.trackedItemId, id: \{ not: undo\.transferCheckId \}, createdAt: \{ gt: c\.createdAt \} \} \}\)/, '이관 뒤에 선 점검을 세지 않는다 — 같은 날 절대값 점검 뒤 되돌리면 숨기기 전으로 복귀가 거짓이 된다')
  must(u, '숨김 적용취소', /if \(!same \|\| later > 0\)/, '이관 뒤 점검이 있어도 되돌린다')
  must(u, '숨김 적용취소', /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  must(u, '숨김 적용취소', /if \(!isOpenLocation\(closedLoc\)\) return \{ ok: false, error: LOCATION_CLOSED_DENIED \}/, '사용 중지한 위치의 링크를 다시 연다(독립 검수 권고 4)')
  must(block('export async function reopenItemLocation', 'export async function undoCloseItemLocation'), '다시 표시', /if \(!isOpenLocation\(loc\)\) return \{ ok: false, error: LOCATION_CLOSED_DENIED \}/, '사용 중지한 위치의 링크를 다시 표시한다(독립 검수 권고 4)')
  const modal = block('function HideLocationModal(', 'function DisposalForm(', ui)
  must(modal, '숨김 창', /closeItemLocation\(\{/, '옮기고 숨기기 창이 서버 액션을 안 부른다')
  must(modal, '숨김 창', /undoCloseItemLocation\(undo\)/, '토스트 적용취소가 숨김 적용취소 액션을 안 부른다')
  const sec = block('function LocationAssignSection(', 'function HideLocationModal(', ui)
  must(sec, '보관 위치 칩', /label: '옮기고 숨기기'/, '재고 남은 칩 캡션에 옮기고 숨기기 링크가 없다')
  // 옮길 위치가 없을 때의 문장은 서버 거부와 한 벌이다(독립 검수 차단 1). 손으로 적은 사본이 되살아나면 거짓 안내가 돌아온다.
  must(sec, '보관 위치 칩', /stockedHideDenied\(l\.pathName, left, false\)/, '옮길 위치가 없을 때의 캡션이 서버 거부 정본(stockedHideDenied)이 아니다')
  mustNot(sec, '보관 위치 칩', /옮길 다른 위치를 켜고 저장하면 됩니다/, '끈 채로 저장하라는 거짓 안내가 되살아났다 — 그대로 하면 서버가 거부한다')
  must(block('export async function setItemLocations', 'export async function batchSetItemLocations'), '위치 떼기 거부', /stockedHideDenied\(locName\(m\.storageLocationId\), '재고가', /, '서버 거부 문장이 캡션 정본(stockedHideDenied)과 한 벌이 아니다')
  // 수령 위치 필터는 상세 모달이 숨긴 위치 집합을 실어 보내야 산다(독립 검수 권고 2). prop 이 빠지면 필터가 빈 집합으로 조용히 꺼진다.
  must(block('function DetailModal(', 'function SettingsForm(', ui), '수령 위치', /hiddenLocationIds=\{row\.hiddenLocationIds\} checkKind=/, '상세 모달이 이력 행에 숨긴 위치 집합을 안 넘긴다 — 수령 위치 필터가 꺼진다')
  mustNot(sec, '보관 위치 칩', /closeItemLocation\(/, '저장 버튼 자리에서 숨김을 직접 부른다 — 저장은 늘 저장만(§27.1)')
  must(ui, '수령 위치', /itemLocations\.filter\(loc => !\(hiddenLocationIds \?\? \[\]\)\.includes\(loc\.id\)/, '수령 위치 고르기가 숨긴 위치를 안 거른다')
}

// ⓙ 위치 사용 중지 — 같은 계획 · 정본 경유 · 한 트랜잭션 · 적용취소 대조 · 화면 배선.
{
  const imp = block('export async function getLocationCloseImpact', 'export type CloseStorageLocationUndo')
  must(imp, '사용 중지 미리보기', /await planLocationClose\(propertyId, id\)/, '미리보기가 쓰기와 같은 계획 함수를 안 부른다 — 화면이 묻는 품목과 서버가 요구하는 품목이 갈린다')
  const plan = block('async function planLocationClose', 'export type LocationCloseImpact')
  must(plan, '사용 중지 계획', /closeTargetIds\(rows, id\)/, '서브트리 닫기 정본(closeTargetIds)을 안 부른다')
  must(plan, '사용 중지 계획', /needsDest: qty >= 0\.001 \|\| \(hadOpenLink && openLinkIds\.length === 0\)/, '재고 남은 품목·유일한 열린 링크가 닫히는 품목(결정 9)을 묻지 않는다')
  const close = block('export async function closeStorageLocation', 'export async function undoCloseStorageLocation')
  must(close, '사용 중지', /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  must(close, '사용 중지', /const propertyId = await getPropertyId\(\)/, '영업장을 안 집는다')
  must(close, '사용 중지', /await planLocationClose\(propertyId, data\.id\)/, '쓰기가 미리보기와 같은 계획 함수를 안 부른다')
  must(close, '사용 중지', /newDefaultProblem\(rows, closingIds, data\.newDefaultId\)/, '기본 창고를 닫을 때 새 기본 창고 필수(결정 4)를 정본으로 안 본다')
  must(close, '사용 중지', /prisma\.\$transaction\(async tx =>/, '인터랙티브 한 트랜잭션이 아니다 — 위치만 닫히고 재고는 안 옮겨진 반쪽이 남는다')
  must(close, '사용 중지', /tx\.stockCheck\.create\(\{ data: transferCheckCreateData\(/, '이관 점검이 트랜잭션 안에서 정본 조립(transferCheckCreateData)으로 서지 않는다')
  must(close, '사용 중지', /위치 사용 중지: \$\{fromPath\}에서/, '이관 메모가 정한 꼴(위치 사용 중지: A에서 B로 N 이관)이 아니다')
  must(close, '사용 중지', /hubAfterClose\(newHub, defaultAfter\)/, '품목 창고 승격 값이 정본(hubAfterClose)을 안 지난다')
  must(close, '사용 중지', /if \(draftRows\.length\) await tx\.stockCheckDraft\.deleteMany\(/, '닫는 위치의 임시저장을 안 지운다')
  must(close, '사용 중지', /if \(storedRows\.length\) await tx\.expense\.updateMany\(\{ where: \{ propertyId, id: \{ in: storedRows\.map\(r => r\.id\) \} \}, data: \{ storedLocationId: data\.storedToId \} \}\)/, '보관 비품을 고른 곳으로 옮기지 않는다(결정 10)')
  must(close, '사용 중지', /tx\.storageLocation\.updateMany\(\{ where: \{ propertyId, id: \{ in: closingIds \}, closedAt: null \}, data: \{ closedAt: now \} \}\)/, '서브트리 closedAt 을 영업장 범위·closedAt: null 조건으로 한 시각에 쓰지 않는다')
  must(close, '사용 중지', /if \(shut\.count !== closingIds\.length\) throw new Error\(STOCK_CHANGED_RETRY\)/, '닫은 행 수를 대조하지 않는다(독립 검수 권고 2)')
  must(close, '사용 중지', /if \(\(await stockSnapshotKey\(tx, itemId\)\) !== p\.i\.snapshot\) throw new Error\(STOCK_CHANGED_RETRY\)/, '품목마다 재고 기록 열쇠를 트랜잭션 안에서 다시 대조하지 않는다(독립 검수 권고 2)')
  mustNot(plan, '사용 중지 계획', /qty: Math\.round\(qty \* 1000\) \/ 1000/, '이관 수량을 반올림한다 — 옮긴 양과 남은 양이 어긋난다(독립 검수 권고 3)')
  const undo = block('export async function undoCloseStorageLocation', 'export async function reopenStorageLocation')
  must(undo, '사용 중지 적용취소', /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  must(undo, '사용 중지 적용취소', /locationsInProperty\(propertyId, locIds\)/, '토큰의 위치 id 를 영업장 범위로 안 본다')
  // 품목 창고 원복 값(hubBefore)도 영업장 범위 검사에 든다(독립 검수 차단). 빠지면 조작한 토큰이 남의 영업장 위치를 창고 칸에 넣는다.
  must(undo, '사용 중지 적용취소', /const locIds = \[[^\n]*undo\.items\.flatMap\(i => \[i\.destLocationId, i\.hubBefore, i\.hubAfter, \.\.\.i\.closedLinkIds\]\)/, '토큰의 품목 창고 원복 값(hubBefore)을 영업장 범위로 안 본다')
  // 바꾼 품목마다 사용 중지 뒤 점검·입수·폐기를 본다(이관 없는 재고 0 품목 포함, 독립 검수 권고 1).
  must(undo, '사용 중지 적용취소', /stockAddition\.count\(\{ where: \{ trackedItemId: i\.trackedItemId, createdAt: \{ gt: after \} \} \}\)/, '사용 중지 뒤 입수를 보지 않는다')
  must(undo, '사용 중지 적용취소', /stockDisposal\.count\(\{ where: \{ trackedItemId: i\.trackedItemId, createdAt: \{ gt: after \} \} \}\)/, '사용 중지 뒤 폐기를 보지 않는다')
  must(undo, '사용 중지 적용취소', /if \(checks \+ adds \+ disps > 0\) return \{ ok: false, error: AFTER_CLOSE_ACTIVITY \}/, '사용 중지 뒤 활동이 있어도 되돌린다')
  must(undo, '사용 중지 적용취소', /const touched = !!i\.transferCheckId \|\| i\.closedLinkIds\.length > 0 \|\| i\.destLink === 'created' \|\| i\.destLink === 'reopened' \|\| i\.hubAfter !== i\.hubBefore/, '활동 검사가 이관 있는 품목에만 걸린다 — 재고 0 품목·새 링크·창고만 바꾼 품목이 빠진다')
  must(undo, '사용 중지 적용취소', /c\.closedAt\?\.getTime\(\) !== undo\.closedAtMs/, 'closedAt 시각 CAS 가 없다 — 그새 다시 사용·다시 닫은 위치를 되돌린다')
  must(undo, '사용 중지 적용취소', /JSON\.stringify\(hubsNow\) !== JSON\.stringify\(\[\.\.\.undo\.hubIdsAfter\]\.sort\(\)\)/, '기본 창고 집합을 대조하지 않는다')
  must(undo, '사용 중지 적용취소', /hubLocationId !== i\.hubAfter/, '품목 창고를 대조하지 않는다')
  must(undo, '사용 중지 적용취소', /c\.locationBreakdown\.length !== exp\.rowCount/, '이관 점검 기대값을 대조하지 않는다 — 얹힌 실측을 지운다')
  must(undo, '사용 중지 적용취소', /storedLocationId: undo\.storedToId \} \}\)/, '보관 비품이 그 자리에 그대로인지 대조하지 않는다')
  must(undo, '사용 중지 적용취소', /prisma\.\$transaction\(async tx =>/, '되돌리기가 한 트랜잭션이 아니다')
  const reopen = block('export async function reopenStorageLocation', 'export async function undoReopenStorageLocation')
  must(reopen, '다시 사용', /closedAncestorOf\(rows, id\)/, '조상이 닫혀 있으면 거부하지 않는다(결정 5)')
  must(reopen, '다시 사용', /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  const ureopen = block('export async function undoReopenStorageLocation', 'export async function setItemLocations')
  must(ureopen, '다시 사용 적용취소', /if \(loc\.isHub \|\| links > 0 \|\| stored > 0 \|\| openKids > 0\)/, '그새 쓰기 시작한 위치를 다시 닫는다')
  const menu = block('function LocationSettingsModal(', 'function CloseLocationModal(', ui)
  must(menu, '위치 관리 메뉴', /void handleCloseLoc\(menuNode\)/, "'사용 중지' 메뉴가 없다")
  must(menu, '위치 관리 메뉴', /void handleReopenLoc\(menuNode\)/, "'다시 사용' 메뉴가 없다")
  must(menu, '위치 관리 메뉴', /undoCloseStorageLocation\(undo\)/, '사용 중지 토스트에 적용취소가 없다')
  must(menu, '위치 관리 메뉴', /undoReopenStorageLocation\(undo\)/, '다시 사용 토스트에 적용취소가 없다')
  must(menu, '위치 관리 행', /<Badge tone="neutral" className="shrink-0">사용 중지<\/Badge>/, "사용 중지 행 배지가 solid neutral '사용 중지' 가 아니다(§11 --canvas 면, 낱말 하나)")
  mustNot(ui, '낱말 하나', /사용 안 함<\/Badge>|숨김 처리됩니다/, "위치 사용 중지 낱말이 둘로 갈렸다('사용 안 함'·'숨김 처리'). 동작·배지는 '사용 중지', 품목 쪽은 '숨겨집니다'(독립 검수 권고 6)")
  const modal = block('function CloseLocationModal(', 'function LocationMoveModal(', ui)
  must(modal, '사용 중지 창', /await closeStorageLocation\(\{/, '사용 중지 창이 서버 쓰기를 안 부른다')
  must(modal, '사용 중지 창', /defaultDestinationId\(closable, impact\.closingIds, newDefault \|\| null\)/, '목적지 기본값이 정본(defaultDestinationId)이 아니다')
  must(modal, '사용 중지 창', /reason=\{blocked \? reasonId : undefined\}/, '빈 행이 있을 때 주 버튼을 이유와 함께 막지 않는다(§27.8 ③)')
}

// ⓚ 열린 술어 정본 경유 — 서버 셋 · 화면 쌍둥이 · 쓰기 거부 · 고르는 화면.
{
  let shift = ''
  try { shift = stripComments(readFileSync('app/(app)/inventory/ledgerShift.ts', 'utf8')) } catch { violations.push('ledgerShift.ts 를 못 읽었다') }
  let ov = ''
  try { ov = stripComments(readFileSync('app/(app)/inventory/overview.ts', 'utf8')) } catch { violations.push('overview.ts 를 못 읽었다') }
  must(block('export async function resolveItemHubLocationId(', 'export async function loadLedgerChecks', shift), '허브 리졸버', /where: \{ trackedItemId, \.\.\.OPEN_LINK_WHERE \}/, '열린 링크 조건 정본(OPEN_LINK_WHERE)을 안 쓴다 — 사용 중지한 창고가 미지정 입수의 귀속처가 된다')
  must(ov, '화면 허브 쌍둥이', /itemLinks\.filter\(l => isOpenLink\(l, l\.storageLocation\)\)/, '화면 쌍둥이가 열린 링크 판정 정본(isOpenLink)을 안 쓴다 — 카드와 서버의 창고가 갈린다')
  must(block('export async function confirmReceipt', 'export async function', src), '수령', /locations: \{ where: OPEN_LINK_WHERE,/, '수령 위치 후보가 열린 링크 정본을 안 쓴다')
  must(block('export async function setItemHub', 'export type ItemLocationStock'), '품목 창고 지정', /\.\.\.OPEN_LINK_WHERE \}/, '창고 지정이 열린 링크 정본을 안 쓴다')
  const asof = block('export async function getStockAsOf', 'export async function setItemHub')
  must(asof, '시점 잔량', /await resolveItemHubLocationId\(trackedItemId, it\.hubLocationId, propertyId\)/, '셋째 허브 정의가 되살아났다 — 정본 리졸버를 불러야 한다')
  mustNot(asof, '시점 잔량', /\?\? locs\[0\]/, '첫 링크 폴백이 되살아났다 — 닫힌 위치에 델타를 얹는다')
  for (const [fn, end] of [['createStockAddition', 'export async function'], ['createStockDisposal', 'export async function'], ['batchSetItemLocations', 'export async function confirmReceipt'], ['toggleStorageLocationHub', 'export async function restoreStorageHubs'], ['restoreStorageHubs', 'export async function createStorageLocation'], ['setItemLocations', 'export async function batchSetItemLocations']]) {
    must(block(`export async function ${fn}`, end), fn, /LOCATION_CLOSED_DENIED/, '사용 중지한 위치를 거부하지 않는다')
  }
  must(block('export async function updateStockAddition', 'export async function'), 'updateStockAddition', /!isOpenLocation\(loc\) && data\.storageLocationId !== a\.storageLocationId/, '새로 고른 사용 중지 위치를 거부하지 않는다(이미 적힌 값은 이력이라 지나가야 한다)')
  for (const [fn, end] of [['createStorageLocation', 'export async function updateStorageLocation'], ['moveStorageLocation', 'export async function placeStorageLocation'], ['placeStorageLocation', 'export async function restoreStorageLocation']]) {
    must(block(`export async function ${fn}`, end), fn, /PARENT_CLOSED_DENIED/, '사용 중지한 위치 아래로 넣는 것을 거부하지 않는다')
  }
  must(block('export async function transferLocationStock', 'export type CloseLocationUndo'), '옮기기', /LOCATION_CLOSED_DENIED/, '도착지가 사용 중지한 위치여도 옮긴다')
  must(block('export async function getItemLocationStock', 'export async function transferLocationStock'), '옮기기 후보', /allLocs\.filter\(l => !isOpenLocation\(l\)\)/, '사용 중지한 위치를 목적지 후보에서 빼지 않는다')
  must(ui, '점검 패널', /getStorageLocations\(\)\.then\(r => setLocs\(r\.filter\(l => !l\.locationClosedAt\)\)\)/, '점검 위치 선택기가 사용 중지한 위치를 거르지 않는다')
  must(block('function BatchLocationModal(', 'function LocationAssignSection(', ui), '일괄 추가', /setAllLocs\(r\.filter\(l => !l\.locationClosedAt\)\)/, '일괄 추가 후보가 사용 중지한 위치를 거르지 않는다')
  must(block('function LocationAssignSection(', 'function HideLocationModal(', ui), '품목 칩', /!closedIds\.has\(loc\.id\) && !loc\.locationClosedAt/, '품목 설정 칩이 사용 중지한 위치를 거르지 않는다')
  must(block('function DisposalForm(', 'function ', ui), '폐기', /const pickLocs = item\.locations\.filter\(l => !l\.locationClosedAt\)/, '폐기 위치 select 가 사용 중지한 위치를 거르지 않는다')
  must(ui, '수령 위치', /!\(hiddenLocationIds \?\? \[\]\)\.includes\(loc\.id\) && !loc\.locationClosedAt/, '수령 위치 고르기가 사용 중지한 위치를 거르지 않는다')
  must(block('function reasonOf(', 'const locPreserveDefault', ui), '옮기기 판정', /ctx\.all\.find\(n => n\.id === parentId\)\?\.locationClosedAt\) return \{ text: '사용 중지한 위치입니다'/, '드래그·옮기기 판정이 사용 중지한 부모를 막지 않는다(서버와 갈린다)')
}

if (violations.length > 0) {
  for (const v of violations) console.error(`FAIL  ${v}`)
  console.error(`\n위치 트리 쓰기 배선 위반 ${violations.length}건. 판정 정본은 lib/locationTree, 진리표는 scripts/test-location-tree.ts.`)
  process.exit(1)
}
console.log('OK    위치 트리 쓰기 열한 축(순환·깊이·형제 중복·하위 거부·형제 전체성·전체 이름 유일·원자 배치·원자 적용취소·품목 위치 숨김·위치 사용 중지·열린 술어)이 배선돼 있다.')
