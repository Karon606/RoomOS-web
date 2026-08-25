// 고정지출의 '그 달 도래 여부'와 '그 달 납부 예정일' 단일 산출식 — 목록 표시·D-3 필터·기록 모달
// 프리필·예상지출 합계·오늘 알림이 모두 이 값을 쓴다. 손사본이 갈라지면 같은 항목이 화면마다
// 다른 날짜로 보인다(신고 1cfaabab: 목록은 25일인데 모달은 오늘). 주기(격월·분기·반기·연1회)의
// 도래 판정도 여기 한 곳이다(신고 7e7da5c4) — 여러 화면이 각자 계산하면 반드시 갈린다.

import { getNextBusinessDay } from './krHolidays'
import { kstMonthOf } from './fmtDate'

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

// ── 주기 도래 판정 (신고 7e7da5c4) ─────────────────────────────────────
// 판정식은 달력 달 기준이다 — (월 - 기준달) mod interval == 0 (음수 정규화). 화면 다섯
// 선택지(1·2·3·6·12)는 전부 12의 약수라 "해마다 같은 달들"이 되고, 스키마가 허용하는
// 비약수 값이 들어와도 이 식은 결정적으로 동작한다(그 해 안에서 도래 달이 밀릴 뿐이다).
// 절대 인덱스(년*12+월) 방식은 anchorMonth 에 연도가 없어 기준점이 정의되지 않아 기각.

/** 주기 판정에 필요한 필드만 — RecurringExpenseWithStatus·RecurringExpenseRow 가 그대로 대입된다. */
export type RecurringCycleSource = {
  intervalMonths: number
  /** 도래 달 기준점(1~12). null 이면 activeSince(없으면 createdAt)의 KST 달. */
  anchorMonth: number | null
  activeSince: Date | string | null
  createdAt: Date | string
}

/** 기준 달 확정 — anchorMonth 가 있으면 그것, 없으면 activeSince(없으면 createdAt)의 KST 달.
 *  월 경계 판정은 kstMonthOf 정본 경유(@db.Date UTC 자정도, 타임스탬프도 같은 규칙으로 떨어진다).
 *  폴백을 호출자에게 맡기면 호출자 수만큼 규칙이 복제된다 — 여기 한 곳. */
export function resolveRecurringAnchorMonth(rec: RecurringCycleSource): number {
  if (rec.anchorMonth != null && rec.anchorMonth >= 1 && rec.anchorMonth <= 12) return rec.anchorMonth
  const key = (rec.activeSince ? kstMonthOf(rec.activeSince) : '') || kstMonthOf(rec.createdAt)
  return Number(key.slice(5)) || 1
}

/** month('YYYY-MM')가 이 항목의 도래 달인가. interval 1 이하는 항상 참(매월) —
 *  기존 행 전부가 이 갈래라 이 함수를 끼워도 거동이 한 글자도 안 바뀐다. */
export function isRecurringDueMonth(rec: RecurringCycleSource, month: string): boolean {
  const interval = rec.intervalMonths
  if (!Number.isFinite(interval) || interval <= 1) return true
  const m = Number(month.slice(5, 7))
  // 깨진 월 입력은 '보이는 쪽'으로 실패한다 — 항목이 소리 없이 숨는 것이 가장 나쁜 실패다.
  if (!m) return true
  const anchor = resolveRecurringAnchorMonth(rec)
  return (((m - anchor) % interval) + interval) % interval === 0
}

/** fromMonth('YYYY-MM') 이후(미포함) 첫 도래 달 — 최대 12회 전진이라 항상 끝난다. */
export function nextRecurringDueMonth(rec: RecurringCycleSource, fromMonth: string): string {
  const [y0, m0] = fromMonth.split('-').map(Number)
  for (let i = 1; i <= 12; i++) {
    const total = (m0 - 1) + i
    const cand = `${y0 + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
    if (isRecurringDueMonth(rec, cand)) return cand
  }
  const total = m0   // 이론상 못 오는 폴백(12의 약수 주기는 12달 안에 반드시 도래) — 다음 달
  return `${y0 + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** 이 항목이 한 해에 도래하는 달들(1~12, 오름차순) — 표기와 판정이 같은 식에서 나온다. */
function dueMonthsOfYear(rec: RecurringCycleSource): number[] {
  const out: number[] = []
  for (let m = 1; m <= 12; m++) {
    if (isRecurringDueMonth(rec, `2001-${String(m).padStart(2, '0')}`)) out.push(m)
  }
  return out
}

/** 주기 표기 정본 — '매월' · '격월 (홀수달)' · '분기 (2·5·8·11월)' · '반기 (3·9월)' · '연 1회 (3월)'.
 *  열거가 판정 함수에서 파생되므로 표기와 실제 도래가 갈릴 수 없다. */
export function recurringCycleLabel(rec: RecurringCycleSource): string {
  const interval = rec.intervalMonths
  if (!Number.isFinite(interval) || interval <= 1) return '매월'
  const months = dueMonthsOfYear(rec)
  if (interval === 2) return `격월 (${months[0] % 2 === 1 ? '홀수달' : '짝수달'})`
  if (interval === 3) return `분기 (${months.join('·')}월)`
  if (interval === 6) return `반기 (${months.join('·')}월)`
  if (interval === 12) return `연 1회 (${months[0]}월)`
  return `${interval}개월마다 (${months.join('·')}월)`
}

/** 폼 select 선택지 정본 — 두 CRUD 폼(환경설정·재무 관리 모달)이 공유한다(사본 드리프트 방지). */
export const RECURRING_INTERVAL_CHOICES: { value: number; label: string }[] = [
  { value: 1, label: '매월' },
  { value: 2, label: '격월 (두 달마다)' },
  { value: 3, label: '분기 (석 달마다)' },
  { value: 6, label: '반기 (여섯 달마다)' },
  { value: 12, label: '연 1회' },
]

/** '오늘 출금·납부' 알림 모집단 판정에 필요한 필드 — RecurringExpenseWithStatus 가 그대로 대입된다. */
export type RecurringDueTodaySource = RecurringDueSource & {
  isPending: boolean                  // activeSince 가 이번 달 이후 — 아직 활성화 전
  recordedExpenseId: string | null    // 이번 달 지출 기록(확인 처리된 예정 행)
}

/**
 * 그 항목이 오늘(KST) 돈이 나가는 건인가 — 푸시와 인앱 종이 같은 이 함수를 쓴다(신고 568633fb).
 * 날짜는 recurringDueDateFor 하나만 본다: 자동이체는 휴일 시프트 후 실제 이체일, 비자동은 기준일(말일 클램프).
 * 활성화 전이거나 이번 달 기록이 이미 있으면 알릴 일이 아니다 — 기록 여부는 재무 화면과 같은 값
 * (getRecurringExpensesWithStatus 의 recordedExpenseId)을 그대로 본다.
 */
export function recurringDueToday(rec: RecurringDueTodaySource, todayYmd: string): boolean {
  if (rec.isPending) return false
  if (rec.recordedExpenseId) return false
  return recurringDueDateFor(rec, todayYmd.slice(0, 7)) === todayYmd
}
