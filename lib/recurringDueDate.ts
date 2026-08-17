// 고정지출의 '그 달 납부 예정일' 단일 산출식 — 목록 표시·D-3 필터·기록 모달 프리필이 모두 이 값을 쓴다.
// 손사본이 갈라지면 같은 항목이 화면마다 다른 날짜로 보인다(신고 1cfaabab: 목록은 25일인데 모달은 오늘).

import { getNextBusinessDay } from './krHolidays'

/** 예정일 산출에 필요한 필드만 — RecurringExpenseWithStatus 가 그대로 대입된다. */
export type RecurringDueSource = {
  dueDay: number
  isAutoDebit: boolean
}

/**
 * 'YYYY-MM' 달의 납부 예정일을 'YYYY-MM-DD' 로 돌려준다.
 * - 기준일이 그 달 일수를 넘으면 말일로 클램프(예: 31일 + 30일 달) — 'YYYY-MM-31' invalid date 방지.
 * - 자동이체만 주말·공휴일이면 다음 영업일로 시프트(비자동이체는 기준일 그대로) — 대시보드 알림과 같은 규칙.
 * 시프트가 달을 넘기면(말일 + 주말) 다음 달 날짜가 나온다 — 실제 이체일이 그날이므로 의도된 결과다.
 */
export function recurringDueDateFor(rec: RecurringDueSource, month: string): string {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const day = Math.min(rec.dueDay, lastDay)
  if (!rec.isAutoDebit) return `${month}-${String(day).padStart(2, '0')}`
  const eff = getNextBusinessDay(new Date(y, m - 1, day))
  return `${eff.getFullYear()}-${String(eff.getMonth() + 1).padStart(2, '0')}-${String(eff.getDate()).padStart(2, '0')}`
}
