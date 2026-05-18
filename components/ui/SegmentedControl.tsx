'use client'

// 세그먼트 컨트롤 — 서로 배타적인 필터·탭을 하나의 그룹 스위치로 묶는다.
// 흩어진 알약 버튼 N개 → 묶인 컨트롤 1개로 시각적 잡음을 줄임.
//
// 디자인 (Brand Guide):
//   트랙: r-md(10) · border · bg cream-2 (페이지 톤 → 살짝 들어간 슬롯 느낌)
//   활성 세그먼트: 떠오른 cream 칩(r-sm 계열 7) + shadow
//   비활성: 투명 배경 + 뮤트 텍스트

import type { ReactNode } from 'react'

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

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-[10px] border border-[var(--warm-border)] bg-[var(--cream-2)] ${
        scroll ? 'max-w-full overflow-x-auto scrollbar-hide' : ''
      } ${className ?? ''}`}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`${seg} shrink-0 font-medium rounded-[7px] whitespace-nowrap transition-colors ${
              active
                ? 'bg-[var(--cream)] text-[var(--warm-dark)] shadow-sm'
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
