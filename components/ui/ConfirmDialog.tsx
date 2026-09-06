'use client'

// 확인 다이얼로그 — v2.0 §14. 네이티브 confirm()/alert() 전면 대체.
// 사용: const ok = await confirmDialog({ title: '...', level: 'danger', confirmLabel: '영구 삭제', impact: [...] })
// lib/saveStatus 와 같은 모듈-스코프 pub/sub — Provider context 없이 어디서든 호출 가능.
// <ConfirmHost /> 를 셸(AppShell·admin layout)에 1회 마운트.

import { useEffect, useRef, useState } from 'react'
import { useVisibleBand } from '@/lib/useVisibleBand'
import { lockBackgroundScroll, unlockBackgroundScroll } from '@/lib/scrollLock'

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
  // v2.0 §27 — 제3의 동작 버튼(choiceDialog 전용). 취소는 항상 무변경이어야 하므로
  // '취소에 실 동작을 싣던' 자리를 이 버튼이 대체한다.
  altLabel?: string
  // 앞 단계로 되돌아가는 링크(순차 선택 2단계 이상에서만). 취소와 다르다 —
  // 취소는 흐름 전체를 무변경으로 닫고, 이건 직전 물음으로 돌아간다. 잘못 골랐을 때의 길이다.
  backLabel?: string
}

type ConfirmResult = 'confirm' | 'alt' | 'cancel' | 'back'
type Pending = { opts: ConfirmOptions; resolve: (r: ConfirmResult) => void }

let listener: ((p: Pending | null) => void) | null = null
let queue: Pending[] = []

function present(opts: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise<ConfirmResult>(resolve => {
    const p: Pending = { opts, resolve }
    if (listener) listener(p)
    else queue.push(p)   // 호스트 미마운트 시 폴백 — 마운트 직후 처리
  })
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return present(opts).then(r => r === 'confirm')
}

// v2.0 §27 3지선다 — 확인/제3 동작/취소. 취소·Esc·배경 클릭은 null(무변경).
export function choiceDialog(opts: ConfirmOptions & { altLabel: string }): Promise<'confirm' | 'alt' | 'back' | null> {
  return present(opts).then(r => (r === 'cancel' ? null : r))
}

// alert() 대체 — 확인 버튼 하나짜리 안내
export function alertDialog(title: string, message?: string): Promise<void> {
  return confirmDialog({ title, message, confirmLabel: '닫기', cancelLabel: '' }).then(() => {})
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // 보이는 띠 정본(useVisibleBand) — 인셋 두 항 + 패널 상한. 키보드 패널 2026-09-02 2단계.
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useVisibleBand({ active: !!pending, overlayRef, panelRef })

  useEffect(() => {
    listener = setPending
    if (queue.length > 0) { setPending(queue[0]); queue = [] }
    return () => { listener = null }
  }, [])

  // 초기 포커스 = 취소 버튼 (오조작 방지, v2.0 §14). 취소 버튼이 없는 안내 다이얼로그(alertDialog)는
  // 확인 버튼에 포커스해 Enter 로 바로 닫히게 한다.
  useEffect(() => {
    if (pending) (cancelRef.current ?? confirmRef.current)?.focus()
  }, [pending])

  // 배경 스크롤 잠금 — 문서 스크롤이 켜진 셸 밖 페이지에서만 실제 효과
  useEffect(() => {
    if (!pending) return
    lockBackgroundScroll()
    return () => unlockBackgroundScroll()
  }, [pending])

  // Esc = 취소 (전 단계 허용, v2.0 §14)
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done('cancel') }
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

  const done = (r: ConfirmResult) => { pending.resolve(r); setPending(null) }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 anim-overlay-in"
      // 위·아래 패딩에 보이는 띠 인셋을 더해 세로 중앙의 기준을 '키보드 위 보이는 띠'로 옮긴다
      // (정본 useVisibleBand, 키보드 패널 2026-09-02 2단계 — 종전 --kbd-inset 하단 한 항은
      // 팬·위 겹침을 몰랐다). 인셋이 0 인 데스크탑에서는 계산 결과가 p-4 의 1rem 으로 같다.
      style={{ background: 'var(--confirm-backdrop)', paddingTop: 'calc(1rem + var(--vv-top, 0px))', paddingBottom: 'calc(1rem + var(--vv-bottom, 0px))' }}
      // 배경클릭: 일반만 닫힘(=취소), 주의·파괴적은 무시 (v2.0 §14)
      onClick={() => { if (level === 'normal') done('cancel') }}
    >
      <div
        ref={panelRef}
        role="alertdialog" aria-modal="true" aria-label={opts.title}
        className="bg-[var(--cream)] rounded-2xl shadow-lift w-full anim-panel-in flex flex-col"
        style={{
          maxWidth: isDanger && opts.impact?.length ? 'var(--confirm-w-impact)' : 'var(--confirm-w)',
          padding: 24,
          // 폭은 고정인데 글자 크기 설정(최대 1.25배)에 따라 세로로만 자란다. 상한이 없으면
          // 내용이 뷰포트를 넘는 순간 위아래가 동시에 잘리고 확인·취소 버튼에 닿을 수 없다(F페이즈).
          // 뷰포트와 '보이는 띠' 중 좁은 쪽 — 키보드가 서면 띠 높이(--vv-h)가 지배해
          // 버튼줄이 키보드 뒤로 안 들어간다(빼는 2rem 은 위아래 1rem 패딩 몫).
          maxHeight: 'min(calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem), calc(var(--vv-h, 100dvh) - 2rem))',
          animation: 'confirm-in 200ms var(--ease-sharp)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 본문만 스크롤 — 버튼줄은 아래 shrink-0 로 항상 보인다 */}
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        {opts.backLabel && (
          // 히트 44px(§09). 취소와 자리를 나눠 둔다 — 나란히 두면 '되돌아가기'가 '무변경 닫기'로 읽힌다.
          <button type="button" onClick={() => done('back')}
            className="-mt-1 mb-1 inline-flex items-center min-h-[44px] text-[13px] text-[var(--tc-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 rounded">
            {'‹'} {opts.backLabel}
          </button>
        )}
        <div className="flex items-start gap-2">
          {isCaution && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          )}
          {isDanger && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tc)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          )}
          <h2 className="text-base font-bold text-[var(--ink)] leading-snug whitespace-pre-line">{opts.title}</h2>
        </div>

        {opts.message && (
          <p className="mt-2.5 text-[13.5px] text-[var(--ink-s)] whitespace-pre-line" style={{ lineHeight: 1.65 }}>
            {opts.message}
          </p>
        )}

        {isDanger && opts.impact && opts.impact.length > 0 && (
          <div className="mt-3 rounded-lg px-3.5 py-3"
            style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-ring)' }}>
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

        </div>

        {/* 버튼 — 취소 좌 · 확인 우, 높이 40px.
            flex-wrap 은 클래스 봉합이다. 폭 360px 고정에 좌우 패딩 48px 이라 3지선다에서
            라벨 합이 312px 을 넘으면 글자가 버튼 밖으로 흘러나온다(360px 폰에서는 더 좁다).
            글자 크기 확대 설정에서는 데스크탑에서도 깨진다. 라벨을 짧게 쓰는 것과 별개로 막아둔다. */}
        <div className="mt-5 flex flex-wrap justify-end gap-2 shrink-0">
          {opts.cancelLabel !== '' && (
            <button ref={cancelRef} type="button" onClick={() => done('cancel')}
              className={`h-10 px-4 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2 ${
                level === 'normal'
                  ? 'bg-transparent hover:bg-[var(--cream-soft)] text-[var(--warm-mid)]'
                  : 'bg-[var(--cream-soft)] hover:bg-[var(--sand)] text-[var(--warm-dark)] border border-[var(--warm-border)]'
              }`}>
              {opts.cancelLabel ?? '취소'}
            </button>
          )}
          {opts.altLabel && (
            <button type="button" onClick={() => done('alt')}
              className="h-10 px-4 rounded-lg text-sm font-medium whitespace-nowrap bg-[var(--cream-soft)] hover:bg-[var(--sand)] text-[var(--warm-dark)] border border-[var(--warm-border)] transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2">
              {opts.altLabel}
            </button>
          )}
          <button ref={confirmRef} type="button" onClick={() => done('confirm')}
            className={`h-10 px-4 rounded-lg text-sm font-semibold whitespace-nowrap text-[var(--on-solid)] transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2 ${
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
