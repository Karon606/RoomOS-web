// 납입일 변경 조정 행 배선 감지. 진리표·통합이 못 보는 화면·배선 자리를 글자로 본다. 실행: node scripts/check-due-day-adjust-wiring.mjs
//
// 왜 필요한가(신고 df82ce57, 2026-10-20). 판정 함수(lib/dueDayAdjust)가 맞아도 화면이 조정 행을 다시 일반 수납 행으로
// 그리거나, 기계 키 정규식 사본이 다시 생기면 같은 사고가 돌아온다. 서버 문은 통합 하네스가 보고, 여기는 그 밖이다.
//
// 잡는 것.
//   ① 기계 키 '[납입일변경]' 글자는 정본(lib/dueDayAdjust)과 테스트·이 그물 밖에 없다(사본 정규식 재발 차단).
//   ② 수납 정보 목록(PaymentRecordList)과 입주자 수납 모달(TenantClient)이 같은 묶음 컴포넌트(DueDayAdjustList)를 쓴다.
//      PaymentRecordList 는 일반 행 목록에서 조정 행을 뺀다.
//   ③ 묶음 컴포넌트는 전용 문(updateDueDayAdjust)으로 저장하고 적용취소(undoPaymentEdit)를 단다. 금액 칸은 정본 MoneyInput,
//      방향은 SegmentedControl. 납부일·방법·현금영수증 칸이 없다.
//   ④ 서버 배선. updatePayment 가 paymentEditGuard 를, 현금영수증 켜기·미리보기가 조정 행 거절을, 실입금·발행 키·후보가
//      조정 행 제외를, 감사가 부호 축을 부른다. 납입일 변경이 협의 금액을 정본 planDueDayAdjustCreate 로 넘긴다.
//   ⑤ 입주달 이중 셈 봉합(운영자 승인 2026-10-20 방안 2). 엔진의 첫 달 규칙이 firstMonthRuleDueDay 로 재고, 입력 칸
//      dueDayAdjusts 가 필수이며, 쿼리 없이 고르는 수납 관리 조회가 조정 행을 달과 무관하게 싣는다(고르는 전제).
//      엔진을 부르는 파일은 조정 행을 정본(lib/dueDayAdjust)으로 채운다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = f => readFileSync(f, 'utf8')
const fails = []
const need = (name, cond) => { if (!cond) fails.push(name) }
// 주석은 안 본다. "부른다"고 적힌 설명이 검사를 통과시키면 그물이 아니라 장식이다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const end = src.indexOf('\n}\n', start + header.length)
  return src.slice(start, end < 0 ? src.length : end + 2)
}

// ── ① 기계 키 글자는 정본에만 ───────────────────────────────────────
const ALLOWED = new Set(['lib/dueDayAdjust.ts'])
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/ \d\.(ts|tsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}
for (const f of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  if (ALLOWED.has(f)) continue
  const src = strip(read(f))
  if (src.includes('[납입일변경]') || src.includes('\\[납입일변경\\]')) fails.push(`${f} : 기계 키 '[납입일변경]' 를 손으로 적었다. lib/dueDayAdjust 의 함수를 쓴다`)
}

// ── ② 두 화면이 같은 묶음 ───────────────────────────────────────────
const prl = strip(read('components/entity-modal/widgets/PaymentRecordList.tsx'))
need('PaymentRecordList 가 DueDayAdjustList 를 그린다', /<DueDayAdjustList[\s>]/.test(prl))
need('PaymentRecordList 의 일반 행 목록이 조정 행을 뺀다(regularRows = …!isDueDayAdjust)', /regularRows\s*=\s*records\.filter\(r => !isDueDayAdjust\(r\.memo\)\)/.test(prl) && /regularRows\.map\(/.test(prl))
need('PaymentRecordList 가 요약 화면에서 묶음을 읽기 전용으로 둔다', /readOnly=\{cashReceiptOnly\}/.test(prl))
const tc = strip(read('app/(app)/tenants/TenantClient.tsx'))
need('TenantClient 가 DueDayAdjustList 를 그린다', /<DueDayAdjustList[\s>]/.test(tc))
need('TenantClient 가 조정 행 손그림(추가납부 필요/과입금 처리)을 되살리지 않았다', !/추가납부 필요|과입금 처리/.test(tc))

// ── ③ 묶음 컴포넌트 ─────────────────────────────────────────────────
const dal = strip(read('components/entity-modal/widgets/DueDayAdjustList.tsx'))
need('묶음이 전용 문 updateDueDayAdjust 로 저장한다', /updateDueDayAdjust\(/.test(dal))
need('묶음이 updatePayment 를 부르지 않는다', !/updatePayment\(/.test(dal))
need('묶음 저장 토스트에 적용취소(undoPaymentEdit)', /label: '적용취소'/.test(dal) && /undoPaymentEdit\(undo\)/.test(dal))
need('금액 칸은 정본 MoneyInput', /<MoneyInput /.test(dal))
need('방향은 SegmentedControl', /<SegmentedControl /.test(dal))
need('조정 행 수정 폼에 납부일·방법·현금영수증 칸이 없다', !/DatePicker|<select|현금영수증/.test(dal))
need('금액 표시는 fmtWon(§06 U+2212)', /fmtWon\(p\.actualAmount\)/.test(dal))

// ── ④ 서버 배선 ────────────────────────────────────────────────────
const rooms = read('app/(app)/rooms/actions.ts')
need('updatePayment 가 paymentEditGuard 를 부르고 그 거절로 돌아간다', (() => { const b = body(rooms, 'export async function updatePayment('); return /paymentEditGuard\(\{ currentMemo: record\.memo/.test(b) && /if \(guard\) return \{ ok: false, error: guard \}/.test(b) })())
need('setCashReceiptIssued 가 조정 행 켜기를 거절한다', /issued && isDueDayAdjust\(record\.memo\)\) return \{ ok: false, error: DUE_DAY_ADJUST_CR_REFUSED \}/.test(body(rooms, 'export async function setCashReceiptIssued(')))
need('previewCashReceiptOn 이 조정 행을 거절한다', /isDueDayAdjust\(record\.memo\)\) return \{ ok: false, error: DUE_DAY_ADJUST_CR_REFUSED \}/.test(body(rooms, 'export async function previewCashReceiptOn(')))
need('updateDueDayAdjust 가 requireEdit·영업장 범위·정본 판정을 지난다', (() => { const b = body(rooms, 'export async function updateDueDayAdjust('); return /await requireEdit\(\)/.test(b) && /where: \{ id: paymentId, propertyId \}/.test(b) && /planDueDayAdjustEdit\(/.test(b) && /signPaymentEditUndo\(/.test(b) })())
need('현금영수증 후보가 조정 행을 뺀다', /payDate: payWindow, \.\.\.notDueDayAdjustWhere\(\)/.test(body(rooms, 'export async function getCashReceiptTabRows(')))
const crl = read('app/(app)/rooms/cashReceiptLine.ts')
need('발행 키(readCrKey)가 조정 행을 뺀다', /isBillingAdjust: false, deletedAt: null, \.\.\.notDueDayAdjustWhere\(\)/.test(body(crl, 'export async function readCrKey(')))
need('행 캡션 키(crKeyInfoForLease)가 조정 행을 뺀다', /\.\.\.notDueDayAdjustWhere\(\)/.test(body(crl, 'export async function crKeyInfoForLease(')))
const rp = read('lib/rentPaid.ts')
need('실입금 판정이 조정 행을 뺀다', /!isDueDayAdjust\(r\.memo\)/.test(rp) && /\.\.\.notDueDayAdjustWhere\(\)/.test(rp))
const gd = strip(read('app/(app)/dashboard/getDashboardData.ts'))
need('홈 현금영수증 미발행 알림(crPays)이 조정 행을 뺀다', /actualAmount: \{ gt: 0 \}, \.\.\.notDueDayAdjustWhere\(\) \}/.test(gd))
need('홈 활동 피드가 정본 조각으로 조정 행만 뺀다(null 메모 살림)', !/NOT: \{ memo:/.test(gd) && !/NOT: dueDayAdjustWhere\(\)/.test(gd))
need('카드 합계가 같은 집합을 쓴다', /\.\.\.notDueDayAdjustWhere\(\),\n\s*\},\n\s*select: \{ actualAmount: true, payMethod: true, payDate: true, isBillingAdjust: true \}/.test(body(rooms, 'export async function getMonthPaymentAggregates(')))
for (const fn of ['savePayment', 'saveDepositPayment', 'saveCleaningFeePayment', 'saveReservationDeposit', 'recordDepositReceived', 'saveDepositPaymentForLease']) {
  need(`${fn} 가 메모 기계 키를 거절한다(paymentMemoGuard)`, /paymentMemoGuard\(/.test(body(rooms, `export async function ${fn}(`)))
}
need('조정 묶음 행 아래 표시가 방향 조각을 뗀다(dueDayAdjustDisplayLabel)', /dueDayAdjustDisplayLabel\(p\.memo\)/.test(dal))
need('감사 규칙 9(부호 축)', /dueDayAdjustSignMismatch\(r\)/.test(read('lib/integrityAudit.ts')))
const ten = read('app/(app)/tenants/actions.ts')
need('납입일 변경이 협의 금액을 정본으로 넘긴다', /planDueDayAdjustCreate\(\{[^}]*agreedAmount: agreedAmount \?\? null/.test(body(ten, 'export async function changeDueDay(')))
const w = strip(read('components/entity-modal/widgets/DueDayPermanentChangeWidget.tsx'))
need('납입일 변경 위젯에 협의 금액 칸(MoneyInput)과 전달', /<MoneyInput /.test(w) && /changeDueDay\(leaseTermId, input\.trim\(\), targetMonth, adjustAmount, agreed > 0 \? agreed : null\)/.test(w))

// ── ⑤ 입주달 이중 셈 봉합 ──────────────────────────────────────────
const billing = strip(read('lib/billing.ts'))
need('BillingLeaseFields.dueDayAdjusts 가 필수 칸이다', /\n\s*dueDayAdjusts: readonly BillingDueDayAdjust\[\]/.test(billing))
need('billForLeaseMonth 의 첫 달 규칙이 firstMonthRuleDueDay 로 잰다', /const ruleDue = firstMonthRuleDueDay\(l\)/.test(body(billing, 'export function billForLeaseMonth(')) && /firstMonthGap\(l\.moveInDate, ruleDue\)/.test(body(billing, 'export function billForLeaseMonth(')) && !/firstMonthGap\(l\.moveInDate, l\.dueDay\)/.test(body(billing, 'export function billForLeaseMonth(')))
need('getRoomPaymentStatus 조회가 조정 행을 달과 무관하게 싣는다(dueDayAdjustsFrom 의 전제)', /OR: \[[\s\S]*?dueDayAdjustWhere\(\),[\s\S]*?\]/.test(body(strip(rooms), 'export async function getRoomPaymentStatus(')) && /dueDayAdjusts: dueDayAdjustsFrom\(allLeaseRecords\)/.test(strip(rooms)))
for (const f of ['app/(app)/rooms/actions.ts', 'app/(app)/rooms/paymentEngine.ts', 'app/(app)/dashboard/getDashboardData.ts', 'app/(app)/dashboard/unpaid.ts', 'app/(app)/report/actions.ts', 'app/api/calendar/[token]/route.ts', 'app/api/export/route.ts', 'app/rent-receipt/[tenantId]/actions.ts', 'lib/integrityAudit.ts', 'lib/leaseStatus.ts']) {
  const src = strip(read(f))
  need(`${f} 가 청구 엔진에 조정 행을 정본으로 채운다`, /billForLeaseMonth\(/.test(src) && /(attachDueDayAdjusts|attachDueDayAdjustsOne|withDueDayAdjusts|dueDayAdjustsFrom|loadDueDayAdjustMap)\(/.test(src))
}

// ⑤-2 지도를 읽었으면 그 지도를 넘긴다. withDueDayAdjusts(x, new Map()) 같은 빈 지도·다른 값을 넘기면 타입은 통과하고
// 조정 행만 조용히 사라진다(독립 검수 2026-10-20 역주입). loadDueDayAdjustMap 결과에 묶인 이름만 둘째 인자로 허용한다.
// 묶임은 두 모양이다. ① const p = loadDueDayAdjustMap(…) 뒤 const m = await p ② const [a, …, m] = await Promise.all([…, loadDueDayAdjustMap(…)])(같은 자리).
function splitTop(src) {   // 최상위 쉼표로 나눈다(괄호·문자열 깊이 고려)
  const out = []; let depth = 0, cur = '', q = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { cur += c; if (c === '\\') { cur += src[++i] ?? ''; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue }
    if ('([{'.includes(c)) depth++
    if (')]}'.includes(c)) depth--
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out.map(x => x.trim())
}
function closeOf(src, open) {   // src[open] 이 여는 괄호일 때 짝 닫는 자리
  let depth = 0, q = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if ('([{'.includes(c)) depth++
    if (')]}'.includes(c)) { depth--; if (depth === 0) return i }
  }
  return -1
}
function loaderBound(src) {
  const names = new Set()
  for (const m of src.matchAll(/const (\w+) = loadDueDayAdjustMap\(/g)) {
    for (const a of src.matchAll(new RegExp(`const (\\w+) = await ${m[1]}\\b`, 'g'))) names.add(a[1])
  }
  for (const m of src.matchAll(/const \[([^\]]*)\] = await Promise\.all\(\[/g)) {
    const lhs = splitTop(m[1])
    const open = m.index + m[0].length - 1
    const rhs = splitTop(src.slice(open + 1, closeOf(src, open)))
    rhs.forEach((e, i) => { if (/^loadDueDayAdjustMap\(/.test(e) && lhs[i]) names.add(lhs[i]) })
  }
  return names
}
const ENGINE_MAP_FILES = ['app/(app)/dashboard/unpaid.ts', 'app/(app)/dashboard/getDashboardData.ts', 'lib/leaseStatus.ts', 'app/(app)/report/actions.ts', 'app/api/calendar/[token]/route.ts', 'app/api/export/route.ts']
for (const f of walkSrc()) {
  const src = strip(read(f))
  if (!/loadDueDayAdjustMap\(/.test(src) && !/withDueDayAdjusts\(/.test(src)) continue
  if (f === 'lib/dueDayAdjust.ts') continue
  const bound = loaderBound(src)
  const calls = [...src.matchAll(/withDueDayAdjusts\(/g)]
  need(`${f} : loadDueDayAdjustMap 결과를 이름에 묶어 쓴다`, bound.size > 0)
  for (const c of calls) {
    const open = c.index + c[0].length - 1
    const args = splitTop(src.slice(open + 1, closeOf(src, open)))
    need(`${f} : withDueDayAdjusts 둘째 인자 '${args[1]}' 가 loadDueDayAdjustMap 결과다`, args.length === 2 && bound.has(args[1]))
  }
  for (const g of src.matchAll(/dueDayAdjusts: (\w+)\.get\(/g)) need(`${f} : 조정 행 .get 의 지도 '${g[1]}' 가 loadDueDayAdjustMap 결과다`, bound.has(g[1]))
  for (const n of bound) need(`${f} : 읽은 지도 '${n}' 를 쓴다`, new RegExp(`withDueDayAdjusts\\([^)]*\\b${n}\\b|${n}\\.get\\(`).test(src))
}
// 엔진 입력 칸에 손으로 넣는 값도 정본 출처여야 한다(빈 배열·새 지도 금지). 타입 선언 줄은 뺀다.
for (const f of walkSrc()) {
  if (f === 'lib/dueDayAdjust.ts' || f === 'lib/billing.ts') continue
  const src = strip(read(f))
  const bound = loaderBound(src)
  for (const m of src.matchAll(/dueDayAdjusts: ([^,\n}]+)/g)) {
    const v = m[1].trim()
    if (/^(readonly |BillingDueDayAdjust)/.test(v)) continue
    const ok = (/^(\w+)\.get\(/.test(v) && bound.has(v.match(/^(\w+)/)[1]))
      || /^dueDayAdjustsFrom\(/.test(v)
      || /^(lease|l)\.dueDayAdjusts$/.test(v)
    need(`${f} : 엔진 입력 dueDayAdjusts 에 정본 출처가 아닌 값 '${v}'`, ok)
  }
  if (/(?<![.\w])dueDayAdjusts,/.test(src)) need(`${f} : 축약형 dueDayAdjusts 는 dueDayAdjustsFrom 결과다`, /dueDayAdjusts = dueDayAdjustsFrom\(/.test(src))
}
for (const f of ENGINE_MAP_FILES) need(`${f} 가 화면 엔진 입력을 영업장 지도(loadDueDayAdjustMap)로 채운다`, /loadDueDayAdjustMap\(/.test(strip(read(f))))
function walkSrc() { return [...walk('app'), ...walk('lib'), ...walk('components')] }

// ⑤-3 실행 중 강제와 스크립트 전수. scripts 는 tsconfig 밖이라 필수 칸이 안 걸린다. 엔진이 입력 누락에 멈추고(?? [] 금지),
// 엔진을 부르는 스크립트는 정본으로 채운다(테스트는 리터럴에 빈 배열을 적는다).
need('billForLeaseMonth 가 입력 누락에 멈춘다(requireDueDayAdjusts)', /requireDueDayAdjusts\(l\)/.test(body(billing, 'export function billForLeaseMonth(')))
need('엔진이 조정 행 누락을 빈 배열로 덮지 않는다', !/dueDayAdjusts \?\? \[\]/.test(billing))
for (const f of readdirSync('scripts')) {
  if (!/\.(ts|mjs)$/.test(f) || / \d\.(ts|mjs)$/.test(f) || f.startsWith('test-') || f === 'check-due-day-adjust-wiring.mjs') continue
  const src = strip(read(join('scripts', f)))
  if (!/billForLeaseMonth\(/.test(src)) continue
  need(`scripts/${f} 가 엔진에 조정 행을 정본으로 채운다`, /(attachDueDayAdjusts|attachDueDayAdjustsOne|withDueDayAdjusts|dueDayAdjustsFrom)\(/.test(src))
}
// ⑤-4 종전 이중 셈으로 남는 모양을 감사가 알린다(규칙 10).
const audit = strip(read('lib/integrityAudit.ts'))
need('감사 규칙 10 이 firstMonthAdjustExposure 로 판정한다', /firstMonthAdjustExposure\(l, \{ moveInMonthLocked:/.test(audit) && /due-day-adjust-first-month/.test(audit))

console.log(`[납입일 변경 조정 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
