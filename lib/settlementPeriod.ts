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

import { PRORATE_BASE_DAYS } from './prorate'

// 납부일 임시조정(overrideDueDay)은 **일부러 보지 않는다** — 운영자 확정 2026-08-01.
//   "납부일 유예는 납부 기한을 미루는거지... 기간 시작을 옮기면 공짜로 사는 기간이 생기잖아"
// 유예는 '언제까지 내도 되는가'를 미룰 뿐 서비스 기간의 경계를 옮기지 않는다. 초판에서 lib/dueDate 의
// effectiveDueRawForMonth 를 그대로 끌어 쓴 것이 오류였고, 그 결과 8월분을 9/3 까지 유예받은 사람이
// 8/20 에 퇴실하면 정산월이 두 달 전으로 가고 기간이 45일(월세의 150%)이 됐다.
export type SettlementLease = {
  dueDay?: string | null
  moveInDate?: Date | string | null
}

export type SettlementPeriod = {
  month: string      // 'YYYY-MM' — 정산 귀속월(기간 **시작**이 속한 달). 퇴실월과 다를 수 있다
  startYmd: string   // 기간 시작 (그 달 납부일. 입주월이면 입주일보다 앞설 수 없다)
  mustLeaveYmd: string // 기간 끝 = 다음 기간 시작 하루 전 = '퇴실해야 하는 날'
  periodDays: number // 기간 전체 일수(28~32). 표시용 — 일할 분모가 아니다
  daysUsed: number   // 일할에 쓰는 사용 일수. 1 이상 30 이하로 자른다(아래 주석)
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

/** 그 달의 기간 시작일. 계약의 원래 납부일만 본다 — 임시조정은 기한만 미룰 뿐 기간을 옮기지 않는다. */
function periodStartYmd(lease: SettlementLease, y: number, m: number): string | null {
  const raw = lease.dueDay ?? null   // 임시조정은 보지 않는다(파일 상단 주석)
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
  // 퇴실일이 기간 시작보다 앞 — 입주일 보정이 시작을 올렸는데 퇴실일이 그보다 빠른 잘못된 입력이다
  // (입주 5/20 인데 퇴실 5/10 등). 종전에는 daysUsed 0 인 멀쩡한 객체를 돌려줘서 잘못된 입력이
  // 확정 데이터가 됐다. 기존 정본 calcCheckoutProration 과 같이 null 로 거른다.
  if (rawUsed <= 0) return null
  return {
    month: `${sy}-${pad(sm)}`,
    startYmd,
    mustLeaveYmd: mustLeave,
    periodDays,
    // 30 상한은 새로 정한 규칙이 아니라 **계약서 조항 그 자체**다.
    //   "1일 이용요금은 월 이용료의 30분의 1로 합니다" — lib/contract.ts buildRefundClause(공정위 기준 고정 문구)
    // 따라서 31일짜리 기간을 그대로 쓰면 우리 계약서를 우리가 어긴다(470,000 이 485,666 이 되는 식).
    // 기존 정본 calcCheckoutProration 도 같은 이유로 30 에서 잘라왔다(lib/prorate.ts:76).
    // 31일 달의 하루를 못 받는 것은 그 조항의 당연한 귀결이고, 운영자도 같은 판단이다(2026-08-01).
    daysUsed: Math.max(1, Math.min(rawUsed, periodDays, PRORATE_BASE_DAYS)),
    daysDiff: diffDays(mustLeave, moveOutYmd),
  }
}

/** 퇴실해야 하는 날만 필요할 때. */
export function mustLeaveYmdFor(lease: SettlementLease, moveOutYmd: string): string | null {
  return settlementPeriodFor(lease, moveOutYmd)?.mustLeaveYmd ?? null
}
