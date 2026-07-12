'use client'

// 표시 항목 선택 — 카드/리스트에 보일 필드를 이용자가 켜고 끄는 메뉴.
// 선택은 localStorage에 저장(기기별 유지).
//
// 사용:
//   const [vis, toggle] = useDisplayFields('roomManage.cardFields', FIELDS)
//   <DisplayFieldsMenu fields={FIELDS} visible={vis} onToggle={toggle} />
//   카드에서: {vis.floor && <…>}

import { useState, useRef, useEffect } from 'react'

export type FieldDef = { key: string; label: string; defaultOn?: boolean }

/** localStorage 백업 필드 표시 상태 훅 */
export function useDisplayFields(storageKey: string, fields: readonly FieldDef[]) {
  const defaults = () =>
    Object.fromEntries(fields.map(f => [f.key, f.defaultOn !== false])) as Record<string, boolean>

  const [visible, setVisible] = useState<Record<string, boolean>>(defaults)

  // 마운트 후 localStorage 값 병합 (SSR 안전)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setVisible(v => ({ ...v, ...JSON.parse(raw) }))
    } catch { /* localStorage 불가 — 기본값 유지 */ }
  }, [storageKey])

  const toggle = (key: string) => {
    setVisible(v => {
      const next = { ...v, [key]: !v[key] }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }

  return [visible, toggle] as const
}

export type FieldSection = {
  heading: string
  fields: readonly FieldDef[]
  visible: Record<string, boolean>
  onToggle: (key: string) => void
}

export function DisplayFieldsMenu({
  fields,
  visible,
  onToggle,
  sections,
  className,
  label = '표시 항목',
  heading = '카드에 표시할 항목',
}: {
  fields: readonly FieldDef[]
  visible: Record<string, boolean>
  onToggle: (key: string) => void
  /** 여러 그룹을 한 메뉴에 — 공실/점유처럼 상태별 항목을 버튼 하나로(운영자 지적 2026-07-06). 지정 시 fields/visible/onToggle 대신 사용 */
  sections?: FieldSection[]
  className?: string
  label?: string                  // 버튼 라벨(기본 '표시 항목'; 예: '공실 카드 항목')
  heading?: string                // 드롭다운 상단 안내문
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2.2" fill="var(--cream)" />
          <circle cx="15" cy="12" r="2.2" fill="var(--cream)" />
          <circle cx="9" cy="18" r="2.2" fill="var(--cream)" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-50 min-w-[184px] max-h-[70vh] overflow-y-auto bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl shadow-lift p-2">
          {sections ? sections.map((s, si) => (
            <div key={s.heading} className={si > 0 ? 'mt-1.5 pt-1.5 border-t border-[var(--warm-border)]/60' : ''}>
              <p className="px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium text-[var(--warm-muted)]">{s.heading}</p>
              {s.fields.map(f => (
                <label key={f.key}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--cream-soft)] transition-colors">
                  <input type="checkbox" checked={s.visible[f.key] ?? false} onChange={() => s.onToggle(f.key)}
                    className="w-4 h-4 accent-[var(--coral)]" />
                  <span className="text-sm text-[var(--warm-dark)]">{f.label}</span>
                </label>
              ))}
            </div>
          )) : (<>
          <p className="px-2 pt-1 pb-1.5 text-[0.6875rem] font-medium text-[var(--warm-muted)]">
            {heading}
          </p>
          {fields.map(f => (
            <label
              key={f.key}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--cream-soft)] transition-colors"
            >
              <input
                type="checkbox"
                checked={visible[f.key] ?? false}
                onChange={() => onToggle(f.key)}
                className="w-4 h-4 accent-[var(--coral)]"
              />
              <span className="text-sm text-[var(--warm-dark)]">{f.label}</span>
            </label>
          ))}
          </>)}
        </div>
      )}
    </div>
  )
}
