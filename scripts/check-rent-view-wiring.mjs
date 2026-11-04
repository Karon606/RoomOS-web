// 계약 정보 '월 이용료' 칸의 '할인 후' 금액 배선 감지망. 읽기 전용, 위반 시 exit 1.
//
// 운영자 요청(2026-11-04) "계약정보의 금액과 할인된 후의 금액 둘 다 표시되는게 안헷갈릴 것 같아", 승인 '추천대로'.
// 값은 서버 한 자리(getTenantDetail)가 정본(lib/rentView)으로 내리고 화면은 그리기만 한다. 진리표는 scripts/test-rent-view.ts.
//
// 축
//   ⓐ 화면 재계산 금지. TenantContractInfo 는 할인·기준액 계산 함수를 import 하지 않고 lease.rentAfterDiscount 만 그린다.
//      주 값은 lease.rentAmount 그대로다(계약서=정가).
//   ⓑ 서버 배선. getTenantDetail 이 rentAfterDiscountFor 를 부르고 금액 스코프(canMoney)가 거짓이면 null 이다.
//      할인 원시 배열은 응답에서 걷고(구조 분해로 빼내고 map 본문에서 다시 싣지 않는다), 방의 예약 인상 칸도 걷는다(stripRoomRentAxes).
//   ⓒ 정본 한 벌. lib/rentView 는 엔진 조각(effectiveBaseRent·discountForMonth·discountedRent)을 부르고, 할인 기간 판정·비율 반올림을
//      손으로 다시 쓰지 않는다. 일할·락이 섞이는 청구 함수(billForLeaseMonth·viewExpectedForMonth)도 부르지 않는다(요율이지 청구가 아니다).
//      줄은 할인 0 이거나 기준액이 계약 금액과 다르면(예약 가격 변경 틈) 서지 않는다(순수 할인일 때만).
//   ⓓ 표기. 위젯에 화살표(→)·취소선(line-through)이 없다. 두 값은 전환이 아니라 동시에 참인 사실이다(가이드 §06·§29).
//   ⓔ 보조 줄 글자. 가이드 §05 Caption(10.5px) 정본 클래스 text-[0.65625rem] 이고 수제 크기(text-[11px] 따위)가 아니다.
//
// 실행: node scripts/check-rent-view-wiring.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(join(ROOT, f), 'utf8'))
const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

// 함수 본문 하나(이름부터 다음 최상위 export 직전까지)
function fnBody(src, name) {
  const i = src.search(new RegExp(`export (async )?function ${name}\\b`))
  if (i < 0) return null
  const rest = src.slice(i + 1)
  const j = rest.search(/\n(export |async function |function )/)
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j)
}

// ⓐ
const W = 'components/entity-modal/widgets/TenantContractInfo.tsx'
const widget = read(W)
for (const banned of ['@/lib/rentView', '@/lib/rentDiscount', '@/lib/billing', '@/lib/roomMonth', 'discountedRent', 'discountForMonth', 'effectiveBaseRent', 'monthlyRentView', 'rentAfterDiscountFor', 'rentAfterDiscountLine']) {
  need(!widget.includes(banned), `ⓐ ${W} 가 '${banned}' 를 쓴다. 할인 후 금액은 서버가 내린 lease.rentAfterDiscount 만 그린다(화면 재계산 금지)`)
}
need(/rentAfterDiscount\?: number \| null/.test(widget), `ⓐ ${W} Lease 타입에 rentAfterDiscount?: number | null 이 없다`)
need(/lease\.rentAfterDiscount != null && \(/.test(widget), `ⓐ ${W} 보조 줄이 lease.rentAfterDiscount != null 조건 아래에 서지 않는다(할인 없는 계약이 지금과 달라진다)`)
need(/할인 후 <MoneyDisplay amount=\{lease\.rentAfterDiscount\} \/>/.test(widget), `ⓐ ${W} 보조 줄 '할인 후 <MoneyDisplay amount={lease.rentAfterDiscount} />' 가 없다`)
need(/<MoneyDisplay amount=\{lease\.rentAmount\} \/>/.test(widget), `ⓐ ${W} 월 이용료 주 값이 lease.rentAmount(계약 금액) 가 아니다`)
need((widget.match(/rentAfterDiscount/g) ?? []).length === 3, `ⓐ ${W} rentAfterDiscount 를 쓰는 자리가 타입·조건·값 셋이 아니다(다른 자리에서 값을 가공하지 말 것)`)

// ⓑ
const A = 'app/(app)/rooms/actions.ts'
const actions = read(A)
const detail = fnBody(actions, 'getTenantDetail')
need(!!detail, `ⓑ ${A} getTenantDetail 을 찾지 못했다`)
if (detail) {
  need(/const canMoney = canReadScope\(access\.role, 'money'\)/.test(detail), 'ⓑ getTenantDetail 이 금액 스코프를 보지 않는다')
  need(/rentAfterDiscount: canMoney \? rentAfterDiscountFor\(\{ \.\.\.l, discounts, room \}, todayMonth\) : null,/.test(detail), 'ⓑ getTenantDetail 이 rentAfterDiscount 를 금액 스코프 아래에서 정본(rentAfterDiscountFor)으로 내지 않는다')
  need(/row\.leaseTerms\.map\(\(\{ discounts, room, \.\.\.l \}\) => \(\{/.test(detail), 'ⓑ getTenantDetail 이 할인 원시 배열을 응답에서 걷지 않는다(구조 분해로 빼낼 것)')
  need(/room: room \? stripRoomRentAxes\(room\) : room,/.test(detail), 'ⓑ getTenantDetail 이 방의 예약 인상 칸을 응답에서 걷지 않는다')
  // 구조 분해로 빼낸 뒤 map 본문에서 다시 싣는 꼴(discounts, · discounts: · ...discounts)도 막는다. 정본 호출의 인자 하나만 허용한다.
  const mapBody = detail.match(/row\.leaseTerms\.map\(\(\{ discounts, room, \.\.\.l \}\) => \(\{([\s\S]*?)\n  \}\)\)/)?.[1]
  need(mapBody != null, 'ⓑ getTenantDetail 의 leaseTerms map 본문을 찾지 못했다')
  if (mapBody != null) {
    const rest = mapBody.replace('rentAfterDiscountFor({ ...l, discounts, room }, todayMonth)', '')
    need(!/\bdiscounts\b/.test(rest), 'ⓑ getTenantDetail 의 leaseTerms map 본문이 할인 원시 배열(discounts)을 응답에 다시 싣는다')
  }
  need(/const todayMonth = kstMonthStr\(\)/.test(detail), 'ⓑ getTenantDetail 의 기준 달이 KST 이번 달(kstMonthStr) 이 아니다')
  need(/discounts: \{ select: \{ discountType: true, value: true, scope: true, startMonth: true, endMonth: true \} \}/.test(detail), 'ⓑ getTenantDetail 이 할인 다섯 칸을 읽지 않는다')
  need(/scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true,/.test(detail), 'ⓑ getTenantDetail 이 방 예약 인상 두 축을 읽지 않는다(기준액이 엔진과 갈린다)')
}
need(/function stripRoomRentAxes[\s\S]{0,300}scheduledRent: _s, rentUpdateDate: _d, nonResidentScheduled: _ns, nonResidentRentDate: _nd, \.\.\.rest/.test(actions), 'ⓑ stripRoomRentAxes 가 예약 인상 네 칸을 모두 걷지 않는다')

// ⓒ
const L = 'lib/rentView.ts'
const lib = read(L)
const view = fnBody(lib, 'monthlyRentView') ?? ''
need(/const base = effectiveBaseRent\(lease, mon\)/.test(view), 'ⓒ monthlyRentView 의 기준액이 effectiveBaseRent 가 아니다')
need(/discount: discountForMonth\(lease\.discounts, mon, base\)/.test(view), 'ⓒ monthlyRentView 의 할인 합계가 discountForMonth 가 아니다')
need(/net: discountedRent\(lease\.discounts, mon, base\)/.test(view), 'ⓒ monthlyRentView 의 할인 후가 discountedRent 가 아니다')
for (const [re, msg] of [
  [/scope === 'permanent'|scope === "permanent"|\.startMonth|\.endMonth/, '할인 기간 판정을 손으로 다시 쓴다(lib/rentDiscount 한 벌)'],
  [/Math\.round/, '비율 반올림을 손으로 다시 쓴다'],
  [/billForLeaseMonth|viewExpectedForMonth|checkoutProrated/, '일할·락이 섞이는 청구 값을 쓴다(요율이지 청구가 아니다)'],
]) need(!re.test(lib), `ⓒ ${L} 가 ${msg}`)
const line = fnBody(lib, 'rentAfterDiscountLine') ?? ''
need(/if \(view\.discount <= 0\) return null/.test(line), 'ⓒ rentAfterDiscountLine 이 할인 없는 달에 줄을 세운다')
need(/if \(view\.base !== contract\) return null/.test(line), "ⓒ rentAfterDiscountLine 이 기준액이 계약 금액과 다른 달(예약 가격 변경 틈)에 줄을 세운다. 가격 변경이 할인처럼 읽힌다('할인 후 42만원' 이 5만원 할인으로)")

// ⓓ ⓔ (주석 포함 원문에서 본다. 화면 글자는 주석이 아니어도 리터럴로 들어온다)
const widgetRaw = strip(readFileSync(join(ROOT, W), 'utf8'))
need(!widgetRaw.includes('→'), `ⓓ ${W} 에 화살표(→)가 있다`)
need(!/line-through/.test(widgetRaw), `ⓓ ${W} 에 취소선(line-through)이 있다`)
const sub = widgetRaw.match(/<p className="([^"]*)">할인 후 /)
need(!!sub && sub[1].includes('text-[0.65625rem]'), `ⓔ ${W} 보조 줄이 Caption 10.5px(text-[0.65625rem]) 가 아니다`)
need(!!sub && !/text-\[\d+px\]/.test(sub[1]), `ⓔ ${W} 보조 줄에 수제 크기가 있다`)

if (violations.length) {
  console.error(`[check-rent-view-wiring] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('[check-rent-view-wiring] ⓐ~ⓔ 통과')
