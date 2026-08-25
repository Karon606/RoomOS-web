'use client'

// 살짝 보기 — 입력 중(모달 위 포함) 다른 페이지를 작은 창으로 확인하고, 닫으면 입력 상태 그대로.
// (운영자 아이디어 2026-07-09: "방번호가 기억 안 날 때 공실 확인" 같은 교차 참조를 범용으로)
// 같은 오리진 iframe — 안의 앱은 window.top 감지(html[data-peek-frame])로 헤더·하단탭을 스스로 숨긴다.
// 마지막으로 본 페이지를 기억해 다음에도 그 페이지부터 연다.

import { useState } from 'react'

const PAGES = [
  { href: '/dashboard', label: '홈' },
  { href: '/room-manage', label: '방' },
  { href: '/tenants', label: '입주자' },
  { href: '/rooms', label: '수납' },
  { href: '/finance', label: '지출' },
  { href: '/inventory', label: '재고' },
] as const

const LS_KEY = 'stayeum-peek-page'

export function PeekSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [page, setPage] = useState<string>(() => {
    if (typeof window === 'undefined') return PAGES[0].href
    try { return localStorage.getItem(LS_KEY) ?? PAGES[0].href } catch { return PAGES[0].href }
  })
  const pick = (href: string) => {
    setPage(href)
    try { localStorage.setItem(LS_KEY, href) } catch { /* 무시 */ }
  }
  if (!open) return null
  return (
    // 하단 시트라 패딩 합산은 시트를 키보드 위로 밀어 올린다(신고 e8a2c73e, 정본은 Modal).
    // iframe 안 페이지에서 키보드가 열려도 시트 하단이 키보드 뒤로 들어가지 않는다.
    <div className="fixed inset-0 z-[var(--z-lightbox)] flex flex-col justify-end bg-black/45 anim-overlay-in"
      style={{ paddingBottom: 'var(--kbd-inset, 0px)' }} onClick={onClose}>
      <div
        className="flex flex-col rounded-t-2xl border-t border-x border-[var(--warm-border)] bg-[var(--canvas)] shadow-lift anim-panel-in"
        style={{ height: 'min(78dvh, 100dvh - env(safe-area-inset-top) - 3rem)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 핸들 + 페이지 칩 + 닫기 */}
        <div className="shrink-0 border-b border-[var(--warm-border)] px-3 pt-2 pb-2">
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--warm-border)]" aria-hidden />
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
              {PAGES.map(p => (
                <button key={p.href} type="button" onClick={() => pick(p.href)}
                  className={[
                    'shrink-0 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
                    page === p.href
                      ? 'border-[var(--coral)] bg-[var(--coral)]/10 text-[var(--warm-dark)]'
                      : 'border-[var(--warm-border)] bg-[var(--cream)] text-[var(--warm-mid)]',
                  ].join(' ')}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="hidden sm:block text-[0.65625rem] text-[var(--warm-muted)] shrink-0">보기만 하는 작은 창 · 닫으면 입력하던 그대로</span>
            <button type="button" onClick={onClose} title="닫기"
              className="h-9 w-9 shrink-0 grid place-items-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)] transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        {/* 본문 — 같은 오리진 iframe (앱이 스스로 크롬 숨김) */}
        <iframe key={page} src={page} title="살짝 보기" className="w-full flex-1 border-0 bg-[var(--canvas)]" />
      </div>
    </div>
  )
}
