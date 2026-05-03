'use client'

import React from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

const VARIANT_CLS: Record<Variant, string> = {
  primary:   'bg-[var(--coral)] hover:opacity-90 text-white border border-transparent',
  secondary: 'bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] border border-[var(--warm-border)]',
  danger:    'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-transparent',
  ghost:     'bg-transparent hover:bg-[var(--canvas)] text-[var(--warm-mid)] border border-transparent',
  subtle:    'bg-[var(--canvas)]/60 hover:bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60',
}

// 모바일 터치 타겟: sm=36px, md=40px, lg=44px (HIG 권장 44px+)
const SIZE_CLS: Record<Size, string> = {
  sm: 'px-3 py-2 text-xs min-h-[36px] rounded-lg',
  md: 'px-4 py-2.5 text-sm min-h-[40px] rounded-xl',
  lg: 'px-5 py-3 text-base min-h-[44px] rounded-xl',
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
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
