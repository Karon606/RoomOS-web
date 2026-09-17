'use client'

// v2.0 §22 SectionHeader — 마커 슬롯형 그룹 헤더.
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
  // 접힘 상태는 셰브런 회전으로만 말하고 있었다 — 화면을 못 보는 사람에게는 지금 열려 있는지
  // 알 단서가 하나도 없다. 형제(TenantRequestsTab 의 `새 요청 등록`)는 이미 달고 있다.
  // 정본에 다니 전 사용처가 함께 고쳐진다.
  return (
    <Tag
      {...(collapsible ? { type: 'button' as const, onClick: onToggle, 'aria-expanded': !collapsed } : {})}
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
