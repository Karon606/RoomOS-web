// 납부일 해석 정본 — dueDay 3포맷('N' · '말일' · 'YYYY-MM-DD')과 임시조정(override)을 한 곳에서 푼다.
// dueDay 를 단독으로 parseInt 하면 전체 날짜형('2026-08-07')이 2026 으로 읽혀 조용히 틀어진다.
// 납부일을 화면·피드에 내보내는 모든 경로는 이 파일을 경유한다(신고 998bff27: 캘린더가 유예를 무시).
//
// 의미론: overrideDueDayMonth = 귀속(청구) 월, overrideDueDay = 그 청구월의 실제 납부일.
// 다른 달로 미루면 저장 측(DueDayTempAdjustWidget)이 전체 날짜형으로 남기므로,
// 전체 날짜형은 그 자체가 "월 경계를 넘긴 유예"라는 신호다.

export type DueLease = {
  dueDay?: string | null
  overrideDueDay?: string | null
  overrideDueDayMonth?: string | null
}

/** dueDay 원문(raw)을 특정 연·월의 절대 날짜로 환산. 전체 날짜형이면 그 날짜를 그대로 쓴다. */
export function resolveDueRaw(raw: string | null | undefined, y: number, m: number): Date | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const [fy, fm, fd] = raw.split('-').map(Number)
    if (!fy || !fm || !fd) return null
    return new Date(fy, fm - 1, fd)
  }
  const last = new Date(y, m, 0).getDate()
  if (raw.includes('말')) return new Date(y, m - 1, last)
  const day = parseInt(raw, 10)
  if (isNaN(day) || day < 1) return null
  return new Date(y, m - 1, Math.min(day, last))
}

/** 그 달에 적용되는 dueDay 원문 — 임시조정이 그 달에 걸려 있으면 조정값. */
export function effectiveDueRawForMonth(l: DueLease, monthStr: string): string | null {
  if (l.overrideDueDay && l.overrideDueDayMonth === monthStr) return l.overrideDueDay
  return l.dueDay ?? null
}

/** 그 달의 납부일(절대 날짜). 임시조정으로 다음 달로 미뤄졌으면 미뤄진 날짜를 돌려준다. */
export function dueDateForMonth(l: DueLease, monthStr: string): Date | null {
  const [y, m] = monthStr.split('-').map(Number)
  if (!y || !m) return null
  return resolveDueRaw(effectiveDueRawForMonth(l, monthStr), y, m)
}

/** 임시조정을 절대 날짜로 해석(귀속월 무관) — 유예 파급 판정용. */
export function overrideAbsDate(l: DueLease): Date | null {
  if (!l.overrideDueDay || !l.overrideDueDayMonth) return null
  if (l.overrideDueDay.includes('-')) return resolveDueRaw(l.overrideDueDay, 0, 0)
  const [y, m] = l.overrideDueDayMonth.split('-').map(Number)
  if (!y || !m) return null
  return resolveDueRaw(l.overrideDueDay, y, m)
}

/**
 * 인수 cutoff 비교용 '그 달 안의 일자'. `dueDay < cutoffDay` 형태의 비교에 넣는 값이다.
 * 전체 날짜형을 parseInt 로 읽으면 2026 이 나와 비교가 조용히 뒤집히므로 반드시 이 함수를 쓴다.
 * 다른 달로 밀린 유예는 그 달 안에 일자가 없으므로 방향으로 접는다 — 이후 달이면 99(항상 cutoff 뒤),
 * 이전 달이면 0(항상 cutoff 앞). 같은 달이면 그 일자.
 */
export function dueDayForCutoff(raw: string | null | undefined, monthStr: string): number | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const m = raw.slice(0, 7)
    if (m > monthStr) return 99
    if (m < monthStr) return 0
    const d = Number(raw.slice(8, 10))
    return Number.isFinite(d) && d > 0 ? d : null
  }
  if (raw.includes('말')) return 31
  const n = parseInt(raw, 10)
  return isNaN(n) ? null : n
}

/** 그 달 납부일이 임시조정으로 옮겨졌는가(원래 날짜와 다른가). 표시 문구 승격 판정용. */
export function isDeferredForMonth(l: DueLease, monthStr: string): boolean {
  if (!l.overrideDueDay || l.overrideDueDayMonth !== monthStr) return false
  const [y, m] = monthStr.split('-').map(Number)
  const base = resolveDueRaw(l.dueDay, y, m)
  const eff = resolveDueRaw(l.overrideDueDay, y, m)
  if (!base || !eff) return false
  return base.getTime() !== eff.getTime()
}
