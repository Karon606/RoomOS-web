// RoomOS 운영 상수 — 하드코딩 분산 방지를 위해 한 곳에서 관리.
// 사업장별로 다르게 가져가야 할 값이 생기면 Property 스키마로 옮겨 DB 저장으로 전환.

// ── 알림 윈도우 ──────────────────────────────────────────────
// 대시보드 알림에서 입주/퇴실/투어 등 이벤트를 보여주는 시간 범위
export const ALERT_WINDOW_BEFORE_DAYS = 7    // 오늘로부터 N일 이전까지 표시
export const ALERT_WINDOW_AFTER_DAYS  = 30   // 오늘로부터 N일 이후까지 표시

// 미수/도래 임박 알림 — daysOverdue가 -N ~ 0일 때 '납부 예정' 알림 노출
export const UNPAID_UPCOMING_ALERT_DAYS = 7

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
