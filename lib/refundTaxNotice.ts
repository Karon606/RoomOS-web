// 이용료 환불 뒤 운영자가 홈택스·카드사에서 따로 해야 할 일을 문장으로 만드는 정본.
//
// 왜 여기 있는가. 앱과 국세청은 연동되지 않아 앱이 대신 취소해 줄 수 없고, 알려주는 것까지가
// 앱의 몫이다(운영자 확정 2026-08-01 — "홈택스에 취소하라고 알려주는 것 정도면 괜찮을 것 같은데").
//
// 그런데 그 문구가 입주자 관리 수정 화면 한 곳에만 손으로 적혀 있었다. 퇴실 처리는 홈 알림과
// 프리즘 위젯으로도 되는데, 그 둘은 서버가 돌려준 안내를 받아서 **버렸다.** 현금영수증을 발행한
// 계약을 홈 알림에서 퇴실 처리하면 앱 매출은 조용히 줄고 홈택스에는 원 금액이 살아 있는데
// 아무도 취소하라는 말을 못 듣는다. 519호 사례를 막으려고 세운 방어가 두 경로에서 비어 있었다
// (2026-08-31 패널 조사, knowledge/cash-receipt-refund.md).
//
// 그래서 문구를 여기 한 벌로 두고 세 경로가 같은 말을 하게 한다. 화면마다 손으로 적으면
// 언젠가 갈리고, 갈린 쪽은 아무도 눈치채지 못한다.

import { fmtWon } from './fmtMoney'

/** 환불 후 홈택스·카드사 조치 — 서버(finalizeRentRefund)가 만들어 준다. */
export type RefundTaxNotice = {
  // 취소할 발행 건들. **입금일이 아니라 발행일이고, 수납액이 아니라 발행액이다.**
  // 왜 날짜가 둘인가 — 운영자는 받은 날 바로 안 끊고 모아서 끊는다(실측 33건 중 29건이 다르다.
  // 2026-08-22 하루에 18건이 몰려 있다). 홈택스는 발행일로 찾으므로 입금일을 적어 주면
  // 없는 날짜를 뒤지게 된다. 두 날짜를 억지로 맞출 일이 아니라는 것이 운영자 확정이다(2026-09-01).
  // 왜 금액도 따로인가 — 45만 받고 30만만 끊을 수 있다. 그것이 CashReceipt 표가 생긴 이유다.
  // 여러 날에 걸쳐 끊었으면 줄도 여럿이다. 한 날짜에 합계를 몰아 적으면 그 중 하나도 못 찾는다.
  cashReceipt?: { ymd: string; amount: number }[]
  card?: { amount: number }                       // 카드 계열로 받은 금액
  pastMonth?: string                              // 지난 달 장부가 바뀐다는 고지
  companyKeeps: number                            // 재발행이 필요할 때 쓸 확정액
}

/**
 * 띄울 안내를 순서대로 돌려준다. 빈 배열이면 알릴 것이 없다.
 *
 * 순서에 뜻이 있다. **지난 달 장부가 바뀌는 고지가 먼저다** — 이 앱에는 월 마감이 없어서
 * 조용히 바뀌면 아무도 모른다. 그 다음이 현금영수증, 마지막이 카드다.
 *
 * 문구는 **앱이 하지 않은 일을 완료형으로 쓰지 않는다.** 취소는 운영자가 홈택스에서 한다.
 * 확인창으로 막지도 않는다 — 환불 확정은 이미 여러 단계를 거친 뒤라 한 번 더 물으면
 * 습관적으로 넘기게 된다.
 */
export function refundTaxNoticeLines(notice: RefundTaxNotice | undefined): string[] {
  if (!notice) return []
  const out: string[] = []
  if (notice.pastMonth) out.push(notice.pastMonth)
  if (notice.cashReceipt?.length) {
    const issues = notice.cashReceipt
    const total = issues.reduce((sum, i) => sum + i.amount, 0)
    // 여러 날에 끊었으면 날짜별로 적고 합계를 덧붙인다 — 홈택스에서 한 건씩 찾아야 하기 때문이다.
    const what = issues.map(i => `${i.ymd} 발행 ${fmtWon(i.amount)}`).join(', ')
      + (issues.length > 1 ? ` (합계 ${fmtWon(total)})` : '')
    // 전액 환불이면 재발행할 것이 없다 — 취소만 하면 된다.
    out.push(notice.companyKeeps === 0
      ? `홈택스에서 현금영수증 발행을 취소해 주세요. ${what}. 앱 매출에서는 뺐지만 현금영수증 취소는 따로 하셔야 합니다.`
      : `현금영수증을 다시 발행해야 합니다. 홈택스에서 ${what}을 취소하고 확정액 ${fmtWon(notice.companyKeeps)}으로 재발행한 뒤, 수납 기록에서 현금영수증 표시를 다시 켜 주세요.`)
  }
  if (notice.card) {
    out.push(`카드로 받은 ${fmtWon(notice.card.amount)}입니다. 카드 승인을 취소하면 카드 매출 자료도 함께 줄지만, 승인을 두고 계좌로 돌려주면 카드 매출은 그대로 남습니다. 어느 쪽으로 처리하셨는지 확인해 주세요.`)
  }
  return out
}
