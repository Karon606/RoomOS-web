// 입주·계약 상태 — 라벨 + 카드 종류 매핑.
// 색/스타일은 RoomCard(카드 베이스) · StatusBadge(예외 뱃지) 컴포넌트가 전담.
// 이 파일은 "상태값 → 무슨 종류의 카드인가" 만 정한다.

import type { CardKind } from '@/components/ui/RoomCard'
import type { BadgeTone } from '@/components/ui/StatusBadge'

/** 상태값 → 한국어 라벨 (오류신고 e1b81629 용어 재정의 — knowledge/glossary '예약 용어' 참조).
 *  '예약'은 방(입실) 예약에만 쓴다 — 투어 쪽은 '투어 예정'으로 분리해 이중 의미 제거.
 *  WAITING_TOUR는 tourDate 없으면 화면상 '문의'로 파생 표시(enum 신설 없음) — statusException(opts) 사용. */
export const STATUS_LABEL: Record<string, string> = {
  ACTIVE:           '거주중',
  RESERVED:         '입실 예약',
  CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT:      '퇴실',
  WAITING_TOUR:     '투어 예정',
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
 *  거주중·퇴실·입실취소는 뱃지 없음. 진행 단계/전환 상태만 뱃지.
 *  hasTourDate === false 인 WAITING_TOUR는 '문의'(투어일 미지정 = 연락만 받은 상태) — 톤은 동일 neutral 계열. */
export function statusException(
  status: string | null | undefined,
  opts?: { hasTourDate?: boolean },
): { tone: BadgeTone; label: string } | null {
  switch (status) {
    case 'CHECKOUT_PENDING': return { tone: 'exit',   label: '퇴실 예정' }
    case 'RESERVED':         return { tone: 'movein', label: '입실 예약' }
    case 'WAITING_TOUR':     return { tone: 'info',   label: opts?.hasTourDate === false ? '문의' : '투어 예정' }
    case 'TOUR_DONE':        return { tone: 'info',   label: '투어 완료' }
    default:                 return null
  }
}

/** 입주자/계약 상태 → Status Row 좌측 팁 톤.
 *  예외 상태는 그 톤, 거주중(resident)은 olive(paid),
 *  퇴실·입실취소(vacant)는 null — RoomCard vacant 기본(ink-mute 팁) 유지. */
export function leaseTipTone(status: string | null | undefined): BadgeTone | null {
  const ex = statusException(status)
  if (ex) return ex.tone
  return leaseCardKind(status) === 'resident' ? 'paid' : null
}
