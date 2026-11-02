// 배송비 결제수단·착불 미기록 판정 정본(lib/codShipping) 진리표. 실패 시 exit 1
// 실행: npx tsx scripts/test-cod-shipping.ts
//
// 왜(신고 6ab4f868·a016642e, 2026-11-02). 배송비 행이 본품의 결제수단을 복사해 착불 5건이 모두 신용카드·미정산으로 태어났다.
// 기본값(착불 = 계좌이체), '같은 수단' 의 뜻, 미기록 판정, 첫 수령 판정이 화면·서버·감지망에서 한 벌인지 본다.
import {
  SHIP_PAY_SAME, shipTypeLabel, defaultShipPay, sameShipPayLabel, resolveShipPay, isCodShipPending, asksCodAtReceipt,
} from '../lib/codShipping'
import { settleStatusForNew } from '../lib/settleStatus'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

// D 기본값 · 결제구분이 정한다
eq('D1 착불 = 계좌이체', defaultShipPay('착불'), { payMethod: '계좌이체', accountId: '' })
eq('D2 선불 = 구매와 같은 수단', defaultShipPay('선불'), { payMethod: SHIP_PAY_SAME, accountId: '' })
eq('D3 신용 = 구매와 같은 수단', defaultShipPay('신용'), { payMethod: SHIP_PAY_SAME, accountId: '' })
eq('D4 없음 = 구매와 같은 수단', defaultShipPay(null), { payMethod: SHIP_PAY_SAME, accountId: '' })

// L 첫 선택지 이름 · 계정 이름이 먼저, 없으면 수단
eq('L1 카드 이름', sameShipPayLabel({ payMethod: '신용카드', financeName: '하나카드' }), '구매와 같은 결제수단 (하나카드)')
eq('L2 이름 없으면 수단', sameShipPayLabel({ payMethod: '현금', financeName: '' }), '구매와 같은 결제수단 (현금)')
eq('L3 둘 다 없으면 괄호 없음', sameShipPayLabel({ payMethod: '', financeName: null }), '구매와 같은 결제수단')

// R 결제수단 해석 · '같은 수단'·빈 값은 머리 그대로(옛 화면이 보낸 값도), 다른 수단은 서버가 읽은 계정
const head = { payMethod: '신용카드', financialAccountId: 'acc-card', financeName: '하나카드' }
eq('R1 같은 수단', resolveShipPay(head, { payMethod: SHIP_PAY_SAME }, null), head)
eq('R2 빈 값(옛 화면)', resolveShipPay(head, null, null), head)
eq('R3 공백 값', resolveShipPay(head, { payMethod: '  ' }, null), head)
eq('R4 계좌이체 + 계정', resolveShipPay(head, { payMethod: '계좌이체', accountId: 'acc-bank' }, { id: 'acc-bank', name: '신한 (저축예금)' }),
  { payMethod: '계좌이체', financialAccountId: 'acc-bank', financeName: '신한 (저축예금)' })
eq('R5 현금(계정 없음)', resolveShipPay(head, { payMethod: '현금' }, null), { payMethod: '현금', financialAccountId: null, financeName: null })
eq('R6 머리 수단이 비면 계좌이체', resolveShipPay({ payMethod: null, financialAccountId: null, financeName: null }, null, null),
  { payMethod: '계좌이체', financialAccountId: null, financeName: null })

// S 정산상태는 배송비 행 자신의 수단으로(판정 정본 무변경). 본품이 신용카드여도 착불 계좌이체는 정산완료.
eq('S1 착불 계좌이체 = 정산완료', settleStatusForNew('계좌이체', { isShipping: true, shippingType: '착불' }), 'SETTLED')
eq('S2 착불 신용카드 = 미정산', settleStatusForNew('신용카드', { isShipping: true, shippingType: '착불' }), 'UNSETTLED')
eq('S3 후불 신용 = 미정산(수단 무관)', settleStatusForNew('계좌이체', { isShipping: true, shippingType: '신용' }), 'UNSETTLED')

// P 미기록 · 착불이고 배송비 행이 없다
eq('P1 착불 · 행 없음', isCodShipPending({ shippingType: '착불' }, 0), true)
eq('P2 착불 · 행 있음', isCodShipPending({ shippingType: '착불' }, 1), false)
eq('P3 선불 · 행 없음', isCodShipPending({ shippingType: '선불' }, 0), false)
eq('P4 결제구분 없음(없었음으로 닫힘)', isCodShipPending({ shippingType: null }, 0), false)
eq('P5 주문 없음', isCodShipPending(null, 0), false)

// A 수령 때 묻는가 · 미기록 착불 · 본품을 아직 하나도 안 받았다(첫 수령)
const r = (isShipping: boolean, received: boolean) => ({ isShipping, receivedAt: received ? new Date('2026-11-01T00:00:00Z') : null })
eq('A1 첫 수령', asksCodAtReceipt({ shippingType: '착불' }, [r(false, false), r(false, false)]), true)
eq('A2 하나 받은 뒤', asksCodAtReceipt({ shippingType: '착불' }, [r(false, true), r(false, false)]), false)
eq('A3 배송비 행이 이미 있음', asksCodAtReceipt({ shippingType: '착불' }, [r(false, false), r(true, false)]), false)
eq('A4 선불', asksCodAtReceipt({ shippingType: '선불' }, [r(false, false)]), false)
eq('A5 문자열 날짜도 받은 것', asksCodAtReceipt({ shippingType: '착불' }, [{ isShipping: false, receivedAt: '2026-11-01' }]), false)

// T 결제구분 화면 라벨 · 값 '신용' 은 그대로, 보이는 글자만 '후불'
eq('T1 신용은 후불', shipTypeLabel('신용'), '후불')
eq('T2 선불·착불 그대로', [shipTypeLabel('선불'), shipTypeLabel('착불')], ['선불', '착불'])
eq('T3 없음은 빈 글자', shipTypeLabel(null), '')

console.log(`[착불 배송비 판정] 통과 ${pass} · 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
