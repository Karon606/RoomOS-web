'use client'

// 목록 행 안의 텍스트 액션 버튼 정본 — 44px 히트영역(button)과 보이는 박스(span)를 분리한다.

import React from 'react'

// 히트영역과 시각 크롬을 한 요소에 겹치면 -my-2 min-h-[44px] 가 보이는 테두리까지 44px 로 부풀린다.
// button 은 배경·테두리 없는 히트 전용, span 이 실제로 보이는 박스다.
const HIT_CLS = '-my-2 min-h-[44px] inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)] disabled:opacity-50'
const CHROME_CLS = 'text-[0.65625rem] font-medium px-2.5 py-1 rounded-lg border'

// 톤은 적용처의 기존 색 조합을 그대로 옮긴 것이다(수정=중립 계열, 삭제=위험 계열).
// success 는 §10 Btn 이 이미 의미색 액션으로 두고 있는 계열이다 — 긍정 사실을 남기는 행 액션
// (보증금 '받음으로 기록')이 raw 버튼에서 넘어오며 등재됐다(2026-08-12).
type Tone = 'neutral' | 'danger' | 'deposit' | 'accent' | 'success'

const TONE_CLS: Record<Tone, string> = {
  neutral: 'border-[var(--warm-border)] text-[var(--warm-mid)]',
  danger: 'border-[var(--danger-ring)] text-[var(--danger-fg)]',
  deposit: 'border-[var(--deposit-ring)] text-[var(--deposit-fg)]',
  accent: 'border-[var(--warm-border)] text-[var(--tc-text)]',
  success: 'border-[var(--success-ring)] text-[var(--success-fg)]',
}

export function RowActionBtn({
  tone = 'neutral', onClick, disabled, reason, expanded, className = '', children,
}: {
  tone?: Tone
  onClick?: () => void
  disabled?: boolean
  // 막힌 이유를 말하는 WhyCaption(또는 같은 구실의 이유 줄) id(가이드 §27.8). 주면 버튼은 막힌다.
  // 네이티브 disabled 대신 aria-disabled 로 막아 포커스가 닿고 aria-describedby 가 이유를 읽는다. 안 주면 종전과 같다.
  reason?: string | null | false
  // 팝업(메뉴·패널)을 여는 버튼이면 열림 상태 — aria-expanded 로 나간다. 안 넘기면 속성 자체가 없다(종전과 같다).
  expanded?: boolean
  className?: string   // 행 레이아웃용(shrink-0 등) — 시각 크롬은 tone 이 정한다
  children: React.ReactNode
}) {
  const blocked = !!reason
  return (
    <button type="button" onClick={blocked ? undefined : onClick} disabled={blocked ? undefined : disabled}
      aria-disabled={blocked || undefined} aria-describedby={blocked ? reason : undefined}
      aria-expanded={expanded} className={`${HIT_CLS} ${blocked ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <span className={`${CHROME_CLS} ${TONE_CLS[tone]}`}>{children}</span>
    </button>
  )
}
