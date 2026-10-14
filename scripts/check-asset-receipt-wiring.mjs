// 비품 수령·배정 예정 호실·소모품 수량 관문 배선 감지망. 읽기 전용, 위반 시 exit 1. 실행: node scripts/check-asset-receipt-wiring.mjs
//
// 2026-10-15 냉장고 519호 건(계획서 비품-전환-배정 1단계). 판정 진리표(scripts/test-asset-receipt.ts)는 순수 함수만 본다.
// 서버와 화면이 그 판정을 **실제로 부르는가**는 진리표가 못 본다. 판정을 지우거나 우회하면 진리표는 초록인 채로
// 유령수령·수령 전 배정·적용취소 반쪽이 되살아난다. 그 자리를 글자로 묶는다(주석은 걷고 본다).
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
  [/opts\?\.assign && !planAsks\(plan\)\) return/, 'S5 묻지 않을 판정인데 배정 요청이 오면 거부해야 한다'],
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
  [/where: \{\s*id: row\.id, propertyId, receivedAt: row\.now\.received \? at : null/, '행 복원에 영업장·이번 상태 조건(CAS)이 없다'],
  [/assetAssignmentLog\.deleteMany\(\{ where: \{ id: \{ in: undo\.logIds \}, propertyId \} \}\)/, '적용취소가 만든 이력 줄을 영업장 범위로 지우지 않는다'],
  [/if \(r\.count !== 1\) throw STALE/, '그 사이 바뀐 행이면 거부해야 한다(반쪽 적용취소 금지)'],
])
mustNot(A, a, 'undoAssetReceipt', [
  [/targetRoomId/, '적용취소가 배정 예정 호실을 건드린다. 예정 호실은 남아야 한다'],
])
for (const fn of ['assignAggregateToTarget', 'distributeAssetToTargets', 'batchAssignAssets']) {
  must(A, a, fn, [[/assignDenialUnreceived\(/, 'S4 수령 전 비품을 방·공용부에 넣는 길을 막지 않는다(받는 순간 말없이 그 방에 선다)']])
}
must(A, a, 'getDurableItems', [[/targetRoomId: true/, 'S4 수령 대기 카드가 배정 예정 호실을 안 읽는다'], [/room\.findMany\(\{ where: \{ id: \{ in: targetIds \}, propertyId \}/, 'S4 예정 호실 번호를 영업장 방으로만 찾지 않는다(지운 방·남의 방)']])

// ── 소모품 서버(inventory/actions) ────────────────────────────────
const I = 'app/(app)/inventory/actions.ts'
const inv = read(I)
must(I, inv, 'confirmReceipt', [
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
must(I, inv, 'cancelReceiptCore', [[/qtyValue: fillBack\.qtyValue, qtyUnit: fillBack\.qtyUnit/, 'S3 수령 취소가 채운 수량을 그대로일 때만(CAS) 원래 값으로 돌리지 않는다']])
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
  [/수령 확인 때 이 호실에 배정할지 묻습니다\./, "S4 '배정할 호실' 캡션이 없다"],
])

// ── 화면(비품·재고) ───────────────────────────────────────────────
const AC = 'app/(app)/inventory/assets/AssetsClient.tsx'
const ac = read(AC)
must(AC, ac, null, [
  [/receiptPlacementPlan\(rows, qty \?\? null\)/, 'S5 받을 때 배정 판정을 서버와 같은 순수 함수로 하지 않는다'],
  [/choiceDialog\(\{ \.\.\.copy, level: 'normal' \}\)/, 'S5 정본 확인창(choiceDialog normal)을 쓰지 않는다'],
  [/if \(choice === null \|\| choice === 'back'\) return/, 'S5 취소가 무변경이 아니다(§27.5)'],
  [/undoAssetReceipt\(undo\)/, 'S5 수령 토스트가 서버 토큰으로 되돌리지 않는다'],
  [/id="assets-pending"/, 'S6 알림 딥링크가 닿을 수령 대기 섹션 id 가 없다'],
  [/!it\.isService && !placed &&/, "S4 놓인 카드에 '수령대기로'가 서 있다(서버가 거부한다)"],
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

// ── 홈 알림 ───────────────────────────────────────────────────────
const AL = 'app/(app)/dashboard/alerts.ts'
must(AL, read(AL), 'computeAlerts', [
  [/category: \{ notIn: trackedCats \}, itemLabel: \{ not: null \}, receivedAt: null, excludeFromInventory: false, isShipping: false/, 'S6 비품 수령 대기 알림 모집단이 비품 화면 수령 대기와 다르다'],
  [/href: '\/inventory\/assets\?focus=assets-pending'/, 'S6 비품 수령 대기 알림이 비품 화면 수령 대기로 안 보낸다'],
])

console.log(`[비품 수령 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
