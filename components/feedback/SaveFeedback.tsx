'use client'

// 글로벌 저장 진행 바 + 토스트 스택 — v2.0 §15·v2.0 §17.
// 토스트: 하단 중앙 고정, 4종(success/error/info/urgent), 최대 3개 스택(최고最古 즉시 퇴장),
// 연속 동일 메시지는 ×N 카운트, hover 중 타이머 일시정지, error 는 수동 닫기 항상 포함.

import { useEffect, useRef, useState } from 'react'
import { subscribePending, subscribeToast, type Toast, type ToastKind } from '@/lib/saveStatus'

type Live = Toast & { count: number }

// 토스트 칩 팔레트는 모드 불변(항상 어두운 서피스 + 크림 텍스트).
// info 가 var(--ink) 를 쓰면 다크모드에서 --ink 가 밝은 크림(--d-ink)으로 뒤집혀
// 크림 글자와 겹쳐 안 보임(운영자 신고 2026-07-10) — 가이드 §"다크 전환은 토큰 치환만" 위반 사례.
// 그래서 라이트 모드의 ink 원값을 고정값으로 사용한다(다른 종류들과 동일한 모드 불변 방식).
const KIND_STYLE: Record<ToastKind, { bg: string; border?: string }> = {
  success: { bg: '#1E2E14', border: 'rgba(78,104,52,.45)' },
  error:   { bg: '#5A1A10', border: 'rgba(160,60,46,.5)' },
  info:    { bg: '#3D2418' },
  urgent:  { bg: 'var(--tc-d)', border: 'rgba(160,60,46,.5)' },
}

function KindIcon({ kind }: { kind: ToastKind }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const, className: 'shrink-0 mt-0.5' }
  if (kind === 'success') return <svg {...common}><path d="M20 6 9 17l-5-5"/></svg>
  if (kind === 'error') return <svg {...common}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
  if (kind === 'urgent') return <svg {...common}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  return <svg {...common}><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
}

export default function SaveFeedback() {
  const [pending, setPending] = useState(0)
  const [toasts, setToasts] = useState<Live[]>([])
  // 타이머 관리 — hover 일시정지(v2.0 §15)를 위해 잔여 시간 추적
  const timers = useRef<Map<number, { handle: ReturnType<typeof setTimeout>; expiresAt: number; remaining: number }>>(new Map())

  const remove = (id: number) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t.handle); timers.current.delete(id) }
    setToasts(prev => prev.filter(x => x.id !== id))
  }
  const schedule = (id: number, ms: number) => {
    const handle = setTimeout(() => remove(id), ms)
    timers.current.set(id, { handle, expiresAt: Date.now() + ms, remaining: ms })
  }
  const pause = (id: number) => {
    const t = timers.current.get(id)
    if (!t) return
    clearTimeout(t.handle)
    t.remaining = Math.max(800, t.expiresAt - Date.now())
  }
  const resume = (id: number) => {
    const t = timers.current.get(id)
    if (!t) return
    clearTimeout(t.handle)
    t.handle = setTimeout(() => remove(id), t.remaining)
    t.expiresAt = Date.now() + t.remaining
  }

  useEffect(() => subscribePending(setPending), [])
  useEffect(() => subscribeToast(t => {
    setToasts(prev => {
      // 동일 메시지 연속 발생 → 기존 토스트에 ×N 카운트 + 타이머 리셋 (v2.0 §15)
      //
      // 단, 적용취소 같은 액션을 단 토스트는 합치면 안 된다. 합쳐도 action 은 갱신되지 않아
      // 버튼이 **먼저 뜬 토스트의 대상**을 계속 가리킨다. 문구가 같아지기 쉬운 수납에서
      // 연달아 두 건을 넣고 적용취소를 누르면 방금 것이 아니라 앞엣것이 취소된다(2026-08-03).
      const dup = t.action ? undefined
        : prev.find(x => x.kind === t.kind && x.message === t.message && x.detail === t.detail && !x.action)
      if (dup) {
        const old = timers.current.get(dup.id)
        if (old) clearTimeout(old.handle)
        schedule(dup.id, t.duration)
        return prev.map(x => x.id === dup.id ? { ...x, count: x.count + 1 } : x)
      }
      schedule(t.id, t.duration)
      // 최대 3개 — 초과 시 최고(最古) 즉시 퇴장
      let next = [...prev, { ...t, count: 1 }]
      if (next.length > 3) {
        const oldest = next[0]
        const ot = timers.current.get(oldest.id)
        if (ot) { clearTimeout(ot.handle); timers.current.delete(oldest.id) }
        next = next.slice(1)
      }
      return next
    })
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* 상단 진행 바 — 갱신 중 표시(v2.0 §17). 콘텐츠는 그대로 둔다.
          저장뿐 아니라 조회(방문 분석 기간 변경 등)에도 쓰이므로 aria-label 은 중립 문구 */}
      {pending > 0 && (
        <div aria-label="처리 중" className="fixed top-0 left-0 right-0 z-[var(--z-toast)] pointer-events-none"
          style={{ height: 'var(--progress-h)' }}>
          <div className="h-full" style={{
            background: 'var(--progress-color)',
            animation: 'roos-progress 1.2s ease-in-out infinite',
            transformOrigin: 'left',
          }} />
          <style>{`@keyframes roos-progress {
            0%   { transform: translateX(-100%) scaleX(0.2); }
            45%  { transform: translateX(0%)    scaleX(0.6); }
            100% { transform: translateX(100%)  scaleX(0.2); }
          }`}</style>
        </div>
      )}

      {/* 토스트 스택 — 하단 중앙, 신규가 아래 (v2.0 §15·11.5. 정중앙 폐지 — 콘텐츠·마우스 동선 가림) */}
      <div className="fixed left-1/2 z-[var(--z-toast)] flex flex-col items-center pointer-events-none"
        style={{
          transform: 'translateX(-50%)',
          bottom: 'calc(var(--toast-offset-bottom) + env(safe-area-inset-bottom))',
          gap: 'var(--toast-gap)',
          maxWidth: 'min(var(--toast-w-max), calc(100vw - 32px))',
          width: 'max-content',
        }}>
        {toasts.map(t => {
          const s = KIND_STYLE[t.kind]
          return (
            <div key={t.id} role="status"
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              className="pointer-events-auto rounded-lg shadow-lift animate-roos-toast max-w-full flex items-start gap-2.5"
              style={{
                background: s.bg,
                border: s.border ? `1px solid ${s.border}` : undefined,
                color: '#FBF6EF',
                padding: '10px 16px',
              }}>
              <KindIcon kind={t.kind} />
              <div className="min-w-0 text-left">
                <p className="text-[13px] font-semibold leading-snug whitespace-pre-line">
                  {t.message}
                  {t.count > 1 && (
                    <span className="ml-1.5 inline-flex items-center rounded-full px-1.5 text-[0.65625rem] font-bold"
                      style={{ background: 'rgba(251,246,239,.18)' }}>×{t.count}</span>
                  )}
                </p>
                {t.detail && (
                  <p className="text-[12.5px] font-normal mt-0.5" style={{ color: 'rgba(251,246,239,.75)', lineHeight: 1.55 }}>
                    {t.detail}
                  </p>
                )}
              </div>
              {t.action && (
                /* 토스트는 모드 불변 다크 칩 — --sand는 다크에서 어두워지므로 고정 라이트 샌드.
                   그 고정값은 이제 --on-solid-accent 토큰이 들고 있다(같은 함정을 밟던
                   --rev-change 와 한 출처, 2026-08-12). 리터럴을 남기지 않는다. */
                <button type="button"
                  onClick={() => { t.action!.run(); remove(t.id) }}
                  className="shrink-0 -my-2.5 -mr-3 px-3 self-stretch text-[13px] font-bold hover:underline"
                  style={{ color: 'var(--on-solid-accent)', minHeight: 44 }}>
                  {t.action.label}
                </button>
              )}
              {t.kind === 'error' && (
                <button type="button" onClick={() => remove(t.id)} aria-label="닫기"
                  className="shrink-0 -my-1 -mr-2 w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          )
        })}
        <style>{`
          @keyframes roos-toast-in {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .animate-roos-toast { animation: roos-toast-in 200ms var(--ease-sharp); }
        `}</style>
      </div>
    </>
  )
}
