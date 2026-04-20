/**
 * 금액을 만원 단위 축약형으로 변환
 * 10,000원 미만은 그대로 반환
 * compact=false 이면 항상 전체 표기
 */
export function formatMoney(amount: number, compact: boolean): string {
  if (!compact || amount < 10000) return `${amount.toLocaleString()}원`
  const man = amount / 10000
  const str = Number.isInteger(man) ? `${man}` : `${parseFloat(man.toFixed(1))}`
  return `${str}만원`
}
