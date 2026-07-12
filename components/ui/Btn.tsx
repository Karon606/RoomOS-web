'use client'

import React from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle' | 'success' | 'warning'
type Size = 'sm' | 'md' | 'lg'

// v2.0 §10 버튼 변형. success·warning은 의미색 솔리드(긍정 결제·조정 액션) — 2026-07-12 등재.
const VARIANT_CLS: Record<Variant, string> = {
  primary:   'bg-[var(--persimmon)] hover:bg-[var(--persimmon-d)] text-[var(--on-solid)] border border-transparent',
  secondary: 'bg-[var(--cream-soft)] hover:bg-[var(--sand)] text-[var(--warm-dark)] border border-[var(--warm-border)]',
  danger:    'bg-[var(--coral)]/10 hover:bg-[var(--coral)]/20 text-[var(--coral-dark)] border border-[var(--coral)]/25',
  ghost:     'bg-transparent hover:bg-[var(--cream-soft)] text-[var(--warm-mid)] border border-transparent',
  subtle:    'bg-[var(--sand)]/40 hover:bg-[var(--sand-2)] text-[var(--warm-mid)] border border-[var(--camel)]/40',
  success:   'bg-[var(--success-solid)] hover:opacity-90 text-[var(--on-solid)] border border-transparent',
  warning:   'bg-[var(--warning-solid)] hover:opacity-90 text-[var(--on-solid)] border border-transparent',
}

// 터치 타겟 최소 44px (Brand Guide v1.2 · HIG). 크기 차이는 패딩·글자크기로 표현.
const SIZE_CLS: Record<Size, string> = {
  sm: 'px-3 py-2 text-xs min-h-[44px] rounded-md',
  md: 'px-4 py-2.5 text-sm min-h-[44px] rounded-lg',
  lg: 'px-5 py-3 text-base min-h-[44px] rounded-lg',
}

export type BtnProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: Variant
  size?: Size
  type?: 'button' | 'submit' | 'reset'
  fullWidth?: boolean
}

export function Btn({
  variant = 'primary',
  size = 'md',
  type = 'button',
  fullWidth = false,
  className = '',
  children,
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
