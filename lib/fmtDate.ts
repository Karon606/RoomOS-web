// 날짜 표시 정본 포맷터 — 페이지별 로컬 fmtDate 재정의 금지(감사 B5, 2026-07-10).
// 규칙: 목록·표 = fmtDateDot('2026.07.10') · 문장·상세 = fmtDateKor('2026년 7월 10일 (금)') · 짧은 인라인 = fmtMD('7/10').
// 기존 로컬 정의를 발견하면 이 모듈로 치환한다(신규 코드는 반드시 여기서 import).

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

// KST 고정 — 서버(UTC)와 클라이언트(KST)가 같은 문자열을 그리도록. 로컬 시간대 기반이면
// 자정 전후 타임스탬프가 서버·클라에서 하루 다르게 렌더되어 하이드레이션 불일치(#418 계열)와
// 날짜 표기 흔들림이 생긴다. +9h 시프트 후 UTC 게터 사용(@db.Date 자정 저장 값은 날짜 불변).
const KST_MS = 9 * 3600000

const toKstDate = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : new Date(dt.getTime() + KST_MS)
}

/** 목록·표용 — '2026.07.10' (KST 기준) */
export function fmtDateDot(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCFullYear()}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** 문장·상세용 — '2026년 7월 10일 (금)' (KST 기준) */
export function fmtDateKor(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCFullYear()}년 ${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${DAYS[dt.getUTCDay()]})`
}

/** 짧은 인라인용 — '7/10' (KST 기준) */
export function fmtMD(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`
}

/** 월·일 문장용 — '7월 29일' (KST 기준). 대시보드 '실제이체' 표기와 동일 문법(카드정산 공유) */
export function fmtMonthDayKor(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일`
}
