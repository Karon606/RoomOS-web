'use client'
// 퇴실 처리 직전 이용료 환불 확인창 정본 — 세 화면(홈 알림·프리즘·입주자 수정)이 같은 문장으로 묻는다.
//
// 왜 한 벌인가. '전액 환불' 확인은 입주자 수정 폼에만 있었고 홈과 프리즘에는 없었다. 그리고
// 환불 0 은 어디서도 안 물었다 — 506호가 그 틈으로 계산값 그대로 확정됐다(2026-09-02 신고).
// 묻는 조건과 문장은 lib/checkoutSettlement 의 rentSettlementConfirmSpec 이 쥔다(회귀 테스트가
// 문장을 직접 보게 하려고 순수 함수로 뽑았다, 2026-09-03). 여기는 그것을 §14 확인 다이얼로그 ·
// §27.4 caution 으로 띄우는 자리다.

import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { rentSettlementConfirmSpec, type RentSettlementValue } from '@/lib/checkoutSettlement'

/**
 * 확정 직전에 부른다. 정산 섹션이 안 섰으면(rent null) 물을 것이 없다.
 *
 * `depositReturn` 은 같은 확정에 실리는 보증금 반환액이다. '나중에 반환'처럼 아직 정하지 않았으면
 * null 을 넘긴다 — 그때는 이용료만 말한다.
 */
export async function confirmRentSettlement(rent: RentSettlementValue | null, depositReturn: number | null): Promise<boolean> {
  const spec = rentSettlementConfirmSpec(rent, depositReturn)
  if (!spec) return true
  return confirmDialog({ ...spec, level: 'caution' })
}
