// 수납 등록 폼 한 벌·기본값 정본 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-11-04, 운영자 승인 '추천대로'). 입주자 상세 수납 모달이 따로 만든 폼으로 금액을 계약 이용료(정가)로
// 채웠고, 할인 달에 그대로 저장하면 할인액이 다음 달 선납으로 적혔다(404·514·509호). 정본 폼(PaymentEntryForm)으로
// 바꾸고 기본값을 lib/paymentSuggest 하나로 모았다. 따로 만든 저장부나 원가 기본값이 되살아나면 붉게 선다.
//
//   ⓐ TenantClient 에 수납 등록 저장 호출(savePayment·saveDepositPayment·setPaymentCashReceipt)이 없다.
//   ⓑ 돈 칸 기본값에 rentAmount 를 쓰지 않는다(TenantClient·PaymentEntryForm·PaymentBody·lib/paymentSuggest).
//      정본 식은 lib 하나이고 폼은 그것을 부른다(조회월 잔액 -balance 를 기본값으로 쓰지 않는다).
//   ⓒ TenantClient 의 <PaymentEntryForm 은 한 곳이고 room 의 expected·balance 가 정산(paySettlement)에서 온다.
//   ⓓ 정산을 읽는 동안(paySettlement === undefined)에는 폼을 세우지 않는다.
//   ⓔ 정본 폼의 결제 수단 목록은 사람이 고르는 목록(MANUAL_PAY_METHODS)이다('보유 보증금' 제외).
//   ⓕ 입주자 수납 모달 '수납 등록' 버튼은 canEdit 아래에 서고, 투어 단계 계약은 버튼 대신 캡션이다.
//
// 실행: node scripts/check-pay-entry-single-form.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8'))
const TC = 'app/(app)/tenants/TenantClient.tsx'
const FORM = 'components/entity-modal/widgets/PaymentEntryForm.tsx'
const BODY = 'components/entity-modal/bodies/PaymentBody.tsx'
const LIB = 'lib/paymentSuggest.ts'
const tc = read(TC), form = read(FORM), body = read(BODY), lib = read(LIB)
const v = []
const need = (ok, msg) => { if (!ok) v.push(msg) }

// ⓐ
for (const fn of ['savePayment(', 'saveDepositPayment(', 'setPaymentCashReceipt(']) {
  need(!tc.includes(fn), `${TC}: ⓐ 수납 등록 저장부(${fn.slice(0, -1)})를 직접 부른다. 수납 등록은 정본 폼 한 벌이다.`)
}

// ⓑ
for (const [f, s] of [[TC, tc], [FORM, form], [BODY, body]]) {
  need(!/setPayAmount\([^)]*rentAmount/.test(s), `${f}: ⓑ 금액 칸을 rentAmount(원가)로 채운다.`)
  // 수납 금액 상태(pay*)만 본다. 계약 편집 폼의 이용료 칸(rentAmount 상태)은 원가가 정본인 자리다.
  need(!/\[\s*pay\w*,[^\]\n]*\]\s*=\s*useState[^\n]*rentAmount/.test(s), `${f}: ⓑ 수납 금액 상태 초깃값이 rentAmount(원가)다.`)
}
need(!/rentAmount|balance/.test(lib), `${LIB}: ⓑ 기본값 정본이 원가(rentAmount)나 조회월 잔액(balance)을 읽는다. 지난달 미납분 자리에 이번 달 정가가 뜬다(404호).`)
need(/export function suggestPayAmount\(/.test(lib), `${LIB}: ⓑ 정본 suggestPayAmount 가 없다.`)
need(/suggestPayAmount\(\{/.test(form), `${FORM}: ⓑ 추천 납입액이 정본(suggestPayAmount)을 부르지 않는다.`)
need(!/-room\.balance/.test(form), `${FORM}: ⓑ 추천 납입액을 조회월 잔액(-room.balance)으로 낸다. 정본은 lib/paymentSuggest 다.`)
need(/o\.duePassed/.test(lib), `${LIB}: ⓑ 자동 기본값이 기한 도래(duePassed)를 보지 않는다. 기한 전 이번 달 청구가 지난달 미납분에 섞인다.`)

// ⓒ
const forms = tc.split('<PaymentEntryForm').length - 1
need(forms === 1, `${TC}: ⓒ <PaymentEntryForm 이 ${forms}곳이다(기대 1). 예약·비예약 두 갈래를 한 폼으로 품는다.`)
const at = tc.indexOf('<PaymentEntryForm')
const blk = at < 0 ? '' : tc.slice(at, tc.indexOf('/>', tc.indexOf('onCancel=', at)))
need(/expected: paySettlement\.expected/.test(blk) && /balance: paySettlement\.balance/.test(blk), `${TC}: ⓒ 수납 폼 room 의 expected·balance 가 정산(paySettlement)에서 오지 않는다.`)
need(!/rentAmount/.test(blk), `${TC}: ⓒ 수납 폼 room 에 계약 이용료(rentAmount)가 들어간다.`)

// ⓓ
const before = at < 0 ? '' : tc.slice(Math.max(0, at - 400), at)
need(/paySettlement === undefined \?/.test(before) && /<SkeletonRows/.test(before), `${TC}: ⓓ 정산을 읽는 동안에도 수납 폼이 선다(읽기 전 값으로 기본값을 만든다).`)
need(/useState<PaySettlement \| null \| undefined>\(undefined\)/.test(tc), `${TC}: ⓓ 정산이 세 상태(읽는 중·없음·값)가 아니다.`)

// ⓔ
need(!/PAYMENT_METHODS\.map/.test(form), `${FORM}: ⓔ 결제 수단 목록이 PAYMENT_METHODS('보유 보증금' 포함)다.`)
need((form.match(/MANUAL_PAY_METHODS\.map/g) ?? []).length === 2, `${FORM}: ⓔ 결제 수단 두 자리(일반·예약금)가 MANUAL_PAY_METHODS 가 아니다.`)

// ⓕ
const lab = tc.search(/>\s*수납 등록\s*</)
const foot = lab < 0 ? '' : tc.slice(Math.max(0, lab - 900), lab)
need(lab >= 0, `${TC}: ⓕ '수납 등록' 버튼을 못 찾았다(침묵 통과 금지).`)
need(/\{canEdit && \(\s*<div className="border-t/.test(foot), `${TC}: ⓕ '수납 등록' 발끝이 canEdit 아래가 아니다(열람 역할에게 서버가 거절할 문이 선다, §27.8 ②).`)
need(/WAITING_TOUR[^\n]*TOUR_DONE[\s\S]*?<WhyCaption[^>]*>투어 단계 계약이라서 수납을 등록할 수 없습니다 · 예약으로 바꾸면 됩니다</.test(foot), `${TC}: ⓕ 투어 단계 계약에 등록 문 대신 캡션이 서지 않는다(G6).`)

console.log(`[수납 등록 폼 한 벌] ⓐ 저장부 · ⓑ 기본값 정본 · ⓒ 정산 room · ⓓ 로딩 · ⓔ 결제 수단 · ⓕ 권한·투어 / 위반 ${v.length}건`)
for (const m of v) console.log('  - ' + m)
if (v.length > 0) process.exit(1)
