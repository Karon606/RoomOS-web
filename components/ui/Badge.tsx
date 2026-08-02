'use client'

import React from 'react'

// M7 가이드 정식 4톤 (솔리드, 강조용 — 미납·완료·경고·중립)
type SemanticTone = 'success' | 'warn' | 'danger' | 'neutral'
// 페일 톤 (부드러운 라벨용 — 거주중·예약·요청 등 상태 표시)
// inspect = v2.0 §04 in-progress(점검·처리 중) b-inspect — v2.0 §22 재고 카드 전용 과정 상태
type PaleTone = 'pale-coral' | 'pale-green' | 'pale-amber' | 'pale-blue' | 'pale-red' | 'pale-teal' | 'pale-purple' | 'pale-neutral' | 'inspect'
// 호환 alias (기존 코드)
type LegacyTone = 'coral' | 'green' | 'amber' | 'blue' | 'red' | 'teal' | 'purple'

type Tone = SemanticTone | PaleTone | LegacyTone

// Brand Guide v1.1 솔리드 톤 — 강조용. mono uppercase 권장
const SOLID_CLS: Record<SemanticTone, string> = {
  success: 'bg-[var(--success-solid)] text-[var(--on-solid)]',   // v2.0 §04 — 시맨틱 솔리드(#4E6834), viz·순백 대신
  warn:    'bg-[var(--warning-solid)] text-[var(--on-solid)]',    // v2.0 §04 — 시맨틱 솔리드(#8B5E0A), honey 새 hue 대신
  danger:  'bg-[var(--persimmon)] text-[var(--on-solid)]',
  neutral: 'bg-[var(--cream-3)] text-[var(--ink-3)]',
}

// 페일 톤 — 일반 라벨용. ring 1px solid 색약 강조
const PALE_CLS: Record<string, string> = {
  'pale-coral':  'bg-[var(--persimmon-l)] text-[var(--persimmon-d)] ring-[var(--persimmon)]/20',
  'pale-green':  'bg-[var(--success-bg)] text-[var(--success-fg)] ring-[var(--viz-3)]/30',
  'pale-amber':  'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-[var(--warning-ring)]',
  'pale-blue':   'bg-[var(--info-bg)] text-[var(--info-fg)] ring-[var(--info-ring)]',
  'pale-red':    'bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-[var(--danger-ring)]',
  'pale-teal':   'bg-[var(--reserve-bg)] text-[var(--reserve-fg)] ring-[var(--reserve-ring)]',
  'pale-purple': 'bg-[var(--deposit-bg)] text-[var(--deposit-fg)] ring-[var(--deposit-ring)]',
  // neutral 틴트 — 솔리드 neutral 은 r-sm·mono·굵기가 달라 pale 형제와 모양이 어긋난다(디자이너 패스 2026-08-02)
  'pale-neutral': 'bg-[var(--neutral-bg)] text-[var(--neutral-fg)] ring-[var(--neutral-ring)]',
  'inspect':     'bg-[var(--inspect-bg)] text-[var(--inspect-fg)] ring-[var(--inspect-ring)]',
  // legacy alias — 기존 코드 호환
  'coral':       'bg-[var(--persimmon-l)] text-[var(--persimmon-d)] ring-[var(--persimmon)]/20',
  'green':       'bg-[var(--success-bg)] text-[var(--success-fg)] ring-[var(--viz-3)]/30',
  'amber':       'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-[var(--warning-ring)]',
  'blue':        'bg-[var(--info-bg)] text-[var(--info-fg)] ring-[var(--info-ring)]',
  'red':         'bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-[var(--danger-ring)]',
  'teal':        'bg-[var(--reserve-bg)] text-[var(--reserve-fg)] ring-[var(--reserve-ring)]',
  'purple':      'bg-[var(--deposit-bg)] text-[var(--deposit-fg)] ring-[var(--deposit-ring)]',
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  icon,
  mono = false,
  children,
  className = '',
}: {
  tone?: Tone
  size?: 'sm' | 'md'
  icon?: React.ReactNode
  /** M7 가이드 솔리드 톤일 때 mono+uppercase로 표시. 페일 톤은 기본 false. */
  mono?: boolean
  children: React.ReactNode
  className?: string
}) {
  const isSolid = tone in SOLID_CLS
  const toneCls = isSolid ? SOLID_CLS[tone as SemanticTone] : (PALE_CLS[tone as string] ?? PALE_CLS['pale-coral'])
  const ringCls = isSolid ? '' : 'ring-1'
  const sizeCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[0.6875rem] px-2 py-0.5'
  // 솔리드 톤은 항상 mono+uppercase (가이드 명시). 페일 톤은 mono prop으로 opt-in.
  const fontCls = (isSolid || mono)
    ? 'mono tnum font-bold uppercase tracking-wider'
    : 'font-medium'
  // 가이드 명시: 솔리드 뱃지는 r-sm(6px), 페일은 r-pill(999)도 OK.
  const radiusCls = isSolid ? 'rounded-sm' : 'rounded-full'
  return (
    <span className={`inline-flex items-center gap-1 ${radiusCls} ${ringCls} ${toneCls} ${sizeCls} ${fontCls} ${className}`}>
      {icon && <span className="leading-none">{icon}</span>}
      {children}
    </span>
  )
}
