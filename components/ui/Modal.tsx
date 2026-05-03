'use client'

import React from 'react'

type Width = 'xs' | 'sm' | 'md' | 'lg'

const WIDTH_CLS: Record<Width, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 'sm',
  onBack,
  headerExtra,
  footer,
  children,
  bodyClassName = '',
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  width?: Width
  onBack?: () => void
  headerExtra?: React.ReactNode      // 제목 옆 배지·태그용
  footer?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full ${WIDTH_CLS[width]} flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        {(title || onBack) && (
          <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
                  title="뒤로"
                >‹</button>
              )}
              <div className="min-w-0">
                {typeof title === 'string'
                  ? <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{title}</h2>
                  : title}
                {subtitle && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{subtitle}</p>}
              </div>
              {headerExtra}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
              title="닫기"
            >✕</button>
          </div>
        )}
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// 모달 푸터의 표준 버튼 영역 — 취소(좌) + 주 액션(우)
export function ModalFooterActions({
  onCancel,
  cancelLabel = '취소',
  children,
  align = 'end',
}: {
  onCancel?: () => void
  cancelLabel?: string
  children?: React.ReactNode    // 주 액션 버튼들 (우측)
  align?: 'split' | 'end'        // split: 양쪽 끝, end: 우측 정렬
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${align === 'split' ? 'justify-between' : 'justify-end'}`}>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 min-h-[40px] text-sm rounded-xl bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] border border-[var(--warm-border)] transition-colors"
        >
          {cancelLabel}
        </button>
      )}
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  )
}
