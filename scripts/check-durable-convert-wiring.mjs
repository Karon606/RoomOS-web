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
  [/const input = \{ category: o\.category, items, received: o\.received, original: o\.original \}/, 'B2 화면의 판정 입력이 서버와 같은 모양이 아니다'],
  [/const plan = conversionPlan\(input, res\.facts\)/, 'B2 화면이 서버와 같은 순수 판정(conversionPlan)을 부르지 않는다'],
  [/const items = convertItemsFrom\(o\.items, o\.formRoomId\)/, 'B2 판정 입력을 서버와 같은 함수(convertItemsFrom)로 만들지 않는다(방별 분배 조각 호실이 갈린다)'],
  [/choiceDialog\(\{ \.\.\.copy, altLabel: copy\.altLabel \?\? '', level: 'caution' \}\)/, 'B2 정본 확인창(choiceDialog caution)이 아니다'],
  [/if \(plan\.kind === 'blocked'\) \{\s*return \(await confirmDialog\(\{ \.\.\.copy, level: 'caution' \}\)\) \? \{ decision: 'keep', asked: true \} : null/, "디자이너 1·R6 바꿀 수 없을 때 같은 자리에서 [취소][그대로 저장] 창으로 묻지 않는다"],
  [/const copy = conversionCopy\(plan, /, 'B2 창 문구가 정본(conversionCopy)이 아니다'],
  [/if \(pick === null \|\| pick === 'back'\) return null/, 'B2 취소가 무변경(저장 중단)이 아니다(§27.5)'],
  [/if \(pick !== 'confirm'\) return \{ decision: 'keep', asked: true \}/, "B2 '그대로 저장'이 지금 동작 그대로가 아니다"],
  [/if \(durableConv\) \{ fd\.set\('category', durableConv\.plan\.target\); fd\.set\('durableFrom', addFormCat\); fd\.set\('durableKind', durableConv\.plan\.kind\) \}/, "B2 등록의 '비품으로 저장'이 카테고리·durableFrom·본 종류를 싣지 않는다"],
  [/fd\.set\('category', durableConv\.plan\.target\); fd\.set\('durableFrom', editFormCat\); fd\.set\('durableKind', durableConv\.plan\.kind\)/, "B2·R5 수정의 '비품으로 저장'이 카테고리·durableFrom·본 종류를 싣지 않는다"],
  [/const durableAsk = addIsService \? \{ decision: 'keep' as const, asked: false \} : await askDurableConvert\(\{/, 'B2 등록이 물품 저장에서 전환 물음을 부르지 않는다(서비스만 건너뛴다)'],
  [/const durableAsk = detailExp && !detailExp\.isShipping && !detailExp\.excludeFromInventory && editItems\.length > 0\s*\? await askDurableConvert\(\{/, 'B2 수정이 품목 저장에서 전환 물음을 부르지 않는다'],
  [/if \(durableConv\.plan\.adjust\.needs\) fd\.set\('convertAdjust', '1'\)/, 'B4·R1 조정이 필요한 F3 에 함께 조정 표식을 싣지 않는다(수가 0 이어도)'],
  [/`지출 등록됨\$\{SEP\}\$\{Number\(savedTm\.slice\(5, 7\)\)\}월분`/, "2b R1 등록 토스트 머리줄 '· 9월분' 구분점 앞을 묶지 않는다(접히면 둘째 줄이 '·' 로 시작한다)"],
  [/if \(!durableConv && label && newCat && detailExp && newCat !== detailExp\.category\) \{/, "B2 전환한 저장에서 '재고 품목 카테고리도 같이 바꿀까요?'를 띄운다(답이 이미 나왔다)"],
  [/if \(!durableConv && detailExp\?\.receivedAt && savedItems\.length === 1\) \{/, 'B4 전환한 저장에서 수량 정정 물음을 띄운다(수령분은 전환이 통째로 걷는다)'],
  [/if \(!durableAsk\.asked\) \{\s*const decided = await confirmCategoryAgainstHistory\(/, '디자이너 8 전환 창을 띄운 등록에서 카테고리 이력 물음이 다시 뜬다(답과 상관없이 건너뛴다)'],
  [/label: CONVERT_UNDO_LABEL, run: \(\) => runDurableUndo\(addUndo, 'F1', durableConv\.from\)/, 'B3·디자이너 2 등록 토스트가 전환 적용취소를 싣지 않는다'],
  [/label: CONVERT_UNDO_LABEL, run: \(\) => runDurableUndo\(editUndo, durableConv\.plan\.kind, durableConv\.from\)/, 'B3·디자이너 2 수정 토스트가 전환 적용취소를 싣지 않는다'],
  [/const t = conversionToast\('F1', addedText, durableConv\.roomNos\)/, '디자이너 2 등록 토스트 머리줄·둘째 줄이 정본(conversionToast)이 아니다'],
  [/const t = conversionToast\(durableConv\.plan\.kind, '지출 수정됨', durableConv\.roomNos, durableConv\.plan\.adjust\.checks\)/, '디자이너 2·7 수정 토스트가 정본(conversionToast)이 아니다'],
  [/if \(!durableConv\) \{\s*const noSpec = finalItems\.filter/, 'R6 비품이 되는 품목에 용량(잔량) 물음을 띄운다'],
  [/void undoDurableConvert\(token\)\.then\(r => \{\s*if \(r\.ok\) \{ pushToast\('info', conversionUndoneText\(kind, from\)\)/, 'B3 적용취소 결과가 정본 문장(§16 형식)이 아니다'],
])
// 막힘은 저장 전 창이다. 저장 뒤 토스트로 말하면 같은 저장의 조정 적용취소를 덮는다(디자이너 1·검수 R4)
mustNot(FC, fc, [[/convertBlocked/, 'R4 막힘을 저장 뒤 토스트로 알린다(조정 적용취소 토스트를 지운다)']])
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
  [/const target = durableTargetCategory\(facts, lead\.label\)/, 'B1·R7 대상 카테고리를 정본(durableTargetCategory, 앞 품명 이력 먼저)으로 정하지 않는다'],
  [/if \(mixedLabels\.length\) return \{ kind: 'blocked', reason: 'mixed'/, 'R6 함께 적은 품목에 소모품 이력이 있어도 바꾼다(장부 축 1 갈림)'],
  [/if \(items\.length !== 1 \|\| lead\.allocated \|\| roomIds\.length !== 1\) return \{ kind: 'none' \}/, 'R1 받은 소모품 F3 가 저장 경로의 단일 갈래(품목 하나·분배 없음·호실 하나)가 아니어도 묻는다'],
  [/if \(!sameFacets\(lead\.facets, input\.original\?\.facets\)\) return \{ kind: 'none' \}/, 'R3 같은 저장에서 품목 칸을 바꾼 F3 를 묻는다(적용취소 원장 어긋남)'],
  [/if \(rc\.blocked\) return \{ kind: 'blocked', reason: rc\.blocked/, '디자이너 1 F3 막힘이 판정에 없다'],
], ' conversionPlan')
mustNot(CP, planFn, [[/amount|금액|냉장고|가전|'수선유지비'/, 'B1 판정에 금액 문턱·가전 낱말·카테고리 하드코딩이 들어왔다(멀티테넌트, 쌀 20kg 오탐)']], ' conversionPlan')
const preFn = (() => { const at = cp.indexOf('export function conversionPrecheck('); return at < 0 ? null : cp.slice(at, cp.indexOf('\n}\n', at)) })()
must(CP, preFn, [
  [/if \(!trackedCats\.includes\(input\.category\)\) return false/, 'B1 추적 카테고리가 아니어도 묻는다'],
  [/if \(!items\.some\(it => it\.roomIds\.length > 0\)\) return false/, 'B1 대상 호실이 없어도 묻는다'],
  [/input\.original && input\.original\.category === input\.category && sameSet\(input\.original\.roomIds, roomIds\)/, "B1 수정 폼이 '이번에 바꿨을 때만' 묻지 않는다"],
], ' conversionPrecheck')
mustNot(CP, preFn, [[/amount|금액|냉장고|가전/, 'B1 앞 조건에 금액 문턱·가전 낱말이 들어왔다']], ' conversionPrecheck')
must(FC, fc, [[/if \(!conversionPrecheck\(input, trackedCategories\)\) return \{ decision: 'keep', asked: false \}/, 'B2 화면이 앞 조건을 정본(conversionPrecheck)으로 가르지 않는다']])
const targetFn = (() => { const at = cp.indexOf('export function durableTargetCategory('); return at < 0 ? null : cp.slice(at, cp.indexOf('\n}\n', at)) })()
must(CP, targetFn, [
  [/const byLabel = lead \? top\(\(f\.labelDurableCounts \?\? \[\]\)\.filter\(d => d\.label === lead\)\) : null/, 'R7 그 품명의 비품 이력을 먼저 안 본다'],
  [/const byProperty = top\(f\.durableCounts\)/, 'B1 대상이 그 영업장 비품 빈도가 아니다'],
  [/DURABLE_FALLBACK_CATEGORY && ok\(DURABLE_FALLBACK_CATEGORY\)/, 'B1 비품 이력이 없을 때 기본 목록 이름이 그 영업장 목록에 있는지 안 본다'],
], ' durableTargetCategory')

// ── 서버 저장(finance/actions) ──────────────────────────────────────
const F = 'app/(app)/finance/actions.ts'
const fin = read(F)
for (const fn of ['addExpense', 'updateExpense']) {
  const body = region(fin, fn)
  must(F, body, [
    [/const convertPlan = durableFrom \? await verifyDurableConvert\(propertyId, \{\s*from: durableFrom, to: category, kind: durableKind,/, 'B2·R5 저장이 전환 요청을 같은 판정·같은 종류로 다시 확인하지 않는다(묻지 않은 전환)'],
    [/return \{ ok: false, error: DURABLE_CONVERT_STALE \}/, 'B2 판정이 다르면 거부하지 않는다'],
    [/signDurableUndo\(propertyId, \{/, 'B3 전환 적용취소 토큰에 서명하지 않는다'],
    [/placementForSave\(\{/, 'B2 자리 두 칸을 1단계 정본(placementForSave)으로 정하지 않는다'],
  ], ` ${fn}`)
}
must(F, region(fin, 'updateExpense'), [
  [/await emptyAutoCards\(propertyId, existing\.category, \[existing\.itemLabel\], \[id\]\)/, 'B2 수정 전환이 빈 자동 카드를 고르지 않는다'],
  [/const cards = await deleteEmptyCardsTx\(tx, propertyId, retire\.snapshots, \[id\]\)/, 'B2 빈 자동 카드를 저장과 한 트랜잭션에서 지우지 않는다'],
  [/facets: itemFacets\(\{ label: existing\.itemLabel, qtyValue: existing\.qtyValue, qtyUnit: existing\.qtyUnit, specValue: existing\.specValue, specUnit: existing\.specUnit \}\)/, 'R3 서버 판정이 원래 품목 칸을 안 넘긴다(같은 저장에서 바꾼 F3 를 받는다)'],
  [/now: rowNowOf\(row\)/, 'R3 F3 토큰에 전환 직후 품목 칸을 안 싣는다'],
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
  [/where: \{ id: r\.id, propertyId, category: undo\.to, receivedAt: null, disposedAt: null, roomId: null, targetRoomId: r\.targetRoomId, assignedLocationId: null, isCommonAsset: false, \.\.\.facetsOf\(r\.now\) \}/, 'B3·R3 F1 복원에 영업장·전환 직후 상태(품목 칸 포함) 조건(CAS)이 없다'],
  [/const facetsOf = \(n: DurableConvertUndo\['rows'\]\[number\]\['now'\]\) => \(\{ itemLabel: n\.itemLabel, qtyValue: n\.qtyValue, qtyUnit: n\.qtyUnit, specValue: n\.specValue, specUnit: n\.specUnit \}\)/, 'R3 CAS 품목 칸이 품명·수량·단위·규격 다섯을 다 안 본다'],
  [/data: \{ category: undo\.from, roomId: r\.targetRoomId, targetRoomId: null \}/, 'B3 F1 이 바꾼 칸만 되돌리지 않는다'],
  [/id: p\.id, propertyId, category: undo\.to, receivedAt: \{ not: null \}, disposedAt: null,\s*roomId: p\.roomId, assignedAt: new Date\(p\.assignedAt\), assignedLocationId: null, isCommonAsset: false, \.\.\.facetsOf\(p\.now\),/, 'B3·R3 F3 복원에 영업장·전환 직후 상태(품목 칸 포함) 조건(CAS)이 없다'],
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
must(DC, region(dc, 'deleteEmptyCardsTx'), [
  [/where: \{ id: s\.item\.id, propertyId, stockChecks: \{ none: \{\} \}, additions: \{ none: \{\} \}, disposals: \{ none: \{\} \} \}/, 'B2 카드 삭제에 비어 있음 조건(CAS)이 없다'],
  [/const others = await tx\.expense\.count\(\{ where: \{ propertyId, category: s\.item\.category, itemLabel: s\.item\.label, id: \{ notIn: expenseIds \} \} \}\)\s*if \(others > 0\) continue/, '검수 참고 카드 삭제가 트랜잭션 안에서 그 품명의 다른 구매를 다시 안 센다'],
], ' deleteEmptyCardsTx')
must(DC, region(dc, 'receiptConvertPreview'), [
  [/if \(adjusted\.ok\) return \{ blocked: null, needsAdjust: true, adjustChecks: adjusted\.plan\?\.rows\.length \?\? 0 \}/, 'R1 미리보기가 조정 필요 표식을 안 준다(수가 0 이면 서버가 거부한다)'],
], ' receiptConvertPreview')
// 정본 수령 취소의 함께 조정 갈래도 매칭 카드가 없으면 이후 점검 가드를 지난다(검수 R1)
const RC = 'app/(app)/inventory/receiptCancel.ts'
must(RC, region(read(RC), 'planReceiptCancel'), [[/\} else if \(autoChecks\.length > 0 && await laterCheckExists\(\)\) \{[\s\S]{0,300}return \{ ok: false, error: RECEIPT_CANCEL_LATER \}/, 'R1 함께 조정 갈래가 매칭 카드 없을 때 이후 점검 가드를 건너뛴다']], ' planReceiptCancel')

console.log(`[비품 전환 배선] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
