'use client'

import { signOut } from '@/app/property-select/actions'
import { User } from '@supabase/supabase-js'
import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const MONTH_KEY = 'roomos_selected_month'

function todayMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// 미니 로고 스피너 (헤더 전용 소형)
function MiniLogoSpinner() {
  return (
    <>
      <style>{`
        @keyframes mls-l { 0%,100%{transform:translateX(-5px);opacity:0} 25%,70%{transform:translateX(0);opacity:1} }
        @keyframes mls-r { 0%,100%{transform:translateX(5px);opacity:0}  25%,70%{transform:translateX(0);opacity:1} }
        .mls-b1{animation:mls-l 1.6s ease-in-out infinite 0s}
        .mls-b2{animation:mls-r 1.6s ease-in-out infinite 0.12s}
        .mls-b3{animation:mls-l 1.6s ease-in-out infinite 0.24s}
        .mls-b4{animation:mls-r 1.6s ease-in-out infinite 0.36s}
      `}</style>
      <svg width="22" height="20" viewBox="0 0 28 24" xmlns="http://www.w3.org/2000/svg">
        <g className="mls-b1"><line x1="1" y1="3"  x2="25" y2="3"  stroke="#f4623a" strokeWidth="4" strokeLinecap="round"/></g>
        <g className="mls-b2"><line x1="1" y1="11" x2="16" y2="11" stroke="#f4623a" strokeWidth="4" strokeLinecap="round" opacity="0.5"/></g>
        <g className="mls-b3"><line x1="1" y1="19" x2="25" y2="19" stroke="#f4623a" strokeWidth="4" strokeLinecap="round" opacity="0.72"/></g>
      </svg>
    </>
  )
}

export default function Header({
  user,
  onMenuClick,
}: {
  user: User
  onMenuClick?: () => void
}) {
  const [open, setOpen]             = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router      = useRouter()
  const todayMonth  = todayMonthStr()
  const pathname    = usePathname()
  const searchParams = useSearchParams()
  const pickerRef   = useRef<HTMLDivElement>(null)

  const currentMonth = searchParams.get('month') ?? todayMonth

  // 픽커 외부 클릭 시 닫기
  useEffect(() => {
    if (!showPicker) return
    const handle = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showPicker])

  const applyMonth = (m: string) => {
    localStorage.setItem(MONTH_KEY, m)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', m)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const changeMonth = (delta: number) => {
    const [yyyy, mm] = currentMonth.split('-').map(Number)
    const d = new Date(yyyy, mm - 1 + delta, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    applyMonth(next)
  }

  const [cy, cm] = currentMonth.split('-')
  const displayMonth = `${cy}년 ${parseInt(cm)}월`

  return (
    <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 shrink-0"
            style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }}>
      <div className="flex items-center gap-2">
        {/* 햄버거 (모바일 전용) — 클릭 시 픽커도 닫기 */}
        <button
          onClick={() => { setShowPicker(false); onMenuClick?.() }}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--warm-mid)' }}
          aria-label="메뉴 열기"
        >
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="0" y1="1" x2="18" y2="1"/>
            <line x1="0" y1="7" x2="18" y2="7"/>
            <line x1="0" y1="13" x2="18" y2="13"/>
          </svg>
        </button>

        {/* 이전 달 버튼 */}
        <button
          onClick={() => changeMonth(-1)}
          disabled={isPending}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors disabled:opacity-40"
          style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
          {'◀'}
        </button>

        {/* 월 표시 + 픽커 */}
        <div ref={pickerRef} className="relative">
          <div
            onClick={() => !isPending && setShowPicker(v => !v)}
            className="text-sm font-semibold text-center transition-opacity relative cursor-pointer px-1 flex items-center gap-1.5"
            style={{ color: 'var(--warm-dark)', opacity: isPending ? 0.4 : 1 }}
          >
            {isPending ? <MiniLogoSpinner /> : displayMonth}
          </div>
          {showPicker && !isPending && (
            <MonthPicker
              current={currentMonth}
              todayMonth={todayMonth}
              onSelect={(m) => { setShowPicker(false); applyMonth(m) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>

        {/* 다음 달 버튼 */}
        {currentMonth < todayMonth && (
          <button
            onClick={() => changeMonth(1)}
            disabled={isPending}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-colors disabled:opacity-40"
            style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
            {'▶'}
          </button>
        )}
      </div>

      {/* 유저 메뉴 */}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          {user.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="avatar"
              className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                 style={{ background: 'var(--coral)' }}>
              {user.email?.[0].toUpperCase()}
            </div>
          )}
          <span className="text-sm max-w-32 truncate hidden sm:block" style={{ color: 'var(--warm-mid)' }}>
            {user.user_metadata?.full_name ?? user.email}
          </span>
        </button>

        {open && (
          <div className="absolute right-0 top-12 w-48 rounded-xl shadow-xl z-50"
               style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
            <div className="p-3" style={{ borderBottom: '1px solid var(--warm-border)' }}>
              <p className="text-xs truncate" style={{ color: 'var(--warm-muted)' }}>{user.email}</p>
            </div>
            <div className="p-1.5 space-y-0.5">
              <a href="/property-select"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: 'var(--warm-dark)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                영업장 변경
              </a>
              <form action={signOut}>
                <button type="submit"
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{ color: '#ef4444' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  로그아웃
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function MonthPicker({
  current, todayMonth, onSelect, onClose
}: {
  current: string
  todayMonth: string
  onSelect: (month: string) => void
  onClose: () => void
}) {
  const [year, setYear] = useState(Number(current.split('-')[0]))
  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const now = new Date()
  const maxYear = now.getFullYear()
  const maxMonth = now.getMonth() + 1

  return (
    <div
      className="absolute top-8 left-1/2 -translate-x-1/2 z-[60] rounded-2xl shadow-2xl p-4 w-64"
      style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setYear(y => y - 1)}
          className="px-2 py-1 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--warm-mid)' }}>
          {'◀'}
        </button>
        <span className="font-semibold text-sm" style={{ color: 'var(--warm-dark)' }}>{year}년</span>
        <button onClick={() => setYear(y => y + 1)}
          className="px-2 py-1 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--warm-mid)' }}>
          {'▶'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {months.map((label, i) => {
          const monthStr = `${year}-${String(i + 1).padStart(2, '0')}`
          const isActive = monthStr === current
          const disabled = year > maxYear || (year === maxYear && i + 1 > maxMonth)
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onSelect(monthStr)}
              className="py-1.5 text-xs rounded-lg transition-colors"
              style={isActive
                ? { background: 'var(--coral)', color: '#fff', fontWeight: 600 }
                : disabled
                  ? { color: 'var(--warm-border)', cursor: 'not-allowed' }
                  : { color: 'var(--warm-mid)' }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSelect(todayMonth)}
          className="flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium"
          style={current === todayMonth
            ? { background: 'var(--coral-light)', color: 'var(--coral)', cursor: 'default' }
            : { background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
          이번달
        </button>
        <button onClick={onClose}
          className="flex-1 py-1.5 text-xs transition-colors"
          style={{ color: 'var(--warm-muted)' }}>
          닫기
        </button>
      </div>
    </div>
  )
}
