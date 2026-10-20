// 비품 수령·배정 예정 호실·소모품 수량 관문 배선 감지망. 읽기 전용, 위반 시 exit 1. 실행: node scripts/check-asset-receipt-wiring.mjs
//
// 2026-10-15 냉장고 519호 건(계획서 비품-전환-배정 1단계). 판정 진리표(scripts/test-asset-receipt.ts)는 순수 함수만 본다.
// 서버와 화면이 그 판정을 **실제로 부르는가**는 진리표가 못 본다. 판정을 지우거나 우회하면 진리표는 초록인 채로
// 유령수령·수령 전 배정·적용취소 반쪽이 되살아난다. 그 자리를 글자로 묶는다(주석은 걷고 본다).
// 독립 검수 반영(2026-10-15). 수령 전 행을 접기·되돌리기가 집는 길(F-1·F-2), 토큰 서명·모집단(N-1), 화면이 본 계획(N-4),
// 역할별 알림(N-5), KST 기본 배정일(N-8), 재고 화면 수령의 소모품 한정(R-2), 제외·포함의 자리 규칙(R-1)을 더 묶는다.
// 2차 검수(08·09 회귀). 적용취소 CAS 의 공용부 칸(F1), 받은 행 예정 호실 승격 금지(R1), 공용 자재도 놓인 것(R3),
// 무상 비품 구매일 KST, 딥링크 정본 준비 단계를 묶는다.
import { readFileSync } from 'node:fs'

const violations = []
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)
const read = (f) => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f}. 파일을 못 읽었다(못 읽으면 통과가 아니라 위반이다)`); return '' } }
/** export async function 이름( 부터 다음 export 직전까지(없으면 null). */
function region(src, name) {
  const at = src.search(new RegExp(`(^|\\n)(export )?async function ${name}\\(`))
  if (at < 0) return null
  const next = src.indexOf('\nexport ', at + 2)
  const nextFn = src.indexOf('\nasync function ', at + 2)
  const ends = [next, nextFn].filter(i => i > 0)
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

// ── 비품 서버(assets/actions) ─────────────────────────────────────
const A = 'app/(app)/inventory/assets/actions.ts'
const a = read(A)
must(A, a, 'setAssetReceived', [
  [/durableExpenseWhere\(propertyId, trackedCats\)/, 'S1 비품 모집단(durableExpenseWhere)으로 다시 거르지 않는다. 낡은 화면의 소모품 id 가 유령수령·이중 입고 뒷문이 된다'],
  [/assetReceiptDenial\(/, 'S1 소모품 거부 판정(assetReceiptDenial)을 부르지 않는다'],
  [/if \(gateDenial\) return \{ ok: false, error: gateDenial \}/, 'S1 소모품 거부 판정을 부르고도 거부하지 않는다'],
  [/unreceiveDenialPlaced\(/, 'S4 놓인 비품을 수령 대기로 돌리는 길을 막지 않는다(수령 전 자리는 예정 호실뿐)'],
  [/if \(placedDenial\) return \{ ok: false, error: placedDenial \}/, 'S4 놓인 비품 판정을 부르고도 거부하지 않는다'],
  [/const assignDay = ymdToDbDate\(kstYmdStr\(now\)\)/, 'S5 배정일이 KST 오늘이 아니다. assignedAt 은 @db.Date 라 KST 00~09시 수령이 어제로 박힌다'],
  [/receiptPlacementPlan\(/, 'S5 받을 때 배정 판정을 화면과 같은 순수 함수로 하지 않는다'],
  [/opts\?\.assign && \(!planAsks\(plan\) \|\| planExpectMismatch\(planRows, opts\.expect\)\)\) return \{ ok: false, error: ASSET_RECEIPT_PLAN_STALE \}/, 'S5 묻지 않을 판정이거나 화면이 본 계획과 다르면(N-4) 배정 요청을 거부해야 한다'],
  [/unplaced: isUnplaced\(e\.roomId, e\.assignedLocationId, e\.isCommonAsset\)/, 'R-4 안 놓인 행 판정이 화면(aggregate)과 같은 정본(isUnplaced)이 아니다'],
  [/signUndoBody\(ASSET_RECEIPT_UNDO_DOMAIN, propertyId, canonicalAssetReceiptUndo\(body\)\)/, 'N-1 적용취소 토큰에 서버 서명을 붙이지 않는다(위조 토큰으로 무관한 지출을 고친다)'],
  [/planTargetOf\(/, 'S5 배정 대상 행을 정본(planTargetOf)으로 고르지 않는다'],
  [/assetAssignmentLog\.create\(\{ data: assignmentLogData\(/, 'S5 수령 배정이 배정 변경 이력을 같은 트랜잭션에 남기지 않는다'],
  [/kind: 'none', label: '미배정' \}/, "S5 이력 출발이 '미배정'이 아니다(정본 placeLabel 표기)"],
  [/await prisma\.\$transaction\(ops\)/, 'S5 수령·배정·이력이 한 트랜잭션이 아니다'],
  [/logIds: logIdx\.map/, 'S5 적용취소 토큰에 만든 이력 줄이 없다(되돌려도 이력이 남는다)'],
  [/cloneExpenseScalars\(e, propertyId, \{/, '부분 수령 분할이 복제 정본(cloneExpenseScalars)을 안 쓴다. 예정 호실 등 칸이 빠진다'],
])
must(A, a, 'undoAssetReceipt', [
  [/requireEdit\(\)/, '적용취소가 편집 권한 관문을 안 지난다'],
  [/deleteMany\(\{\s*where: \{ id: c\.id, propertyId, receivedAt: at/, '분할 수령 조각을 영업장·수령 시각 조건(CAS) 없이 지운다'],
  [/where: \{\s*id: row\.id, propertyId, receivedAt: at, disposedAt: null,\s*roomId: row\.now\.roomId, assignedLocationId: null, isCommonAsset: row\.now\.isCommonAsset, itemLabel: row\.now\.itemLabel,/, '행 복원에 영업장·이번 상태 조건(CAS)이 없다(R-3 공용 표식·품목명, 2차 F1 공용부 칸 늘 포함)'],
  [/deleteMany\(\{\s*where: \{ id: c\.id, propertyId, receivedAt: at, roomId: c\.roomId, assignedLocationId: null,/, '2차 F1 공용부로 옮긴 수령 조각을 적용취소가 지운다(자리·옮긴 이력이 사라진다)'],
  [/parseAssetReceiptUndo\(undoRaw\)/, 'N-1 토큰 모양 검사(parseAssetReceiptUndo)를 안 지난다'],
  [/verifyUndoBody\(ASSET_RECEIPT_UNDO_DOMAIN, propertyId, canonicalAssetReceiptUndo\(undo\), undo\.sig\)/, 'N-1 토큰 서명을 확인하지 않는다'],
  [/durableExpenseWhere\(propertyId, trackedCats\), id: \{ in: ids \} \} \}\)\s*if \(inPop !== ids\.length\) return \{ ok: false, error: ASSET_RECEIPT_UNDO_INVALID \}/, 'N-1 토큰의 행이 전부 비품 모집단 안인지 보지 않는다(공과금 같은 무관한 지출)'],
  [/data: \{ qtyValue: Math\.round\(qty \* 1000\) \/ 1000, amount, detail: s\.prevDetail, allocationGroupId: s\.prevGroupId \}/, 'N-1 분할 원행의 수량·금액을 서버가 다시 더하지 않는다'],
  [/qty \+= c\.qtyValue; amount \+= c\.amount/, 'N-1 분할 원행 금액을 지운 조각에서 다시 셈하지 않는다'],
  [/assetAssignmentLog\.deleteMany\(\{ where: \{ id: \{ in: undo\.logIds \}, propertyId \} \}\)/, '적용취소가 만든 이력 줄을 영업장 범위로 지우지 않는다'],
  [/if \(r\.count !== 1\) throw STALE/, '그 사이 바뀐 행이면 거부해야 한다(반쪽 적용취소 금지)'],
])
mustNot(A, a, 'undoAssetReceipt', [
  [/targetRoomId/, '적용취소가 배정 예정 호실을 건드린다. 예정 호실은 남아야 한다'],
  [/\.prev\.(amount|qtyValue)|amount: (row|s)\.prev/, 'N-1 토큰에 실린 원래 금액·수량을 그대로 쓴다(위조 토큰이 금액을 쓴다)'],
])
// F-1·F-2 미배정 접기·이력 되돌리기는 수령 전 물품 행을 집지 않는다(배정 정본 isPlaceable 의 조회 조건)
must(A, a, 'mergeUnassignedGroup', [
  [/roomId: null, assignedLocationId: null, isCommonAsset: false, disposedAt: null, AND: \[PLACEABLE_WHERE\] \}/, 'F-1 미배정 접기가 수령 대기 잔여까지 집는다(받은 조각이 수령 대기로 사라진다). 공용 자재 행도 접지 않는다(2026-10-19)'],
  [/const k = u\.storedLocationId \?\? ''/, '보관 위치가 다른 조각을 한 행으로 접는다(한쪽 창고 몫이 다른 창고로 옮겨진다, 2026-10-19)'],
  [/const keepGroup = others \+ byStore\.size > 1/, '접은 뒤 묶음 잔존 판정이 보관 위치별 남는 행과 접지 않는 행을 함께 세지 않는다'],
  [/const others = await prisma\.expense\.count\(\{\s*where: \{ propertyId, allocationGroupId: groupId, id: \{ notIn: unassigned\.map\(u => u\.id\) \} \},/, 'F-1 묶음 뜻 세기(others)에서 수령 대기 행을 뺐다. groupId 가 풀린다'],
])
must(A, a, 'revertAssignmentLog', [
  [/roomId: to\.roomId, assignedLocationId: to\.locationId,[\s\S]{0,160}AND: \[PLACEABLE_WHERE\],/, 'F-2 배정 이력 되돌리기가 수령 전 물품 행을 방에 넣는다'],
])
// N-8 배정일·폐기일 기본값은 KST 오늘(@db.Date). new Date() 는 KST 00~09시에 어제로 박힌다
for (const fn of ['assignAggregateToTarget', 'distributeAssetToTargets', 'disposeAssets']) {
  must(A, a, fn, [[/ymdToDbDate\(kstYmdStr\(\)\)/, 'N-8 기본 날짜가 KST 오늘(ymdToDbDate(kstYmdStr()))이 아니다']])
  mustNot(A, a, fn, [[/new Date\(\)/, 'N-8 기본 날짜에 new Date() 가 남았다(교체 폐기일 포함)']])
}
// 무상 비품 구매일도 KST 오늘(@db.Date, 2차 검수)
must(A, a, 'addFreeAsset', [[/date: ymdToDbDate\(kstYmdStr\(\)\)/, '2차 무상 비품 구매일이 KST 오늘이 아니다(KST 00~09시에 어제로 박힌다)']])
mustNot(A, a, 'addFreeAsset', [[/date: new Date\(\)/, '2차 무상 비품 구매일에 new Date() 가 남았다']])
// R3 놓인 행 판정 정본 하나(공용 자재도 놓인 것). 수령 대기로 거부·서버 조회·화면 버튼·장부 축 1 이 같은 셋을 본다
must(A, a, 'setAssetReceived', [[/select: \{ roomId: true, assignedLocationId: true, isCommonAsset: true, excludeFromInventory: true \}/, '2차 R3 수령 대기로 돌리기가 공용 자재 표식을 안 읽는다']])
// R-4 화면 breakdown 과 서버가 같은 '안 놓인 행' 정본을 쓴다
const AG = 'app/(app)/inventory/assets/aggregate.ts'
const ag = read(AG)
must(AG, ag, null, [
  [/export const isUnplaced = \(roomId: string \| null, locationId: string \| null, isCommon: boolean\) => !roomId && !locationId && !isCommon/, "R-4 안 놓인 행 정본(isUnplaced)이 방·공용부·공용 자재 셋을 다 안 본다"],
  [/unplaced: isUnplaced\(r\.roomId, r\.locationId, r\.isCommon\)/, 'R-4 화면 breakdown 이 정본(isUnplaced)을 안 쓴다'],
])
const RP = 'app/(app)/inventory/assets/receiptPlacement.ts'
must(RP, read(RP), null, [
  [/export function assignDenialUnreceived\([\s\S]{0,400}isPlaceable\(/, 'F-2 배정 거부 판정이 isPlaceable 정본을 안 쓴다(조회 조건 PLACEABLE_WHERE 와 갈린다)'],
  [/export function unreceiveDenialPlaced\([\s\S]{0,300}!isUnplaced\(r\.roomId, r\.assignedLocationId, r\.isCommonAsset\)/, '2차 R3 수령 대기로 거부가 놓인 행 정본(isUnplaced)을 안 쓴다(공용 자재가 빠진다)'],
])
for (const fn of ['assignAggregateToTarget', 'distributeAssetToTargets', 'batchAssignAssets']) {
  must(A, a, fn, [[/assignDenialUnreceived\(/, 'S4 수령 전 비품을 방·공용부에 넣는 길을 막지 않는다(받는 순간 말없이 그 방에 선다)']])
}
must(A, a, 'getDurableItems', [[/targetRoomId: true/, 'S4 수령 대기 카드가 배정 예정 호실을 안 읽는다'], [/room\.findMany\(\{ where: \{ id: \{ in: targetIds \}, propertyId \}/, 'S4 예정 호실 번호를 영업장 방으로만 찾지 않는다(지운 방·남의 방)']])

// ── 소모품 서버(inventory/actions) ────────────────────────────────
const I = 'app/(app)/inventory/actions.ts'
const inv = read(I)
must(I, inv, 'confirmReceipt', [
  [/includes\(expense\.category\)\) return \{ ok: false, error: INVENTORY_RECEIPT_DENY_UNTRACKED \}/, 'R-2 재고 화면 수령이 비품을 받는다(배정 물음 우회)'],
  [/signUndoBody\(QTY_FILL_DOMAIN, propertyId, canonicalQtyFill\(qtyFill\)\)/, 'N-1 채움 조각에 서버 서명을 붙이지 않는다'],
  [/receiptNeedsQty\(expense, /, 'S3 수량 관문(receiptNeedsQty)을 부르지 않는다. 수량 없는 수령이 유령수령이 된다'],
  [/if \(needsQty && fill == null\) return \{ ok: false, error: RECEIPT_QTY_REQUIRED \}/, 'S3 수량이 끝내 비면 거부해야 한다'],
  [/qtyFill \? \{ qtyValue: qtyFill\.qtyValue, qtyUnit: qtyFill\.qtyUnit, detail: qtyFill\.detail \}/, 'S3 채운 수량이 수령과 같은 트랜잭션에 안 적힌다'],
  [/!filling && receiveQty != null/, 'S3 수량을 채우는 수령이 부분 수령으로 쪼개진다(전체를 모른다)'],
])
must(I, inv, 'confirmAllPending', [
  [/receiptNeedsQty\(e, trackedCats\)/, 'S3 한꺼번에 받는 경로가 수량 관문을 먼저 안 본다(앞 건만 받고 멈춘다)'],
  [/if \(noQty > 0\) return \{ ok: false, error: receiptQtyRequiredMany\(noQty\) \}/, 'S3 한꺼번에 받는 경로가 빈 수량을 세고도 시작한다'],
])
{
  const body = region(inv, 'updateExpenseFromInventory') ?? ''
  const gate = body.indexOf('return { ok: false, error: RECEIPT_QTY_REQUIRED }')
  const firstWrite = body.indexOf('prisma.expense.update(')
  if (gate < 0) violations.push(`${I} updateExpenseFromInventory. S3 수령일을 넣는 수정에 수량 관문이 없다`)
  else if (firstWrite >= 0 && gate > firstWrite) violations.push(`${I} updateExpenseFromInventory. S3 수량 관문이 첫 쓰기보다 뒤다(거부돼도 수정이 반쯤 남는다)`)
  if (!/confirmReceipt\(id, undefined, undefined, data\.qtyValue\)/.test(body)) violations.push(`${I} updateExpenseFromInventory. S3 도착 수량을 정본 수령(confirmReceipt)에 넘기지 않는다`)
}
// 수령 취소 정본은 공용층(receiptCancel)의 판정(planReceiptCancel)과 쓰기(applyReceiptCancel)다(2026-10-15 비품 전환이 같은 정본을
// 재무 저장 트랜잭션 안에서 부르려고 나눴다). cancelReceiptCore 는 두 함수를 잇는 껍데기다.
const RC = 'app/(app)/inventory/receiptCancel.ts'
const rc = read(RC)
must(RC, rc, 'planReceiptCancel', [
  [/includes\(exp\.category\)\) return \{ ok: false, error: INVENTORY_RECEIPT_DENY_UNTRACKED \}/, 'R-2 재고 화면 수령 취소가 놓인 비품을 수령 대기로 돌린다(자리 있는 수령 전 비품)'],
  [/!qtyFillShapeOk\(opts\.qtyFill\) \|\| opts\.qtyFill\.expenseId !== expenseId/, 'N-1 채움 조각 모양 검사를 안 지난다'],
  [/verifyUndoBody\(QTY_FILL_DOMAIN, propertyId, canonicalQtyFill\(opts\.qtyFill\), opts\.qtyFill\.sig\)/, 'N-1 채움 조각 서명을 확인하지 않는다'],
])
must(RC, rc, 'applyReceiptCancel', [
  [/qtyValue: fillBack\.qtyValue, qtyUnit: fillBack\.qtyUnit/, 'S3 수령 취소가 채운 수량을 그대로일 때만(CAS) 원래 값으로 돌리지 않는다'],
  [/where: \{ \.\.\.same, detail: filledAuto \}/, 'N-1 세부를 지금 값이 채운 자동 형식일 때만 고치지 않는다'],
  [/await tx\.stockCheck\.deleteMany\(\{ where: \{ sourceExpenseId: expenseId \} \}\)/, '수령 취소가 자동 점검을 걷지 않는다'],
])
mustNot(RC, rc, 'applyReceiptCancel', [[/detail: fillBack\.prevDetail/, 'N-1 채움 조각의 세부 글자를 그대로 쓴다']])
must(I, inv, 'cancelReceiptCore', [
  [/const p = await planReceiptCancel\(expenseId, propertyId, opts\)/, '수령 취소가 정본 판정(planReceiptCancel)을 안 탄다'],
  [/prisma\.\$transaction\(tx => applyReceiptCancel\(tx, plan\)\)/, '수령 취소가 정본 쓰기(applyReceiptCancel)를 안 탄다'],
])
must(I, inv, 'setExpenseInventoryExclusion', [
  [/placementForSave\(\{/, 'R-1 제외·포함이 자리 두 칸을 저장 규칙 정본으로 정하지 않는다(방에 걸린 서비스를 포함하면 자리 있는 수령 전 비품)'],
  [/data: \{ excludeFromInventory: exclude, roomId: place\.roomId, targetRoomId: place\.targetRoomId \}/, 'R-1 정본이 정한 두 칸을 쓰지 않는다'],
  [/roomId: goodsAfter \|\| e\.receivedAt \? e\.roomId : \(e\.roomId \?\? e\.targetRoomId\)/, '2차 R1 받은 행의 예정 호실을 방으로 올린다(받은 미배정 비품이 제외·포함 왕복으로 말없이 배정된다)'],
])
must(I, inv, 'syncTrackedItemCategory', [
  [/const deleteUndo = await trackedItemDeleteSnapshot\(propertyId, item\)\s*await prisma\.trackedItem\.delete/, 'S2 카드를 지우기 전에 정본 스냅샷(TrackedItemDeleteUndo)을 안 뜬다'],
  [/retired: 'deleted', deleteUndo/, 'S2 카드 정리의 적용취소 토큰을 돌려주지 않는다'],
])

// ── 재무(finance/actions·FinanceClient) ─────────────────────────────
const F = 'app/(app)/finance/actions.ts'
const fin = read(F)
for (const fn of ['addExpense', 'updateExpense']) {
  must(F, fin, fn, [
    [/const formRoomIds = \[\.\.\.new Set\(\[roomId, formTarget,/, `S4 '배정할 호실'이 영업장 방 검증(formRoomIds)에 안 들어간다`],
    [/room\.count\(\{ where: \{ id: \{ in: formRoomIds \}, propertyId \} \}\)/, 'S4 호실 칸을 영업장 방으로 검증하지 않는다'],
    [/placementForSave\(\{/, 'S4 호실 두 칸을 저장 규칙 정본(placementForSave)으로 정하지 않는다'],
  ])
}
mustNot(F, fin, 'updateExpense', [[/roomId:\s+roomId \|\| null,/, 'S4 단일 수정이 폼 roomId 를 그대로 쓴다. 수령 전 비품에 자리가 생긴다']])
mustNot(F, fin, 'addExpense', [[/\n\s+roomId:\s+r\.roomId,/, 'S4 다품목 등록이 조각 roomId 를 그대로 쓴다. 수령 전 비품에 자리가 생긴다']])
const FC = 'app/(app)/finance/FinanceClient.tsx'
const fc = read(FC)
must(FC, fc, null, [
  [/undoDeleteTrackedItem\(deleteUndo\)/, "S2 '같이 변경' 토스트가 카드 정리를 적용취소하지 않는다"],
  [/<input type="hidden" name="targetRoomId" value=\{addPlanned \? addExpRoomId : ''\} \/>/, "S4 등록 폼이 '배정할 호실'을 싣지 않는다"],
  [/\{editPlanned && <input type="hidden" name="targetRoomId" value=\{editExpRoomId\} \/>\}/, "S4 수정 폼이 받기 전 비품에만 '배정할 호실'을 싣지 않는다"],
  [/수령할 때 이 호실에 배정할지 묻습니다\./, "S4 '배정할 호실' 캡션이 없다"],
])

// ── 화면(비품·재고) ───────────────────────────────────────────────
const AC = 'app/(app)/inventory/assets/AssetsClient.tsx'
const ac = read(AC)
must(AC, ac, null, [
  [/receiptPlacementPlan\(rows, qty \?\? null\)/, 'S5 받을 때 배정 판정을 서버와 같은 순수 함수로 하지 않는다'],
  [/choiceDialog\(\{ \.\.\.copy, level: 'normal' \}\)/, 'S5 정본 확인창(choiceDialog normal)을 쓰지 않는다'],
  [/if \(choice === null \|\| choice === 'back'\) return/, 'S5 취소가 무변경이 아니다(§27.5)'],
  [/undoAssetReceipt\(undo\)/, 'S5 수령 토스트가 서버 토큰으로 되돌리지 않는다'],
  [/assign = choice === 'confirm'\s*\n/, "R-4 확인창 선택과 배정의 대응이 '배정'(confirm) 하나가 아니다('수령만'도 배정한다)"],
  [/markReceived\(it, true, qty, \{ assign, plan, expect: planExpectOf\(rows\) \}, storeId \?\? null\)/, 'N-4 화면이 창에 띄운 계획을 서버에 같이 보내지 않는다(보관 위치도 같이 싣는다)'],
  [/\.\.\.\(how\?\.assign \? \{ assign: true, expect: how\.expect \} : \{\}\), storedLocationId: storeId \}/, 'N-4 배정 요청에 본 계획이 안 실린다(수령 창의 보관 위치도 함께)'],
  [/receiptAssignCopy\(plan, it\.itemLabel, unit, storeNameOf\(storeId\)\)/, '보관 위치 축 F2 창 문구가 고른 보관 위치를 말하지 않는다(미배정에 둔다고 거짓말)'],
  [/withAssign \? ASSET_RECEIPT_ASSIGN_UNDONE : ASSET_RECEIPT_UNDONE/, 'R-5 수령 적용취소 결과 토스트가 정본 문장(§16 형식)을 안 쓴다'],
  [/`이동을 적용취소했습니다\$\{SEP\}이\\u00a0이력은\\u00a0지워짐`/, "후속 검수 권장 2 이동 적용취소 결과의 구분점이 SEP 가 아니다(접히면 둘째 줄이 '·' 로 시작한다)"],
  [/id="assets-pending"/, 'S6 알림 딥링크가 닿을 수령 대기 섹션 id 가 없다'],
  [/const prepareFocus = useCallback\(\(id: string\) => \{ if \(id === 'assets-pending'\) setGroup\('unassigned'\) \}, \[\]\)\s*useFocusSection\(\{ prepare: prepareFocus \}\)/, 'D15 알림 딥링크가 정본 useFocusSection 준비 단계에서 미배정 그룹으로 바꾸지 않는다(다른 그룹을 보고 있으면 닿을 곳이 없다)'],
  [/!it\.isService && isUnplaced\(it\.roomId, it\.locationId, it\.isCommon\) &&/, "S4·2차 R3 놓인 카드(방·공용부·공용 자재)에 '수령대기로'가 서 있다(서버가 거부한다)"],
])
mustNot(AC, ac, null, [[/수령과 배정을 취소하고/, 'R-5 수령 적용취소 결과가 옛 동사로 돌아왔다']])
// 웹디자이너 2차. 알약 까닭은 짧은 형(서버 거부 문장 안에 든 같은 낱말), 수령 대기 상세 머리는 상태 이름
must(AC, ac, null, [
  [/text-white\/75">\{ASSET_ASSIGN_PENDING_REASON_SHORT\}<\/span>/, '디자이너 2차 F1 선택 알약 까닭이 짧은 형이 아니다(320px 125% 에서 다섯 줄)'],
  [/const here = `\$\{pendingHere \? '수령 대기' : curPlace\(it\)\}/, "디자이너 2차 F3 수령 대기 상세 머리가 '미배정(여분)'으로 부른다"],
])
const IC = 'app/(app)/inventory/InventoryClient.tsx'
const ic = read(IC)
must(IC, ic, null, [
  [/const missing = g\.items\.filter\(f => qtyMissing\(f\.p\.qtyValue\)\)/, 'S3 재고 수령 대기가 수량 빈 구매를 정본(qtyMissing)으로 가리지 않는다'],
  [/confirmReceipt\(id, undefined, undefined, fills\?\.\[id\]\)/, 'S3 재고 수령 대기가 도착 수량을 서버에 넘기지 않는다'],
  [/const noQty = qtyMissing\(entry\.qtyValue\)/, 'S3 품목 상세 구매 수령이 수량 빈 구매를 가리지 않는다'],
  [/const askQty = entry\.receivedAt === null && qtyMissing\(entry\.qtyValue\)/, 'S3 구매 수정 수령일이 수량 빈 구매를 가리지 않는다'],
  [/undoConfirmReceipt\(id, f \? \{ qtyFill: f \} : undefined\)/, 'S3 수령 취소가 채운 수량을 함께 돌리지 않는다'],
])
// 웹디자이너 2차 R2. A 카드 칸별 오류는 칸과 오류 문장을 잇고(aria-describedby), 보더가 위험색으로 선다
must(IC, ic, null, [
  [/aria-describedby=\{qtyAsk\?\.bad\.includes\(f\.p\.id\) \? `rcvqty-err-\$\{f\.p\.id\}` : undefined\}/, '디자이너 2차 R2 A 카드 칸이 오류 문장을 가리키지 않는다(aria-describedby)'],
  [/<p id=\{`rcvqty-err-\$\{f\.p\.id\}`\}/, '디자이너 2차 R2 A 카드 오류 문장에 id 가 없다'],
  // 3차 검수 권장 ③. B(품목 상세 구매 수령)·C(구매 수정 수령일)도 같은 문법(칸이 오류 문장을 가리키고 문장에 id)
  [/aria-describedby=\{rcvQtyErr \? `rcvqty-err-b-\$\{entry\.id\}` : undefined\}/, 'A4 B 카드 칸이 오류 문장을 가리키지 않는다(aria-describedby)'],
  [/\{rcvQtyErr && <p id=\{`rcvqty-err-b-\$\{entry\.id\}`\}/, 'A4 B 카드 오류 문장에 id 가 없다'],
  [/aria-describedby=\{rcvQtyErr \? `rcvqty-err-c-\$\{entry\.id\}` : undefined\}/, 'A4 C 폼 칸이 오류 문장을 가리키지 않는다(aria-describedby)'],
  [/\{rcvQtyErr && <p id=\{`rcvqty-err-c-\$\{entry\.id\}`\}/, 'A4 C 폼 오류 문장에 id 가 없다'],
  [/const qtyInputCls = `\$\{checkTextInputCls\} text-right aria-\[invalid=true\]:border-\[var\(--danger-fg\)\]`/, '디자이너 2차 R2 수량칸 오류 보더가 없다'],
])

// ── 홈 알림 ───────────────────────────────────────────────────────
const AL = 'app/(app)/dashboard/alerts.ts'
must(AL, read(AL), 'computeAlerts', [
  [/const seeMoney = viewerRole \? canReadScope\(viewerRole, 'money'\) : true/, 'N-5 알림이 보는 사람의 금액 읽기 권한(비품 화면 관문)을 안 본다'],
  [/for \(const e of seeMoney \? pendingAssetReceipts : \[\]\)/, 'N-5 비품 화면을 못 여는 역할에게 비품 수령 대기 알림이 선다'],
  [/seeMoney && e\.amount > 0 \? fmtWon\(e\.amount\)/, 'N-5 소모품 수령 대기 알림이 금액을 못 읽는 역할에게 금액을 보인다'],
  [/category: \{ notIn: trackedCats \}, itemLabel: \{ not: null \}, receivedAt: null, excludeFromInventory: false, isShipping: false/, 'S6 비품 수령 대기 알림 모집단이 비품 화면 수령 대기와 다르다'],
  [/href: '\/inventory\/assets\?focus=assets-pending'/, 'S6 비품 수령 대기 알림이 비품 화면 수령 대기로 안 보낸다'],
])

// D15 딥링크 정본. 준비 단계(prepare)를 먼저 부르고, 섹션이 그려질 때까지 몇 프레임 기다려 스크롤한다
const FS = 'lib/useFocusSection.ts'
must(FS, read(FS), null, [
  [/io\.prepare\(id\)/, 'D15 정본 딥링크가 준비 단계(prepare)를 안 부른다'],
  [/prepare: id => prepareRef\.current\?\.\(id\)/, 'A3 정본 딥링크가 prepare 를 ref 로 부르지 않는다(인라인 함수가 효과를 다시 돌린다)'],
  [/else if \(left-- > 0\) handle = io\.raf\(tryScroll\)/, 'D15 정본 딥링크가 섹션이 그려질 때까지 기다리지 않는다(그룹을 바꾼 회차에 스크롤이 헛돈다)'],
])
// 행동 그물(scripts/test-focus-section)이 의미를 본다. 여기서는 받는 쪽 배선만 묶는다.
// A2 재고 화면 '재고 소진 임박'은 품목별 보기 안에만 선다. 준비 단계가 품목별로 연다(저장된 보기는 안 건드린다)
must(IC, ic, null, [[/useFocusSection\(\{ prepare: id => \{ if \(id === 'inventory-lowstock'\) setViewMode\('item'\) \} \}\)/, "A2 재고 소진 임박 딥링크가 위치별 보기에서 품목별을 열지 않는다(무반응)"]])
// R3 장부 축 1 도 같은 셋(방·공용부·공용 자재)
const PP = 'scripts/check-asset-pending-placement.ts'
must(PP, read(PP), null, [[/receivedAt: null, OR: \[\{ roomId: \{ not: null \} \}, \{ assignedLocationId: \{ not: null \} \}, \{ isCommonAsset: true \}\] \}/, '2차 R3 장부 축 1 이 공용 자재 표식을 안 본다(놓인 행 정본과 갈린다)']])
const AA = 'app/(app)/dashboard/alertActions.ts'
must(AA, read(AA), null, [[/computeAlerts\(access\.propertyId, access\.role\)/, 'N-5 인앱 종이 보는 사람 역할을 알림 계산에 안 넘긴다']])
const CR = 'app/api/cron/push-alerts/route.ts'
const cr = read(CR)
must(CR, cr, null, [
  [/computeAlerts\(pid, roleOf\.get\(pid\)\)/, 'N-5 푸시가 받는 사람 역할을 알림 계산에 안 넘긴다'],
  // 역할은 종(영업장 관문)과 같은 정본 한 함수로 정한다(3차 검수 권장 ①). 판정의 답은 진리표 scripts/test-resolve-role 이 지킨다.
  [/const roleOf = pushRoleMap\(\{\s*roleRows: roles\.map\(r => \(\{ propertyId: r\.propertyId, role: r\.role as Role \}\)\), ownedIds: owned\.map\(o => o\.id\),\s*email: emailOf\.get\(userId\) \?\? null, isSuperEmail: isSuperAdminEmail,\s*\}\)/, 'A1 푸시가 역할을 정본 묶음 계산(pushRoleMap)으로 정하지 않는다(종과 역할이 갈린다)'],
  [/prisma\.user\.findMany\(\{ where: \{ id: \{ in: \[\.\.\.approved\] \} \}, select: \{ id: true, email: true \} \}\)/, 'A1 푸시가 승인된 수신자 말고도 이메일을 읽는다(검수 R2)'],
])
mustNot(CR, cr, null, [[/roleOf\.set\([^)]*'OWNER'\)/, 'A1 푸시가 역할을 손으로 박는다(정본 resolvePropertyRole 밖 판정)']])
const PA = 'lib/auth/propertyAccess.ts'
const pa = read(PA)
must(PA, pa, null, [
  [/role: resolvePropertyRole\(\{ membershipRole: membership\.role as Role, isOwner: property\?\.ownerId === userId, superByEnv \}\)/, 'A1 관문(역할 줄 갈래)이 정본 resolvePropertyRole 로 역할을 정하지 않는다'],
  [/resolvePropertyRole\(\{ membershipRole: null, isOwner: property\.ownerId === userId, superByEnv: superByEnvNoRow, superByDb: !!me\?\.isSuperAdmin \}\)/, 'A1 관문(역할 줄 없는 갈래)이 정본 resolvePropertyRole 로 역할을 정하지 않는다'],
])
mustNot(PA, pa, null, [[/role: superByEnv \? 'OWNER'|role: 'OWNER'/, 'A1 관문이 역할을 손으로 박는다(정본 resolvePropertyRole 밖 판정)']])

console.log(`[비품 수령 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
