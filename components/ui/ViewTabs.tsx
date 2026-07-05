'use client'

// §24 뷰 전환 탭 (View Tabs) — 코랄 채움 조인트 탭 정본.
// SegmentedControl(§22.2)은 필터(라디오, 해제 가능) 전용 — 이 컴포넌트는 "항상 정확히 1개 활성"인
// 뷰 전환에만 쓴다(판별은 §24.0). 링크 탭(href)은 <Link>, 아니면 <button>. 접미(suffix)는 24.3 형식.
import { useLayoutEffect, useRef, useState } from 'react'
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
  equal = false,
  ariaLabel,
}: {
  tabs: ViewTab[]          // 2~4 권장, 5 max
  activeId: string         // 항상 정확히 1개 — 필수(해제 없음)
  onChange?: (id: string) => void   // button 모드에서만
  fill?: boolean           // true = flex-1 균등 탭(컨테이너 풀폭)
  equal?: boolean          // true = 탭 폭 동일(가장 긴 라벨 기준), 컨테이너는 내용폭 유지 — §24 부록 등재 제안 중
  ariaLabel: string
}) {
  const refs = useRef<(HTMLElement | null)[]>([])

  // 슬라이딩 코랄 채움(§25.3) — 활성 탭 위치를 실측해 채움 블록이 탭 사이를 미끄러진다.
  // 세그먼트 배경은 투명(트랙이 cream), 채움은 z-0, 탭 콘텐츠는 z-1. reduced-motion이면 즉시 점프.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const activeIdx = tabs.findIndex(t => t.id === activeId)
  useLayoutEffect(() => {
    const el = refs.current[activeIdx]
    if (!el) { setThumb(null); return }
    const measure = () => setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [activeIdx, tabs.length, fill, equal])

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

  const segBase = `relative z-[1] px-4 ${fill ? 'flex-1 justify-center text-center' : equal ? 'justify-center text-center' : ''} py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center whitespace-nowrap shrink-0
    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)]
    border-r border-[var(--warm-border)] last:border-r-0 motion-safe:transition-colors motion-safe:duration-150`
  // 채움 실측 전(첫 프레임·JS 비활성)엔 활성 탭이 자체 배경으로 폴백
  const segActive   = thumb ? 'text-[var(--cream)]' : 'bg-[var(--coral)] text-[var(--cream)]'
  const segInactive = 'text-[var(--warm-mid)] hover:bg-[var(--cream-2)] hover:text-[var(--warm-dark)]'
  const segDisabled = 'text-[var(--warm-muted)] cursor-not-allowed'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative ${fill ? 'flex w-full' : equal ? 'inline-grid grid-flow-col auto-cols-fr' : 'inline-flex'} rounded-[10px] border border-[var(--warm-border)] overflow-hidden bg-[var(--cream)] text-sm font-semibold max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      {thumb && (
        <div aria-hidden className="absolute inset-y-0 bg-[var(--coral)] motion-safe:transition-[left,width] motion-safe:duration-200 motion-safe:ease-out"
          style={{ left: thumb.left, width: thumb.width }} />
      )}
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
