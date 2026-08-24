// Vercel 서버는 UTC, 사용자는 KST(+9). 월 단위 비교는 항상 KST 기준이어야
// "오늘"이 한국 시각으로 정확히 판정됨.

const KST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function kstYmd(d: Date = new Date()): { year: number; month: number; day: number } {
  const parts = KST_FMT.formatToParts(d)
  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value)
  const day = Number(parts.find(p => p.type === 'day')!.value)
  return { year, month, day }
}

export function kstMonthStr(d: Date = new Date()): string {
  const { year, month } = kstYmd(d)
  return `${year}-${String(month).padStart(2, '0')}`
}

// "YYYY-MM-DD" KST 날짜 문자열 (date input value용).
// 클라이언트의 new Date().toISOString()은 UTC라 KST 자정 직후 하루 어긋남.
export function kstYmdStr(d: Date = new Date()): string {
  const { year, month, day } = kstYmd(d)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// "YYYY-MM-DD" 대상일이 KST 오늘로부터 며칠 뒤인지(과거면 음수).
// 두 날짜를 같은 기준(UTC 자정)으로 파싱해 빼므로 실행 환경의 타임존이 결과에 섞이지 않는다.
// 서버(UTC)와 기기(KST)가 같은 D-day 문자열을 내야 SSR 하이드레이션이 갈라지지 않는다
// — new Date() 로 오늘을 만들면 KST 00~09시에 서버는 어제, 기기는 오늘이 되어 React #418 이 난다.
export function kstDaysUntil(ymd: string, today: string = kstYmdStr()): number {
  const target = Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`)
  const base = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(target) || Number.isNaN(base)) return NaN
  return Math.round((target - base) / 86400000)
}

// @db.Date 칸에 넣을 'YYYY-MM-DD' → **UTC 자정** Date. 날짜만 뜻하는 값의 저장 정본이다.
//
// 왜 필요한가 — `new Date(`${ymd}T00:00:00`)` 은 오프셋이 없어 **실행 환경의 타임존으로** 읽힌다.
// Vercel(UTC)에서는 UTC 자정이라 맞지만, KST 기기에서 같은 코드를 돌리면 전날 15:00Z 가 되고
// @db.Date 는 UTC 날짜 부분을 잘라 저장하므로 **하루 앞선 날짜가 박힌다**. 프로덕션에서만 맞는
// 코드라 눈에 안 띄는 것이 이 결함의 성질이다(2026-08-12 청소 날짜에서 발견).
//
// 읽는 쪽과도 짝이 맞는다 — lib/fmtDate 는 +9h 시프트 후 UTC 게터를 쓰는데, UTC 자정 값은
// 그 시프트로 날짜가 안 바뀐다(fmtDate 주석의 '@db.Date 자정 저장 값은 날짜 불변').
//
// 형식이 어긋나면 Invalid Date 를 그대로 돌려준다 — 부르는 쪽이 이미 Number.isNaN 으로
// 거르고 있고, 여기서 null 로 바꾸면 그 검사가 조용히 통과해 버린다.
export function ymdToDbDate(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`)
}

// ── @db.Date 창(범위) 정본 ─────────────────────────────────────
//
// 왜 필요한가 — `new Date(y, m - 1, 1)` 은 **실행 환경의 자정**이다. KST 기기에서 그것은
// 전날 15:00Z 이고, @db.Date 비교는 UTC 날짜부만 보므로 창이 통째로 하루 앞으로 밀린다.
// 2026-08 실측: 8월 창이 [7/31 .. 8/30] 이 되어 7/31 전기요금 104만원이 8월 지출로 세어지고
// 8/31 기록은 어느 달에도 안 잡혔다. Vercel(UTC)에서는 맞게 나오므로 **프로덕션에서만 맞는
// 코드**라 눈에 안 띄는 것이 이 결함의 성질이다.
//
// 끝을 `lte 말일`이 아니라 `lt 다음 달 1일`로 잡는 이유.
//   - 말일을 셀 필요가 없다(윤년·30/31일 분기 소멸).
//   - @db.Date 든 DateTime 이든 똑같이 정확하다 — 말일 23:59:59.999 같은 '거의 자정' 끝값이
//     필요 없다. 그 형태는 밀리초 아래 값을 놓치고, 칸 타입이 바뀌면 조용히 틀어진다.
//   - 인접한 두 창이 겹치지도(이중 계상) 비지도(레코드 증발) 않는 형태가 구조로 보장된다.
export type DbDateRange = { gte: Date; lt: Date }

// 'YYYY-MM' 의 다음 달. 경계 계산 전용 내부 헬퍼다.
// 일반 용도의 정본은 lib/moveCalendar shiftMonth 지만, kstDate 는 아무 것도 import 하지 않는
// 잎 모듈로 두어야 한다 — 클라이언트 컴포넌트가 날짜 하나 때문에 달력·계약 트리를 끌어오면 안 된다.
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + m                      // 0-based(m-1) 에 한 달 더한 값
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' 한 달 창 — [그 달 1일, 다음 달 1일). */
export function monthDbRange(month: string): DbDateRange {
  return { gte: ymdToDbDate(`${month}-01`), lt: ymdToDbDate(`${nextMonth(month)}-01`) }
}

/** 'YYYY-MM' 두 달을 양끝으로 하는 창 — [from 1일, to 다음 달 1일). 양끝 달 모두 포함한다. */
export function monthsDbRange(fromMonth: string, toMonth: string): DbDateRange {
  return { gte: ymdToDbDate(`${fromMonth}-01`), lt: ymdToDbDate(`${nextMonth(toMonth)}-01`) }
}

/** 한 해 창 — [1/1, 다음 해 1/1). */
export function yearDbRange(year: number | string): DbDateRange {
  const y = Number(year)
  return { gte: ymdToDbDate(`${y}-01-01`), lt: ymdToDbDate(`${y + 1}-01-01`) }
}

/** 하루 창 — ['YYYY-MM-DD', 다음 날). UTC 자정끼리의 덧셈이라 서머타임이 끼어들 여지가 없다. */
export function dayDbRange(ymd: string): DbDateRange {
  const gte = ymdToDbDate(ymd)
  return { gte, lt: new Date(gte.getTime() + 86400000) }
}

// @db.Date 값이 속한 달 'YYYY-MM'. 로컬 게터(getFullYear/getMonth)로 뽑으면 실행 환경
// 타임존만큼 밀리고, Date 끼리 부등호로 재면 경계일 레코드가 양쪽 버킷에서 탈락한다.
// 저장 정본이 UTC 자정(ymdToDbDate)이므로 UTC 날짜부가 곧 달력 날짜다.
export function dbDateMonthKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toISOString().slice(0, 7)
}

// ── 타임스탬프 칸의 월 창 정본 ──────────────────────────────────
//
// 위 monthDbRange 는 **@db.Date 전용**이다. 저장 정본이 UTC 자정이라 UTC 로 창을 잡는 것이 맞다.
// 그런데 DateTime(시각까지 있는 칸)에 그 창을 쓰면 **KST 자정 경계에서 하루가 밀린다**.
// 8월 창 [2026-08-01T00:00Z .. 2026-09-01T00:00Z) 는 KST 로 [8/1 09:00 .. 9/1 09:00) 이라,
// KST 8/1 새벽 3시에 찍힌 값은 7월 창에 들어가고 KST 9/1 새벽 값은 8월로 샌다.
//
// 사람이 보는 달은 KST 달이므로 창의 양끝도 KST 자정이어야 한다. 오프셋을 명시해 만들면
// 실행 환경 타임존이 결과에 섞이지 않는다(kstDateTimeToUtc 와 같은 관행).
// 끝을 lt 다음 달 1일로 잡는 이유는 monthDbRange 주석과 같다.
export function kstMonthTsRange(month: string): DbDateRange {
  return {
    gte: new Date(`${month}-01T00:00:00.000+09:00`),
    lt: new Date(`${nextMonth(month)}-01T00:00:00.000+09:00`),
  }
}

// 타임스탬프가 속한 **KST 달** 'YYYY-MM'. KST 는 DST 가 없어 +9h 고정 시프트 후
// UTC 날짜부가 곧 KST 달력이다(splitKstDateTime 과 같은 관행).
// toISOString().slice(0, 7) 을 그냥 쓰면 KST 새벽 값이 전달로 떨어진다.
export function kstMonthKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d)
  return new Date(dt.getTime() + 9 * 3600000).toISOString().slice(0, 7)
}

// ── 시각까지 있는 일시(날짜 + HH:mm) ────────────────────────────
// 날짜만 다루는 위 함수들과 달리 '몇 시 몇 분'이 함께 있는 값이다.
// 폼은 오프셋 없는 "2026-08-05T14:46"(= 사용자가 본 KST)을 보내는데, 서버(UTC)의
// new Date() 는 그걸 UTC 로 읽어 9시간 뒤로 저장한다. 읽기는 기기(KST) 로컬 게터라
// 다시 +9h 로 보이고, 그 부풀린 값을 저장하면 또 9시간이 붙는 래칫이 된다(신고 54bce9c5).
// 쓰기는 kstDateTimeToUtc, 읽기는 splitKstDateTime 으로 짝을 맞춘다.

// 폼이 보낸 KST 날짜·시각을 저장용 UTC Date 로. 값이 비었거나 형식이 어긋나면 null.
// ymd 에 "YYYY-MM-DDTHH:mm" 처럼 시각이 붙어 와도 되고(폼 hidden 이 합쳐 보내는 형태),
// 그때 hm 을 따로 주면 hm 이 우선한다. 시각이 없으면 KST 자정.
export function kstDateTimeToUtc(ymd: string | null | undefined, hm?: string | null): Date | null {
  const raw = (ymd ?? '').trim()
  if (!raw) return null
  const date = raw.slice(0, 10)
  const time = ((hm ?? '').trim() || raw.slice(11, 16) || '00:00').slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time}:00+09:00`)   // 오프셋 명시 — 실행 환경 타임존 무관
  return Number.isNaN(d.getTime()) ? null : d
}

// 저장된 시각을 KST 의 날짜·시각 짝으로 — date/time 입력 프리필과 일시 표기용.
// KST 는 DST 가 없어 +9h 고정 시프트 후 UTC 게터가 곧 KST 성분이다.
export function splitKstDateTime(d: Date | string | null | undefined): { ymd: string; hm: string } {
  if (!d) return { ymd: '', hm: '' }
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return { ymd: '', hm: '' }
  const k = new Date(dt.getTime() + 9 * 3600000)
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
  return { ymd: kstYmdStr(dt), hm }
}

// KST 기준 base(기본 오늘)에서 n개월 전 날짜를 "YYYY-MM-DD"로.
// 대상 월에 그 '일'이 없으면 말일로 맞춘다(금융앱 관례, 예: 5/31의 1개월 전 → 4/30).
export function kstMonthsAgoStr(n: number, base: Date = new Date()): string {
  const { year, month, day } = kstYmd(base)   // month는 1-based
  const targetIdx = (month - 1) - n           // 0-based 월 인덱스에서 차감
  const ty = year + Math.floor(targetIdx / 12)
  const tm = ((targetIdx % 12) + 12) % 12      // 0-based, 음수 정규화
  const lastDay = new Date(ty, tm + 1, 0).getDate()
  const d = Math.min(day, lastDay)
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
