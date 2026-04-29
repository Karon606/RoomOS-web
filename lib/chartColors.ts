/**
 * RoomOS Chart Color System
 * 브랜드 웜톤 기반 10색 팔레트 — 지출/수익 카테고리 그래프 전용
 * Design: RoomOS Chart Colors.html
 */

export const CHART_COLORS = [
  '#e8893a', // Warm Orange  — 1순위
  '#f4623a', // Coral (Brand)— 2순위
  '#d4a847', // Amber Gold   — 3순위
  '#b8c45a', // Warm Lime    — 4순위
  '#6aab7e', // Sage Green   — 5순위
  '#5aa4b8', // Dusty Teal   — 6순위
  '#7b8fc4', // Periwinkle   — 7순위
  '#a87cc0', // Dusty Purple — 8순위
  '#c07a9a', // Dusty Rose   — 9순위
  '#c09878', // Warm Taupe   — 10순위
] as const

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}

/** 지출 카테고리 고정 색상 매핑 */
export const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  '관리비':      '#f4623a', // Coral (브랜드)
  '수선유지':    '#d4a847', // Amber Gold
  '세금':        '#7b8fc4', // Periwinkle
  '인건비':      '#e8893a', // Warm Orange
  '소모품':      '#b8c45a', // Warm Lime
  '보증금 반환': '#5aa4b8', // Dusty Teal
  '기타':        '#c09878', // Warm Taupe
}

/** 성별 색상 매핑 */
export const GENDER_COLORS: Record<string, string> = {
  MALE:    '#7b8fc4', // Periwinkle
  FEMALE:  '#c07a9a', // Dusty Rose
  OTHER:   '#a87cc0', // Dusty Purple
  UNKNOWN: '#c09878', // Warm Taupe
}

/** 입주 상태 색상 매핑 */
export const STATUS_COLORS = {
  active:      '#6aab7e', // Sage Green — 거주중
  reserved:    '#5aa4b8', // Dusty Teal — 입실 예정
  checkout:    '#d4a847', // Amber Gold — 퇴실 예정
  nonResident: '#c09878', // Warm Taupe — 비거주자
}
