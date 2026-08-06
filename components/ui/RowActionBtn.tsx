'use client'

// 목록 행 안의 텍스트 액션 버튼 정본 — 44px 히트영역(button)과 보이는 박스(span)를 분리한다.

import React from 'react'

// 히트영역과 시각 크롬을 한 요소에 겹치면 -my-2 min-h-[44px] 가 보이는 테두리까지 44px 로 부풀린다.
// button 은 배경·테두리 없는 히트 전용, span 이 실제로 보이는 박스다.
const HIT_CLS = '-my-2 min-h-[44px] inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)] disabled:opacity-50'
const CHROME_CLS = 'text-[0.65625rem] font-medium px-2.5 py-1 rounded-lg border'

// 톤은 적용처의 기존 색 조합을 그대로 옮긴 것이다(수정=중립 계열, 삭제=위험 계열).
type Tone = 'neutral' | 'danger' | 'deposit' | 'accent'

const TONE_CLS: Record<Tone, string> = {
  neutral: 'border-[var(--warm-border)] text-[var(--warm-mid)]',
  danger: 'border-[var(--danger-ring)] text-[var(--danger-fg)]',
  deposit: 'border-[var(--deposit-ring)] text-[var(--deposit-fg)]',
  accent: 'border-[var(--warm-border)] text-[var(--coral)]',
}

export function RowActionBtn({
  tone = 'neutral', onClick, disabled, className = '', children,
}: {
  tone?: Tone
  onClick?: () => void
  disabled?: boolean
  className?: string   // 행 레이아웃용(shrink-0 등) — 시각 크롬은 tone 이 정한다
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${HIT_CLS} ${className}`}>
      <span className={`${CHROME_CLS} ${TONE_CLS[tone]}`}>{children}</span>
    </button>
  )
}
