'use client'

// 확인 다이얼로그 — Brand Guide v1.3 §9. 네이티브 confirm()/alert() 전면 대체.
// 사용: const ok = await confirmDialog({ title: '...', level: 'danger', confirmLabel: '영구 삭제', impact: [...] })
// lib/saveStatus 와 같은 모듈-스코프 pub/sub — Provider context 없이 어디서든 호출 가능.
// <ConfirmHost /> 를 셸(AppShell·admin layout)에 1회 마운트.

import { useEffect, useRef, useState } from 'react'

export type ConfirmLevel = 'normal' | 'caution' | 'danger'

export type ConfirmOptions = {
  title: string                 // 대상 이름 명시 권장 ("401호 김건우 기록을…")
  message?: string
  level?: ConfirmLevel          // default 'normal'
  confirmLabel?: string         // 항상 동사 ("저장", "전환", "영구 삭제") — "확인"·"예" 금지
  cancelLabel?: string
  // danger 전용 — 영향 목록 (건수는 반드시 실데이터)
  impact?: { label: string; count?: number | string }[]
  irreversibleNote?: string     // danger 기본: '이 동작은 되돌릴 수 없습니다.'
}

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void }

let listener: ((p: Pending | null) => void) | null = null
let queue: Pending[] = []

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const p: Pending = { opts, resolve }
    if (listener) listener(p)
    else queue.push(p)   // 호스트 미마운트 시 폴백 — 마운트 직후 처리
  })
}

// alert() 대체 — 확인 버튼 하나짜리 안내
export function alertDialog(title: string, message?: string): Promise<void> {
  return confirmDialog({ title, message, confirmLabel: '닫기', cancelLabel: '' }).then(() => {})
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    listener = setPending
    if (queue.length > 0) { setPending(queue[0]); queue = [] }
    return () => { listener = null }
  }, [])

  // 초기 포커스 = 취소 버튼 (오조작 방지, §9.1)
  useEffect(() => {
    if (pending) cancelRef.current?.focus()
  }, [pending])

  // Esc = 취소 (전 단계 허용, §9.2)
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false) }
    }
    // 공용 Modal 의 Esc 스택보다 먼저 받도록 capture
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  if (!pending) return null
  const { opts } = pending
  const level: ConfirmLevel = opts.level ?? 'normal'
  const isDanger = level === 'danger'
  const isCaution = level === 'caution'

  const done = (ok: boolean) => { pending.resolve(ok); setPending(null) }

  return (
    <div
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4"
      style={{ background: 'var(--confirm-backdrop)' }}
      // 배경클릭: 일반만 닫힘(=취소), 주의·파괴적은 무시 (§9.2)
      onClick={() => { if (level === 'normal') done(false) }}
    >
      <div
        role="alertdialog" aria-modal="true" aria-label={opts.title}
        className="bg-[var(--cream)] rounded-2xl shadow-lift w-full"
        style={{
          maxWidth: isDanger && opts.impact?.length ? 'var(--confirm-w-impact)' : 'var(--confirm-w)',
          padding: 24,
          animation: 'confirm-in 200ms var(--ease-sharp)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          {isCaution && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5E0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          )}
          {isDanger && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tc)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          )}
          <h2 className="text-base font-bold text-[var(--ink)] leading-snug">{opts.title}</h2>
        </div>

        {opts.message && (
          <p className="mt-2.5 text-[13.5px] text-[var(--ink-s)] whitespace-pre-line" style={{ lineHeight: 1.65 }}>
            {opts.message}
          </p>
        )}

        {isDanger && opts.impact && opts.impact.length > 0 && (
          <div className="mt-3 rounded-lg px-3.5 py-3"
            style={{ background: 'rgba(160,60,46,.06)', border: '1px solid rgba(160,60,46,.2)' }}>
            <p className="text-xs font-semibold text-[var(--ink)] mb-1.5">함께 삭제되는 항목</p>
            <ul className="space-y-0.5">
              {opts.impact.map((it, i) => (
                <li key={i} className="text-[12.5px] text-[var(--ink-s)]">
                  · {it.label}{it.count != null && <>
                    {' '}<span className="num font-semibold" style={{ fontFeatureSettings: "'tnum'" }}>{it.count}</span>건
                  </>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDanger && (
          <p className="mt-3 text-xs font-semibold text-[var(--tc-d)]">
            {opts.irreversibleNote ?? '이 동작은 되돌릴 수 없습니다.'}
          </p>
        )}

        {/* 버튼 — 취소 좌 · 확인 우, 높이 40px */}
        <div className="mt-5 flex justify-end gap-2">
          {opts.cancelLabel !== '' && (
            <button ref={cancelRef} type="button" onClick={() => done(false)}
              className={`h-10 px-4 rounded-lg text-sm font-medium transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2 ${
                level === 'normal'
                  ? 'bg-transparent hover:bg-[var(--cream-soft)] text-[var(--warm-mid)]'
                  : 'bg-[var(--cream-soft)] hover:bg-[var(--sand)] text-[var(--warm-dark)] border border-[var(--warm-border)]'
              }`}>
              {opts.cancelLabel ?? '취소'}
            </button>
          )}
          <button type="button" onClick={() => done(true)}
            className={`h-10 px-4 rounded-lg text-sm font-semibold text-white transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2 ${
              isDanger ? 'bg-[var(--tc)] hover:bg-[var(--tc-d)]' : 'bg-[var(--persimmon)] hover:bg-[var(--persimmon-d)]'
            }`}>
            {opts.confirmLabel ?? (isDanger ? '삭제' : '저장')}
          </button>
        </div>

        <style>{`@keyframes confirm-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }`}</style>
      </div>
    </div>
  )
}
