// 보관 위치 트리 쓰기 액션의 배선 감지망 — 다섯 축이 살아 있는가. 읽기 전용, 위반 시 exit 1.
//
// 왜 소스 가드인가. 이동·생성·삭제·순서의 거부 규칙은 DB 가 있어야 실행되는 서버 액션이라
// 순수 진리표(scripts/test-location-tree.ts)로 덮을 수 없다. 순수 판정 함수는 이미 그 진리표가
// 지키고 있으므로, 여기서는 **액션이 그 판정 함수를 실제로 부르는가**를 본다. 판정이 멀쩡해도
// 호출이 빠지면 순환·깊이 초과·형제 중복이 그대로 저장된다 — 값 대조로는 안 잡히는 구멍이다.
//
// 다섯 축.
//   ⓐ 이동이 wouldCycle·depthOf·siblingNameTaken 셋을 다 부른다(하나라도 빠지면 그 축이 뚫린다).
//   ⓑ 생성이 형제 중복을 본다(루트끼리는 Postgres 유니크가 NULL 을 구분 못 해 서버가 유일한 관문이다).
//   ⓒ 삭제가 하위를 센다(parentId 는 SetNull 이라 지우면 자식이 조용히 루트로 튀어 오른다).
//   ⓓ 순서가 형제 집합 전체성을 본다(부분 배열이면 안 보낸 형제의 상대 순서가 흔들린다).
//   ⓔ 모든 쓰기가 소속 영업장을 확인한다(남의 영업장 위치를 옮기거나 지우지 못하게).
//
// 실행: node scripts/check-location-actions-wiring.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/inventory/actions.ts'
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

function block(startMarker, endMarker) {
  const from = src.indexOf(startMarker)
  if (from < 0) { violations.push(`블록 시작을 못 찾았다: ${startMarker}`); return null }
  const to = src.indexOf(endMarker, from + startMarker.length)
  if (to < 0) { violations.push(`블록 끝을 못 찾았다: ${endMarker}`); return null }
  return src.slice(from, to)
}

function must(b, label, pattern, why) {
  if (b == null) return
  if (!pattern.test(b)) violations.push(`${label} — ${why} (${pattern})`)
}

// ── 공통 전제: 순수 판정 함수를 실제로 import 하고 있는가 ────────────────────────────
for (const fn of ['wouldCycle', 'depthOf', 'siblingNameTaken', 'stripPrefixSuggestion', 'subtreeIds', 'MAX_DEPTH']) {
  if (!new RegExp(`\\b${fn}\\b`).test(src.slice(0, src.indexOf('async function getPropertyId')))) {
    violations.push(`import 에 ${fn} 이 없다 — 판정 정본(lib/locationTree)을 안 쓰고 있다.`)
  }
}

// ⓐ 이동 — 순환·깊이·형제 중복 셋 전부.
{
  const b = block('export async function moveStorageLocation', 'export async function setStorageHub')
  must(b, '이동', /wouldCycle\(rows, id, parentId\)/, '자기 서브트리 이동 거부(wouldCycle)를 안 부른다')
  must(b, '이동', /depthOf\(rows, parentId\)/, '깊이 계산(depthOf)을 안 부른다')
  must(b, '이동', /subtreeRelativeDepth\(rows, id\)/, '서브트리 깊이까지 안 센다 — 자손 단 노드가 상한을 넘겨 앉는다')
  must(b, '이동', /> MAX_DEPTH/, '깊이 상한(MAX_DEPTH) 비교가 없다')
  must(b, '이동', /siblingNameTaken\(rows, parentId, nextName, id\)/, '형제 중복 거부(siblingNameTaken)를 안 부른다')
  must(b, '이동', /stripPrefixSuggestion\(self\.name, parentPath\)/, '앞부분 떼기(stripPrefixSuggestion)를 안 쓴다')
  must(b, '이동', /renameLabel: `\$\{self\.name\} → \$\{nextName\}`/, '이름 전환 미리보기 문자열을 서버가 안 돌려준다')
  must(b, '이동', /undo: LocationMoveUndo/, '적용취소 페이로드(이전 parentId·name·sortOrder)가 없다')
  must(b, '이동', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다 — 소속 검사의 전제다')
  must(b, '이동', /상위 위치를 찾을 수 없습니다/, '다른 영업장 부모를 거부하지 않는다')
}

// ⓑ 생성 — 형제 중복 + 깊이 + 소속.
{
  const b = block('export async function createStorageLocation', 'export async function updateStorageLocation')
  must(b, '생성', /siblingNameTaken\(rows, parentId, trimmed\)/, '형제 중복을 안 본다 — 루트끼리는 DB 유니크가 못 막는다')
  must(b, '생성', /depthOf\(rows, parentId\)/, '부모 깊이를 안 센다')
  must(b, '생성', /> MAX_DEPTH/, '깊이 상한 비교가 없다')
  must(b, '생성', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다 — 소속 검사의 전제다')
}

// ⓑ' 이름 바꾸기 — 형제 중복 보강 + 적용취소.
{
  const b = block('export async function updateStorageLocation', 'export type LocationDeleteImpact')
  must(b, '이름 바꾸기', /siblingNameTaken\(rows, self\.parentId, trimmed, id\)/, '형제 중복을 안 본다')
  must(b, '이름 바꾸기', /undo: \{ id, name: self\.name \}/, '적용취소용 이전 이름을 안 돌려준다')
  must(b, '이름 바꾸기', /const rows = await loadLocationRows\(propertyId\)/, '이 영업장 행 목록을 안 읽는다')
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
  ['moveStorageLocation', 'export async function setStorageHub'],
  ['reorderStorageLocations', 'export type LocationMoveUndo'],
  ['deleteStorageLocation', 'export async function setItemLocations'],
]) {
  const b = block(`export async function ${fn[0]}`, fn[1])
  must(b, fn[0], /await requireEdit\(\)/, '쓰기 권한 게이트가 없다')
  must(b, fn[0], /const propertyId = await getPropertyId\(\)/, '영업장을 안 집는다')
}

if (violations.length > 0) {
  for (const v of violations) console.error(`FAIL  ${v}`)
  console.error(`\n위치 트리 쓰기 배선 위반 ${violations.length}건. 판정 정본은 lib/locationTree, 진리표는 scripts/test-location-tree.ts.`)
  process.exit(1)
}
console.log('OK    위치 트리 쓰기 다섯 축(순환·깊이·형제 중복·하위 거부·형제 전체성)이 배선돼 있다.')
