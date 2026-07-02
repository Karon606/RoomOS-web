'use client'

// §24 뷰 전환 탭 (View Tabs) — 코랄 채움 조인트 탭 정본.
// SegmentedControl(§22.2)은 필터(라디오, 해제 가능) 전용 — 이 컴포넌트는 "항상 정확히 1개 활성"인
// 뷰 전환에만 쓴다(판별은 §24.0). 링크 탭(href)은 <Link>, 아니면 <button>. 접미(suffix)는 24.3 형식.
import { useRef } from 'react'
import Link from 'next/link'

export interface ViewTab {
  id: string              // 탭 식별자 (패널 aria-labelledby와 매칭)
  label: string
  suffix?: string         // 합계 접미: "+16만" | "12만" — 괄호는 컴포넌트가 붙임(24.3)
  href?: string           // 지정 시 링크 탭(24.5). 없으면 <button>
  disabled?: boolean
}

export function ViewTabs({
  tabs,
  activeId,
  onChange,
  fill = false,
  ariaLabel,
}: {
  tabs: ViewTab[]          // 2~4 권장, 5 max
  activeId: string         // 항상 정확히 1개 — 필수(해제 없음)
  onChange?: (id: string) => void   // button 모드에서만
  fill?: boolean           // true = flex-1 균등 탭
  ariaLabel: string
}) {
  const refs = useRef<(HTMLElement | null)[]>([])

  // 키보드 roving(§24.6) — ←/→ 이동, Home/End 처음/끝. 활성만 tabindex=0.
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter(i => i >= 0)
    if (enabled.length === 0) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = enabled[(enabled.indexOf(idx) + 1) % enabled.length]
    else if (e.key === 'ArrowLeft') next = enabled[(enabled.indexOf(idx) - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next == null) return
    e.preventDefault()
    refs.current[next]?.focus()
  }

  const segBase = `px-4 ${fill ? 'flex-1 justify-center text-center' : ''} py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center whitespace-nowrap shrink-0
    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)]
    border-r border-[var(--warm-border)] last:border-r-0 motion-safe:transition-colors motion-safe:duration-150`
  const segActive   = 'bg-[var(--coral)] text-[var(--cream)]'
  const segInactive = 'bg-[var(--cream)] text-[var(--warm-mid)] hover:bg-[var(--cream-2)] hover:text-[var(--warm-dark)]'
  const segDisabled = 'bg-[var(--cream)] text-[var(--warm-muted)] cursor-not-allowed'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${fill ? 'flex w-full' : 'inline-flex'} rounded-[10px] border border-[var(--warm-border)] overflow-hidden bg-[var(--cream)] text-sm font-semibold max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId
        const cls = `${segBase} ${t.disabled ? segDisabled : active ? segActive : segInactive}`
        const content = (
          <>
            {t.label}
            {t.suffix && <span className="tabular-nums">&nbsp;({t.suffix})</span>}
          </>
        )
        return t.href && !t.disabled ? (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            ref={el => { refs.current[i] = el }}
            onKeyDown={e => onKeyDown(e, i)}
            className={cls}
          >
            {content}
          </Link>
        ) : (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            tabIndex={active ? 0 : -1}
            ref={el => { refs.current[i] = el }}
            onKeyDown={e => onKeyDown(e, i)}
            onClick={() => !t.disabled && onChange?.(t.id)}
            className={cls}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
