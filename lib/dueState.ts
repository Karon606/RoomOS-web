// 그 달 납부 기한 날짜 고르기와 기한 상태(납부일 전 · 납부일 당일 · 미납) 판정의 정본. 수납 관리·홈·종·푸시·수납 등록이 이것만 부른다
//
// 운영자 원문(2026-11-04): "납부일 당일은 납부일 당일이라고 표시하는게 좋을 것 같아. 납기 전도 아니고 미납도 아니고".
// 승인 '추천대로'(2026-11-04). 세 상태는 before(납부일 전) · today(납부일 당일) · overdue(미납, 다음 날부터)다.
//
// 왜 한 파일인가. 같은 뜻의 판정이 다섯 자리에 따로 있었다(수납 관리 행 isPaid·첫 미납 달 루프·홈 미수·종과 푸시·
// 수납 등록 기본값). 수납 관리는 '오늘 끝 시각 이하면 도래', 홈은 '경과일 0 이상이면 미납'이라 당일을 둘 다 미납으로 봤고,
// 기한 날짜 자체도 갈렸다(29일 납부 계약의 평년 2월을 한쪽은 2/28, 한쪽은 3/1 로 넘겼다. 첫 달 기한과 늦은 유예도 자리마다 달랐다).
// 그래서 기한 날짜 고르기(dueYmdOfLeaseMonth)와 비교(dueStateOf)를 여기 하나로 두고 사본을 금지한다(감지망 check-due-state-canon).
//
// 날짜는 전부 'YYYY-MM-DD' 문자열이다. 오늘은 KST 달력일 하나를 한 요청에서 한 번 재서 넘긴다(lib/kstDate). Date 의 시각·시간대를
// 섞지 않으므로 서버(UTC)와 기기(KST)가 같은 답을 낸다.
import { firstMonthDueYmd } from './billing'

export type DueState = 'before' | 'today' | 'overdue'

const YMD = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

/** kstYmd() 같은 {year, month, day} 를 'YYYY-MM-DD' 로. 한 요청에서 잰 오늘을 그대로 옮길 때 쓴다(두 번 재면 자정에 갈린다). */
export function ymdOfParts(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** 기한과 오늘(둘 다 'YYYY-MM-DD')로 상태. 기한이 오늘보다 뒤면 납부일 전, 같으면 납부일 당일, 앞이면 미납. */
export function dueStateOf(dueYmd: string, todayYmd: string): DueState {
  if (!YMD.test(dueYmd) || !YMD.test(todayYmd)) throw new Error(`dueStateOf: 날짜 모양이 아닙니다 (${dueYmd}, ${todayYmd})`)
  return dueYmd > todayYmd ? 'before' : dueYmd === todayYmd ? 'today' : 'overdue'
}

/** 경과일(오늘 − 기한, 음수 = 남은 날). 연체(7일 초과)·독촉(1일 이상)·문구의 숫자 원천. */
export function daysPastDue(dueYmd: string, todayYmd: string): number {
  const [dy, dm, dd] = dueYmd.split('-').map(Number)
  const [ty, tm, td] = todayYmd.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86400000)
}

/**
 * dueDay 원문('N' · '말일' · 'YYYY-MM-DD')을 그 달 기한 'YYYY-MM-DD' 로. 일이 그 달 말일보다 크면 말일로 접는다
 * (31일 납부의 11월은 30일, 29일 납부의 평년 2월은 28일). 다음 달로 넘기지 않는다. 전체 날짜형은 그 날짜 그대로다.
 * 읽을 수 없으면 null.
 */
export function dueYmdForMonth(raw: string | null | undefined, month: string): string | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const s = raw.slice(0, 10)
    if (!YMD.test(s)) return null
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
    return s
  }
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let day: number
  if (raw.includes('말')) day = last
  else {
    day = parseInt(raw, 10)
    if (isNaN(day) || day < 1) return null
    day = Math.min(day, last)
  }
  return `${y}-${pad(m)}-${pad(day)}`
}

/** 기한 고르기에 쓰는 계약 칸. dueDay 는 계약 원래 납부일(임시조정 전)이다. */
export type DueLease = {
  dueDay?: string | null
  overrideDueDay?: string | null
  overrideDueDayMonth?: string | null
  moveInDate?: Date | string | null
  cycleDay?: string | null
}

/** 임시조정이 없을 때 그 달 기한. 입주달 첫 달 규칙이 발동하면 입주일(lib/billing firstMonthDueYmd), 아니면 납부일. */
export function scheduledDueYmd(l: DueLease, month: string): string | null {
  const fm = firstMonthDueYmd({ moveInDate: l.moveInDate ?? null, dueDay: l.dueDay ?? null, cycleDay: l.cycleDay ?? null }, month)
  return fm ?? dueYmdForMonth(l.dueDay, month)
}

/**
 * 그 달 기한('YYYY-MM-DD', 없으면 null). 순서가 규칙이다.
 *   ① 그 달에 직접 건 임시조정(앞당김·미룸 모두, 전체 날짜형이면 그 날짜)
 *   ② 이후 달에 건 임시조정이 그 달 원래 기한 이상이면 그 날짜(이 달 채무를 뒤로 미룬 유예, 2026-06-02 5월 미납 6/1 유예)
 *   ③ 원래 기한(scheduledDueYmd: 첫 달이면 입주일, 아니면 납부일. 말일 클램프)
 */
export function dueYmdOfLeaseMonth(l: DueLease, month: string): string | null {
  if (l.overrideDueDay && l.overrideDueDayMonth === month) {
    const own = dueYmdForMonth(l.overrideDueDay, month)
    if (own) return own
  }
  const sched = scheduledDueYmd(l, month)
  if (l.overrideDueDay && l.overrideDueDayMonth && l.overrideDueDayMonth > month) {
    const later = dueYmdForMonth(l.overrideDueDay, l.overrideDueDayMonth)
    if (later && (!sched || later >= sched)) return later
  }
  return sched
}

/**
 * 그 귀속월의 기한 상태. 판정 자리가 모두 이것만 부른다.
 * 기한을 읽을 수 없으면(null) 한 규칙이다. 지난 달이면 미납, 이번 달·앞으로 올 달이면 납부일 전.
 */
export function monthDueState(month: string, dueYmd: string | null, todayYmd: string): DueState {
  if (dueYmd) return dueStateOf(dueYmd, todayYmd)
  return month < todayYmd.slice(0, 7) ? 'overdue' : 'before'
}

/** 그 달 기한 상태(계약에서 바로). dueYmdOfLeaseMonth 와 monthDueState 를 잇는다. */
export function leaseMonthDueState(l: DueLease, month: string, todayYmd: string): DueState {
  return monthDueState(month, dueYmdOfLeaseMonth(l, month), todayYmd)
}

/**
 * 기한을 미뤄 준 상태면 그 기한('YYYY-MM-DD'), 아니면 null. 유예는 원래 기한보다 뒤로 옮겼고 그 날이 아직 안 온 것이다.
 * 유예한 날짜 당일은 유예가 아니라 납부일 당일이다(운영자 승인 2026-11-04). 낼 돈이 남았는지는 부르는 쪽이 본다.
 */
export function deferredDueYmd(l: DueLease, month: string, todayYmd: string): string | null {
  const eff = dueYmdOfLeaseMonth(l, month)
  const sched = scheduledDueYmd(l, month)
  if (!eff || !sched || eff <= sched) return null
  return dueStateOf(eff, todayYmd) === 'before' ? eff : null
}
