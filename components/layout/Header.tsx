'use client'

import { signOut } from '@/app/property-select/actions'
import { User } from '@supabase/supabase-js'
import { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const MONTH_KEY = 'roomos_selected_month'

function todayMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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
  const router      = useRouter()
  const todayMonth  = todayMonthStr()
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  const currentMonth = searchParams.get('month') ?? todayMonth

  // 페이지 이동 시 저장된 월로 복원
  useEffect(() => {
    const stored = localStorage.getItem(MONTH_KEY)
    if (stored && !searchParams.get('month') && stored !== todayMonth) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('month', stored)
      router.replace(`${pathname}?${params.toString()}`)
    }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyMonth = (m: string) => {
    localStorage.setItem(MONTH_KEY, m)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', m)
    router.push(`${pathname}?${params.toString()}`)
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
    <header className="h-14 md:h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        {/* 햄버거 (모바일 전용) */}
        <button
          onClick={onMenuClick}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-lg"
          aria-label="메뉴 열기"
        >
          ☰
        </button>

        {/* 월 이동 */}
        <button
          onClick={() => changeMonth(-1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors text-sm">
          {'◀'}
        </button>
        <div
          onClick={() => setShowPicker(!showPicker)}
          className="text-sm font-semibold text-white text-center hover:text-indigo-400 transition-colors relative cursor-pointer px-1"
        >
          {displayMonth}
          {showPicker && (
            <MonthPicker
              current={currentMonth}
              todayMonth={todayMonth}
              onSelect={(m) => { setShowPicker(false); applyMonth(m) }}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        {currentMonth < todayMonth && (
          <button
            onClick={() => changeMonth(1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors text-sm">
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
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-medium">
              {user.email?.[0].toUpperCase()}
            </div>
          )}
          <span className="text-sm text-gray-300 max-w-32 truncate hidden sm:block">
            {user.user_metadata?.full_name ?? user.email}
          </span>
        </button>

        {open && (
          <div className="absolute right-0 top-12 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50">
            <div className="p-3 border-b border-gray-700">
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <div className="p-1.5 space-y-0.5">
              <a href="/property-select"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors">
                {'영업장 변경'}
              </a>
              <form action={signOut}>
                <button type="submit"
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-gray-700 transition-colors">
                  {'로그아웃'}
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
      className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-4 w-64"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setYear(y => y - 1)}
          className="text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-gray-700 transition-colors text-sm">
          {'◀'}
        </button>
        <span className="text-white font-semibold text-sm">{year}년</span>
        <button onClick={() => setYear(y => y + 1)}
          className="text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-gray-700 transition-colors text-sm">
          {'▶'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {months.map((label, i) => {
          const monthStr = `${year}-${String(i + 1).padStart(2, '0')}`
          const isActive = monthStr === current
          return (
            <button
              key={i}
              disabled={year > maxYear || (year === maxYear && i + 1 > maxMonth)}
              onClick={() => onSelect(monthStr)}
              className={`py-1.5 text-xs rounded-lg transition-colors
                ${isActive
                  ? 'bg-indigo-600 text-white font-semibold'
                  : year > maxYear || (year === maxYear && i + 1 > maxMonth)
                    ? 'text-gray-700 cursor-not-allowed'
                    : 'text-gray-300 hover:bg-gray-700'}`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSelect(todayMonth)}
          className={`flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium
            ${current === todayMonth
              ? 'bg-indigo-600/30 text-indigo-300 cursor-default'
              : 'bg-gray-700 text-gray-300 hover:bg-indigo-600 hover:text-white'}`}>
          이번달
        </button>
        <button onClick={onClose}
          className="flex-1 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          닫기
        </button>
      </div>
    </div>
  )
}
