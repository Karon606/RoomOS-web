// 정산상태 회귀 — lib/settleStatus. 실행: npx tsx scripts/test-settle-status.ts
//
// 고정하는 것(운영자 신고 2026-09-25, 승인 같은 날). **카드에서 카드로 옮기는 것은 갈래가 안
// 바뀌는 일이고, 그때 정산완료는 살아남아야 한다.** 종전에는 두 수정 경로가 결제수단만 보고
// 다시 계산해 이미 빠져나간 돈이 미정산 합계에 되살아났다(이중 정산의 입구).
import { isCreditPay, settleStatusForNew, settleStatusForEdit } from '../lib/settleStatus'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  실패 ${name}\n    기대 ${want}\n    실제 ${got}`)
}

// 갈래 판정
eq('신용카드는 갚을 것', isCreditPay('신용카드'), true)
eq('체크카드는 즉시 빠진다', isCreditPay('체크카드'), false)
eq('계좌이체는 즉시 빠진다', isCreditPay('계좌이체'), false)
eq('빈 값', isCreditPay(null), false)

// 새로 만들 때 — 종전 규칙 그대로다(이 경로는 안 바뀐다)
eq('새 신용카드 지출은 미정산', settleStatusForNew('신용카드'), 'UNSETTLED')
eq('새 계좌이체 지출은 정산완료', settleStatusForNew('계좌이체'), 'SETTLED')

// **이 신고의 핵심** — 카드에서 카드로 옮겨도 정산완료는 지킨다
eq('카드→카드, 정산완료 유지', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '신용카드', current: 'SETTLED',
}), 'SETTLED')
eq('카드→카드, 미정산 유지', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '신용카드', current: 'UNSETTLED',
}), 'UNSETTLED')

// 갈래가 바뀔 때만 다시 계산한다
eq('신용카드→계좌이체는 정산완료로', settleStatusForEdit({
  prevPayMethod: '신용카드', nextPayMethod: '계좌이체', current: 'UNSETTLED',
}), 'SETTLED')
eq('계좌이체→신용카드는 미정산으로', settleStatusForEdit({
  prevPayMethod: '계좌이체', nextPayMethod: '신용카드', current: 'SETTLED',
}), 'UNSETTLED')

// 갈래가 같으면 결제수단 글자가 달라도 지킨다(체크카드·계좌이체 둘 다 즉시 결제다)
eq('체크카드→계좌이체, 상태 유지', settleStatusForEdit({
  prevPayMethod: '체크카드', nextPayMethod: '계좌이체', current: 'SETTLED',
}), 'SETTLED')

// 직전 결제수단을 모를 때(옛 행) — 갈래가 다르면 다시 계산한다
eq('직전이 없고 새로 신용카드면 미정산', settleStatusForEdit({
  prevPayMethod: null, nextPayMethod: '신용카드', current: 'SETTLED',
}), 'UNSETTLED')
eq('직전이 없고 새로 계좌이체면 지금 상태 유지', settleStatusForEdit({
  prevPayMethod: null, nextPayMethod: '계좌이체', current: 'UNSETTLED',
}), 'UNSETTLED')

console.log(`[정산상태] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
