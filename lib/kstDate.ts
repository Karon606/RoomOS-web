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
