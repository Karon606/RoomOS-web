'use client'

// 상태 카드 베이스 — "이 카드는 어떤 종류인가" 를 배경 톤으로 표현.
//   resident 거주 중 — 연한 Warm Olive 톤
//   vacant   비거주·공실 — cream-soft + 좌측 ink-m 3px 팁 + opacity 0.6 (가라앉음, v1.2)
//   neutral  일반 데이터 (수납·재고 등) — cream 단색
//   overdue  연체 — 좌측 Terracotta 3px 팁 + 옅은 틴트 (v1.2 긴급 상태 패턴)
//
// 정상 상태는 베이스만으로 충분 — 뱃지는 예외일 때만 badge 슬롯으로.

import type { ReactNode, CSSProperties } from 'react'

export type CardKind = 'resident' | 'vacant' | 'neutral'

const KIND: Record<CardKind, { bg: string; bd: string; opacity?: number }> = {
  resident: { bg: 'var(--card-resident-bg)', bd: 'var(--card-resident-bd)' },
  vacant:   { bg: 'var(--card-vacant-bg)',   bd: 'var(--card-vacant-bd)', opacity: 0.6 },
  neutral:  { bg: 'var(--card-neutral-bg)',  bd: 'var(--card-neutral-bd)' },
}

export function RoomCard({
  kind = 'neutral',
  badge,
  selected = false,
  overdue = false,
  tipColor,
  tipBg,
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
  /** 상태별 좌측 3px 팁 색 — 지정 시 그 색으로 좌측 보더 (Status Row 패턴). */
  tipColor?: string
  /** 상태별 옅은 배경 틴트 — tipColor 와 함께 쓰면 Status Row 행 틴트 (rgba 권장). */
  tipBg?: string
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  const k = KIND[kind]
  const style: CSSProperties = selected
    ? { background: 'var(--cream)', borderColor: 'var(--coral)', borderWidth: 2, boxShadow: '0 0 0 2px rgba(160,60,46,0.20)' }
    : overdue
      ? { background: 'rgba(160,60,46,0.045)', borderColor: 'var(--card-neutral-bd)', borderLeftColor: 'var(--coral)', borderLeftWidth: 3 }
      : tipColor
        ? { background: tipBg ?? k.bg, borderColor: k.bd, borderLeftColor: tipColor, borderLeftWidth: 3, opacity: k.opacity }
        : kind === 'vacant'
          ? { background: k.bg, borderColor: k.bd, borderLeftColor: 'var(--ink-mute)', borderLeftWidth: 3, opacity: k.opacity }
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
