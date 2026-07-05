'use client'

// §21.4 MergeSheet — 합치기 단일 바텀시트. 카드 액션·상세·선택 알약 어디서 열어도 같은 컴포넌트.
// 방향 고지 필수(§09 파괴적 확인 정신): 무엇이 사라지고 무엇이 남는지 명시.
// 적용취소는 실행 후 §10 undo 토스트 — 환경설정에 숨기지 않음(호출부가 토스트로 처리).
import React, { useEffect, useState } from 'react'

export type MergeTarget = { id: string; label: string }

export function MergeSheet({
  open, onClose, sourceLabel, targets,
  title = '합치기', description, confirmLabel = '합치기',
  onConfirm, pending = false, z = 200,
}: {
  open: boolean
  onClose: () => void
  sourceLabel: string          // 사라질(합쳐질) 쪽 — "이 품목" 또는 "선택 N개"
  targets: MergeTarget[]       // 남을(대표) 후보
  title?: string
  description?: React.ReactNode
  confirmLabel?: string
  onConfirm: (destId: string) => void
  pending?: boolean
  /** 모달 위에서 열 때 260(=--z-modal-2). 기본은 페이지 레벨(--z-modal). */
  z?: 200 | 260
}) {
  const [destId, setDestId] = useState('')
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) { setDestId(''); const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t) }
    setShown(false)
  }, [open])
  if (!open) return null
  const dest = targets.find(t => t.id === destId)

  return (
    <div className={`fixed inset-0 ${z === 260 ? 'z-[var(--z-modal-2)]' : 'z-[var(--z-modal)]'} flex items-end justify-center`} role="dialog" aria-modal="true">
      <div className={`absolute inset-0 bg-[rgba(31,26,23,.45)] transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-t-[20px] bg-[var(--cream)] px-[18px] pb-5 pt-2 shadow-[0_-8px_32px_-12px_rgba(0,0,0,.35)] transition-transform duration-200 ${shown ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="mx-auto mb-3 h-1 w-[38px] rounded-full bg-[var(--warm-mid)]/40" />
        <h2 className="text-base font-bold text-[var(--warm-dark)]">{title}</h2>
        {description && <p className="mt-1 text-[0.78125rem] leading-relaxed text-[var(--warm-mid)]">{description}</p>}

        {/* 대상 선택 — 남을(대표) 카드 */}
        <label className="mt-4 block text-xs font-medium text-[var(--warm-mid)]">합칠 대상 (남을 품목)</label>
        <select value={destId} onChange={e => setDestId(e.target.value)} disabled={pending}
          className="mt-1.5 h-11 w-full rounded-[10px] border-[1.5px] border-[var(--warm-border)] bg-[var(--canvas)] px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          <option value="">대표(남을 품목) 선택…</option>
          {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        {/* 방향 고지 — 무엇이 사라지고 무엇이 남는지 */}
        {dest && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[0.625rem] text-[var(--warm-muted)]">합쳐질(사라짐)</p>
              <p className="truncate text-[0.8125rem] font-semibold text-[var(--warm-dark)]">{sourceLabel}</p>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-[0.625rem] text-[var(--warm-muted)]">남을(대표)</p>
              <p className="truncate text-[0.8125rem] font-semibold text-[var(--coral)]">{dest.label}</p>
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-[46px] flex-1 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] text-sm font-semibold text-[var(--warm-dark)] transition-colors hover:bg-[var(--cream-2)] disabled:opacity-50">취소</button>
          <button type="button" onClick={() => dest && onConfirm(dest.id)} disabled={pending || !dest}
            className="h-[46px] flex-[1.6] rounded-xl bg-[var(--coral)] text-sm font-semibold text-white transition-colors hover:bg-[var(--coral-dark)] disabled:opacity-50">
            {pending ? '합치는 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
