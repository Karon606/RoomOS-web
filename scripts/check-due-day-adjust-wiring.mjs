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

console.log(`[납입일 변경 조정 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
