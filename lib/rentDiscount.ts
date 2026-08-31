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
    // 적용 범위는 **스코프가 아니라 기간이 정한다** (2026-08-31 운영자 승인).
    //
    // 종전에는 permanent 가 시작·끝을 아예 안 읽어서 무조건 전 기간이었다. 그래서 할인을 지우면
    // 이미 할인가로 받고 끝난 지난 달까지 정가로 되쓰여 없던 미수가 생겼다("과거는 과거지").
    //
    // 이제 permanent 도 기간을 읽는다. 시작월이 있으면 그 달부터, 끝월이 있으면 그 달까지다.
    // 둘 다 없으면 종전대로 전 기간이라 **기존에 저장된 할인은 거동이 한 글자도 안 바뀐다**
    // (마이그레이션 0건). 무엇보다 이 규칙을 데이터가 쥐므로 되쓰기 엔진은 손댈 필요가 없다 —
    // 적용 기간 밖의 달은 변경 전후 청구액이 같아 엔진이 알아서 건너뛴다. 엔진에 월 하한을
    // 세우는 안은 신고 70cde9d6·50a2a69b 를 재발시켜 기각됐다.
    const from = d.startMonth
    const to   = d.endMonth
    const applies = d.scope === 'permanent'
      ? (!from || from <= targetMonth) && (!to || targetMonth <= to)
      // 일시 할인은 시작월이 있어야 성립한다(없으면 어느 달인지 말한 적이 없다).
      : !!from && from <= targetMonth && (!to || targetMonth <= to)
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
