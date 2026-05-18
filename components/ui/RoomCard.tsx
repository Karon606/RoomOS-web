'use client'

// 상태 카드 베이스 — "이 카드는 어떤 종류인가" 를 배경 톤으로 표현.
//   resident 거주 중   — 연한 Success 톤
//   vacant   비거주·공실 — cream-soft + opacity 0.72 (가라앉음)
//   neutral  일반 데이터 (수납·재고 등) — cream 단색
//
// 정상 상태는 이 베이스만으로 충분 — 뱃지는 예외일 때만 badge 슬롯으로.
// 좌측 border 강조·색 dot·카드 배경 직접 지정 금지.

import type { ReactNode } from 'react'

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
  onClick,
  className,
  children,
}: {
  kind?: CardKind
  /** 예외 상황 뱃지 — 있을 때만 우상단에 표시 */
  badge?: ReactNode
  /** 선택 모드 강조 (Terracotta 테두리) */
  selected?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  const k = KIND[kind]
  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl border transition-colors ${onClick ? 'cursor-pointer active:brightness-[0.97]' : ''} ${className ?? ''}`}
      style={
        selected
          ? { background: 'var(--cream)', borderColor: 'var(--coral)', borderWidth: 2, boxShadow: '0 0 0 2px rgba(160,60,46,0.20)' }
          : { background: k.bg, borderColor: k.bd, opacity: k.opacity }
      }
    >
      {children}
      {badge && <div className="absolute top-3 right-3 z-[1]">{badge}</div>}
    </div>
  )
}
