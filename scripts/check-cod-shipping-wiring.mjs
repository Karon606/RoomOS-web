// 착불 배송비 배선 감지(정적) · 실행: node scripts/check-cod-shipping-wiring.mjs. 위반 시 exit 1
//
// 왜(신고 6ab4f868·a016642e, 2026-11-02). 진리표(test-cod-shipping)는 판정 함수만, 통합(test-cod-shipping-flow)은 서버 액션만 본다.
// 화면이 배송비 수단을 안 보내거나, 수령 자리가 칸을 안 세우거나, [수령 취소] 가 배송비 줄 조각을 안 넘기면 둘 다 통과한 채로
// 착불 배송비가 다시 신용카드로 태어나거나 지워지지 않는다. 그래서 그 자리들이 실제로 꽂혀 있는지 모양으로 본다.
//
// 축
//   ⓐ 등록(addExpense)의 배송비 줄은 자기 수단(shipPayForSave)이고 본품 수단을 복사하지 않는다
//   ⓑ 착불은 금액이 없어도 주문을 세운다(codPending), 배송비 줄은 금액이 있을 때만
//   ⓒ 등록 폼: 배송비 방식은 세그먼트(체크박스 금지), 배송비 수단 칸을 보낸다, 착불 금액 없이도 주문 칸을 보낸다
//   ⓓ 수정 폼 주문 묶기: 수단을 보내고, 배송비 줄 적용취소를 단다. 서버는 착불 줄의 날짜·귀속월을 덮지 않는다
//   ⓔ 수령 자리 셋(수령 대기 묶음·품목 상세 구매 카드·비품 수령 창)이 같은 칸(CodShipField)을 세우고 서버에 싣는다
//   ⓕ [수령 취소] 셋이 배송비 줄 조각을 넘긴다(소모품 전량·부분, 비품)
//   ⓖ 상세가 '배송비 미기록' 을 말하고 '없었음' 으로 닫는 길과 그 적용취소가 있다
//   ⓗ 주문 결제수단 갈림 그물(check-order-card-split)은 배송비 줄을 계속 뺀다(착불은 다른 것이 정상)
import { readFileSync } from 'node:fs'

const read = p => readFileSync(p, 'utf8')
const finance = read('app/(app)/finance/actions.ts')
const fclient = read('app/(app)/finance/FinanceClient.tsx')
const inv = read('app/(app)/inventory/actions.ts')
const iclient = read('app/(app)/inventory/InventoryClient.tsx')
const aact = read('app/(app)/inventory/assets/actions.ts')
const aclient = read('app/(app)/inventory/assets/AssetsClient.tsx')
const split = read('scripts/check-order-card-split.mjs')

const fails = []
const need = (name, cond) => { if (!cond) fails.push(name) }
const count = (s, re) => (s.match(re) ?? []).length
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const next = src.indexOf('\nexport async function', start + header.length)
  return src.slice(start, next < 0 ? src.length : next)
}

// ⓐ ⓑ
const add = body(finance, 'export async function addExpense(')
const shipBlock = add.slice(add.indexOf('const shippingCreate'), add.indexOf('if (multiItems) {', add.indexOf('const shippingCreate')))
need('ⓐ addExpense 가 배송비 수단을 shipPayForSave 로 정한다', /shipPayForSave\(propertyId,/.test(add))
need('ⓐ 배송비 줄은 shipPay.payMethod 를 쓴다', /payMethod:\s*shipPay\.payMethod/.test(shipBlock))
need('ⓐ 배송비 줄이 본품 수단을 복사하지 않는다', shipBlock.length > 0 && !/payMethod:\s*payMethod \|\| '계좌이체'/.test(shipBlock))
need('ⓑ 착불은 금액 없이도 주문을 세운다', /const codPending\s*=\s*orderShippingType === '착불'/.test(add) && /isOrderMode\s*=.*\|\|\s*codPending/.test(add))
need('ⓑ 배송비 줄은 금액이 있을 때만', /const shippingCreate = shipPay && orderShipping > 0/.test(add))

// ⓒ
need('ⓒ 등록 폼 배송비 방식은 세그먼트', /ariaLabel="배송비 기록 방식"/.test(fclient))
need('ⓒ 등록 폼에 배송비 방식 체크박스가 없다', !/checked=\{addHasShipping\}/.test(fclient) && !/checked=\{addOrderMode\}/.test(fclient))
need('ⓒ 등록 폼이 배송비 수단을 보낸다', /name="orderShipPayMethod"/.test(fclient) && /name="orderShipAccountId"/.test(fclient))
need('ⓒ 착불이면 금액 없이도 주문 칸을 보낸다', /const sendOrder = \(addOrderShipping \?\? 0\) > 0 \|\| cod/.test(fclient))
need('ⓒ 결제구분을 바꾸면 수단 기본값이 따라간다', count(fclient, /setAddShipPay\(defaultShipPay\(t\)\)/g) === 1)

// ⓓ
const attach = body(finance, 'export async function attachShippingToOrder(')
need('ⓓ 수정 폼이 배송비 수단을 보낸다', /attachShippingToOrder\(\{[^}]*shipPay: attachShipPay/.test(fclient))
need('ⓓ 수정 폼이 배송비 줄 적용취소를 단다', /undoAttachShipping\(su\)/.test(fclient))
need('ⓓ 서버가 고른 수단을 shipPayForSave 로 본다', /shipPayForSave\(propertyId,/.test(attach))
need('ⓓ 착불 줄은 날짜·귀속월을 덮지 않는다', /const keepDates = shipType === '착불'/.test(attach) && /keepDates \? \{\} : \{ date: rep\.date/.test(attach))

// ⓔ
need('ⓔ 수령 대기 묶음·구매 카드가 CodShipField 를 세운다', count(iclient, /<CodShipField /g) >= 2)
need('ⓔ 비품 수령 창이 CodShipField 를 세운다', count(aclient, /<CodShipField /g) >= 1)
need('ⓔ 수령 대기 묶음이 착불 칸 때문에도 자리를 연다', /missing\.length > 0 \|\| codOrders\.length > 0/.test(iclient))
need('ⓔ 비품 수령 창이 착불 카드에서도 열린다', /hasStores \|\| it\.codAsk/.test(aclient))
need('ⓔ 소모품 수령이 배송비를 서버에 싣는다', /confirmReceipt\(id, undefined, undefined, fills\?\.\[id\], c &&/.test(iclient) && /confirmReceipt\(expenseId, locationId, qty, fillQty, cod\)/.test(iclient))
need('ⓔ 비품 수령이 배송비를 서버에 싣는다', /codShip: \{ amount: cod\.amount!/.test(aclient))
need('ⓔ 서버 소모품 수령이 배송비 줄을 한 트랜잭션에', /codCreate \? \[prisma\.expense\.create\(\{ data: codCreate \}\)\]/.test(inv))
need('ⓔ 서버 비품 수령이 배송비 줄을 한 트랜잭션에', /ops\.push\(prisma\.expense\.create\(\{ data: codCreate\.data \}\)\)/.test(aact))

// ⓕ
need('ⓕ 수령 대기 묶음 [수령 취소] 가 조각을 넘긴다', /codShip: cs/.test(iclient))
need('ⓕ 구매 카드 [수령 취소] 가 조각을 넘긴다(전량·부분)', /undoPartialReceipt\(res\.undo, res\.codShipUndo \?\? null\)/.test(iclient) && /codShip: res\.codShipUndo/.test(iclient))
need('ⓕ 비품 [수령 취소] 가 조각을 넘긴다', /undoReceive\(undo, !!how\?\.assign, codUndo\)/.test(aclient))
need('ⓕ 서버 수령 취소가 같은 트랜잭션에서 줄을 지운다', count(inv, /deleteCodShipTx\(tx,/g) >= 2 && count(aact, /deleteCodShipTx\(tx,/g) >= 1)

// ⓖ
need('ⓖ 상세가 배송비 미기록을 말한다', /codPendingOf\(detailExp\) && \(\s*<span[^>]*>\s*\{COD_UNRECORDED\}/.test(fclient))
need('ⓖ 없었음으로 닫기와 적용취소', /closeCodShipping\(orderId\)/.test(fclient) && /undoCloseCodShipping\(orderId\)/.test(fclient))

// ⓗ
need('ⓗ 주문 결제수단 갈림 그물은 배송비 줄을 뺀다', /orderId: \{ not: null \}, isShipping: false/.test(split))

if (fails.length) {
  console.error(`[착불 배송비 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.error(`  ${f}`)
  process.exit(1)
}
console.log('[착불 배송비 배선] 축 ⓐ 배송비 줄 자기 수단 · ⓑ 착불 금액 없이 주문 · ⓒ 등록 폼 세그먼트·수단 칸 · ⓓ 수정 폼 묶기 수단·적용취소·날짜 · ⓔ 수령 자리 셋 · ⓕ 수령 취소 조각 · ⓖ 미기록·없었음 · ⓗ 갈림 그물 착불 예외 / 위반 0건')
