/**
 * Stayeum Chart Color System — Brand Guide v1.3 §14.1 데이터 시각화 팔레트.
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
 * §23.2 차트·개념 색 매핑 — 개념별 고정 토큰 1:1 (단일 출처).
 * 같은 개념(수입·지출·완납…)은 recharts·자체 DonutChart·KPI 어디서나 같은 색.
 * 의미가 있는 개념은 §14.4 의미색 토큰, 의미 없는 분류는 viz 토큰.
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

/** 지출 카테고리 고정 색상 매핑 — viz 토큰 고정 배정 */
export const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  '관리비':      'var(--viz-1)',
  '수선유지':    'var(--viz-4)',
  '세금':        'var(--viz-5)',
  '인건비':      'var(--viz-2)',
  '소모품':      'var(--viz-3)',
  '보증금 반환': 'var(--viz-7)',
  '기타':        'var(--viz-8)',
}

/** 성별 색상 매핑 */
export const GENDER_COLORS: Record<string, string> = {
  MALE:    'var(--viz-2)', // camel
  FEMALE:  'var(--viz-6)', // dusty rose
  OTHER:   'var(--viz-7)', // sage
  UNKNOWN: 'var(--viz-8)', // taupe
}

/** 입주 상태 색상 매핑 — 상태 의미가 있는 색은 상태 토큰 우선(§14.2) */
export const STATUS_COLORS = {
  active:      'var(--success)', // 거주중 — Warm Olive (상태 토큰)
  reserved:    'var(--viz-2)',   // 예약 — camel (StatusBadge movein 톤과 동일 계열)
  checkout:    'var(--viz-4)',   // 퇴실 예정 — amber
  nonResident: 'var(--viz-8)',   // 비거주 — taupe
}
