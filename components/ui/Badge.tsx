'use client'

import React from 'react'

// M7 가이드 정식 4톤 (솔리드, 강조용 — 미납·완료·경고·중립)
type SemanticTone = 'success' | 'warn' | 'danger' | 'neutral'
// 페일 톤 (부드러운 라벨용 — 거주중·예약·요청 등 상태 표시)
type PaleTone = 'pale-coral' | 'pale-green' | 'pale-amber' | 'pale-blue' | 'pale-red' | 'pale-teal' | 'pale-purple'
// 호환 alias (기존 코드)
type LegacyTone = 'coral' | 'green' | 'amber' | 'blue' | 'red' | 'teal' | 'purple'

type Tone = SemanticTone | PaleTone | LegacyTone

// M7 가이드 솔리드 톤 — 강조용. mono uppercase 권장
const SOLID_CLS: Record<SemanticTone, string> = {
  success: 'bg-[#6a9f3a] text-white',
  warn:    'bg-[var(--honey)] text-[var(--ink)]',
  danger:  'bg-[var(--persimmon)] text-white',
  neutral: 'bg-[var(--cream-3)] text-[var(--ink-3)]',
}

// 페일 톤 — 일반 라벨용. ring 1px solid 색약 강조
const PALE_CLS: Record<string, string> = {
  'pale-coral':  'bg-[var(--persimmon-l)] text-[var(--persimmon-d)] ring-[var(--persimmon)]/20',
  'pale-green':  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'pale-amber':  'bg-amber-50 text-amber-700 ring-amber-200',
  'pale-blue':   'bg-blue-50 text-blue-700 ring-blue-200',
  'pale-red':    'bg-red-50 text-red-700 ring-red-200',
  'pale-teal':   'bg-teal-50 text-teal-700 ring-teal-200',
  'pale-purple': 'bg-purple-50 text-purple-700 ring-purple-200',
  // legacy alias — 기존 코드 호환
  'coral':       'bg-[var(--persimmon-l)] text-[var(--persimmon-d)] ring-[var(--persimmon)]/20',
  'green':       'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'amber':       'bg-amber-50 text-amber-700 ring-amber-200',
  'blue':        'bg-blue-50 text-blue-700 ring-blue-200',
  'red':         'bg-red-50 text-red-700 ring-red-200',
  'teal':        'bg-teal-50 text-teal-700 ring-teal-200',
  'purple':      'bg-purple-50 text-purple-700 ring-purple-200',
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
