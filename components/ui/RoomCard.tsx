'use client'

// 상태 카드 베이스 — "이 카드는 어떤 종류인가" 를 배경 톤으로 표현.
//   resident 거주 중 — 연한 Warm Olive 톤
//   vacant   비거주·공실 — cream-soft + 좌측 ink-m 3px 팁 + opacity 0.6 (가라앉음, v1.2)
//   neutral  일반 데이터 (수납·재고 등) — cream 단색
//   overdue  연체 — 좌측 Terracotta 3px 팁 + 옅은 틴트 (v1.2 긴급 상태 패턴)
//
// 정상 상태는 베이스만으로 충분 — 뱃지는 예외일 때만 badge 슬롯으로.

import { useRef } from 'react'
import type { ReactNode, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

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
  onLongPress,
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
  /** 꾹 눌러 선택 모드 진입 — v2.0 §23 공통 제스처(500ms, 10px 이동 시 취소). 발화 후 click 억제. */
  onLongPress?: () => void
  className?: string
  children: ReactNode
}) {
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = useRef(false)
  const lpStart = useRef<{ x: number; y: number } | null>(null)
  const lpClear = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }
  const lpDown = (e: ReactPointerEvent) => {
    if (!onLongPress) return
    lpStart.current = { x: e.clientX, y: e.clientY }
    lpClear()
    lpTimer.current = setTimeout(() => { lpFired.current = true; onLongPress() }, 500)
  }
  const lpMove = (e: ReactPointerEvent) => {
    if (lpStart.current && (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10)) lpClear()
  }
  const k = KIND[kind]
  const style: CSSProperties = selected
    ? { background: 'var(--cream)', borderColor: 'var(--coral)', borderWidth: 2, boxShadow: '0 0 0 2px color-mix(in srgb, var(--coral) 20%, transparent)' }
    : overdue
      ? { background: 'color-mix(in srgb, var(--coral) 4.5%, transparent)', borderColor: 'var(--card-neutral-bd)', borderLeftColor: 'var(--coral)', borderLeftWidth: 3 }
      : tipColor
        ? { background: tipBg ?? k.bg, borderColor: k.bd, borderLeftColor: tipColor, borderLeftWidth: 3, opacity: k.opacity }
        : kind === 'vacant'
          ? { background: k.bg, borderColor: k.bd, borderLeftColor: 'var(--ink-mute)', borderLeftWidth: 3, opacity: k.opacity }
          : { background: k.bg, borderColor: k.bd, opacity: k.opacity }
  return (
    <div
      onClick={(onClick || onLongPress) ? () => {
        if (lpFired.current) { lpFired.current = false; return }
        onClick?.()
      } : undefined}
      onPointerDown={lpDown}
      onPointerMove={lpMove}
      onPointerUp={lpClear}
      onPointerLeave={lpClear}
      onContextMenu={onLongPress ? e => e.preventDefault() : undefined}
      className={`relative rounded-xl border transition-colors ${onClick ? 'cursor-pointer active:brightness-[0.97]' : ''} ${onLongPress ? 'select-none' : ''} ${className ?? ''}`}
      style={style}
    >
      {children}
      {badge && <div className="absolute top-3 right-3 z-[1]">{badge}</div>}
    </div>
  )
}
