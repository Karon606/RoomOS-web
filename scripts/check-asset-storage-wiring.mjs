// 비품 보관 위치 축(storedLocationId) 배선 감지망. 읽기 전용, 위반 시 exit 1. 실행: node scripts/check-asset-storage-wiring.mjs
//
// 2026-10-19 신고 195e05c8·09ec10aa(운영자 승인 '추천대로'). 보관 위치는 배정과 다른 축이고 받은 + 안 놓인 행에만 산다.
// 진리표(test-asset-storage)는 순수 판정을, 통합 하네스(test-asset-receipt-flow ST 절)는 실제 쓰기를 본다. 여기서는
// 서버·화면이 그 규칙을 **실제로 부르는가**를 글자로 묶는다(주석은 걷고 본다). 보관 위치를 비우는 자리 하나만 빠져도
// '방에 있는데 창고에 보관' 이나 '수령 전인데 창고에 보관' 이 생기고, 진리표는 초록인 채로 남는다.
import { readFileSync } from 'node:fs'

const violations = []
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)
const read = (f) => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f}. 파일을 못 읽었다(못 읽으면 통과가 아니라 위반이다)`); return '' } }
/** (export )?(async )?function 이름( 부터 다음 최상위 function·export 직전까지. 없으면 null. */
function region(src, name) {
  const at = src.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\(`))
  if (at < 0) return null
  const ends = [src.indexOf('\nexport ', at + 2), src.indexOf('\nasync function ', at + 2), src.indexOf('\nfunction ', at + 2)].filter(i => i > 0)
  return src.slice(at, ends.length ? Math.min(...ends) : undefined)
}
function must(file, src, fn, checks) {
  const body = fn ? region(src, fn) : src
  if (body == null) { violations.push(`${file}. ${fn} 를 못 찾았다. 이름이 바뀌었으면 이 그물도 함께 고친다`); return }
  for (const [re, msg] of checks) if (!re.test(body)) violations.push(`${file}${fn ? ` ${fn}` : ''}. ${msg}`)
}
function mustNot(file, src, fn, checks) {
  const body = fn ? region(src, fn) : src
  if (body == null) return
  for (const [re, msg] of checks) if (re.test(body)) violations.push(`${file}${fn ? ` ${fn}` : ''}. ${msg}`)
}

// ── 순수층 ─────────────────────────────────────────────────────────
const SP = 'app/(app)/inventory/assets/storagePlace.ts'
const sp = read(SP)
must(SP, sp, null, [
  [/export const canHoldStorage = \(r: StorageRow\) => !!r\.receivedAt && isUnplaced\(r\.roomId, r\.assignedLocationId, r\.isCommonAsset\)/, '불변식(받은 + 안 놓인 행)이 놓인 행 정본 isUnplaced 를 안 쓴다'],
  [/return hubs\.length === 1 \? hubs\[0\]\.id : null/, '기본 창고가 여럿이거나 없을 때도 미리 고른다(승인안: 하나일 때만)'],
  [/return \[\.\.\.rows\.filter\(r => r\.isHub\), \.\.\.rows\.filter\(r => !r\.isHub\)\]/, '후보 순서가 기본 창고 먼저·나머지 받은 차례가 아니다'],
])
mustNot(SP, sp, null, [[/415|제기역/, '보관 위치를 하드코딩했다(멀티테넌트)']])

// ── 서버(assets/actions) ───────────────────────────────────────────
const A = 'app/(app)/inventory/assets/actions.ts'
const a = read(A)
// 분할 복제 정본은 2026-10-20 에 공용 파일로 옮겼다(소모품 부분 수령도 같은 함수를 부른다).
const EC = 'app/(app)/inventory/expenseClone.ts'
must(EC, read(EC), 'cloneExpenseScalars', [[/storedLocationId: e\.storedLocationId/, '분할 복제가 보관 위치를 물려주지 않는다(남는 조각·옮긴 조각 규칙의 바닥)']])
must(A, a, 'buildSplitOps', [[/storedLocationId: 'storedLocationId' in data \? data\.storedLocationId : e\.storedLocationId/, '옮긴 조각이 실린 보관 위치를 받지 않거나, 폐기(키 없음) 조각이 원행 값을 안 지킨다']])
must(A, a, 'buildFanOutOps', [[/storedLocationId: 'storedLocationId' in d \? d\.storedLocationId : e\.storedLocationId/, '나눠 배정 조각이 보관 위치를 비우지 않는다']])
must(A, a, 'targetData', [
  [/if \(t\.kind === 'room'\) return \{ roomId: t\.id, assignedLocationId: null, storedLocationId: null \}/, '방으로 옮길 때 보관 위치를 비우지 않는다'],
  [/if \(t\.kind === 'location'\) return \{ roomId: null, assignedLocationId: t\.id, storedLocationId: null \}/, '공용부로 옮길 때 보관 위치를 비우지 않는다'],
  [/if \(t\.kind === 'storage'\) return \{ roomId: null, assignedLocationId: null, storedLocationId: t\.id \}/, '보관 대상이 보관 위치를 적지 않는다'],
])
must(A, a, 'validateTarget', [[/t\.kind === 'storage'\) \{\s*if \(!\(await storageInProperty\(propertyId, t\.id\)\)\) return STORE_NOT_FOUND/, '보관 대상 위치를 영업장 범위로 보지 않는다(남의 영업장 위치 FK)']])
must(A, a, 'storageInProperty', [[/storageLocation\.findFirst\(\{ where: \{ id, propertyId \}/, '보관 위치 확인이 영업장 범위가 아니다']])
must(A, a, 'assignAggregateToTarget', [
  [/const isNone = target\.kind === 'none' \|\| target\.kind === 'storage'/, '보관 대상이 미배정 복귀(배정일 비움·묶음 접기)로 안 간다'],
  [/placeLabel\(propertyId, rep0\.roomId, rep0\.assignedLocationId, rep0\.isCommonAsset, rep0\.storedLocationId\)/, '이력 출발이 보관 위치를 모른다(되돌리기가 창고로 못 돌아간다)'],
  [/placeLabel\(propertyId, tData\.roomId, tData\.assignedLocationId, false, tData\.storedLocationId\)/, '이력 도착이 보관 위치를 모른다'],
])
must(A, a, 'placeLabel', [[/return \{ kind: 'storage', label: name \}/, "보관 위치 이력 종류('storage')를 안 남긴다"], [/return \{ kind: 'none', label: '미배정' \}/, "보관 위치 없는 미배정 이력 라벨('미배정', 되찾기 열쇠)을 바꿨다"]])
must(A, a, 'resolvePlace', [[/kind === 'storage'[\s\S]{0,260}locPaths\.byPathName\(label \?\? ''\)/, '보관 위치 이력을 표기 경로로 되찾지 않는다']])
must(A, a, 'revertAssignmentLog', [
  [/\.\.\.\(to\.storedId \? \{ storedLocationId: to\.storedId \} : \{\}\)/, "'간 곳'이 보관 위치면 그 위치 행만 집어야 한다(다른 창고 몫을 끌어온다)"],
  [/storedLocationId: from\.storedId \}/, '되돌리기가 출발 보관 위치를 되살리지 않거나, 방 출발이면 비우지 않는다'],
])
must(A, a, 'setAssetReceived', [
  [/if \(!\(await storageInProperty\(propertyId, storeId\)\)\) return \{ ok: false, error: STORE_NOT_FOUND \}/, '수령 창 보관 위치를 영업장 범위로 보지 않는다'],
  [/assignedAt: assignDay, storedLocationId: null \}/, '수령하며 방에 배정한 몫의 보관 위치를 비우지 않는다'],
  [/data: \{ receivedAt: null, storedLocationId: null \}/, '수령 대기로 돌리면서 보관 위치를 비우지 않는다(수령 전 행은 늘 비어 있다)'],
  [/signUndoBody\(ASSET_UNRECEIVE_UNDO_DOMAIN, propertyId, canonicalAssetUnreceiveUndo\(ub\)\)/, '수령 대기로의 적용취소 토큰에 서명이 없다'],
  [/storeOf = \(e: ExpRow\) => \(isUnplaced\(e\.roomId, e\.assignedLocationId, e\.isCommonAsset\) \? storeId : null\)/, '보관 위치를 놓인 행에도 준다'],
])
must(A, a, 'undoAssetReceipt', [
  [/storedLocationId: row\.now\.storedLocationId,/, '수령 적용취소가 보관 위치를 CAS 로 안 본다(다른 창고로 옮긴 사실을 지운다)'],
  [/receivedAt: null, storedLocationId: null,/, '수령 적용취소가 보관 위치를 비우지 않는다'],
  [/disposedAt: null, storedLocationId: c\.storedLocationId \}/, '부분 수령 조각 삭제가 보관 위치를 CAS 로 안 본다'],
])
must(A, a, 'undoAssetUnreceive', [
  [/requireEdit\(\)/, '적용취소가 편집 권한 관문을 안 지난다'],
  [/verifyUndoBody\(ASSET_UNRECEIVE_UNDO_DOMAIN, propertyId, canonicalAssetUnreceiveUndo\(undo\), undo\.sig\)/, '수령 대기로 적용취소가 서명을 확인하지 않는다'],
  [/where: \{ id: r\.id, propertyId, receivedAt: null, storedLocationId: null, roomId: null, assignedLocationId: null, isCommonAsset: false, disposedAt: null \}/, '수령 대기로 적용취소 CAS 가 빠졌다(다시 받은 행을 덮는다)'],
  [/storeOk\.get\(r\.storedLocationId\)/, '되살리는 보관 위치를 영업장 범위로 보지 않는다'],
])
must(A, a, 'addFreeAsset', [
  [/if \(!\(await storageInProperty\(propertyId, input\.storedLocationId\)\)\) return \{ ok: false, error: STORE_NOT_FOUND \}/, '무상 입수 보관 위치를 영업장 범위로 보지 않는다'],
  [/signUndoBody\(ASSET_FREE_UNDO_DOMAIN, propertyId, canonicalAssetFreeUndo\(body\)\)/, '무상 입수 적용취소 토큰에 서명이 없다'],
])
must(A, a, 'undoAddFreeAsset', [
  [/deleteMany\(\{\s*where: \{\s*id: undo\.id, propertyId, amount: 0, memo: '무상입수', roomId: null,/, '무상 입수 적용취소가 등록 직후 모양(CAS) 없이 지운다'],
  [/storedLocationId: undo\.storedLocationId, qtyValue: undo\.qtyValue, itemLabel: undo\.itemLabel,/, '무상 입수 적용취소가 보관 위치·수량·품명을 CAS 로 안 본다(다른 창고로 옮긴 행을 지운다, 검수 R1)'],
  [/assetAssignmentLog\.count\(\{[\s\S]{0,200}createdAt: \{ gte: at \}/, '무상 입수 뒤 배정 이력이 생겼는데 지운다(이력 고아, 검수 R1 X2)'],
  [/if \(logsAfter > 0\) return \{ ok: false, error: ASSET_FREE_UNDO_STALE \}/, '배정 이력이 생긴 무상 입수를 거부하지 않는다'],
])
must(A, a, 'undoDisposalRow', [[/storedLocationId: row\.storedLocationId,/, '폐기 한 줄 적용취소가 다른 창고 짝에 접는다(검수 R2)']])
must(A, a, 'setCommonAsset', [
  [/isCommonAsset: true, roomId: null, assignedLocationId: null, storedLocationId: null/, '공용 자재로 가면서 보관 위치를 비우지 않는다'],
  [/restoreStored: stored \}/, '공용 자재로 지운 보관 위치를 적용취소에 돌려주지 않는다'],
])
mustNot(A, a, 'setCommonAsset', [[/snapshotRow/, '공용 자재 적용취소를 원상태 스냅샷으로 덮는다(옮긴 몫이 원행에 되살아나 지출이 는다, 검수 F1)']])
must(A, a, 'undoSetCommonAsset', [
  [/requireEdit\(\)/, '공용 자재 적용취소가 편집 권한 관문을 안 지난다'],
  [/where: \{ id: \{ in: targetIds \}, propertyId, isCommonAsset: true \}, data: \{ isCommonAsset: false \}/, '공용 표시 적용취소가 반대 값 되돌리기(그 직후 상태 CAS)가 아니다(검수 F1)'],
  [/where: \{ id: r\.id, propertyId, isCommonAsset: false, roomId: null, assignedLocationId: null, storedLocationId: null, receivedAt: \{ not: null \} \}/, '보관 위치 되살리기에 CAS 가 없다'],
  [/storageLocation\.findMany\(\{ where: \{ id: \{ in: storeIds \}, propertyId \}/, '되살리는 보관 위치를 영업장 범위로 보지 않는다'],
  [/where: \{ id: \{ in: targetIds \}, propertyId, isCommonAsset: false, roomId: null, assignedLocationId: null, storedLocationId: null \}/, '해제 적용취소의 직후 상태 조건에 보관 위치가 없다(창고에 보관한 행을 공용으로 되돌린다, 재검수 X4e)'],
  [/if \(flipped\.count === 0\) throw new Error\(ASSET_COMMON_UNDO_STALE\)/, '바뀐 행이 0건인데 성공으로 돌려준다(재검수 X4c)'],
])
mustNot(A, a, 'undoSetCommonAsset', [
  [/qtyValue|amount/, '공용 자재 적용취소가 수량·금액을 쓴다(묵은 값으로 덮는다)'],
  [/withDisposedSiblings\(/, '적용취소 때 형제를 다시 찾는다(다른 공용 카드의 폐기 행이 끌려와 공용이 풀린다, 재검수 X4d)'],
])
must(A, a, 'setCommonAsset', [[/return \{ ok: true, changedIds: targetIds, restoreStored: stored \}/, '공용 자재 표시가 실제로 바꾼 행을 토큰에 싣지 않는다(재검수 X4d)']])
must(A, a, 'applyAssetUndo', [
  [/if \(!expect \|\| touched\.some\(id => !expect\.some\(e => e\.id === id\)\)\) throw new Error\(ASSET_ASSIGN_UNDO_STALE\)/, '직후 모양 없는 적용취소 토큰을 받는다(재검수 X8)'],
  [/if \(\(await tx\.expense\.count\(\{ where: shapeWhere\(e\) \}\)\) !== 1\) throw new Error\(ASSET_ASSIGN_UNDO_STALE\)/, '배정·폐기 적용취소가 직후 모양 CAS 없이 덮는다(옮긴 몫이 원행에 되살아나 지출이 는다, 재검수 X8)'],
  [/storedLocationId: e\.storedLocationId, qtyValue: e\.qtyValue, amount: e\.amount, allocationGroupId: e\.allocationGroupId,/, '직후 모양 CAS 에 자리·수량·금액·묶음 칸이 빠졌다'],
])
for (const fn of ['assignAggregateToTarget', 'batchAssignAssets', 'disposeAssets', 'distributeAssetToTargets']) {
  must(A, a, fn, [[/expect: await afterShapes\(propertyId,/, '적용취소 토큰에 직후 모양을 안 싣는다(재검수 X8)']])
}
must(A, a, 'snapshotRow', [[/storedLocationId: e\.storedLocationId/, '적용취소 스냅샷에 보관 위치가 없다']])
must(A, a, 'applyAssetUndo', [
  [/storageLocation\.findMany\(\{ where: \{ id: \{ in: storeIds \}, propertyId \}/, '적용취소가 되살리는 보관 위치를 영업장 범위로 보지 않는다(토큰 위조로 남의 영업장 위치 FK)'],
  [/storedLocationId: r\.storedLocationId && okStores\.has\(r\.storedLocationId\) \? r\.storedLocationId : null/, '범위 밖 보관 위치를 비우지 않는다'],
])
must(A, a, 'getStorageLocations', [[/storageCandidates\(/, '보관 후보가 정본 순서(기본 창고 먼저)를 안 탄다']])
mustNot(A, a, 'getStorageLocations', [[/filter\(r => !hubIds\.has/, '보관 후보에서 기본 창고를 뺐다(신고 195e05c8 의 원인)']])
must(A, a, 'getAssignableLocations', [[/filter\(r => !hubIds\.has\(r\.id\)\)/, '공용부 배정 후보에 기본 창고가 들어갔다(미배정 뜻이 깨진다, 승인안 (a) 기각)']])
must(A, a, 'getDurableItems', [[/storedLocationId: true,/, '비품 화면이 보관 위치를 안 읽는다'], [/storedLocationName: locPaths\.pathName\(r\.storedLocationId\)/, '보관 위치 이름이 표기 경로가 아니다'],
  [/r\.storedLocationId && r\.receivedAt && !r\.roomId && !r\.assignedLocationId && !r\.isCommonAsset && !r\.excludeFromInventory/, '표시 관문이 받은 + 안 놓인 비품 물품만 보지 않는다(검수 R3)']])
must(A, a, 'withDisposedSiblings', [[/storedLocationId: true,/, '카드 정체성(집계 키)에 보관 위치가 빠졌다. 다른 창고 카드의 폐기 행을 끌어온다']])
const AG = 'app/(app)/inventory/assets/aggregate.ts'
must(AG, read(AG), 'aggregateAssets', [[/r\.isService \? 'S' : '', r\.storedLocationId \?\? ''\]\.join\('␟'\)/, '집계 키에 보관 위치가 없다(다른 창고 몫이 한 카드로 뭉친다)']])

// ── 재무 ───────────────────────────────────────────────────────────
const F = 'app/(app)/finance/actions.ts'
const f = read(F)
must(F, f, 'updateExpense', [
  [/storedLocationId: storedForSave\(\{/, '재무 수정이 보관 위치 저장 규칙(storedForSave)을 안 탄다(방을 고른 뒤에도 창고에 보관이 남는다)'],
  [/assignedLocationId: null, isCommonAsset: false, storedLocationId: null \}/, '비품 전환(F3) 배정이 보관 위치를 비우지 않는다'],
])
must(F, f, 'undoDeleteExpense', [[/storedLocationId: \(fk: string\) => prisma\.storageLocation\.findFirst\(\{ where: \{ id: fk, propertyId \}/, '삭제 복원이 보관 위치 FK 를 영업장 범위로 강등하지 않는다']])
must(F, f, 'getExpenses', [[/storedLocationName: r\.storedLocationId && r\.receivedAt && !r\.roomId && !r\.assignedLocationId && !r\.isCommonAsset && !r\.excludeFromInventory\s*\? \(locPaths\?\.pathName\(r\.storedLocationId\)/, '재무 목록이 보관 위치 이름을 불변식 관문 없이(또는 표기 경로가 아니게) 싣는다']])

// ── 위치(inventory/actions) ────────────────────────────────────────
const I = 'app/(app)/inventory/actions.ts'
const inv = read(I)
must(I, inv, 'toggleStorageLocationHub', [
  [/updateMany\(\{ where: \{ propertyId, isHub: true, NOT: \{ id \} \}, data: \{ isHub: false \} \}\)/, '기본 창고 지정이 다른 기본 창고를 해제하지 않는다(여럿이면 미리 고를 곳이 모호하다)'],
  [/return \{ ok: true, prevHubIds \}/, '기본 창고 변경 적용취소가 옛 집합을 못 받는다'],
])
must(I, inv, 'restoreStorageHubs', [[/requireEdit\(\)/, '기본 창고 되살리기가 편집 권한 관문을 안 지난다'], [/count\(\{ where: \{ id: \{ in: ids \}, propertyId \} \}\)/, '기본 창고 되살리기가 영업장 범위를 안 본다']])
must(I, inv, 'deleteStorageLocation', [
  [/expense\.count\(\{ where: \{ propertyId, assignedLocationId: id \} \}\)/, '위치 삭제가 공용부 배정 비품을 세지 않는다(경고 없이 미배정으로)'],
  [/expense\.count\(\{ where: \{ propertyId, storedLocationId: id \} \}\)/, '위치 삭제가 보관 중인 비품을 세지 않는다'],
  [/checkRows \+ linkedItems \+ addRows \+ dispRows \+ assignedAssets \+ storedAssets > 0/, '비품 건수가 묻기 판정에 안 들어간다'],
])
must(I, inv, 'setExpenseInventoryExclusion', [
  [/const storedLocationId = storedForSave\(\{/, '재고 제외(서비스로) 뒤 보관 위치가 남는다(검수 R3)'],
  [/targetRoomId: place\.targetRoomId, storedLocationId \} \}\)/, '재고 제외가 판정한 보관 위치를 쓰지 않는다(검수 R3)'],
])
const IC = 'app/(app)/inventory/InventoryClient.tsx'
const ic = read(IC)
must(IC, ic, null, [
  [/assignedAssets > 0 \? \{ label: '미배정으로 바뀌는 공용부 비품 구매 기록', count: assignedAssets \}/, '위치 삭제 확인창이 공용부 비품 줄을 안 보인다'],
  [/storedAssets > 0 \? \{ label: '보관 위치가 지워지는 비품 구매 기록', count: storedAssets \}/, '위치 삭제 확인창이 보관 비품 줄을 안 보인다'],
  [/restoreStorageHubs\(prevHubIds\)/, '기본 창고 적용취소가 옛 집합을 되살리지 않는다(반대 값 토글은 해제된 옛 기본 창고를 못 돌린다)'],
])

// ── 화면(AssetsClient) ─────────────────────────────────────────────
const AC = 'app/(app)/inventory/assets/AssetsClient.tsx'
const ac = read(AC)
must(AC, ac, null, [
  [/<PillButton primary onClick=\{openBatch\}>일괄 옮기기<\/PillButton>/, "선택 알약 주 버튼이 '일괄 옮기기'(일괄 옮기기 창 열기)가 아니다"],
  [/if \(parseStoreKey\(batchAssign\.to\)\) \{ runBatchStore\(batchAssign\.to\); return \}/, '일괄 옮기기 창의 여분 보관 칸이 보관 대상으로 안 간다'],
  // 신고 0c37bc53(2026-10-26 운영자 승인): 목적지 세 자리(옮기기·일괄 옮기기·나눠 배정)가 정본 DestinationPicker 하나를 쓴다.
  [/<DestinationPicker label="어디로 옮길까요\?" value=\{move\.to\}/, '옮기기 모달이 목적지 고르기 정본(DestinationPicker)을 안 쓴다'],
  [/<DestinationPicker label="어디로 옮길까요\?" value=\{batchAssign\.to\}/, '일괄 옮기기 창이 목적지 고르기 정본(DestinationPicker)을 안 쓴다'],
  [/<DestinationPicker label="방·공용부 추가" value="" [\s\S]{0,200}groups=\{\['room', 'loc'\]\}/, "나눠 배정의 '방·공용부 추가' 가 DestinationPicker(방·공용부 두 칸)가 아니다"],
  [/defaultDestGroup\(isUnplaced\(it\.roomId \?\? null, it\.locationId \?\? null, !!it\.isCommon\)\)/, '옮기기 처음 칸이 정본 defaultDestGroup(미배정이면 여분 보관, 아니면 방)이 아니다'],
  [/disabled=\{pending \|\| !picked \|\| over \|\| same/, '옮기기 모달에서 방·공용부 칸 목적지를 고르기 전에 옮기기가 열린다'],
  [/disabled=\{pending \|\| !picked \|\| overAny\}/, '일괄 옮기기 창에서 목적지를 고르기 전에 옮기기가 열린다'],
  [/\(it\.storedLocationId \?\? null\) === toStore\.id\)/, '이미 미배정이어도 보관 위치가 다르면 옮길 수 있어야 한다(같은 곳 판정)'],
  [/hasStores \? \(/, '위치가 0곳일 때 보관 위치 UI 를 숨기는 갈래가 없다'],
  [/const defStore = defaultStorageId\(storages\)/, '미리 고르기가 정본(기본 창고 하나일 때만)이 아니다'],
  [/setRcv\(\{ it, qty: q0, store: defStore \?\? ''/, '수령 창이 기본 창고를 미리 골라 두지 않는다'],
  [/void receiveWithPlan\(it, qty, storeId\)/, '수령 창 보관 위치가 수령에 안 실린다'],
  [/storedLocationId: freeForm\.store \|\| null/, '무상 입수가 보관 위치를 안 싣는다'],
  [/target: \{ kind: 'storage', id: st\.id \}/, '선택 알약 보관 위치 지정이 서버 보관 대상을 안 쓴다'],
  [/<SectionHeader marker=\{g\.name \? <PinMarker \/> : undefined\}\s*name=\{g\.name \? <span className="break-keep">\{g\.name\}<\/span> : STORE_UNKNOWN_HEAD\}/, "보관 위치 묶음 머리가 정본 SectionHeader 가 아니거나 '보관 위치 미정' 머리에 마커·낮춘 색이 남았다(웹디자이너 패스)"],
  [/storeMeta=\{!!q\}/, '카드 메타의 보관 위치 토막이 묶음이 풀린 화면(검색)에서만 서야 한다'],
  // 금액은 2026-10-20 부터 메타 줄 끝에 따로 선다(말줄임이 금액부터 자르지 않게). 보관 위치 토막은 여전히 맨 앞이다.
  [/const head = place \? `\$\{place\} · \$\{rest\}` : rest/, '풀린 화면의 보관 위치 토막이 맨 앞 차례가 아니다'],
  [/const placeIn = \(it: AssetItem\) =>/, '문장 속 장소(경로 그대로) 정본이 없다'],
  [/subtitle=\{`지금 \$\{fromIn\}에/, "옮기기 부제가 문장 속 장소가 아니라 라벨('…보관에')이다"],
  [/logPlaceLabel\(r\.fromKind, r\.fromLabel\)/, "배정 변경 이력이 보관 이력을 '{위치} 보관'으로 안 읽는다"],
  [/undoCommon\(res\.changedIds, value, res\.restoreStored\)/, '공용 자재 적용취소가 반대 값 + 보관 위치 CAS(undoSetCommonAsset)가 아니다(검수 F1)'],
  [/const res = await undoSetCommonAsset\(ids, value, restoreStored\)/, '공용 자재 적용취소 손잡이가 서버 undoSetCommonAsset 을 안 부른다(검수 F1)'],
  [/undoUnreceive\(uu\)/, '수령 대기로 토스트에 적용취소가 없다'],
  [/undoFree\(undo\)/, '무상 입수 토스트에 적용취소가 없다'],
])
mustNot(AC, ac, null, [
  [/415|제기역/, '보관 위치를 하드코딩했다(멀티테넌트)'],
  [/rcvAsk/, '카드 안 인라인 수령 물음이 남았다(수령 창 하나로 모았다)'],
  [/setPillMode\('store'\)/, "선택 알약에 '보관 위치' 버튼이 따로 섰다(360·412 에서 닫기·폐기가 밀린다, 웹디자이너 패스)"],
  [/<optgroup /, '목적지 select 에 optgroup 이 남았다. 무리는 세그먼트로 고른다(신고 0c37bc53, DestinationPicker)'],
  [/undoBatchAssignAssets\(undo\)\s*\n\s*if \(!res\.ok\) \{ pushToast\('error', res\.error\); return \}\s*\n\s*pushToast\('info', '되돌렸습니다'\)/, '공용 자재 적용취소가 원상태 스냅샷으로 덮는다'],
])

// ── 목적지 고르기 정본(DestinationPicker, 신고 0c37bc53) ─────────────────
const DP = 'app/(app)/inventory/assets/DestinationPicker.tsx'
const dp = read(DP)
must(DP, dp, null, [
  [/<SegmentedControl<DestGroup> size="md"/, '목적지 무리를 정본 SegmentedControl md 로 고르지 않는다(가이드 §12 상호배타는 세그먼트)'],
  [/store: STORE_SEGMENT_LABEL, room: '방', loc: '공용부'/, "세그먼트 칸 이름이 '여분 보관 / 방 / 공용부' 가 아니다"],
  [/aria-label=\{STORE_GROUP_LABEL\}/, "여분 보관 select 의 aria-label 이 무리 이름 '여분으로 보관 (배정 안 함)' 이 아니다"],
  [/<option key=\{s\.id\} value=\{storeKey\(s\.id\)\}>\{storeOptionLabel\(s\)\}<\/option>/, "보관 선택지가 '{경로}에 보관' 정본(storeOptionLabel)이 아니다"],
  [/<option value=\{storeKey\(null\)\}>\{STORE_UNKNOWN_OPTION\}<\/option>/, "여분 보관 칸에 '보관 위치 모름'이 없다"],
  [/hasStores \? \(/, '위치가 0곳일 때 보관 select 를 숨기는 갈래가 없다'],
  [/onChange\(g === 'store' \? storeDefault : ''\)/, '칸을 바꿀 때 여분 보관은 기본 보관 값, 방·공용부는 빈 값(미리 안 고름)이 아니다'],
  [/group === 'store' && <p[^>]*>\{STORE_SEGMENT_CAPTION\}<\/p>/, '여분 보관 칸에서만 서는 캡션이 없다'],
  [/g !== 'loc' \|\| locations\.length > 0/, '공용부가 0곳이면 공용부 칸을 숨기지 않는다'],
])
mustNot(DP, dp, null, [
  [/<optgroup /, '목적지 select 에 optgroup 이 남았다(무리는 세그먼트로 고른다)'],
  [/value: 'all'|label: '전체'/, "목적지 세그먼트에 '전체' 칸이 섰다(§23 필터로 읽힌다)"],
])

console.log(`[비품 보관 위치 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
