// 단기 청구 락(입주월 record 의 최대 expectedAmount) 조정 규칙 — 순수함수(부수효과 없음).
// 서버(syncShortStayCharge·updateTenant)와 scripts/test-money.ts 가 같은 함수를 쓴다.
// 락은 '그 달 최대'라 마커를 얹기만 해서는 내려가지 않는다 — 감액은 되쓰기가 필요하고,
// 그 원값 스냅샷(lockRewrites)이 적용취소의 복원 근거다.

export type LockRecord = { id: string; expectedAmount: number }
export type LockRewrite = { recordId: string; prevExpectedAmount: number }

/** 그 달 청구 락 = 활성 record 의 최대 expectedAmount (lib/billing 우선순위 ②의 입력값). */
export function lockOf(records: LockRecord[]): number {
  let max = 0
  for (const r of records) if (r.expectedAmount > max) max = r.expectedAmount
  return max
}

/**
 * 목표 락 — 정책 누적가(또는 운영자 수동 입력액)를 쓰되, 이미 받은 금액(paidSum) 아래로는 내리지 않는다.
 * 잔액 0(완납)에서 멈춘다: 그 아래는 환불 영역이라 자동으로 내리지 않는 것이 회계 규칙(운영자 확정 2026-07-26).
 */
export function shortStayLockTarget(targetRent: number, paidSum: number): number {
  return Math.max(targetRent, paidSum)
}

/** 조정 방향. 목표와 현 락이 같으면 null(조정 불필요). */
export function lockAdjustKind(newTarget: number, currentLock: number): 'increase' | 'decrease' | null {
  if (newTarget > currentLock) return 'increase'
  if (newTarget < currentLock) return 'decrease'
  return null
}

/**
 * 정책가를 결정하는 전 입력(원인 사실). 이 넷 중 하나라도 바뀌어야 청구를 다시 계산한다.
 * (회계 확정 2026-07-26 — 원인 없는 재계산은 근거 없는 매출 정정이라 사고로 본다.)
 */
export type ShortStayBasis = {
  moveOutIso: string | null
  rentAmount: number
  roomId: string | null
  moveInYmd: string | null
}

/** 원인 게이트 — 증감 양방향 공통. false 면 동기화 자체를 하지 않는다(협의가 보존). */
export function shortStayBasisChanged(prev: ShortStayBasis, next: ShortStayBasis): boolean {
  return next.moveOutIso !== prev.moveOutIso
    || next.rentAmount !== prev.rentAmount
    || next.roomId !== prev.roomId
    || next.moveInYmd !== prev.moveInYmd
}

/**
 * 협의가(직전 이용료가 그 시점 정책가와 달랐던 경우)가 정책 누적가로 재계산될 때의 고지 문구.
 * 비례 조정은 하지 않는다 — 정책 누적가로 맞추되 운영자가 알고 되돌릴 수 있게 반드시 알린다.
 * 협의가가 아니었거나 직전 정책가를 알 수 없으면 null(고지 없음).
 */
export function negotiatedRecalcNotice(prevRent: number, prevPolicyRent: number | null, newPolicyRent: number): string | null {
  if (prevPolicyRent == null || prevRent === prevPolicyRent) return null
  return `기존 협의 이용료 ${prevRent.toLocaleString()}원이 정책 누적가 ${newPolicyRent.toLocaleString()}원으로 재계산됩니다. 협의가를 유지하려면 이용료 칸을 직접 입력해 저장하세요.`
}

/** 감액 시 되쓸 record — 새 목표보다 큰 락을 물고 있는 활성 record 전부(되쓰기 전 원값을 스냅샷으로). */
export function lockRewritesFor(records: LockRecord[], newTarget: number): LockRewrite[] {
  return records
    .filter(r => r.expectedAmount > newTarget)
    .map(r => ({ recordId: r.id, prevExpectedAmount: r.expectedAmount }))
}
