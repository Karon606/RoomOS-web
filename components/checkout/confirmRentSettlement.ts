'use client'
// 퇴실 처리 직전 이용료 환불 확인창 정본 — 세 화면(홈 알림·프리즘·입주자 수정)이 같은 문장으로 묻는다.
//
// 왜 한 벌인가. '전액 환불' 확인은 입주자 수정 폼에만 있었고 홈과 프리즘에는 없었다. 그리고
// 환불 0 은 어디서도 안 물었다 — 506호가 그 틈으로 계산값 그대로 확정됐다(2026-09-02 신고).
// 묻는 조건은 셋이다. 계산값과 다른 금액, 환불 0, 결제액 전액. 셋 다 기본에서 벗어난 확정이라
// 보증금 반환액과 한 문장으로 묶어 한 번 더 보여 준다(§14 확인 다이얼로그 · §27.4 caution).

import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { fmtWon } from '@/lib/fmtMoney'
import type { RentSettlementValue } from './RentSettlementSection'

/**
 * 확정 직전에 부른다. 정산 섹션이 안 섰으면(rent null) 물을 것이 없다.
 *
 * `depositReturn` 은 같은 확정에 실리는 보증금 반환액이다. '나중에 반환'처럼 아직 정하지 않았으면
 * null 을 넘긴다 — 그때는 이용료만 말한다.
 */
export async function confirmRentSettlement(rent: RentSettlementValue | null, depositReturn: number | null): Promise<boolean> {
  if (!rent) return true
  const { amount, max, pick, suggested } = rent
  const full = amount > 0 && amount >= max
  const differs = amount !== suggested
  if (!full && !differs && amount > 0) return true

  // 두 갈래가 같은 모양이다 — 제목은 이용료 한 금액, 보증금 반환액과 총 환불액은 본문(§14 위계,
  // 제목 16/700 에 두 금액을 실으면 375px 에서 두 줄을 꽉 채운다). 취소는 늘 무변경이라 기본 라벨.
  const depositPart = depositReturn != null
    ? ` 보증금 반환 ${fmtWon(depositReturn)} · 총 환불액 ${fmtWon(amount + depositReturn)}.`
    : ''

  // 전액 환불(사용분·위약금까지 반환)은 계산값 초과 여부와 무관하게 결제액 전액이면 묻는다.
  // 이 화면에서 가장 센 확정이라 caution 이다 — 계산값과 조금 다른 갈래보다 약하면 위험도가 뒤집힌다.
  if (full) {
    return confirmDialog({
      title: `이용료 ${fmtWon(amount)}을 전액 환불할까요?`,
      message: `사용분까지 모두 돌려주는 금액입니다.${depositPart}`,
      level: 'caution',
      confirmLabel: '전액 환불',
    })
  }

  const message = amount === 0
    ? (pick === 'none'
      ? `결제액 ${fmtWon(max)}은 회사 귀속으로 남고 수납 기록은 바뀌지 않습니다.`
      : suggested === 0
      ? `계산값이 0원이라 돌려줄 이용료가 없습니다. 수납 기록은 바뀌지 않습니다.`
      : `계산값 ${fmtWon(suggested)} 대신 0원입니다. 수납 기록은 바뀌지 않습니다.`)
    : `계산값 ${fmtWon(suggested)}과 다른 금액입니다.`
  return confirmDialog({
    title: amount === 0 ? '이용료를 환불하지 않고 처리할까요?' : `이용료 ${fmtWon(amount)}을 환불할까요?`,
    message: `${message}${depositPart}`,
    level: 'caution',
    confirmLabel: '퇴실 처리',
  })
}
