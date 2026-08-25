// 지출 목록의 날짜별 합계 문구 정본 — 실지출과 예정을 **섞지 않고 나란히 적는다**.
//
// 왜 정본인가 (오류신고 6e358d34, 2026-08-25). 종전에는 실지출만 세서, 예정 행만 있는 날에
// 항목이 금액을 달고 서 있는데 머리가 '합계 0원' 이었다. 실측 2026-08-28 표시 0원 대 실제
// 예정 1,050,500원. 그렇다고 둘을 더하면 추정이 장부 숫자에 섞인다(f7b0292a 판정).
//
// 그래서 두 축을 나눠 세고 문구로 가른다. 모바일 헤더와 데스크톱 소계 행이 같은 함수를 써야
// 두 자리가 안 갈린다.

export type DayTotalInput = { actual: number; planned: number }

/**
 * 그 날짜 머리에 설 문구.
 *   실지출만        → `합계 50,000원`
 *   예정만          → `예정 1,050,500원`   (0원 합계를 적지 않는다)
 *   둘 다           → `합계 50,000원 · 예정 31,900원`
 *   둘 다 0         → `합계 0원`            (빈 날에도 머리는 선다)
 */
export function dayTotalText(
  input: DayTotalInput,
  prefix: string,
  fmt: (n: number) => string,
): string {
  const parts: string[] = []
  if (input.actual > 0 || input.planned === 0) parts.push(`${prefix} ${fmt(input.actual)}`)
  if (input.planned > 0) parts.push(`예정 ${fmt(input.planned)}`)
  return parts.join(' · ')
}
