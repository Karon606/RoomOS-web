// 날짜 표시 정본 포맷터 — 페이지별 로컬 fmtDate 재정의 금지(감사 B5, 2026-07-10).
// 규칙: 목록·표 = fmtDateDot('2026.07.10') · 문장·상세 = fmtDateKor('2026년 7월 10일 (금)') · 짧은 인라인 = fmtMD('7/10').
// 기존 로컬 정의를 발견하면 이 모듈로 치환한다(신규 코드는 반드시 여기서 import).

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

const toDate = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : dt
}

/** 목록·표용 — '2026.07.10' */
export function fmtDateDot(d: Date | string | null | undefined): string {
  const dt = toDate(d)
  if (!dt) return '—'
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
}

/** 문장·상세용 — '2026년 7월 10일 (금)' */
export function fmtDateKor(d: Date | string | null | undefined): string {
  const dt = toDate(d)
  if (!dt) return '—'
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
}

/** 짧은 인라인용 — '7/10' */
export function fmtMD(d: Date | string | null | undefined): string {
  const dt = toDate(d)
  if (!dt) return '—'
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}
