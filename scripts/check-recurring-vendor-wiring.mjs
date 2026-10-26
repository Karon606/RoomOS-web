// 고정지출 구매처(납부처) 배선 감지망(verify:fast). 읽기 전용 소스 검사, 위반 시 exit 1. 실행: node scripts/check-recurring-vendor-wiring.mjs
//
// 왜 (2026-10-27 운영자 승인, 신고 5fa9cf43 "임대료나 통신비, 보험, 정수기 등 납부처 적는 곳이 없었네"). 칸(RecurringExpense.vendor·
// Expense.vendor)은 있었는데 매달 누르는 두 자리(기록 모달·재무 고정 지출 관리 폼)에 칸이 없었다. 한 자리만 빠져도 그 길로 들어온
// 기록은 구매처를 잃고, 비운 칸을 `|| undefined` 로 접으면 지울 길이 사라진다([[form-clear-vs-absent]]). 통합(test-recurring-vendor-flow)은
// 서버 동작을 보고, 이 그물은 화면과 서버의 짝을 모양으로 본다. 축은 열둘이다.
//   ⓐ 기록 액션의 칸(부재=항목 값, 실림=그 값, 비움=null) ⓑ 기본 구매처 저장(같은 트랜잭션·조건부 갱신·서명 토큰)과 그 적용취소
//   ⓒ 기록 모달(칸 상시 렌더·빈 칸 null·체크박스 노출·기본값·결과 전달) ⓓ 두 호출부(자동완성 목록·토스트 정본)
//   ⓔ 재무 관리 폼(초기·새 항목·수정 프리필·저장 넷, 옛 '칸이 없어' 주석 금지) ⓕ 허용 칸 표에 vendor 유지
//   ⓖ 소급(항목·빈 구매처로 좁힘·서명·제목/메모 추출 금지)과 묻는 자리 ⓗ 자리표시·캡션 세 자리 같은 글자
//   ⓘ 구매처 이름 변경이 항목까지·적용취소가 항목까지 ⓙ 목록 캡션은 고정지출 행만 ⓚ 현황이 vendor 를 싣는다 ⓛ 등록(package.json)
import { readFileSync } from 'node:fs'

const violations = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
const read = f => { try { return readFileSync(f, 'utf8') } catch { violations.push(`${f}. 파일을 못 읽었다(못 읽으면 통과가 아니라 위반이다)`); return '' } }
/** (export )?(async )?function 이름( 부터 다음 최상위 function·export·const 직전까지. */
function region(src, name) {
  const at = src.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\(`))
  if (at < 0) return null
  const ends = [src.indexOf('\nexport ', at + 2), src.indexOf('\nasync function ', at + 2), src.indexOf('\nfunction ', at + 2), src.indexOf('\nconst ', at + 2)].filter(i => i > 0)
  return src.slice(at, ends.length ? Math.min(...ends) : undefined)
}
function must(file, src, fn, checks, nots = []) {
  const body = fn ? region(src, fn) : src
  if (body == null) { violations.push(`${file}. ${fn} 를 못 찾았다. 이름이 바뀌었으면 이 그물도 함께 고친다`); return }
  for (const [re, msg] of checks) if (!re.test(body)) violations.push(`${file}${fn ? ` ${fn}` : ''}. ${msg}`)
  for (const [re, msg] of nots) if (re.test(body)) violations.push(`${file}${fn ? ` ${fn}` : ''}. ${msg}`)
}

const FA = 'app/(app)/finance/actions.ts'
const fa = strip(read(FA))
const MODAL = 'app/(app)/finance/RecurringExpenseRecordModal.tsx'
const modal = read(MODAL)
const FC = 'app/(app)/finance/FinanceClient.tsx'
const fc = read(FC)
const DC = 'app/(app)/dashboard/DashboardClient.tsx'
const dc = read(DC)
const SF = 'app/(app)/settings/SettingsForm.tsx'
const sf = read(SF)
const ASK = 'app/(app)/finance/recurringVendorBackfillAsk.ts'
const ask = strip(read(ASK))

// ── ⓐ 기록 액션의 칸 ─────────────────────────────────────────────
must(FA, fa, 'recordRecurringExpense', [
  [/\n\s+vendor\?: string \| null\n/, "인자에 vendor?: string | null 이 없다(모달이 적은 구매처를 못 싣는다)"],
  [/const recordVendor = 'vendor' in data \? \(data\.vendor\?\.trim\(\) \|\| null\) : \(recurring\.vendor \?\? null\)/, "칸이 실려 오면 그 값(비우면 null), 없으면 항목 값으로 가르지 않는다('vendor' in data)"],
  [/vendor:\s+recordVendor,/, '지출 생성이 가른 구매처(recordVendor)를 안 쓴다'],
], [
  [/vendor:\s+recurring\.vendor \?\? null,/, '지출 생성이 항목 구매처를 그대로 복사한다(모달에서 고친 값이 버려진다)'],
  [/data\.vendor\s*\|\|\s*recurring\.vendor/, '비운 칸을 항목 값으로 접는다(|| 는 빈 글자를 부재로 읽는다)'],
])

// ── ⓑ 기본 구매처 저장과 적용취소 ────────────────────────────────
{
  const rec = region(fa, 'recordRecurringExpense') ?? ''
  const txAt = rec.indexOf('prisma.$transaction(async tx =>')
  const upd = rec.search(/tx\.recurringExpense\.updateMany\(\{\s*where: \{ id: data\.recurringExpenseId, propertyId, vendor: templateBefore \},\s*data:\s*\{ vendor: recordVendor \}/)
  if (txAt < 0 || upd < txAt) violations.push(`${FA} recordRecurringExpense. 기본 구매처 저장이 지출 생성과 같은 트랜잭션 안의 조건부 갱신(id·propertyId·지금 값)이 아니다`)
  if (!/const saveTemplateVendor = data\.saveVendorAsDefault === true && recordVendor !== templateBefore/.test(rec)) violations.push(`${FA} recordRecurringExpense. 기본 구매처 저장이 체크와 '값이 다를 때'에 묶이지 않았다`)
  if (!/signUndoBody\(RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN, propertyId, canonicalRecurringVendorUndo\(body\)\)/.test(rec)) violations.push(`${FA} recordRecurringExpense. 기본 구매처 적용취소 토큰을 정본 서명(용도 라벨 recurring-template-vendor-v1)으로 내지 않는다`)
}
must(FA, fa, 'undoRecurringTemplateVendor', [
  [/parseRecurringVendorUndo\(raw\)/, '토큰 모양을 정본(parseRecurringVendorUndo)으로 다시 보지 않는다'],
  [/verifyUndoBody\(RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN, propertyId, canonicalRecurringVendorUndo\(body\), sig\)/, '서명을 이 용도 라벨·이 영업장으로 보지 않는다'],
  [/recurringExpense\.updateMany\(\{\s*where: \{ id: u\.recurringExpenseId, propertyId, vendor: u\.after \},\s*data:\s*\{ vendor: u\.before \}/, "지금이 '쓴 직후' 값일 때만 되돌리는 조건부 갱신이 아니다"],
])
if (!/export const RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN = 'recurring-template-vendor-v1'/.test(read('lib/recurringVendorUndo.ts'))) violations.push("lib/recurringVendorUndo.ts. 용도 라벨이 'recurring-template-vendor-v1' 이 아니다")

// ── ⓒ 기록 모달 ─────────────────────────────────────────────────
{
  const m = strip(modal)
  // 칸은 조건 없이 그린다. 칸 자리 앞(카테고리 칸 뒤)에서 조건부 렌더(&& ( · ? ( )로 감싸면 비울 길이 사라진다.
  const inputAt = m.indexOf('id="rec-record-vendor"')
  const catAt = m.lastIndexOf('{rec.category}', inputAt)
  if (inputAt < 0 || catAt < 0) violations.push(`${MODAL}. 구매처 칸(id rec-record-vendor)이 카테고리 칸 뒤에 없다`)
  else if (/&&\s*\(|\?\s*\(/.test(m.slice(catAt, inputAt))) violations.push(`${MODAL}. 구매처 칸이 조건부로 그려진다(폼이 칸을 상시 그려야 비운 값을 보낸다)`)
  if (!/useState\(rec\.vendor \?\? ''\)/.test(m)) violations.push(`${MODAL}. 구매처 칸을 항목 기본 구매처로 채워 열지 않는다`)
  if (!/vendor: vendor\.trim\(\) \|\| null,/.test(m)) violations.push(`${MODAL}. 빈 칸을 null 로 싣지 않는다(서버가 부재로 읽어 항목 값을 쓴다)`)
  if (/vendor: vendor(\.trim\(\))? \|\| undefined/.test(m)) violations.push(`${MODAL}. 빈 칸을 undefined 로 접는다`)
  if (!/list="rec-record-vendors"/.test(m) || !/<datalist id="rec-record-vendors">\{vendorSuggestions\.map/.test(m)) violations.push(`${MODAL}. 구매처 자동완성(지출 이력 datalist)이 없다`)
  if (!/const vendorDiffers = \(vendor\.trim\(\) \|\| null\) !== \(rec\.vendor \?\? null\)/.test(m) || !/\{vendorDiffers && \(/.test(m)) violations.push(`${MODAL}. '기본 구매처로 저장' 체크가 적은 값이 항목 값과 다를 때만 보이지 않는다`)
  if (!/useState\(\(\) => !rec\.vendor\)/.test(m)) violations.push(`${MODAL}. 체크 기본값이 '항목이 비면 켜짐, 다른 값이 있으면 꺼짐'이 아니다`)
  if (!/이 항목의 기본 구매처로 저장/.test(m)) violations.push(`${MODAL}. 체크박스 문구가 '이 항목의 기본 구매처로 저장'이 아니다(낱말은 구매처, 결정 B)`)
  if (!/saveVendorAsDefault: vendorDiffers && saveVendorDefault,/.test(m)) violations.push(`${MODAL}. 숨은 체크가 실려 간다(보일 때만 싣는다)`)
  if (!/onDone\(\{ templateVendorUndo: res\.templateVendorUndo \}\)/.test(m)) violations.push(`${MODAL}. 적용취소 토큰을 부르는 쪽에 넘기지 않는다`)
  if (!/label: '구매처 적용취소'/.test(m) || !/undoRecurringTemplateVendor\(u\)/.test(m)) violations.push(`${MODAL}. 기록 토스트에 기본 구매처 적용취소가 없다`)
  if (/confirmDialog\([^)]*기본 구매처/.test(m)) violations.push(`${MODAL}. 기본 구매처 저장에 확인창을 띄운다(§14, 토스트 적용취소로 한다)`)
}

// ── ⓓ 두 호출부 ─────────────────────────────────────────────────
for (const [f, src, list] of [[FC, fc, 'vendorSuggestions'], [DC, dc, 'recVendors']]) {
  const at = src.indexOf('<RecurringExpenseRecordModal')
  const tag = at < 0 ? '' : src.slice(at, src.indexOf('/>', at))
  if (!tag) { violations.push(`${f}. 기록 모달 호출을 못 찾았다`); continue }
  if (!new RegExp(`vendorSuggestions=\\{${list}\\}`).test(tag)) violations.push(`${f}. 기록 모달에 구매처 자동완성 목록을 안 넘긴다`)
  if (!/onDone=\{done => \{[^\n]*pushRecurringRecordedToast\(done,/.test(tag)) violations.push(`${f}. 기록 토스트가 정본(pushRecurringRecordedToast)이 아니다(기본 구매처 적용취소가 빠진다)`)
}
if (!/getExpenseVendorSuggestions\(\)\.catch\(/.test(dc)) violations.push(`${DC}. 홈 알림 경로가 구매처 후보를 받지 않거나 실패를 삼키지 않는다(후보 때문에 폼이 안 열리면 안 된다)`)

// ── ⓔ 재무 고정 지출 관리 폼 ─────────────────────────────────────
{
  const f = strip(fc)
  if (!/const \[recMgmtForm, setRecMgmtForm\]\s*= useState\(\{[^\n]*payMethod: '', vendor: '',/.test(f)) violations.push(`${FC}. 관리 폼 초기 상태에 vendor 가 없다`)
  if ((f.match(/setRecMgmtForm\(\{ title: '', [^\n]*vendor: '',/g) ?? []).length !== 1) violations.push(`${FC}. 새 항목 폼이 vendor 를 비워 열지 않는다`)
  if (!/setRecMgmtForm\(\{ title: r\.title,[^\n]*vendor: r\.vendor \?\? '',/.test(f)) violations.push(`${FC}. 수정 폼이 항목 구매처를 채워 열지 않는다(채우지 않으면 저장 한 번에 환경설정 값이 지워진다)`)
  const save = f.match(/\n  const handleSaveRecMgmt = \(\) => \{[\s\S]*?\n  \}\n/)?.[0] ?? ''
  if (!/vendor: recMgmtForm\.vendor\.trim\(\) \|\| null,/.test(save)) violations.push(`${FC} handleSaveRecMgmt. 구매처를 싣지 않거나 빈 칸을 null 로 싣지 않는다`)
  if (!/askRecurringVendorBackfill\(\{ recurringExpenseId: editing\.id, prevVendor: editing\.vendor, nextVendor: data\.vendor,/.test(save)) violations.push(`${FC} handleSaveRecMgmt. 구매처를 새로 적은 저장 뒤 과거 빈 구매처 소급을 묻지 않는다(결정 D)`)
  if (!/value=\{recMgmtForm\.vendor\}/.test(f)) violations.push(`${FC}. 관리 폼에 구매처 칸이 없다`)
  if (/거래처는 이 폼에 칸이 없어/.test(fc)) violations.push(`${FC}. '거래처는 이 폼에 칸이 없어' 옛 주석이 남았다(칸이 생겼다)`)
}
// 환경설정 고정지출 폼도 같은 정본으로 소급을 묻는다(결정 D, 두 관리 폼).
{
  const save = strip(sf).match(/\n  const handleSaveRec = \(\) => \{[\s\S]*?\n  \}\n/)?.[0] ?? ''
  if (!/import \{ askRecurringVendorBackfill \} from '@\/app\/\(app\)\/finance\/recurringVendorBackfillAsk'/.test(sf)) violations.push(`${SF}. 소급 묻기 정본(askRecurringVendorBackfill)을 가져오지 않는다`)
  if (!/if \(editingRec\) void askRecurringVendorBackfill\(\{ recurringExpenseId: editingRec\.id, prevVendor: editingRec\.vendor, nextVendor: data\.vendor,/.test(save)) violations.push(`${SF} handleSaveRec. 구매처를 새로 적은 저장 뒤 과거 빈 구매처 소급을 묻지 않는다(결정 D)`)
  const okAt = save.indexOf("showToast(editingRec ? '고정 지출 수정됨'"), askAt = save.indexOf('askRecurringVendorBackfill(')
  if (okAt < 0 || askAt < okAt) violations.push(`${SF} handleSaveRec. 소급 묻기가 저장 성공 뒤가 아니다(실패한 저장에 묻는다)`)
}

// ── ⓕ 허용 칸 표 ─────────────────────────────────────────────────
if (!/payMethod: 'string\?', vendor: 'string\?'/.test(read('app/(app)/settings/actions.ts'))) violations.push("app/(app)/settings/actions.ts. RECURRING_FIELDS 에 vendor: 'string?' 가 없다(두 폼의 구매처 저장이 버려진다)")

// ── ⓖ 소급 ───────────────────────────────────────────────────────
must(FA, fa, 'backfillRecurringVendor', [
  [/"propertyId" = \$\{propertyId\}::uuid AND "recurringExpenseId" = \$\{recurringExpenseId\}::uuid AND "vendor" IS NULL/, '소급 대상을 { 영업장, 이 항목, 구매처 빈 행 } 으로 좁히지 않는다'],
  [/RETURNING "id"/, '실제로 채운 행 id 를 돌려받지 않는다(토큰에 그사이 채워진 행이 섞인다)'],
  [/signFieldUndo\(propertyId, 'recurring-vendor-backfill',/, "적용취소 토큰을 용도 라벨 'recurring-vendor-backfill' 로 서명하지 않는다"],
  [/recurringExpense\.findFirst\(\{ where: \{ id: recurringExpenseId, propertyId \}/, '채울 값을 영업장 범위로 읽은 항목 구매처에서 가져오지 않는다'],
], [
  [/\b(detail|memo|title)\b/, '제목·메모에서 이름을 뽑아 채운다(금지, 운영자 결정 D)'],
])
must(FA, fa, 'countRecurringVendorBackfill', [
  [/expense\.count\(\{ where: \{ propertyId, recurringExpenseId, vendor: null \} \}\)/, '묻기 전 건수를 같은 대상으로 세지 않는다'],
  [/isChannelName\(rec\.vendor, await loadChannelNames\(propertyId\)\)\) return \{ ok: true, count: 0/, '항목 구매처가 쇼핑몰 목록 이름인데 소급을 묻는다'],
])
must(FA, fa, 'backfillRecurringVendor', [
  [/isChannelName\(vendor, await loadChannelNames\(propertyId\)\)\) return \{ ok: false, error: RECURRING_VENDOR_CHANNEL_DENIED \}/, '항목 구매처가 쇼핑몰 목록 이름인데 소급한다(목록이 판매자 자동 기능의 경계다)'],
])
if (!/if \(!next \|\| next === prev\) return/.test(ask) || !/c\.count === 0/.test(ask)) violations.push(`${ASK}. 새로 적은 값이 없거나 0건인데 묻는다`)
if (!/undoExpenseFieldChange\(undo\)/.test(ask)) violations.push(`${ASK}. 소급 토스트에 적용취소가 없다`)
if (!/'recurring-vendor-backfill': 'expense-recurring-vendor-backfill-v1'/.test(read('lib/expenseFieldUndo.ts'))) violations.push("lib/expenseFieldUndo.ts. 소급 용도 라벨이 없다")

// ── ⓗ 자리표시·캡션 세 자리 ──────────────────────────────────────
{
  const PH = 'placeholder="예: 한국전력, KT"'
  const CAP = '기록되는 지출의 구매처로 자동 입력됩니다.'
  for (const [f, src] of [[SF, sf], [FC, fc], [MODAL, modal]]) {
    if (!src.includes(PH)) violations.push(`${f}. 고정지출 구매처 자리표시가 '예: 한국전력, KT' 가 아니다(세 자리 같은 글자, 결정 B)`)
    if (/예: 한국전력, 아리수/.test(src)) violations.push(`${f}. 옛 자리표시('아리수')가 남았다`)
  }
  for (const [f, src] of [[SF, sf], [FC, fc]]) if (!src.includes(CAP)) violations.push(`${f}. 고정지출 폼 구매처 캡션이 '${CAP}' 가 아니다(두 폼 같은 글자)`)
}

// ── ⓘ 구매처 이름 변경이 항목까지 ────────────────────────────────
must(FA, fa, 'renameVendor', [
  [/tx\.recurringExpense\.findMany\(\{ where: \{ propertyId, vendor: oldName \}/, '같은 이름의 고정지출 항목을 같은 트랜잭션에서 찾지 않는다(다음 기록이 옛 이름으로 되살아난다)'],
  [/tx\.recurringExpense\.updateMany\(\{\s*where: \{ id: \{ in: recHit\.map\(r => r\.id\) \}, propertyId, vendor: oldName \}/, '항목 구매처를 영업장·옛 이름 조건으로 고치지 않는다'],
  [/recs\.map\(r => \(\{ id: r\.id, before: oldName, after: target \|\| null \}\)\)\)/, '적용취소 토큰에 항목 줄을 싣지 않는다'],
  [/recurringUpdated: recs\.length,/, '바꾼 고정 지출 항목 수를 돌려주지 않는다(화면이 말하지 못한다)'],
])
{
  // 이름 변경·합치기·비우기 토스트가 항목 수를 둘째 줄로 말한다(0개면 생략).
  const f = strip(fc)
  if ((f.match(/detail: recurringVendorFollowLine\(/g) ?? []).length !== 2) violations.push(`${FC}. 구매처 이름 변경·합치기 토스트가 따라 바뀐 고정 지출 항목 수를 둘째 줄로 말하지 않는다`)
  if (!/res\.recurringUpdated > 0 \?/.test(f) || !/recTotal > 0 \?/.test(f)) violations.push(`${FC}. 고정 지출 항목이 0개인데도 둘째 줄을 붙인다`)
}
must(FA, fa, 'undoExpenseFieldChange', [
  [/planRecurringVendorUndo\(u, recNow\)/, '적용취소가 항목 줄을 계획하지 않는다'],
  [/if \(!recPlan\) return 'recurring' as const/, "항목이 '쓴 직후'가 아니면 전부 안 하는 갈래가 없다"],
  [/if \(restored === 'recurring'\) return \{ ok: false, error: FIELD_UNDO_RECURRING_CONFLICT \}/, '항목 때문에 막힌 적용취소가 지출 탓 문장을 낸다(까닭이 틀린다)'],
  [/if \(\(u\.recurring \?\? \[\]\)\.length > 0\) \{ revalidatePath\('\/settings'\); revalidatePath\('\/dashboard'\) \}/, '항목 줄을 되돌리고도 환경설정·홈 화면을 갱신하지 않는다'],
  [/tx\.recurringExpense\.updateMany\(\{ where: \{ id: p\.id, propertyId \}, data: \{ vendor: p\.vendor \} \}\)/, '항목 구매처를 영업장 범위로 되돌리지 않는다'],
])

// ── ⓙ 목록 캡션 ─────────────────────────────────────────────────
{
  const fn = fc.match(/function fixedVendorCaption\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  if (!/if \(!e\.recurringExpenseId \|\| grouped \|\| !e\.detail \|\| !e\.vendor\) return null/.test(fn)) violations.push(`${FC}. 목록 구매처 캡션 판정이 '고정지출 행·묶음 아님·내역 있음'이 아니다(물품 행은 숨김 결정 7df4b16a)`)
  if (!/e\.detail\.trim\(\) === e\.vendor\.trim\(\) \? null : e\.vendor/.test(fn)) violations.push(`${FC}. 제목과 구매처가 같은데 캡션을 또 붙인다(같은 말 두 번)`)
  if ((fc.match(/fixedVendorCaption\(e, !!grp\)/g) ?? []).length !== 2) violations.push(`${FC}. 목록 구매처 캡션이 모바일 카드·데스크톱 표 두 자리에서 같은 판정을 안 쓴다`)
  if (/\{\[e\.vendor, e\.detail\]/.test(fc)) violations.push(`${FC}. 목록이 모든 행에 구매처를 다시 붙인다`)
}

// ── ⓚ 현황 ───────────────────────────────────────────────────────
{
  const s = read('app/(app)/finance/recurringStatus.ts')
  if (!/\n\s+vendor: string \| null\n/.test(s) || !/vendor:\s+re\.vendor \?\? null,/.test(s)) violations.push('app/(app)/finance/recurringStatus.ts. 현황이 항목 구매처를 싣지 않는다(모달 프리필이 빈다)')
}

// ── ⓛ 등록 ───────────────────────────────────────────────────────
{
  const pkg = JSON.parse(read('package.json') || '{}').scripts ?? {}
  if (!/node scripts\/check-recurring-vendor-wiring\.mjs/.test(pkg['verify:fast'] ?? '')) violations.push('package.json. verify:fast 에 이 그물이 없다')
  if (!/scripts\/test-recurring-vendor-flow\.ts/.test(pkg['verify:fast'] ?? '')) violations.push('package.json. verify:fast 에 통합(test-recurring-vendor-flow)이 없다')
  if (!/scripts\/check-recurring-vendor-drift\.mjs/.test(pkg['verify:db'] ?? '')) violations.push('package.json. verify:db 에 항목 구매처 갈림 경고(check-recurring-vendor-drift)가 없다')
  if (!/export async function auditRecurringVendorChannel\(/.test(read('scripts/recurring-vendor-audit.mjs')) || !/auditRecurringVendorChannel\(/.test(read('scripts/check-recurring-vendor-drift.mjs'))) violations.push('scripts/check-recurring-vendor-drift.mjs. 항목 구매처가 쇼핑몰 목록 이름인 경고 축이 없다')
}

console.log(`[고정지출 구매처 배선] 축 ⓐ~ⓛ / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  고정지출 구매처는 기록 모달·재무 관리 폼·환경설정 폼 세 자리가 같은 칸이다. 한 자리만 빠져도 그 길의 기록이 구매처를 잃는다.')
  process.exit(1)
}
