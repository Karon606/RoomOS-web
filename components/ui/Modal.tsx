'use client'

import React from 'react'
import { confirmDialog } from './ConfirmDialog'

type Width = 'xs' | 'sm' | 'md' | 'lg' | '2xl'

const WIDTH_CLS: Record<Width, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',   // 넓은 표 모달(전체 재고 보정 등)
}

// Esc 처리용 전역 스택 — 모달이 겹쳐 있을 때(z 260/280) Esc 는 최상단(마지막 마운트)만 닫는다.
let modalSeq = 0
const escStack: number[] = []

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
  z = 200,
  dirty = false,
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
  z?: 200 | 260 | 280 | 380          // 다른 모달 위에 겹쳐 띄울 때 (통합 상세 모달 등). 380=시스템 오버레이(오류신고) — 모든 모달·컨펌 위
  /** §13.2 입력 유실 방지 — true 면 배경클릭 무시, Esc·X 는 닫기 확인 1회 */
  dirty?: boolean
}) {
  // dirty 닫기 정책 — Esc/X 는 "작성 중인 내용이 있습니다" 확인을 거친다.
  // ref 로 들고 있어 Esc 핸들러 재등록 없이 최신값 사용. asking 플래그는
  // 확인 다이얼로그가 떠 있는 동안 Esc 연타로 다이얼로그가 중첩되는 것을 막는다.
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  const askingRef = React.useRef(false)
  const requestClose = React.useCallback(async () => {
    if (askingRef.current) return
    if (dirtyRef.current) {
      askingRef.current = true
      try {
        const ok = await confirmDialog({
          title: '작성 중인 내용이 있습니다. 닫을까요?',
          confirmLabel: '닫기', cancelLabel: '계속 작성',
        })
        if (!ok) return
      } finally { askingRef.current = false }
    }
    onClose()
  }, [onClose])
  // Esc 로 닫기 — 배경 클릭과 동일하게 동작(키보드 기대 일관성).
  // 겹친 모달에서는 최상단 것만 닫히도록 전역 스택으로 판별.
  React.useEffect(() => {
    if (!open) return
    const id = ++modalSeq
    escStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (escStack[escStack.length - 1] !== id) return
      void requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      const idx = escStack.indexOf(id)
      if (idx >= 0) escStack.splice(idx, 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, requestClose])

  if (!open) return null
  // §13.2 — dirty 면 배경클릭(아래 onClick)은 조용히 무시(대부분 오조작), 닫기는 Esc·X 확인 경로로만
  // v1.3 §12 레이어 토큰 매핑 — 호출부 API(200/260/280)는 유지, 실제 z는 토큰
  const zClass = z === 380 ? 'z-[var(--z-report)]' : z === 280 ? 'z-[var(--z-modal-3)]' : z === 260 ? 'z-[var(--z-modal-2)]' : 'z-[var(--z-modal)]'
  return (
    <div
      className={`fixed inset-0 bg-black/70 ${zClass} flex items-center justify-center anim-overlay-in`}
      // 안전 영역(상태바·다이내믹 아일랜드·홈 인디케이터)을 피해 패딩 —
      // 모달 헤더의 닫기 버튼이 상태바에 가려지지 않도록.
      style={{
        paddingTop:    'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft:   'max(1rem, env(safe-area-inset-left))',
        paddingRight:  'max(1rem, env(safe-area-inset-right))',
      }}
      onClick={dirty ? undefined : onClose}
    >
      <div
        className={`bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl shadow-lift w-full ${WIDTH_CLS[width]} flex flex-col anim-panel-in`}
        // 뷰포트 기준 calc — 안전영역 안쪽으로 최대 높이 한정 (% 는 안 풀려 헤더가 잘림)
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)' }}
        onClick={e => e.stopPropagation()}
      >
        {(title || onBack) && (
          <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
                  title="뒤로"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
              )}
              <div className="min-w-0">
                {typeof title === 'string'
                  ? <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{title}</h2>
                  : title}
                {subtitle && <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 line-clamp-2">{subtitle}</p>}   {/* truncate는 긴 안내가 잘림(신고 e32c60ab) — 2줄까지 표시 */}
              </div>
              {headerExtra}
            </div>
            <button
              type="button"
              onClick={() => void requestClose()}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
              title="닫기"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
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
          className="px-4 py-2.5 min-h-[40px] text-sm rounded-lg bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] border border-[var(--warm-border)] transition-colors"
        >
          {cancelLabel}
        </button>
      )}
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  )
}
