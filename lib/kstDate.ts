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
