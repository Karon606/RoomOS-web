'use client'

// §21.3 SelectionPillBar — 선택 모드 하단 floating 다크 알약.
// 탭별 가능한 액션만 children 으로 노출하되 셸(컨테이너·카운트·닫기)은 동일.
// 합치기는 양 탭 공통 승격. 불가능한 액션은 숨김(비활성 아님).
import React from 'react'

export function SelectionPillBar({
  count, onClose, children, label = '선택', unit = '개',
}: {
  count: number
  onClose: () => void
  children: React.ReactNode      // PillButton 들 또는 서브플로(select 등)
  label?: string                 // 카운트 라벨(기본 '선택')
  unit?: string                  // 조수사(기본 '개'; 사람은 '명' 등)
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-50 flex justify-center md:bottom-4">
      <div className="pointer-events-auto mx-3.5 flex max-w-[calc(100vw-28px)] items-center gap-2 rounded-[15px] bg-[var(--pill-bg)] px-4 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,.45)]">
        <span className="whitespace-nowrap text-[0.8125rem] font-semibold text-white">
          <span className="mono tnum text-[var(--sand)]">{count}</span>{unit} {label}
        </span>
        <span className="h-4 w-px bg-white/20" />
        {children}
        <button type="button" onClick={onClose} aria-label="선택 취소"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// 알약 내부 액션 버튼 — ghost(기본) / primary(주액션 solid --coral-dark 계열)
export function PillButton({
  onClick, primary = false, disabled = false, children,
}: {
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={[
        'h-9 shrink-0 whitespace-nowrap rounded-[9px] px-3 text-sm font-semibold transition-colors disabled:opacity-50',
        primary
          ? 'bg-[var(--coral)] text-white hover:bg-[var(--coral-dark)]'
          : 'bg-white/[0.13] text-white hover:bg-white/20',
      ].join(' ')}>
      {children}
    </button>
  )
}
