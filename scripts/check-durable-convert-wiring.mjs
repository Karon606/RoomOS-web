// 비품 전환(F1·F3) 배선 감지망. 읽기 전용, 위반 시 exit 1. 실행: node scripts/check-durable-convert-wiring.mjs
//
// 2026-10-15 계획서 비품-전환-배정 2단계. 판정 진리표(test-durable-convert)는 순수 함수만, 통합 하네스(test-durable-convert-flow)는
// 서버 쓰기만 본다. 화면이 그 판정을 **저장 사슬 맨 앞에서** 부르는가, 전환한 저장에서 '재고 품목 카테고리도 같이 바꿀까요?'를
// 띄우지 않는가, 서버가 같은 판정을 다시 돌리고 토큰에 서명하는가는 둘 다 못 본다. 그 자리를 글자로 묶는다(주석은 걷고 본다).
import { readFileSync } from 'node:fs'

const violations = []
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)
const read = (f) => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f}. 파일을 못 읽었다(못 읽으면 통과가 아니라 위반이다)`); return '' } }
/** (export )?async function 이름( 부터 다음 최상위 함수 직전까지. */
function region(src, name) {
  const at = src.search(new RegExp(`(^|\\n)(export )?async function ${name}\\(`))
  if (at < 0) return null
  const ends = [src.indexOf('\nexport ', at + 2), src.indexOf('\nasync function ', at + 2), src.indexOf('\nfunction ', at + 2)].filter(i => i > 0)
  return src.slice(at, ends.length ? Math.min(...ends) : undefined)
}
function must(file, body, checks, where = '') {
  if (body == null) { violations.push(`${file}${where}. 대상을 못 찾았다. 이름이 바뀌었으면 이 그물도 함께 고친다`); return }
  for (const [re, msg] of checks) if (!re.test(body)) violations.push(`${file}${where}. ${msg}`)
}
function mustNot(file, body, checks, where = '') {
  if (body == null) return
  for (const [re, msg] of checks) if (re.test(body)) violations.push(`${file}${where}. ${msg}`)
}
/** a 가 b 보다 앞인가(둘 다 있어야 한다). */
function before(file, body, a, b, msg) {
  const i = body.search(a), j = body.search(b)
  if (i < 0 || j < 0 || i > j) violations.push(`${file}. ${msg}`)
}

// ── 화면(FinanceClient) ───────────────────────────────────────────
const FC = 'app/(app)/finance/FinanceClient.tsx'
const fc = read(FC)
must(FC, fc, [
  [/const plan = conversionPlan\(\{ category: o\.category, items, received: o\.received, original: o\.original \}, res\.facts\)/, 'B2 화면이 서버와 같은 순수 판정(conversionPlan)을 부르지 않는다'],
  [/const items = convertItemsFrom\(o\.items, o\.formRoomId\)/, 'B2 판정 입력을 서버와 같은 함수(convertItemsFrom)로 만들지 않는다(방별 분배 조각 호실이 갈린다)'],
  [/choiceDialog\(\{ \.\.\.copy, level: 'caution' \}\)/, 'B2 정본 확인창(choiceDialog caution)이 아니다'],
  [/const copy = conversionCopy\(plan, /, 'B2 창 문구가 정본(conversionCopy)이 아니다'],
  [/if \(pick === null \|\| pick === 'back'\) return null/, 'B2 취소가 무변경(저장 중단)이 아니다(§27.5)'],
  [/if \(pick !== 'confirm'\) return \{ decision: 'keep' \}/, "B2 '그대로 저장'이 지금 동작 그대로가 아니다"],
  [/if \(durableConv\) \{ fd\.set\('category', durableConv\.plan\.target\); fd\.set\('durableFrom', addFormCat\) \}/, "B2 등록의 '비품으로 저장'이 카테고리와 durableFrom 을 싣지 않는다"],
  [/fd\.set\('category', durableConv\.plan\.target\); fd\.set\('durableFrom', editFormCat\)/, "B2 수정의 '비품으로 저장'이 카테고리와 durableFrom 을 싣지 않는다"],
  [/if \(durableConv\.adjust > 0\) fd\.set\('convertAdjust', '1'\)/, 'B4 이후 점검 조정 수를 창에 적고도 서버에 함께 조정을 싣지 않는다'],
  [/if \(!durableConv && label && newCat && detailExp && newCat !== detailExp\.category\) \{/, "B2 전환한 저장에서 '재고 품목 카테고리도 같이 바꿀까요?'를 띄운다(답이 이미 나왔다)"],
  [/if \(!durableConv && detailExp\?\.receivedAt && savedItems\.length === 1\) \{/, 'B4 전환한 저장에서 수량 정정 물음을 띄운다(수령분은 전환이 통째로 걷는다)'],
  [/if \(!durableConv\) \{\s*const decided = await confirmCategoryAgainstHistory\(/, '전환 창에서 카테고리를 정한 등록에서 카테고리 이력 물음이 다시 뜬다(서버 판정과 대상이 갈린다)'],
  [/run: \(\) => runDurableUndo\(addUndo, 'F1', durableConv\.from\)/, 'B3 등록 토스트가 전환 적용취소를 싣지 않는다'],
  [/run: \(\) => runDurableUndo\(editUndo, durableConv\.plan\.kind, durableConv\.from\)/, 'B3 수정 토스트가 전환 적용취소를 싣지 않는다'],
  [/void undoDurableConvert\(token\)\.then\(r => \{\s*if \(r\.ok\) \{ pushToast\('info', conversionUndoneText\(kind, from\)\)/, 'B3 적용취소 결과가 정본 문장(§16 형식)이 아니다'],
  [/if \(res\.receipt\.blocked\) return \{ decision: 'blocked'/, 'B4 자동 점검을 걷을 수 없는 F3 에서 창 대신 안내하지 않는다'],
  [/else if \(convertBlocked\) pushToast\('success', '지출 수정됨', \{ detail: convertBlocked \}\)/, 'B4 막힌 F3 의 까닭을 저장 토스트에 싣지 않는다'],
])
// 사슬 맨 앞. 물음이 세트 확인·카테고리 이력·수량 정정 물음보다 먼저다
{
  const addAt = fc.indexOf('const handleAddExp = ')
  const add = addAt >= 0 ? fc.slice(addAt, fc.indexOf('const askLinkAfterExpenseSave', addAt)) : ''
  before(FC, add, /await askDurableConvert\(\{/, /await confirmDurableSetItems\(addItems\)/, 'B2 등록에서 전환 물음이 사슬 맨 앞이 아니다(세트 확인보다 뒤)')
  before(FC, add, /await askDurableConvert\(\{/, /await confirmCategoryAgainstHistory\(/, 'B2 등록에서 전환 물음이 카테고리 이력 물음보다 뒤다')
  before(FC, add, /await askDurableConvert\(\{/, /await addExpense\(fd\)/, 'B2 등록에서 전환 물음이 저장보다 뒤다')
  const updAt = fc.indexOf('const handleUpdateExp = ')
  const upd = updAt >= 0 ? fc.slice(updAt, fc.indexOf('const handleDeleteExp', updAt)) : ''
  before(FC, upd, /await askDurableConvert\(\{/, /await confirmDurableSetItems\(editItems\)/, 'B2 수정에서 전환 물음이 사슬 맨 앞이 아니다')
  before(FC, upd, /await askDurableConvert\(\{/, /await previewExpenseStockShift\(/, 'B4 수정에서 전환 물음이 수량 정정 물음보다 뒤다')
  before(FC, upd, /await askDurableConvert\(\{/, /await updateExpense\(fd\)/, 'B2 수정에서 전환 물음이 저장보다 뒤다')
}

// ── 순수층(conversionPlan) ─────────────────────────────────────────
const CP = 'app/(app)/inventory/assets/conversionPlan.ts'
const cp = read(CP)
const planFn = (() => { const at = cp.indexOf('export function conversionPlan('); return at < 0 ? null : cp.slice(at, cp.indexOf('\n}\n', at)) })()
must(CP, planFn, [
  [/if \(!conversionPrecheck\(input, facts\.trackedCats\)\) return \{ kind: 'none' \}/, 'B1 판정이 앞 조건(추적 카테고리·호실·이번에 바꿨나)으로 시작하지 않는다'],
  [/!facts\.trackedHistoryLabels\.includes\(it\.label\)/, 'B1 그 품명의 소모품 이력을 안 본다(이력이 곧 기억)'],
  [/const target = durableTargetCategory\(facts\)/, 'B1 대상 카테고리를 정본(durableTargetCategory)으로 정하지 않는다'],
], ' conversionPlan')
mustNot(CP, planFn, [[/amount|금액|냉장고|가전|'수선유지비'/, 'B1 판정에 금액 문턱·가전 낱말·카테고리 하드코딩이 들어왔다(멀티테넌트, 쌀 20kg 오탐)']], ' conversionPlan')
const preFn = (() => { const at = cp.indexOf('export function conversionPrecheck('); return at < 0 ? null : cp.slice(at, cp.indexOf('\n}\n', at)) })()
must(CP, preFn, [
  [/if \(!trackedCats\.includes\(input\.category\)\) return false/, 'B1 추적 카테고리가 아니어도 묻는다'],
  [/if \(!items\.some\(it => it\.roomIds\.length > 0\)\) return false/, 'B1 대상 호실이 없어도 묻는다'],
  [/input\.original && input\.original\.category === input\.category && sameSet\(input\.original\.roomIds, roomIds\)/, "B1 수정 폼이 '이번에 바꿨을 때만' 묻지 않는다"],
], ' conversionPrecheck')
mustNot(CP, preFn, [[/amount|금액|냉장고|가전/, 'B1 앞 조건에 금액 문턱·가전 낱말이 들어왔다']], ' conversionPrecheck')
must(FC, fc, [[/if \(!conversionPrecheck\(\{ category: o\.category, items, received: o\.received, original: o\.original \}, trackedCategories\)\) return \{ decision: 'keep' \}/, 'B2 화면이 앞 조건을 정본(conversionPrecheck)으로 가르지 않는다']])
const targetFn = (() => { const at = cp.indexOf('export function durableTargetCategory('); return at < 0 ? null : cp.slice(at, cp.indexOf('\n}\n', at)) })()
must(CP, targetFn, [
  [/f\.durableCounts\.filter\(d => d\.count > 0 && ok\(d\.category\)\)/, 'B1 대상이 그 영업장 비품 빈도가 아니다'],
  [/DURABLE_FALLBACK_CATEGORY && ok\(DURABLE_FALLBACK_CATEGORY\)/, 'B1 비품 이력이 없을 때 기본 목록 이름이 그 영업장 목록에 있는지 안 본다'],
], ' durableTargetCategory')

// ── 서버 저장(finance/actions) ──────────────────────────────────────
const F = 'app/(app)/finance/actions.ts'
const fin = read(F)
for (const fn of ['addExpense', 'updateExpense']) {
  const body = region(fin, fn)
  must(F, body, [
    [/const convertPlan = durableFrom \? await verifyDurableConvert\(propertyId, \{/, 'B2 저장이 전환 요청을 같은 판정으로 다시 확인하지 않는다(묻지 않은 전환)'],
    [/return \{ ok: false, error: DURABLE_CONVERT_STALE \}/, 'B2 판정이 다르면 거부하지 않는다'],
    [/signDurableUndo\(propertyId, \{/, 'B3 전환 적용취소 토큰에 서명하지 않는다'],
    [/placementForSave\(\{/, 'B2 자리 두 칸을 1단계 정본(placementForSave)으로 정하지 않는다'],
  ], ` ${fn}`)
}
must(F, region(fin, 'updateExpense'), [
  [/await emptyAutoCards\(propertyId, existing\.category, \[existing\.itemLabel\], \[id\]\)/, 'B2 수정 전환이 빈 자동 카드를 고르지 않는다'],
  [/const cards = await deleteEmptyCardsTx\(tx, propertyId, retire\.snapshots\)/, 'B2 빈 자동 카드를 저장과 한 트랜잭션에서 지우지 않는다'],
  [/const rc = await planReceiptCancel\(id, propertyId, \{ adjustFollowing: formData\.get\('convertAdjust'\) === '1' \}\)/, 'B4 F3 가 수령 취소 정본 판정(함께 조정 포함)을 안 탄다'],
  [/const cu = await applyReceiptCancel\(tx, cancelPlan, \{ keepReceived: true \}\)/, 'B4 F3 가 수령 취소 정본 쓰기로 자동 점검을 걷지 않는다(수령 시각은 지킨다)'],
  [/const assignDay = ymdToDbDate\(kstYmdStr\(existing\.receivedAt\)\)/, 'B4 F3 배정일이 수령일의 KST 날짜가 아니다(KST 00~09시 수령이 어제로 박힌다)'],
  [/assignedAt: assignDay, assignedLocationId: null, isCommonAsset: false/, 'B4 F3 가 그 방 배정 세 칸을 쓰지 않는다'],
  [/assetAssignmentLog\.create\(\{ data: assignmentLogData\(propertyId, row\.itemLabel, row,\s*\{ kind: 'none', label: '미배정' \}, \{ kind: 'room'/, "B4 F3 가 배정 이력 '미배정에서 방'을 직접 남기지 않는다"],
  [/autoCheckSnaps\(cancelPlan\.autoChecks\)/, 'B4 F3 토큰이 걷은 자동 점검을 전 칸으로 담지 않는다(바이트 동일 복원 불가)'],
], ' updateExpense')
mustNot(F, region(fin, 'updateExpense'), [[/logAssignment\(/, "B4 F3 가 '변화 없음'이면 이력을 안 남기는 logAssignment 를 쓴다"]], ' updateExpense')
must(F, region(fin, 'undoDurableConvert'), [
  [/await requireEdit\(\)/, 'B3 적용취소가 편집 권한 관문을 안 지난다'],
  [/const undo = parseDurableConvertUndo\(raw\)/, 'B3 토큰 모양 검사를 안 지난다'],
  [/verifyUndoBody\(DURABLE_CONVERT_UNDO_DOMAIN, propertyId, canonicalDurableConvertUndo\(undo\), undo\.sig\)/, 'B3 토큰 서명을 용도 라벨로 대조하지 않는다'],
  [/prisma\.\$transaction\(tx => applyDurableConvertUndo\(tx, propertyId, undo, trackedCats\)\)/, 'B3 적용취소가 한 트랜잭션이 아니다'],
  [/seedTrackedItemsFromExpenses\(undo\.seedLabels\)/, 'B3 등록 전환을 되돌려도 원래 생겼을 카드를 시드하지 않는다'],
], ' undoDurableConvert')

// ── 공용층(durableConvert) ──────────────────────────────────────────
const DC = 'app/(app)/inventory/durableConvert.ts'
const dc = read(DC)
must(DC, region(dc, 'applyDurableConvertUndo'), [
  [/if \(!trackedCats\.includes\(undo\.from\) \|\| trackedCats\.includes\(undo\.to\)\) throw INVALID/, 'B3 되돌릴 카테고리가 지금 소모품인지 안 본다(무관한 카테고리로 쓴다)'],
  [/where: \{ id: r\.id, propertyId, category: undo\.to, receivedAt: null, disposedAt: null, roomId: null, targetRoomId: r\.targetRoomId, assignedLocationId: null, isCommonAsset: false \}/, 'B3 F1 복원에 영업장·전환 직후 상태 조건(CAS)이 없다'],
  [/data: \{ category: undo\.from, roomId: r\.targetRoomId, targetRoomId: null \}/, 'B3 F1 이 바꾼 칸만 되돌리지 않는다'],
  [/id: p\.id, propertyId, category: undo\.to, receivedAt: \{ not: null \}, disposedAt: null,\s*roomId: p\.roomId, assignedAt: new Date\(p\.assignedAt\), assignedLocationId: null, isCommonAsset: false,/, 'B3 F3 복원에 영업장·전환 직후 상태 조건(CAS)이 없다'],
  [/if \(u\.count !== 1\) throw STALE/, 'B3 그 사이 바뀐 행이면 전부 되감지 않는다(반쪽 적용취소)'],
  [/restoreTrackedItemTx\(tx, propertyId, c\)/, 'B3 지운 카드를 같은 id 로 되살리지 않는다'],
  [/id: l\.id, stockCheckId: c\.id, storageLocationId: l\.storageLocationId, remainingQty: l\.remainingQty,\s*restockedQty: l\.restockedQty, fromHubQty: l\.fromHubQty, fromLocationId: l\.fromLocationId, carried: l\.carried,/, 'B3 F3 자동 점검 위치 내역을 바이트 그대로(id·이월 표식) 되살리지 않는다'],
  [/assetAssignmentLog\.deleteMany\(\{ where: \{ id: \{ in: undo\.logIds \}, propertyId \} \}\)/, 'B3 F3 배정 이력 줄을 영업장 범위로 지우지 않는다'],
], ' applyDurableConvertUndo')
must(DC, region(dc, 'emptyAutoCards'), [
  [/prisma\.stockCheck\.count\(\{ where: \{ trackedItemId: c\.id, OR: \[\{ sourceExpenseId: null \}, \{ sourceExpenseId: \{ notIn: expenseIds \} \}\] \} \}\)/, 'B2 빈 카드 판정이 점검을 안 센다(이 지출의 수령 자동 점검만 뺀다)'],
  [/prisma\.expense\.count\(\{ where: \{ propertyId, category: c\.category, itemLabel: c\.label, id: \{ notIn: expenseIds \} \} \}\)/, 'B2 빈 카드 판정이 그 품명의 다른 구매를 안 센다'],
  [/trackedItemDeleteSnapshot\(propertyId, c\)/, 'B2 카드를 지우기 전에 정본 스냅샷을 안 뜬다'],
], ' emptyAutoCards')
must(DC, region(dc, 'deleteEmptyCardsTx'), [[/where: \{ id: s\.item\.id, propertyId, stockChecks: \{ none: \{\} \}, additions: \{ none: \{\} \}, disposals: \{ none: \{\} \} \}/, 'B2 카드 삭제에 비어 있음 조건(CAS)이 없다']], ' deleteEmptyCardsTx')

console.log(`[비품 전환 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
