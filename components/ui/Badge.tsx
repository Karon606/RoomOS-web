'use client'

import React from 'react'

type Tone = 'neutral' | 'coral' | 'green' | 'amber' | 'blue' | 'red' | 'teal' | 'purple'

const TONE_CLS: Record<Tone, string> = {
  neutral: 'bg-[var(--canvas)] text-[var(--warm-mid)] ring-[var(--warm-border)]',
  coral:   'bg-[var(--coral)]/10 text-[var(--coral)] ring-[var(--coral)]/20',
  green:   'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber:   'bg-amber-50 text-amber-700 ring-amber-200',
  blue:    'bg-blue-50 text-blue-700 ring-blue-200',
  red:     'bg-red-50 text-red-700 ring-red-200',
  teal:    'bg-teal-50 text-teal-700 ring-teal-200',
  purple:  'bg-purple-50 text-purple-700 ring-purple-200',
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  icon,
  children,
  className = '',
}: {
  tone?: Tone
  size?: 'sm' | 'md'
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const sizeCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[11px] px-2 py-0.5'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ${TONE_CLS[tone]} ${sizeCls} ${className}`}>
      {icon && <span className="leading-none">{icon}</span>}
      {children}
    </span>
  )
}
