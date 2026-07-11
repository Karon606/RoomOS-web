'use client'

// 세그먼트 컨트롤 — 서로 배타적인 필터·탭을 하나의 그룹 스위치로 묶는다.
// 흩어진 알약 버튼 N개 → 묶인 컨트롤 1개로 시각적 잡음을 줄임.
//
// 디자인 (Brand Guide):
//   트랙: r-md(10) · border · bg cream-2 (페이지 톤 → 살짝 들어간 슬롯 느낌)
//   활성 세그먼트: 떠오른 cream 칩(r-sm 계열 7) + shadow — 칩이 탭 사이를 미끄러져 이동(v2.0 §29)
//   비활성: 투명 배경 + 뮤트 텍스트
// 슬라이딩 칩: 세그먼트 폭이 제각각이라 offsetLeft/offsetWidth 실측으로 위치·크기를 잡고
// left·width 트랜지션으로 이동. reduced-motion이면 트랜지션 없이 즉시 점프.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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

  return (
    <div
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
                : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
