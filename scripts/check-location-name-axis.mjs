// 보관 위치 이름 축 감지망 — 화면에 찍는 위치 이름이 표기 경로(pathName)인가. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 2026-09-14 트리(parentId) 뒤로 위치 이름은 두 축이 됐다.
//   · name     — 그 노드 한 칸의 이름. 트리 편집 화면(위치 관리)이 쓴다. `상단`.
//   · pathName — 조상 이름을 공백으로 이은 표기 경로. **그 외 모든 표시 자리**가 쓴다. `4층 김치냉장고 상단`.
// 한 자리가 name 으로 남으면 같은 위치가 카드에선 `4층 김치냉장고 상단`, 점검 폼에선 `상단` 으로 떠
// 어느 칸을 세는지 화면이 말을 못 한다. 9/11 김치 사고가 바로 "어느 칸인지 몰라 깜빡한" 사고다.
// 값 대조로는 절대 안 잡힌다 — 수량은 내내 맞고 글자만 틀리기 때문이다. 모양을 보는 그물이 따로 있어야 한다.
//
// 검사는 파일별로 함수·블록을 잘라서 한다. 블록을 못 찾으면(이름이 바뀌었으면) 그것도 위반이다 —
// 조용히 통과하는 그물은 없느니만 못하다. 주석은 걷고 본다(주석 속 예시에 걸리지 않게).
//
// 실행: node scripts/check-location-name-axis.mjs
import { readFileSync } from 'node:fs'

const violations = []

// 문자열·템플릿 안의 // 를 주석으로 오인하지 않도록 상태를 들고 걷는다. 걷어낸 자리는 공백으로 채워 줄 수를 보존한다.
function stripComments(src) {
  let out = ''
  let i = 0
  let state = 'code'   // code | line | block | sq | dq | tpl
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

const sources = new Map()
function read(file) {
  if (!sources.has(file)) {
    try { sources.set(file, stripComments(readFileSync(file, 'utf8'))) }
    catch { sources.set(file, null) }
  }
  return sources.get(file)
}

// start 마커부터 다음 최상위 선언(또는 end 마커) 직전까지를 한 블록으로 자른다.
function slice(file, startMarker, endMarker) {
  const src = read(file)
  if (src == null) { violations.push(`${file} — 파일이 없다. 경로가 바뀌었으면 이 그물도 같이 고쳐야 한다.`); return null }
  const from = src.indexOf(startMarker)
  if (from < 0) { violations.push(`${file} — 블록 시작을 못 찾았다: ${startMarker}`); return null }
  const to = endMarker ? src.indexOf(endMarker, from + startMarker.length) : -1
  if (endMarker && to < 0) { violations.push(`${file} — 블록 끝을 못 찾았다: ${endMarker}`); return null }
  return src.slice(from, to < 0 ? src.length : to)
}

// 블록이 패턴을 최소 min 번 품고 있는가.
function must(file, block, label, pattern, min = 1) {
  if (block == null) return
  const hits = block.match(pattern)
  const n = hits ? hits.length : 0
  if (n < min) violations.push(`${file} — ${label}: ${pattern} 가 ${n}회(최소 ${min}회). 표시 이름이 pathName 이 아니다.`)
}

// 블록이 금지 패턴을 품고 있지 않은가.
function mustNot(file, block, label, pattern) {
  if (block == null) return
  if (pattern.test(block)) violations.push(`${file} — ${label}: ${pattern} 가 남아 있다. 표시 이름은 pathName 이다(name 은 트리 편집용 한 칸).`)
}

// ── 1. 재고 개요(서버) — 카드 칩·위치 이름 두 곳 + 배치 조회 ───────────────────────────
{
  const f = 'app/(app)/inventory/overview.ts'
  const src = read(f)
  if (src == null) violations.push(`${f} — 파일이 없다.`)
  else {
    must(f, slice(f, 'const locations: StorageLocationItem[] = itemLinks', 'const openLinkIds'),
      'locations 매핑', /pathName: locIndex\.pathName\(/)
    must(f, slice(f, 'const locNameOf = (id: string)', 'const restockedOf'),
      'locNameOf(카드 칩·상세 위치 칩)', /locIndex\.pathName\(/)
    must(f, slice(f, 'lastCheckLocationBreakdown:', 'monthlyConsumption,'),
      'lastCheckLocationBreakdown', /locationName: locIndex\.pathName\(/)
    // 배치 조회 — 허브 한 줄만 뽑던 findFirst 를 영업장 위치 전체 findMany 로 넓혔다(쿼리 수 불변).
    // 조상이 링크돼 있으리란 보장이 없어 전체를 읽어야 표기 경로를 만들 수 있다.
    mustNot(f, src, '배치 조회', /storageLocation\.findFirst\(\s*\{\s*where:\s*\{\s*propertyId,\s*isHub: true/)
    must(f, src, '배치 조회', /allLocationRows\.find\(l => l\.isHub\)/)
  }
}

// ── 2. 재고 서버 액션 — 상세·점검·이동·숨김·전파·목록 ──────────────────────────────────
{
  const f = 'app/(app)/inventory/actions.ts'
  must(f, slice(f, 'export async function getStorageLocations', 'export async function reorderStorageLocations'),
    'getStorageLocations(목록)', /pathName: r\.pathName/)
  must(f, slice(f, 'export async function getStorageLocations', 'export async function reorderStorageLocations'),
    'getStorageLocations(구조 칸)', /parentId: r\.parentId[\s\S]*depth: r\.depth|depth: r\.depth[\s\S]*parentId: r\.parentId/)

  const detail = slice(f, 'export async function getInventoryDetail', 'export async function createTrackedItem')
  must(f, detail, '상세 점검 breakdown', /locationName: locPaths\.pathName\(/)
  must(f, detail, '상세 입수·폐기 위치', /storageLocationName: [a-z]\.storageLocationId \? \(locPaths\.pathName\(/g, 2)
  must(f, detail, '수령 위치', /receivedLocationName: p\.receivedLocationId \? \(locPaths\.pathName\(/)
  must(f, detail, '상세 위치 칩(locations)', /pathName: locPaths\.pathName\(/)
  must(f, detail, '상세 위치 순서(DFS)', /locPaths\.rank\(a\.id\) - locPaths\.rank\(b\.id\)/)

  must(f, slice(f, 'async function withOtherNames', 'function applyTransfers'),
    'HUB_SHORT 목록(withOtherNames)', /locPaths\.pathName\(o\.locationId\)/)

  must(f, slice(f, 'export async function previewStockCheckPropagation', '\n}\n'),
    '전파 미리보기', /locationName: locPaths\?\.pathName\(/)

  must(f, slice(f, 'export async function setItemLocations', 'export async function batchSetItemLocations'),
    '위치 떼기 안내(locName)', /const locName = \(id: string\) => locPaths\.pathName\(/)

  must(f, slice(f, 'export async function getItemLocationStock', 'export async function transferLocationStock'),
    '품목 위치 잔량(이동 모달 칩)', /pathName: l\.pathName/)

  const transfer = slice(f, 'export async function transferLocationStock', 'export type CloseLocationUndo')
  must(f, transfer, '위치 이동 문구', /const fromLoc = locPaths\.pathName\(/)
  mustNot(f, transfer, '위치 이동 문구', /(fromLoc|toLoc)\.name/)

  const close = slice(f, 'export async function closeItemLocation', 'export async function reopenItemLocation')
  must(f, close, '숨김 이관 메모', /위치 숨김: \$\{locPaths\.pathName\(/)
}

// ── 3. 재고 화면 — 표시 자리마다 pathName 을 읽는가 ───────────────────────────────────
//   위치 관리 모달(LocationSettingsModal)만 예외다. 거기서 고치는 것이 name(한 칸) 자체이고,
//   구조는 트리 화면이 들여쓰기로 말한다.
{
  const f = 'app/(app)/inventory/InventoryClient.tsx'
  const BLOCKS = [
    ['InventoryCard(카드 칩)', 'function InventoryCard(', 'function AddItemModal(', 1],
    ['DetailModal(상세 위치 칩·허브 목록)', 'function DetailModal(', 'function MonthlyInflowList(', 2],
    ['TimelineRow(수령 위치 칩)', 'function TimelineRow(', 'function DiffAttributionChoice(', 1],
    ['TimelineReconcileForm(보정 행)', 'function TimelineReconcileForm(', 'function InventoryCategorySettingsModal(', 1],
    ['FullReconcileModal(일괄 보정 행)', 'function FullReconcileModal(', 'function CheckEditForm(', 1],
    ['CheckEditForm(점검 수정 행)', 'function CheckEditForm(', 'function AdditionEditForm(', 3],
    ['AdditionEditForm(입수 수정 select)', 'function AdditionEditForm(', 'function PurchaseEditForm(', 1],
    ['CheckForm(아이템별 점검 행)', 'function CheckForm(', 'function TransferStockModal(', 3],
    ['TransferStockModal(이동 칩·토스트)', 'function TransferStockModal(', 'function HubShortDialog(', 5],
    ['HubShortDialog(공여 위치 칩)', 'function HubShortDialog(', 'function LocationBatchCheckModal(', 2],
    ['LocationBatchCheckModal(위치 select·임시저장 칩)', 'function LocationBatchCheckModal(', 'function MergeDecisionModal(', 3],
    ['BatchLocationModal(위치 일괄 추가 칩)', 'function BatchLocationModal(', 'function LocationAssignSection(', 1],
    ['LocationAssignSection(품목별 할당 칩)', 'function LocationAssignSection(', 'function DisposalForm(', 2],
    ['DisposalForm(폐기 폼 select)', 'function DisposalForm(', 'function AdditionForm(', 1],
    ['AdditionForm(입수 폼 select)', 'function AdditionForm(', null, 1],
  ]
  for (const [label, start, end, min] of BLOCKS) {
    const block = slice(f, start, end)
    must(f, block, label, /\.pathName\b/g, min)
    // 같은 블록에 위치 이름의 평면 축이 남아 있으면 두 이름이 한 화면에서 섞인다.
    mustNot(f, block, label, /\b(loc|l|hubLoc|itemHub|fromLoc|toLoc|src|hubStock)\.name\b/)
  }
}

// ── 4. 비품(공용부) — 배정 select·이력 라벨·그룹 순서 ────────────────────────────────
{
  const f = 'app/(app)/inventory/assets/actions.ts'
  const assets = slice(f, 'export async function getDurableItems', 'export async function reorderAssetItems')
  must(f, assets, '비품 카드 위치 이름', /locationName: r\.assignedLocationId \? \(locPaths\.pathName\(/)
  must(f, assets, '공용부 그룹 순서(DFS 랭크)', /locPaths\.rank\(a\.locationId\) - locPaths\.rank\(b\.locationId\)/)
  mustNot(f, assets, '공용부 그룹 순서', /locRank\.get\(/)

  must(f, slice(f, 'export async function getAssignableLocations', 'export type AssignTarget'),
    '공용부 배정 후보', /pathName: r\.pathName/)

  must(f, slice(f, 'async function placeLabel', 'type SpecKey = {'),
    '배정 이력 라벨(placeLabel)', /locPaths\.pathName\(locId\)/)

  const resolve = slice(f, 'async function resolvePlace', 'export async function revertAssignmentLog')
  must(f, resolve, '배정 이력 되돌리기(resolvePlace)', /locPaths\.byPathName\(/)
  mustNot(f, resolve, '배정 이력 되돌리기(resolvePlace)', /storageLocation\.findFirst\([\s\S]*?name: label/)
}

{
  const f = 'app/(app)/inventory/assets/AssetsClient.tsx'
  const src = read(f)
  if (src == null) violations.push(`${f} — 파일이 없다.`)
  else {
    must(f, src, '공용부 배정 select·라벨', /\.pathName\b/g, 5)
    mustNot(f, src, '공용부 배정 select·라벨', /locations\.find\(l => l\.id === id\)\?\.name/)
    mustNot(f, src, '공용부 배정 select', /value=\{'loc:' \+ l\.id\}>\{l\.name\}/)
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`FAIL  ${v}`)
  console.error(`\n위치 이름 축 위반 ${violations.length}건. 화면에 찍는 위치 이름은 표기 경로(pathName)다 — 정본은 lib/locationTree.flattenDfs.`)
  process.exit(1)
}
console.log('OK    위치 표시 이름이 전부 pathName 축이다.')
