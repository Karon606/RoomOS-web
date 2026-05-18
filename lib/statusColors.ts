// 입주·계약 상태 — 라벨 + 카드 종류 매핑.
// 색/스타일은 RoomCard(카드 베이스) · StatusBadge(예외 뱃지) 컴포넌트가 전담.
// 이 파일은 "상태값 → 무슨 종류의 카드인가" 만 정한다.

import type { CardKind } from '@/components/ui/RoomCard'
import type { BadgeTone } from '@/components/ui/StatusBadge'

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

export function statusLabel(status: string | null | undefined): string {
  return (status && STATUS_LABEL[status]) || '—'
}

/** 입주자/계약 상태 → 카드 종류 (RoomCard kind).
 *  거주중·퇴실예정 = resident / 퇴실·입실취소 = vacant / 문의·예약 등 진행중 = neutral */
export function leaseCardKind(status: string | null | undefined): CardKind {
  switch (status) {
    case 'ACTIVE':
    case 'CHECKOUT_PENDING': return 'resident'
    case 'CHECKED_OUT':
    case 'CANCELLED':        return 'vacant'
    default:                 return 'neutral'
  }
}

/** 입주자/계약 상태 → 예외 뱃지 (정상 상태는 null — 카드 베이스만으로 표현).
 *  거주중·퇴실·입실취소는 뱃지 없음. 진행 단계/전환 상태만 뱃지. */
export function statusException(
  status: string | null | undefined,
): { tone: BadgeTone; label: string } | null {
  switch (status) {
    case 'CHECKOUT_PENDING': return { tone: 'exit',   label: '퇴실 예정' }
    case 'RESERVED':         return { tone: 'movein', label: '예약' }
    case 'WAITING_TOUR':     return { tone: 'info',   label: '투어 대기' }
    case 'TOUR_DONE':        return { tone: 'info',   label: '투어 완료' }
    default:                 return null
  }
}
