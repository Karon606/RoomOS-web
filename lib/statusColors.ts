// 입주·계약 상태 색상 — 브랜드 가이드 준수. 앱 전역 단일 출처.
//
// 각 페이지에 흩어져 있던 emerald/amber/blue/purple 등 off-brand 색을
// 브랜드 5계열로 통일: Success green · Honey · Camel · Terracotta-pale · Neutral.
//
// 사용:
//   뱃지   → statusBadge(status)  (px-2 py-0.5 rounded-* 와 함께)
//   라벨   → statusLabel(status)
//   카드   → CARD_TONE[tone] / CARD_ACCENT[tone], roomCardTone()/tenantCardTone()

/** 상태값 → 한국어 라벨 */
export const STATUS_LABEL: Record<string, string> = {
  ACTIVE:           '거주중',
  RESERVED:         '예약',
  CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT:      '퇴실',
  WAITING_TOUR:     '투어 대기',
  TOUR_DONE:        '투어 완료',
  CANCELLED:        '입실 취소',
  NON_RESIDENT:     '비거주자',
}

// 뱃지 — 전부 globals.css 브랜드 토큰. 페일 배경 + 가독 텍스트 + 옅은 ring.
//   green = --st-live · honey = --st-leaving · camel = --st-incoming
//   coral = --coral-pale · neutral = --canvas/--warm-border
const BADGE_GREEN   = 'bg-[var(--st-live-bg)] text-[var(--st-live-fg)] ring-1 ring-[var(--st-live-fg)]/25'
const BADGE_HONEY   = 'bg-[var(--st-leaving-bg)] text-[var(--st-leaving-fg)] ring-1 ring-[var(--st-leaving-fg)]/30'
const BADGE_CAMEL   = 'bg-[var(--st-incoming-bg)] text-[var(--st-incoming-fg)] ring-1 ring-[var(--st-incoming-fg)]/30'
const BADGE_CORAL   = 'bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/25'
const BADGE_NEUTRAL = 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]'

/** 상태 뱃지 클래스 */
export const STATUS_BADGE: Record<string, string> = {
  ACTIVE:           BADGE_GREEN,
  CHECKOUT_PENDING: BADGE_HONEY,
  RESERVED:         BADGE_CAMEL,
  NON_RESIDENT:     BADGE_CAMEL,
  TOUR_DONE:        BADGE_CORAL,
  WAITING_TOUR:     BADGE_CORAL,
  CHECKED_OUT:      BADGE_NEUTRAL,
  CANCELLED:        BADGE_NEUTRAL,
}

export function statusBadge(status: string | null | undefined): string {
  return (status && STATUS_BADGE[status]) || BADGE_NEUTRAL
}
export function statusLabel(status: string | null | undefined): string {
  return (status && STATUS_LABEL[status]) || '—'
}

// ── 카드 톤 ────────────────────────────────────────────────────────
// 카드 배경·테두리로 상태를 텍스트 없이 구분.

export type CardTone = 'live' | 'vacant' | 'inquiry' | 'ended'

/** 카드 컨테이너 배경·테두리 클래스 */
export const CARD_TONE: Record<CardTone, string> = {
  live:    'bg-[var(--st-card-live)] border-[var(--st-live-fg)]/25',  // 거주중 — 은은한 Success 그린 틴트
  vacant:  'bg-[var(--cream-2)] border-[var(--warm-border)]',         // 공실 — Page 회색톤, 가라앉음
  inquiry: 'bg-[var(--cream)] border-[var(--coral)]/25',              // 문의·투어 — Terracotta 페일
  ended:   'bg-[var(--cream-2)] border-[var(--warm-border)]',         // 퇴실·취소 — 중립
}

/** 카드 왼쪽 액센트 바 색 (없으면 null) */
export const CARD_ACCENT: Record<CardTone, string | null> = {
  live:    'var(--st-card-accent)',
  vacant:  null,
  inquiry: 'var(--coral)',
  ended:   null,
}

/** 카드 안의 흐림(가라앉음) 여부 — vacant/ended는 텍스트를 뮤트 처리 */
export function isMutedTone(tone: CardTone): boolean {
  return tone === 'vacant' || tone === 'ended'
}

/** 호실 상태 라벨('거주중'|'퇴실 예정'|'공실'|'예약') → 카드 톤 */
export function roomCardTone(label: string): CardTone {
  if (label === '거주중' || label === '퇴실 예정') return 'live'
  return 'vacant' // 공실·예약 = 빈 방
}

/** 입주자/계약 상태 → 카드 톤 */
export function tenantCardTone(status: string | null | undefined): CardTone {
  switch (status) {
    case 'ACTIVE':
    case 'CHECKOUT_PENDING': return 'live'
    case 'RESERVED':
    case 'WAITING_TOUR':
    case 'TOUR_DONE':        return 'inquiry'
    case 'CHECKED_OUT':
    case 'CANCELLED':        return 'ended'
    default:                 return 'vacant'
  }
}
