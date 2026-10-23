'use client'

// 세그먼트 컨트롤 — 서로 배타적인 필터·탭을 하나의 그룹 스위치로 묶는다.
// 흩어진 알약 버튼 N개 → 묶인 컨트롤 1개로 시각적 잡음을 줄임.
//
// 디자인 (Brand Guide):
//   트랙: r-md(10) · border · bg cream-2 (페이지 톤 → 살짝 들어간 슬롯 느낌)
//   활성 세그먼트: 떠오른 cream 칩(r-sm 계열 7) + shadow — 칩이 탭 사이를 미끄러져 이동(v2.0 §29)
//   비활성: 투명 배경 + --seg-ink-off 텍스트(트랙 --cream-2 위 AA. --warm-mid 는 4.11:1 미달, globals.css 주석·가이드 §23)
// 슬라이딩 칩: 세그먼트 폭이 제각각이라 offsetLeft/offsetWidth 실측으로 위치·크기를 잡고
// left·width 트랜지션으로 이동. reduced-motion이면 트랜지션 없이 즉시 점프.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type SegmentOption<T extends string> = {
  value: T
  label: ReactNode
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  scroll = false,
  className,
  ariaLabel,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** sm = text-xs(필터 행) · md = text-sm(탭) */
  size?: 'sm' | 'md'
  /** 옵션이 많아 가로로 넘칠 때 트랙을 가로 스크롤 */
  scroll?: boolean
  className?: string
  ariaLabel?: string
}) {
  const seg = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const activeIdx = options.findIndex(o => o.value === value)

  useLayoutEffect(() => {
    const el = btnRefs.current[activeIdx]
    if (!el) { setThumb(null); return }
    const measure = () => setThumb({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [activeIdx, options.length, size])

  // scroll 모드 · 넘침 페이드 — 잘리는 쪽 끝을 흐려 '더 있다'를 말한다(ViewTabs 와 같은 data-fade, 마스크 규칙은 globals.css).
  const trackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const track = trackRef.current
    if (!scroll || !track) return
    const update = () => {
      if (track.scrollWidth <= track.clientWidth + 1) { delete track.dataset.fade; return }
      const atStart = track.scrollLeft <= 1
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1
      track.dataset.fade = atStart ? 'right' : atEnd ? 'left' : 'both'
    }
    update()
    track.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(track)
    return () => { track.removeEventListener('scroll', update); ro.disconnect() }
  }, [scroll, options.length])

  // scroll 모드 · 고른 칸을 트랙 안으로(첫 렌더 포함). ?cat= 로 뒤쪽 칸에 착지하면 고른 칸이 스크롤 밖이라
  // 아무것도 안 골라진 화면으로 보였다(지출 카테고리 독립 검수 2026-10-23). 움직이는 것은 트랙 가로 스크롤뿐이다
  // (요소를 화면으로 끌어오는 API 는 페이지 세로 위치까지 옮겨 쓰지 않는다, ViewTabs 와 같은 이유). 첫 착지는 즉시, 이후만 부드럽게.
  // 칸 폭이 나중에 바뀌면(웹폰트 교체·글자 크기) 처음 맞춘 자리가 어긋나 고른 칸이 다시 잘린다. 고른 칸의 크기 변화를 지켜보고
  // 그때 잘려 있으면만 다시 맞춘다(사람이 트랙을 밀어 둔 자리는 고른 칸이 보이는 한 건드리지 않는다).
  const scrolledOnce = useRef(false)
  useEffect(() => {
    const el = btnRefs.current[activeIdx]
    const track = trackRef.current
    if (!scroll || !el || !track) return
    const bring = (onlyIfClipped: boolean) => {
      if (track.scrollWidth <= track.clientWidth) return
      if (onlyIfClipped && el.offsetLeft >= track.scrollLeft && el.offsetLeft + el.offsetWidth <= track.scrollLeft + track.clientWidth) return
      const max = track.scrollWidth - track.clientWidth
      const left = Math.max(0, Math.min(max, el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2))
      if (Math.abs(track.scrollLeft - left) < 1) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      track.scrollTo({ left, behavior: scrolledOnce.current && !onlyIfClipped && !reduce ? 'smooth' : 'auto' })
    }
    bring(false)
    scrolledOnce.current = true
    const ro = new ResizeObserver(() => bring(true))
    ro.observe(el)
    return () => ro.disconnect()
  }, [scroll, activeIdx, options.length])

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`relative inline-flex items-center gap-0.5 p-0.5 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream-2)] ${
        scroll ? 'max-w-full overflow-x-auto scrollbar-hide' : ''
      } ${className ?? ''}`}
    >
      {thumb && (
        <div aria-hidden className="absolute rounded-[7px] bg-[var(--cream)] shadow-sm motion-safe:transition-[left,width,top,height] motion-safe:duration-200 motion-safe:ease-out"
          style={{ left: thumb.left, top: thumb.top, width: thumb.width, height: thumb.height }} />
      )}
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            ref={el => { btnRefs.current[i] = el }}
            onClick={() => onChange(opt.value)}
            className={`${seg} relative z-[1] shrink-0 font-medium rounded-[7px] whitespace-nowrap transition-colors ${
              active
                ? `text-[var(--warm-dark)]${thumb ? '' : ' bg-[var(--cream)] shadow-sm'}`
                : 'text-[var(--seg-ink-off)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
