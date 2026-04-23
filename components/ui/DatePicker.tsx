'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

type ViewMode = 'day' | 'month' | 'year'

const KO_MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const KO_DOW    = ['일','월','화','수','목','금','토']

interface DatePickerProps {
  value: string                   // 'YYYY-MM-DD' or ''
  onChange: (v: string) => void
  name?: string                   // hidden input name for form submission
  placeholder?: string
  maxDate?: string
  minDate?: string
  className?: string
  style?: React.CSSProperties
}

export function DatePicker({
  value, onChange, name, placeholder = '날짜 선택',
  maxDate, minDate, className, style,
}: DatePickerProps) {
  const [open, setOpen]         = useState(false)
  const [view, setView]         = useState<ViewMode>('day')
  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.slice(0, 4)) : new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.slice(5, 7)) - 1 : new Date().getMonth())
  const [yearBase, setYearBase] = useState(() => {
    const y = value ? parseInt(value.slice(0, 4)) : new Date().getFullYear()
    return Math.floor(y / 12) * 12
  })
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const todayStr   = new Date().toISOString().slice(0, 10)

  // 외부에서 value가 바뀌면 뷰 동기화
  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.slice(0, 4)))
      setViewMonth(parseInt(value.slice(5, 7)) - 1)
    }
  }, [value])

  const handleOpen = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const popW = Math.max(r.width, 280)
      // 우측 경계 체크
      const left = Math.min(r.left, window.innerWidth - popW - 8)
      setPos({ top: r.bottom + 4, left: Math.max(8, left), width: popW })
    }
    setView('day')
    setOpen(true)
  }

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : ''

  // ── Day view 계산 ────────────────────────────────────────────
  const firstDOW  = new Date(viewYear, viewMonth, 1).getDay()
  const daysInM   = new Date(viewYear, viewMonth + 1, 0).getDate()

  const prevMonth = () => viewMonth === 0
    ? (setViewMonth(11), setViewYear(y => y - 1))
    : setViewMonth(m => m - 1)

  const nextMonth = () => viewMonth === 11
    ? (setViewMonth(0), setViewYear(y => y + 1))
    : setViewMonth(m => m + 1)

  const handleDayClick = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    onChange(`${viewYear}-${m}-${d}`)
    setOpen(false)
  }

  const isDisabledDate = (dateStr: string) =>
    (!!maxDate && dateStr > maxDate) || (!!minDate && dateStr < minDate)

  // ── 공용 버튼 스타일 ─────────────────────────────────────────
  const navBtn = {
    base: 'w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-colors',
    style: { color: 'var(--warm-mid)', background: 'var(--canvas)' } as React.CSSProperties,
  }
  const headerBtn = (active: boolean) => ({
    className: 'px-2 py-0.5 rounded-lg text-sm font-semibold transition-colors',
    style: { color: active ? 'var(--coral)' : 'var(--warm-dark)' } as React.CSSProperties,
  })

  // ── 팝업 렌더 ────────────────────────────────────────────────
  const popup = open ? (
    <>
      {/* 외부 클릭 닫기 backdrop */}
      <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />

      <div
        className="fixed z-[100] rounded-2xl shadow-2xl select-none"
        style={{
          top: pos.top, left: pos.left, width: pos.width,
          background: 'var(--cream)',
          border: '1px solid var(--warm-border)',
          padding: '12px',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* ════ 일 뷰 ════ */}
        {view === 'day' && (
          <>
            {/* 헤더: ◀ [月] [年] ▶ */}
            <div className="flex items-center gap-1 mb-2">
              <button onClick={prevMonth} className={navBtn.base} style={navBtn.style}>◀</button>
              <div className="flex-1 flex items-center justify-center gap-1">
                <button
                  onClick={() => setView('month')}
                  className={headerBtn(false).className}
                  style={headerBtn(false).style}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  {KO_MONTHS[viewMonth]}
                </button>
                <button
                  onClick={() => { setYearBase(Math.floor(viewYear / 12) * 12); setView('year') }}
                  className={headerBtn(false).className}
                  style={headerBtn(false).style}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  {viewYear}년
                </button>
              </div>
              <button onClick={nextMonth} className={navBtn.base} style={navBtn.style}>▶</button>
            </div>

            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 mb-1">
              {KO_DOW.map((d, i) => (
                <div key={d} className="text-center py-1"
                  style={{ fontSize: 10, fontWeight: 600, color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : 'var(--warm-muted)' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {Array.from({ length: firstDOW }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInM }).map((_, i) => {
                const day = i + 1
                const m = String(viewMonth + 1).padStart(2, '0')
                const d = String(day).padStart(2, '0')
                const dateStr = `${viewYear}-${m}-${d}`
                const isSelected = dateStr === value
                const isToday    = dateStr === todayStr
                const disabled   = isDisabledDate(dateStr)
                const dow = (firstDOW + i) % 7
                return (
                  <button key={day}
                    disabled={disabled}
                    onClick={() => handleDayClick(day)}
                    className="h-8 w-full flex items-center justify-center rounded-lg text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    style={isSelected
                      ? { background: 'var(--coral)', color: '#fff' }
                      : isToday
                        ? { background: 'rgba(244,98,58,0.12)', color: 'var(--coral)', fontWeight: 700 }
                        : { color: dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : 'var(--warm-dark)' }
                    }
                  >
                    {day}
                  </button>
                )
              })}
            </div>

            {/* 오늘 / 초기화 */}
            <div className="flex gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
              <button onClick={() => { onChange(todayStr); setOpen(false) }}
                className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors"
                style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
                오늘
              </button>
              {value && (
                <button onClick={() => { onChange(''); setOpen(false) }}
                  className="flex-1 py-1.5 text-xs rounded-lg transition-colors"
                  style={{ color: 'var(--warm-muted)' }}>
                  초기화
                </button>
              )}
            </div>
          </>
        )}

        {/* ════ 월 뷰 ════ */}
        {view === 'month' && (
          <>
            <div className="flex items-center gap-1 mb-3">
              <button onClick={() => setViewYear(y => y - 1)} className={navBtn.base} style={navBtn.style}>◀</button>
              <button
                onClick={() => { setYearBase(Math.floor(viewYear / 12) * 12); setView('year') }}
                className="flex-1 text-sm font-semibold py-0.5 rounded-lg transition-colors text-center"
                style={{ color: 'var(--warm-dark)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                {viewYear}년
              </button>
              <button onClick={() => setViewYear(y => y + 1)} className={navBtn.base} style={navBtn.style}>▶</button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {KO_MONTHS.map((label, i) => {
                const isSelected = value
                  ? parseInt(value.slice(0, 4)) === viewYear && parseInt(value.slice(5, 7)) === i + 1
                  : false
                const isCurrent = viewMonth === i
                return (
                  <button key={i}
                    onClick={() => { setViewMonth(i); setView('day') }}
                    className="py-2 text-xs rounded-xl transition-colors font-medium"
                    style={isSelected
                      ? { background: 'var(--coral)', color: '#fff' }
                      : isCurrent
                        ? { background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }
                        : { color: 'var(--warm-mid)' }}>
                    {label}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ════ 연도 뷰 ════ */}
        {view === 'year' && (
          <>
            <div className="flex items-center gap-1 mb-3">
              <button onClick={() => setYearBase(b => b - 12)} className={navBtn.base} style={navBtn.style}>◀</button>
              <div className="flex-1 text-center text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>
                {yearBase} – {yearBase + 11}
              </div>
              <button onClick={() => setYearBase(b => b + 12)} className={navBtn.base} style={navBtn.style}>▶</button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }).map((_, i) => {
                const yr = yearBase + i
                const isSelected = value ? parseInt(value.slice(0, 4)) === yr : false
                const isViewYear = yr === viewYear
                return (
                  <button key={yr}
                    onClick={() => { setViewYear(yr); setView('month') }}
                    className="py-2 text-xs rounded-xl transition-colors font-medium"
                    style={isSelected
                      ? { background: 'var(--coral)', color: '#fff' }
                      : isViewYear
                        ? { background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }
                        : { color: 'var(--warm-mid)' }}>
                    {yr}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  ) : null

  return (
    <>
      {/* 폼 제출용 hidden input (form 내부에 위치) */}
      {name && <input type="hidden" name={name} value={value} readOnly />}

      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className={`w-full text-left ${className ?? ''}`}
        style={style}
      >
        {displayValue
          ? displayValue
          : <span style={{ opacity: 0.45 }}>{placeholder}</span>
        }
      </button>

      {typeof window !== 'undefined' && popup
        ? createPortal(popup, document.body)
        : null
      }
    </>
  )
}
