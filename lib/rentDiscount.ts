// #14 월세 할인 계산 — 순수함수(부수효과 없음, 단위테스트 대상).
// 미수/완납 계산이 3곳(getRoomPaymentStatus·대시보드 발생주의·unpaid.ts)에 분산돼 있어,
// "그 달 청구액 = baseRent - 할인" 을 이 단일 헬퍼로 계산해 일관성을 보장한다.

export type RentDiscountInput = {
  discountType: string   // 'amount' | 'percent'
  value: number          // 원(amount) 또는 %(percent)
  scope: string          // 'permanent' | 'temporary'
  startMonth?: string | null  // 'YYYY-MM'
  endMonth?: string | null    // 'YYYY-MM'
  /** 할인 사유 — 왜 깎아 주는지(프로모션·양곡지원 따위). 계산에는 안 쓰고 라벨에만 붙는다. */
  memo?: string | null
}

// 특정 월(targetMonth='YYYY-MM')에 그 계약에 적용되는 할인 합계.
// percent는 baseRent 기준 반올림. 합산은 baseRent를 넘지 않게 캡(음수 청구 방지).
export function discountForMonth(
  discounts: RentDiscountInput[] | null | undefined,
  targetMonth: string,
  baseRent: number,
): number {
  if (!discounts || discounts.length === 0 || baseRent <= 0) return 0
  let total = 0
  for (const d of discounts) {
    const applies =
      d.scope === 'permanent'
      || (d.scope === 'temporary' && !!d.startMonth && !!d.endMonth && d.startMonth <= targetMonth && targetMonth <= d.endMonth)
      // 시작만 있고 끝이 없는 일시 할인 = 시작월부터 무기한
      || (d.scope === 'temporary' && !!d.startMonth && !d.endMonth && d.startMonth <= targetMonth)
    if (!applies) continue
    const amt = d.discountType === 'percent'
      ? Math.round((baseRent * d.value) / 100)
      : d.value
    if (amt > 0) total += amt
  }
  return Math.min(total, baseRent)
}

// 할인 적용 후 그 달 실제 청구액 (0 미만 방지)
export function discountedRent(
  discounts: RentDiscountInput[] | null | undefined,
  targetMonth: string,
  baseRent: number,
): number {
  return Math.max(0, baseRent - discountForMonth(discounts, targetMonth, baseRent))
}

// 할인 1건 사람이 읽는 라벨 (UI 표시용)
export function discountLabel(d: RentDiscountInput): string {
  const v = d.discountType === 'percent' ? `${d.value}%` : `${d.value.toLocaleString()}원`
  const period = d.scope === 'permanent'
    ? '매월'
    : d.startMonth
      ? `${d.startMonth}${d.endMonth ? `~${d.endMonth}` : '~'}`
      : '기간 미정'
  // 사유가 있으면 뒤에 붙인다 — 목록에서 왜 깎였는지가 바로 보여야 한다(운영자 요구 2026-08-31).
  const reason = d.memo?.trim()
  return `${v} 할인 · ${period}${reason ? ` · ${reason}` : ''}`
}
