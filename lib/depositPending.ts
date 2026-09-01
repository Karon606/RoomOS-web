// 보증금 반환 기준액과 '반환 대기' 판정의 순수 정본 — 서버 액션·홈 알림·감지망이 같은 답을 낸다.
//
// 왜 순수 함수인가. 판정식(퇴실 완료 + 반환 기록 없음 + 기준액 > 0)이 세 자리에 각자 적히면
// 언젠가 갈리고, 갈린 쪽은 아무도 눈치채지 못한다. 조회는 호출부가 하고 판단만 여기 모은다.
//
// 기준액 규칙(2026-08-10 확정, actions.getDepositBasisForLease 에서 옮김).
//   실수납이 있으면 실수납이 기준이다 — 계약 30만인데 20만 받은 계약에서 계약액을 쓰면
//   받은 적 없는 10만이 몰취 수익으로 잡힌다.
//   실수납 0 + 인수 전 입주자는 계약액이다 — 보증금을 양도인이 받아 이 원장에 입금이 없을 뿐
//   반환의무는 실재한다(운영자 확인 2026-08-02).
//   둘 다 아니면 0 — 정산할 돈 자체가 없다.

export type DepositBasisInput = {
  received: number          // 이 계약의 보증금 명목 실수납 합
  contract: number          // 계약서상 보증금
  preAcquisition: boolean   // 인수 전 입주(입주일 < 인수 기준일)
}

export function depositBasisOf(i: DepositBasisInput): {
  basis: number; source: 'received' | 'carriedOver' | 'none'
} {
  if (i.received > 0) return { basis: i.received, source: 'received' }
  if (i.preAcquisition && i.contract > 0) return { basis: i.contract, source: 'carriedOver' }
  return { basis: 0, source: 'none' }
}

/**
 * 반환 대기 유예 일수 — 퇴실 후 이 일수까지는 '대기 업무'이고, 넘기면 감지망이 위반으로 올린다.
 *
 * 퇴실 처리에서 '나중에 반환'을 고를 수 있게 되면서(운영자 승인 2026-09-01) 반환 기록 없는
 * 퇴실이 정당한 상태가 됐다. 그렇다고 그물을 없애면 진짜 누락도 조용해진다 — 홈 알림이
 * 상시로 조르고, 이 유예를 넘긴 건만 그물이 결함으로 잡는다.
 */
export const DEPOSIT_RETURN_GRACE_DAYS = 14
