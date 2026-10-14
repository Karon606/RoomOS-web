// 수납 기록 삭제 확인창 정본 — 프리즘(PaymentRecordList)과 수납 모달(TenantClient)이 같은 문안을 쓴다.
// 문안이 두 벌이면 반드시 갈린다. 실제로 갈려 있었다 — 프리즘 쪽은 '이 수납 기록을 삭제할까요?' 한 줄에
// level 이 danger 였고(소프트삭제라 '되돌릴 수 없습니다'가 거짓말이 된다), 어느 달 매출이 얼마 바뀌는지
// 알려주지 않았다. 수납 모달 쪽만 고쳐진 상태였다.
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { fmtWon } from '@/lib/fmtMoney'
import { crDeleteConfirmLine } from '@/lib/cashReceiptCopy'

/**
 * 삭제해도 되는지 묻는다. 되돌릴 수 있으므로 level 은 caution 이다(danger 는 '되돌릴 수 없습니다'를 자동으로 붙인다).
 *
 * cr 은 삭제 미리보기(previewPaymentDelete)다(2026-10-13 422호 2단계). 이 삭제로 현금영수증 발행 기록이 함께
 * 지워지거나(drop), 발행은 남는데 받은 돈과 금액이 달라지면(keep) 본문 끝 줄(적용취소 안내) 앞에 그 사실을
 * 한 줄 덧붙인다. 422호에서 10,000원 선납을 지웠을 때 420,000원 발행이 말없이 남았다(결함 D2).
 * 금액은 fmtWon 한 곳을 지난다(가이드 §06, 인라인 toLocaleString()+'원' 금지).
 */
export function confirmDeletePayment(
  p: { targetMonth: string; actualAmount: number; isDeposit: boolean },
  cr?: Parameters<typeof crDeleteConfirmLine>[0],
): Promise<boolean> {
  const mon = Number(p.targetMonth.split('-')[1])
  const crLine = crDeleteConfirmLine(cr)
  const body = p.isDeposit
    ? '보증금 잔액이 그만큼 줄어듭니다. 환불 정산에도 그대로 반영됩니다.'
    : `${mon}월 매출이 ${fmtWon(p.actualAmount)} 줄고 그만큼 미수로 잡힙니다. 홈과 리포트의 ${mon}월 숫자도 함께 바뀝니다.`
  return confirmDialog({
    title: p.isDeposit
      ? `보증금 수납 ${fmtWon(p.actualAmount)}을 삭제할까요?`
      : `${mon}월분 수납 ${fmtWon(p.actualAmount)}을 삭제할까요?`,
    message: [body, crLine, '삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.'].filter(Boolean).join('\n'),
    level: 'caution', confirmLabel: '삭제',
  })
}
