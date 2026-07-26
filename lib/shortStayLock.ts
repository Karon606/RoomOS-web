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

/** 감액 시 되쓸 record — 새 목표보다 큰 락을 물고 있는 활성 record 전부(되쓰기 전 원값을 스냅샷으로). */
export function lockRewritesFor(records: LockRecord[], newTarget: number): LockRewrite[] {
  return records
    .filter(r => r.expectedAmount > newTarget)
    .map(r => ({ recordId: r.id, prevExpectedAmount: r.expectedAmount }))
}
