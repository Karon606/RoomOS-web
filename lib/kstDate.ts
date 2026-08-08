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
