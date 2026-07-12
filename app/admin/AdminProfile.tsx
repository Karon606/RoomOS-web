'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { signOut } from '@/app/property-select/actions'

// 운영자 헤더 우측 프로필 드롭다운 — 로그인 계정 표시 + 앱으로 + 로그아웃.
export default function AdminProfile({
  email,
  hasProperties,
}: {
  email: string | null
  hasProperties: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const initial = (email ?? '?')[0]?.toUpperCase() ?? '?'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--cream-soft)] min-h-[40px]"
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--on-solid)] text-xs font-semibold shrink-0"
          style={{ background: 'var(--persimmon)' }}
          aria-hidden
        >
          {initial}
        </div>
        <span className="text-xs truncate max-w-[140px] hidden sm:inline"
          style={{ color: 'var(--ink-3)' }}>
          {email}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-mute)' }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[220px] rounded-xl shadow-lg overflow-hidden z-20"
          style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)' }}
        >
          {email && (
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--cream-3)' }}>
              <p className="text-[0.625rem]" style={{ color: 'var(--ink-mute)' }}>로그인 계정</p>
              <p className="text-sm font-medium truncate mt-0.5" style={{ color: 'var(--ink-2)' }}>{email}</p>
            </div>
          )}
          {hasProperties && (
            <Link
              href="/property-select"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm hover:bg-[var(--cream-soft)] transition-colors"
              style={{ color: 'var(--ink-3)' }}
            >
              앱으로 ›
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--cream-soft)] transition-colors"
              style={{ color: 'var(--persimmon-d)' }}
            >
              로그아웃
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
