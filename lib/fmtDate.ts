// 날짜 표시 정본 포맷터 — 페이지별 로컬 fmtDate 재정의 금지(감사 B5, 2026-07-10).
// 규칙: 목록·표 = fmtDateDot('2026.07.10') · 문장·상세 = fmtDateKor('2026년 7월 10일 (금)') · 짧은 인라인 = fmtMD('7/10')
//       · 요일이 정보인 짧은 인라인 = fmtMDDay('7/10 (금)').
//       · **화면 밖·범위 밖을 가리키는 인라인은 연도 포함(fmtDateDot)** — 지금 보고 있는 기간
//         안의 날짜는 몇 월인지만으로 충분하지만, 그 밖을 가리키면 어느 해인지 알 길이 없다
//         (입퇴실 캘린더의 '이후 예정 · 최초 …' 줄, 2026-08-20 등재).
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

/** 월 스코프용 — 'YYYY-MM' (KST 기준). 월 경계 판정은 반드시 이걸 쓴다(로컬 재정의 금지). */
export function kstMonthOf(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return ''
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
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

/**
 * 짧은 인라인 + 요일 — '7/10 (금)' (KST 기준).
 * 요일 자체가 정보인 자리에 쓴다(청소 업체는 화목·월수금처럼 요일로 온다 — 운영자 2026-08-10).
 * 요일은 fmtDateKor 과 같은 DAYS·같은 +9h 시프트에서 뽑는다 — 로컬 getDay() 를 쓰면
 * 서버(UTC)와 기기(KST)가 자정 전후로 다른 요일을 그려 하이드레이션이 갈린다.
 */
export function fmtMDDay(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} (${DAYS[dt.getUTCDay()]})`
}

/** 월·일 문장용 — '7월 29일' (KST 기준). 대시보드 '실제이체' 표기와 동일 문법(카드정산 공유) */
export function fmtMonthDayKor(d: Date | string | null | undefined): string {
  const dt = toKstDate(d)
  if (!dt) return '—'
  return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일`
}
