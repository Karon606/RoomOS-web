'use client'

// v2.0 §23 리스트·테이블 공용 검색바 — 수납·호실관리·고객관리 동일 룩(정본).
// 좌측 돋보기 SVG + cream 배경 + 우측 지우기(×). 풀폭이 기본이며 모바일에서도 항상 노출.
// (이전엔 고객관리만 아이콘 없는 데스크탑 전용 input 이라 모바일에서 검색 불가였음 — 통일로 해결)
import React from 'react'

export function SearchBar({
  value, onChange, placeholder, className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string                 // 컨테이너 추가 클래스 (예: 'flex-1')
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] pointer-events-none"
        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" /><path d="M16 16 L21 21" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm pl-9 pr-8 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
      />
      {value && (
        <button
          type="button" onClick={() => onChange('')} aria-label="검색어 지우기"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-base leading-none"
        >×</button>
      )}
    </div>
  )
}
