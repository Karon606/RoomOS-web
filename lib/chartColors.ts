/**
 * Stayeum Chart Color System — v2.0 §04 데이터 시각화 팔레트.
 * 시리즈는 viz-1부터 순서대로 배정(화면마다 재배치 금지). raw 팔레트·자체 hex 금지.
 * 값은 globals.css 의 --viz-* 토큰 (수치 원본은 docs/brand-guide-v1.3.md).
 */

export const CHART_COLORS = [
  'var(--viz-1)', // terracotta — 주 시리즈
  'var(--viz-2)', // camel
  'var(--viz-3)', // warm olive
  'var(--viz-4)', // amber
  'var(--viz-5)', // deep wine
  'var(--viz-6)', // dusty rose
  'var(--viz-7)', // sage
  'var(--viz-8)', // taupe
] as const

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}

/**
 * v2.0 §24 차트·개념 색 매핑 — 개념별 고정 토큰 1:1 (단일 출처).
 * 같은 개념(수입·지출·완납…)은 recharts·자체 DonutChart·KPI 어디서나 같은 색.
 * 의미가 있는 개념은 v2.0 §04 의미색 토큰, 의미 없는 분류는 viz 토큰.
 */
export const CONCEPT_COLORS = {
  income:   'var(--tc)',             // 수입
  expense:  'var(--ink-s)',          // 지출
  etcIncome:'var(--camel)',          // 기타수익
  deposit:  'var(--deposit-fg)',     // 보증금
  reserve:  'var(--reserve-fg)',     // 예비비
  paid:     'var(--success-fg)',     // 완납
  await:    'var(--info-fg)',        // 예정
  unpaid:   'var(--warning-fg)',     // 미납
  overdue:  'var(--overdue-solid)',  // 연체
} as const

/**
 * 지출 카테고리 고정 색 — **영업장 설정의 등록 순서**가 색을 정한다(정본 목록은
 * settings/actions 의 getExpenseCategories). 카테고리 이름을 코드에 박지 않는다:
 * 목록은 영업장마다 다르고 운영자가 언제든 더하고 지운다.
 *
 * 왜 등록 순서인가. 종전에는 그 달 **금액 순위**가 색이었다. 같은 임대료가 7월에는 2위라
 * 카멜, 8월에는 1위라 테라코타여서 두 달 도넛을 나란히 놓고 비교할 수가 없었다.
 * 등록 순서는 달과 무관하므로 같은 카테고리는 언제나 같은 색이다.
 *
 * 목록에 없는 카테고리(설정에서 지운 뒤 과거 지출만 남은 것 — 실데이터 '청소비' 1종)는
 * 이름으로 자리를 정한다. 그 달에 무엇이 함께 서느냐에 기대면 달을 바꿀 때 또 흔들린다.
 *
 * 알아 둘 한계: viz 팔레트는 여덟 색뿐이라 등록 카테고리가 아홉 개를 넘으면 색이 돈다
 * (제기역점은 13종 — 9번째부터 viz-1 과 겹친다). 팔레트를 늘리는 것은 가이드 §04 개정이라
 * 운영자·디자인 판단 영역이고, 이 함수는 그 결정이 내려지면 CHART_COLORS 만 길어지면 된다.
 */
export function expenseCategoryColor(category: string, registered: readonly string[]): string {
  const i = registered.indexOf(category)
  if (i >= 0) return chartColor(i)
  let h = 0
  for (const ch of category) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return chartColor(h)
}

/** 성별 색상 매핑 */
export const GENDER_COLORS: Record<string, string> = {
  MALE:    'var(--viz-2)', // camel
  FEMALE:  'var(--viz-6)', // dusty rose
  OTHER:   'var(--viz-7)', // sage
  UNKNOWN: 'var(--viz-8)', // taupe
}

/** 입주 상태 색상 매핑 — 상태 의미가 있는 색은 상태 토큰 우선(v2.0 §04) */
export const STATUS_COLORS = {
  active:      'var(--success)', // 거주중 — Warm Olive (상태 토큰)
  reserved:    'var(--viz-2)',   // 예약 — camel (StatusBadge movein 톤과 동일 계열)
  checkout:    'var(--viz-4)',   // 퇴실 예정 — amber
  nonResident: 'var(--viz-8)',   // 비거주 — taupe
}
