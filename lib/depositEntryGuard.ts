// 보증금 수납 전 청소비 중복 확인 — 두 수납 폼(PaymentEntryForm·TenantClient)이 같은 경고를 쓴다.
// 사고(520호 김민정, 2026-08-10 운영자 확인): 입실 때 청소비 2만원을 이미 받았는데, 청소비가 포함된
// 보증금 5만원을 통째로 수납해 같은 2만원이 두 번 잡혔다. 앱이 아무 말도 하지 않았다.
// 차단이 아니라 확인이다 — 청소비를 보증금과 별도로 받는 영업장도 있으므로(멀티테넌트) 강제하지 않는다.
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { getDepositCompositionForLease } from '@/app/(app)/tenants/actions'
import { depositComposition } from '@/lib/depositComposition'
import { fmtWon } from '@/lib/fmtMoney'

/** 계속 진행해도 되면 true. 청소비를 이미 받았고 입력액이 현금 몫을 넘을 때만 확인창을 띄운다. */
export async function confirmDepositCleaningOverlap(input: {
  leaseTermId: string
  depositAmount: number   // 계약 보증금
  payAmount: number       // 지금 입력한 총액
  cleaningFee: number     // 계약 청소비 (0이면 확인 불요)
}): Promise<boolean> {
  if (input.cleaningFee <= 0 || input.payAmount <= 0) return true
  let comp
  try { comp = await getDepositCompositionForLease(input.leaseTermId) }
  catch { return true }   // 조회 실패가 수납을 막으면 안 된다 — 경고 없이 통과
  if (comp.cleaningPaid <= 0) return true
  // 청소비를 보증금과 별도로 받는 영업장에서는 이 경고 자체가 거짓이다(청소비는 보증금 몫이 아니다).
  // 그쪽의 초과 수납은 서버 가드(saveDepositPayment)가 잔여 기준으로 이미 막는다.
  if (!comp.cleaningFeeInDeposit) return true
  // 현금 몫은 기수령 보증금까지 빼야 한다. 안 빼면 현금 몫을 이미 받아 둔 계약에서
  // 청소비만큼을 또 넣어도 '몫 이내'로 보여 확인창이 조용히 넘어간다(설계 감사 F, 2026-08-10).
  // 판정식은 lib/depositComposition 정본 — 화면이 보고 있는 계약 보증금을 그대로 넣는다.
  const view = depositComposition({
    contractDeposit: input.depositAmount, depositPaid: comp.depositPaid,
    cleaningPaid: comp.cleaningPaid, cleaningFeeInDeposit: true,
  })
  const cashPortion = view.shortfall
  if (input.payAmount <= cashPortion) return true
  return confirmDialog({
    title: '청소비를 이미 받았습니다',
    message: `이 계약은 청소비 ${fmtWon(comp.cleaningPaid)}을 이미 받았습니다.\n`
      + `보증금 ${fmtWon(input.depositAmount)}에 청소비가 포함되는 방식이라면 현금으로 받을 몫은 ${fmtWon(cashPortion)}입니다.\n`
      + `${fmtWon(input.payAmount)}으로 계속할까요?`,
    level: 'caution', confirmLabel: '계속',
  })
}
