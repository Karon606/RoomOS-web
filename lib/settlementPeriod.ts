// 퇴실 정산 기간 정본 — '퇴실일이 속한 서비스 기간'과 '퇴실해야 하는 날'을 한 곳에서 푼다.
//
// 왜 필요한가: 기존 lib/prorate 의 calcCheckoutProration 은 기간을 **퇴실월 안에서만** 잡는다.
// 납부일이 20일인 사람이 9월 3일에 나가면 실제 서비스 기간은 8/20~9/19 인데, 퇴실월(9월) 기준으로
// 계산하면 9/20 부터로 잡혀 기간이 통째로 어긋난다. 정산은 달이 아니라 '기간'이 단위다.
//
// 퇴실해야 하는 날 = 다음 기간 시작 하루 전. 납부일이 20일이면 19일이다.
// 운영자 확정(2026-08-01): 여기서 하루라도 어긋나면 묻는다. 봐주기 임계값은 두지 않는다.
//   "하루이틀 봐주는 것은 나의 판단이고 프로그램 정확도를 위해서는 원칙대로 해야지."
//
// 날짜는 전부 'YYYY-MM-DD' 문자열과 정수로만 다룬다. Date 객체를 섞으면 로컬 자정과 DB 의 UTC 자정이
// 어긋나 하루가 밀린다(실제로 겪은 버그). 하루 빼기만 UTC 산술로 하고 곧바로 문자열로 되돌린다.

import { effectiveDueRawForMonth, type DueLease } from './dueDate'

export type SettlementLease = DueLease & {
  moveInDate?: Date | string | null
}

export type SettlementPeriod = {
  month: string      // 'YYYY-MM' — 정산 귀속월(기간 **시작**이 속한 달). 퇴실월과 다를 수 있다
  startYmd: string   // 기간 시작 (그 달 납부일. 입주월이면 입주일보다 앞설 수 없다)
  mustLeaveYmd: string // 기간 끝 = 다음 기간 시작 하루 전 = '퇴실해야 하는 날'
  daysUsed: number   // startYmd~퇴실일 양끝 포함. 퇴실일이 기간 끝을 넘으면 기간 전체 일수
  daysDiff: number   // 퇴실일 − 퇴실해야 하는 날. 음수 = 일찍 나감, 0 = 딱 맞음, 양수 = 초과
}

const pad = (n: number) => String(n).padStart(2, '0')
const toYmd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** 'YYYY-MM-DD' 에서 하루 빼기 — UTC 산술로만(로컬 시간대가 섞이면 하루가 밀린다) */
function minusOneDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) - 86400000)
  return toYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** 두 'YYYY-MM-DD' 사이의 일수 차(b − a) */
function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** Date | 'YYYY-MM-DD' | null → 'YYYY-MM-DD' | null. Date 는 UTC 기준으로 읽는다(DB 저장 규약) */
export function asYmd(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 10) || null
  return toYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
}

/**
 * 그 달의 기간 시작일. 납부일 임시조정이 그 달에 걸려 있으면 조정값을 쓴다(lib/dueDate 정본 경유).
 * 임시조정이 전체 날짜형이면 그 날짜가 곧 기간 시작이다 — 월 경계를 넘긴 유예가 그렇게 저장된다.
 */
function periodStartYmd(lease: SettlementLease, y: number, m: number): string | null {
  const raw = effectiveDueRawForMonth(lease, `${y}-${pad(m)}`)
  if (!raw) return null
  if (raw.includes('-')) return raw.slice(0, 10)
  const last = lastDayOf(y, m)
  if (raw.includes('말')) return toYmd(y, m, last)
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 1) return null
  return toYmd(y, m, Math.min(n, last))
}

/**
 * 퇴실일이 속한 서비스 기간. 납부일이 없거나 해석 불가면 null.
 *
 * 기간 시작을 찾는 방법: 퇴실월의 납부일을 보고, 퇴실일이 그보다 앞이면 전월 기간에 속한 것이다.
 * 입주월이면 시작이 입주일보다 앞설 수 없다(납부일 1일 계약이 월 중 입주한 경우 과다 계산 방지 —
 * lib/prorate 의 같은 보정과 동일한 취지, 신고 6334bac4).
 */
export function settlementPeriodFor(
  lease: SettlementLease,
  moveOutYmd: string,
): SettlementPeriod | null {
  const parts = moveOutYmd.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null
  const [oy, om] = parts

  let sy = oy, sm = om
  const startInOutMonth = periodStartYmd(lease, oy, om)
  if (!startInOutMonth) return null
  if (moveOutYmd < startInOutMonth) {
    sm = om - 1
    if (sm < 1) { sm = 12; sy = oy - 1 }
  }
  let startYmd = periodStartYmd(lease, sy, sm)
  if (!startYmd) return null

  // 입주월 보정 — 기간 시작은 입주일보다 앞설 수 없다
  const moveIn = asYmd(lease.moveInDate)
  if (moveIn && moveIn.slice(0, 7) === `${sy}-${pad(sm)}` && moveIn > startYmd) startYmd = moveIn

  // 다음 기간 시작 하루 전이 '퇴실해야 하는 날'
  let ny = sy, nm = sm + 1
  if (nm > 12) { nm = 1; ny = sy + 1 }
  const nextStart = periodStartYmd(lease, ny, nm)
  if (!nextStart) return null
  const mustLeave = minusOneDay(nextStart)

  const periodDays = diffDays(startYmd, mustLeave) + 1
  const rawUsed = diffDays(startYmd, moveOutYmd) + 1
  return {
    month: `${sy}-${pad(sm)}`,
    startYmd,
    mustLeaveYmd: mustLeave,
    daysUsed: Math.max(0, Math.min(rawUsed, periodDays)),
    daysDiff: diffDays(mustLeave, moveOutYmd),
  }
}

/** 퇴실해야 하는 날만 필요할 때. */
export function mustLeaveYmdFor(lease: SettlementLease, moveOutYmd: string): string | null {
  return settlementPeriodFor(lease, moveOutYmd)?.mustLeaveYmd ?? null
}
