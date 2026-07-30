// 거주기간의 달력 기준 정본 — 만 개월 수(회차식과 동일 규칙: 시작일+n개월[말일 클램프]가 종료일 이하)와 표시 문자열.
// 종전엔 연·월 차이만 보고 일을 무시해 31일 달 걸침·월중 입주가 부정확했다(신고 f9803357, TenantClient·TenantContractInfo 중복 제거).

const lastDayOf = (y: number, monthIdx: number) => new Date(y, monthIdx + 1, 0).getDate()

/** 만 개월 수 — 시작일에서 n개월 뒤(말일 클램프)가 종료일 이하인 최대 n. 역순이면 0. */
export function calendarMonthsBetween(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (months < 0) return 0
  const idx = start.getMonth() + months
  const ty = start.getFullYear() + Math.floor(idx / 12)
  const tm = ((idx % 12) + 12) % 12
  const anniversary = new Date(ty, tm, Math.min(start.getDate(), lastDayOf(ty, tm)))
  if (anniversary.getTime() > end.getTime()) months -= 1
  return Math.max(0, months)
}

/** 거주기간 표시 — 1개월 미만은 일수, 이후 N개월 / N년 / N년 N개월. */
export function fmtStayPeriod(
  moveIn: Date | string | null | undefined,
  end?: Date | string | null,
  today?: string,   // 'YYYY-MM-DD'(서버 KST) — SSR/클라 동일값으로 하이드레이션 불일치(#418) 방지
): string {
  if (!moveIn) return '—'
  const start  = new Date(moveIn)
  const finish = end ? new Date(end) : (today ? new Date(today) : new Date())
  const months = calendarMonthsBetween(start, finish)
  if (months < 1) {
    const days = Math.max(0, Math.floor((finish.getTime() - start.getTime()) / 86400000))
    return `${days}일`
  }
  const years = Math.floor(months / 12)
  const rem   = months % 12
  if (years > 0 && rem > 0) return `${years}년 ${rem}개월`
  if (years > 0) return `${years}년`
  return `${months}개월`
}
