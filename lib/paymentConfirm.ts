// 수납 기록 삭제 확인창 정본 — 프리즘(PaymentRecordList)과 수납 모달(TenantClient)이 같은 문안을 쓴다.
// 문안이 두 벌이면 반드시 갈린다. 실제로 갈려 있었다 — 프리즘 쪽은 '이 수납 기록을 삭제할까요?' 한 줄에
// level 이 danger 였고(소프트삭제라 '되돌릴 수 없습니다'가 거짓말이 된다), 어느 달 매출이 얼마 바뀌는지
// 알려주지 않았다. 수납 모달 쪽만 고쳐진 상태였다.
import { confirmDialog } from '@/components/ui/ConfirmDialog'

/** 삭제해도 되는지 묻는다. 되돌릴 수 있으므로 level 은 caution 이다(danger 는 '되돌릴 수 없습니다'를 자동으로 붙인다). */
export function confirmDeletePayment(p: { targetMonth: string; actualAmount: number; isDeposit: boolean }): Promise<boolean> {
  const mon = Number(p.targetMonth.split('-')[1])
  const won = p.actualAmount.toLocaleString()
  return confirmDialog({
    title: p.isDeposit
      ? `보증금 수납 ${won}원을 삭제할까요?`
      : `${mon}월분 수납 ${won}원을 삭제할까요?`,
    message: p.isDeposit
      ? '보증금 잔액이 그만큼 줄어듭니다. 환불 정산에도 그대로 반영됩니다.\n삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.'
      : `${mon}월 매출이 ${won}원 줄고 그만큼 미수로 잡힙니다. 홈과 리포트의 ${mon}월 숫자도 함께 바뀝니다.\n삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.`,
    level: 'caution', confirmLabel: '삭제',
  })
}
