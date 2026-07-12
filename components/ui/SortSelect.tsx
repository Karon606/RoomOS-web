'use client'

// 정렬 선택 — 옵션이 많아(8~11개) 세그먼트 컨트롤에 안 들어가는 정렬용.
// 네이티브 select(모바일에서 네이티브 피커) + 오름/내림 토글 버튼.

export type SortOption<T extends string> = { value: T; label: string }

export function SortSelect<T extends string>({
  options,
  value,
  dir,
  onChange,
  onToggleDir,
  className,
  ariaLabel,
}: {
  options: readonly SortOption<T>[]
  value: T
  dir: 'asc' | 'desc'
  onChange: (value: T) => void
  onToggleDir: () => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <span className="text-xs font-medium text-[var(--warm-muted)]">정렬</span>
      <div className="relative">
        <select
          aria-label={ariaLabel ?? '정렬 기준'}
          value={value}
          onChange={e => onChange(e.target.value as T)}
          className="appearance-none bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs font-medium rounded-sm pl-3 pr-7 py-1.5 outline-none focus:border-[var(--coral)] transition-colors"
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--warm-muted)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </div>
      <button
        type="button"
        onClick={onToggleDir}
        aria-label={dir === 'asc' ? '오름차순 · 누르면 내림차순' : '내림차순 · 누르면 오름차순'}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] text-xs text-[var(--warm-mid)] transition-colors hover:border-[var(--coral)] hover:text-[var(--warm-dark)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={dir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
        </svg>
      </button>
    </div>
  )
}
