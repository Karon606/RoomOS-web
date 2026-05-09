'use client'

import { useEffect, useState } from 'react'
import { subscribePending, subscribeToast, type Toast } from '@/lib/saveStatus'

const TOAST_DURATION_MS = 2400

export default function SaveFeedback() {
  const [pending, setPending] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribePending(setPending), [])
  useEffect(() => subscribeToast(t => {
    setToasts(prev => [...prev, t])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), TOAST_DURATION_MS)
  }), [])

  return (
    <>
      {/* 상단 얇은 진행 바 — 저장/리프레시 진행 중에만 노출 */}
      {pending > 0 && (
        <div
          aria-label="저장 중"
          className="fixed top-0 left-0 right-0 h-[3px] z-[200] pointer-events-none"
          style={{ background: 'transparent' }}
        >
          <div
            className="h-full"
            style={{
              background: 'var(--persimmon)',
              animation: 'roos-progress 1.2s ease-in-out infinite',
              transformOrigin: 'left',
            }}
          />
          <style>{`
            @keyframes roos-progress {
              0%   { transform: translateX(-100%) scaleX(0.2); }
              45%  { transform: translateX(0%)    scaleX(0.6); }
              100% { transform: translateX(100%)  scaleX(0.2); }
            }
          `}</style>
        </div>
      )}

      {/* 우상단 토스트 스택 */}
      <div className="fixed top-3 right-3 z-[201] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 'calc(100vw - 24px)' }}>
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto rounded-xl px-3.5 py-2.5 text-sm font-medium shadow-lift animate-roos-toast"
            style={{
              background: t.kind === 'error'
                ? 'color-mix(in srgb, var(--coral) 92%, white)'
                : t.kind === 'success'
                ? 'color-mix(in srgb, #10b981 92%, white)'
                : 'var(--ink-2)',
              color: '#fff',
              minWidth: 200,
              maxWidth: 360,
            }}
          >
            {t.message}
          </div>
        ))}
        <style>{`
          @keyframes roos-toast-in {
            from { opacity: 0; transform: translateY(-8px) scale(0.96); }
            to   { opacity: 1; transform: translateY(0)    scale(1); }
          }
          .animate-roos-toast { animation: roos-toast-in 180ms ease-out; }
        `}</style>
      </div>
    </>
  )
}
