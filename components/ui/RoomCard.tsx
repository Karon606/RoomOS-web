'use client'

// 상태 카드 베이스 — "이 카드는 어떤 종류인가" 를 배경 톤으로 표현.
//   resident 거주 중 — 연한 Warm Olive 톤
//   vacant   비거주·공실 — cream-soft + opacity 0.72 (가라앉음)
//   neutral  일반 데이터 (수납·재고 등) — cream 단색
//   overdue  연체 — 좌측 Terracotta 보더 + 옅은 틴트 (v1.1 긴급 상태 패턴)
//
// 정상 상태는 베이스만으로 충분 — 뱃지는 예외일 때만 badge 슬롯으로.

import type { ReactNode, CSSProperties } from 'react'

export type CardKind = 'resident' | 'vacant' | 'neutral'

const KIND: Record<CardKind, { bg: string; bd: string; opacity?: number }> = {
  resident: { bg: 'var(--card-resident-bg)', bd: 'var(--card-resident-bd)' },
  vacant:   { bg: 'var(--card-vacant-bg)',   bd: 'var(--card-vacant-bd)', opacity: 0.72 },
  neutral:  { bg: 'var(--card-neutral-bg)',  bd: 'var(--card-neutral-bd)' },
}

export function RoomCard({
  kind = 'neutral',
  badge,
  selected = false,
  overdue = false,
  onClick,
  className,
  children,
}: {
  kind?: CardKind
  /** 예외 상황 뱃지 — 있을 때만 우상단에 표시 */
  badge?: ReactNode
  /** 선택 모드 강조 (Terracotta 테두리) */
  selected?: boolean
  /** 연체 — 좌측 Terracotta 보더 + 옅은 틴트 (v1.1 긴급 상태 패턴) */
  overdue?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  const k = KIND[kind]
  const style: CSSProperties = selected
    ? { background: 'var(--cream)', borderColor: 'var(--coral)', borderWidth: 2, boxShadow: '0 0 0 2px rgba(160,60,46,0.20)' }
    : overdue
      ? { background: 'rgba(160,60,46,0.045)', borderColor: 'var(--card-neutral-bd)', borderLeftColor: 'var(--coral)', borderLeftWidth: 3 }
      : { background: k.bg, borderColor: k.bd, opacity: k.opacity }
  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl border transition-colors ${onClick ? 'cursor-pointer active:brightness-[0.97]' : ''} ${className ?? ''}`}
      style={style}
    >
      {children}
      {badge && <div className="absolute top-3 right-3 z-[1]">{badge}</div>}
    </div>
  )
}
