// 스테이음 운영 상수 — 하드코딩 분산 방지를 위해 한 곳에서 관리.
// 사업장별로 다르게 가져가야 할 값이 생기면 Property 스키마로 옮겨 DB 저장으로 전환.

// ── 알림 윈도우 ──────────────────────────────────────────────
// 대시보드 알림에서 입주/퇴실/투어 등 이벤트를 보여주는 시간 범위
export const ALERT_WINDOW_BEFORE_DAYS = 7    // 오늘로부터 N일 이전까지 표시
export const ALERT_WINDOW_AFTER_DAYS  = 30   // 오늘로부터 N일 이후까지 표시

// 미수/도래 임박 알림 — daysOverdue가 -N ~ 0일 때 '납부 예정' 알림 노출
export const UNPAID_UPCOMING_ALERT_DAYS = 7

// 대시보드 알림 '지금 급함' 존 기준 — 경과(음수)이거나 D-N 이내면 긴급으로 최상단 노출
// (urgencyDays <= 이 값 → 긴급. 0=오늘, 1=내일, 2=모레)
// 카테고리에 오버라이드 없으면 이 전역값 사용.
export const ALERT_URGENT_WITHIN_DAYS = 2

// 카테고리별 '지금 급함' 임계값(L 후속 폴리시) — 카테고리마다 "급함"의 시간 감각이 달라서.
// 키는 AlertCat(dashboard/DashboardClient.tsx). 값은 ALERT_URGENT_WITHIN_DAYS 와 동일 의미(D-N).
// 미정 카테고리는 전역 ALERT_URGENT_WITHIN_DAYS 사용.
// (사업장별 다르게 가져가야 하면 Property 컬럼으로 옮길 것)
export const ALERT_URGENT_CATEGORY_DAYS: Record<string, number> = {
  unpaid:    0,  // 미납 — 도래 즉시 급함
  upcoming:  2,  // 납부예정 — 2일 전부터 (전역과 동일)
  moveout:   3,  // 퇴실예정 — 사전 준비 필요
  movein:    3,  // 입주예정 — 사전 준비 필요
  tour:      1,  // 투어예정 — 당일/전날만 급함
  wish:     -1,  // 희망호실 — 절대 긴급 아님(임계값 < 모든 urgencyDays)
  request:   0,  // 요청·컴플레인 — 들어오면 바로 대응
  recurring: 2,  // 고정지출 — 며칠 전 알림 (전역과 동일)
  inventory: 5,  // 재고소진 — 발주 리드타임 고려해 더 일찍
  receipt:   2,  // 현금영수증 발급 기한(수취+5일) — 이틀 전부터 급함
  depositReturn: 0,  // 보증금 반환 대기 — 돌려줄 돈이라 뜨는 즉시 급함(잊힘 방지가 존재 이유)
}

// ── 고정 지출(RecurringExpense) 신규 추가 폼 디폴트 ─────────
export const DEFAULT_RECURRING_DUE_DAY         = '25'
export const DEFAULT_RECURRING_CATEGORY        = '관리비'
export const DEFAULT_RECURRING_ALERT_DAYS_BEFORE = '7'

// ── 체크리스트 ──────────────────────────────────────────────
// 신규 항목 생성 시 알림 시작일 디폴트 (도래일 N일 전)
export const DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE = 3

// ── 수납 FIFO 분배 안전장치 ─────────────────────────────────
// 한 번 입금이 N개월 이상으로 분배되지 않도록 차단 (무한루프 방지)
// 24개월 → 60개월 (5년)으로 확장. 장기 선납 케이스 수용.
export const FIFO_MAX_ALLOCATE_MONTHS = 60

// ── 부가수익 세부 항목 자동완성 ──────────────────────────────
// 과거 지출 detail 텍스트에서 자동완성 제안 시 조회 한계
export const FINANCE_DETAIL_SUGGESTIONS_LIMIT = 1000
