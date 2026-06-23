'use client'

// §21.2 SectionHeader — 마커 슬롯형 그룹 헤더.
// 그룹 축(소모품=카테고리 색 점, 비품=배정 위치 아이콘)은 다르되 마커만 교체, 나머지는 동일.
import React from 'react'

export function SectionHeader({
  marker, name, count, trailing,
  collapsible = false, collapsed = false, onToggle,
  first = false, className = '',
}: {
  marker?: React.ReactNode      // 카테고리=색 점 11px / 위치=아이콘 14px (slot 교체)
  name: React.ReactNode         // 13px/700
  count?: React.ReactNode       // DM Mono 11px --warm-muted
  trailing?: React.ReactNode    // 우측(합계 금액 등)
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  first?: boolean               // 첫 헤더 상단 여백 축소
  className?: string
}) {
  const Tag: 'button' | 'div' = collapsible ? 'button' : 'div'
  return (
    <Tag
      {...(collapsible ? { type: 'button' as const, onClick: onToggle } : {})}
      className={[
        'flex w-full items-center gap-2 pb-1.5',
        first ? 'pt-0.5' : 'pt-3.5',
        collapsible ? 'cursor-pointer text-left' : '',
        className,
      ].join(' ')}>
      {marker != null && <span className="grid shrink-0 place-items-center">{marker}</span>}
      <span className="text-[0.8125rem] font-bold text-[var(--warm-dark)]">{name}</span>
      {count != null && <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{count}</span>}
      <span className="flex-1" />
      {trailing}
      {collapsible && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-[var(--warm-muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      )}
    </Tag>
  )
}

// 카테고리 색 점 마커(11px) — 소모품 탭용 헬퍼
export function DotMarker({ color }: { color: string }) {
  return <span className="block h-[11px] w-[11px] rounded-full" style={{ background: color }} />
}
