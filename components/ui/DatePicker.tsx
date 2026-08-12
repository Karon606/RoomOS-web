'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { kstYmdStr } from '@/lib/kstDate'

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
  monthOnly?: boolean             // 월 단위 선택 — 월 뷰에서 시작, 월 클릭 시 'YYYY-MM-01' 반환·닫힘
  disabled?: boolean              // 저장 진행 중 재입력 차단(네이티브 input 의 disabled 자리를 대신한다)
  className?: string
  style?: React.CSSProperties
}

export function DatePicker({
  value, onChange, name, placeholder = '날짜 선택',
  maxDate, minDate, monthOnly, disabled, className, style,
}: DatePickerProps) {
  // KST 기준 오늘 — toISOString은 UTC라 KST 00~09시에 어제로 계산되던 잠복 버그(운영자 승인 수정 2026-07-19).
  // 아래 뷰 기본값·'올해로'도 같은 기준을 쓴다 — new Date() 는 서버(UTC)와 기기(KST)가 갈려
  // 연말 새벽에 달력이 지난해로 열리고 하이드레이션도 어긋난다.
  const todayStr      = kstYmdStr()
  const todayYear     = parseInt(todayStr.slice(0, 4), 10)
  const todayMonthIdx = parseInt(todayStr.slice(5, 7), 10) - 1

  const [open, setOpen]         = useState(false)
  const [view, setView]         = useState<ViewMode>('day')
  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.slice(0, 4)) : todayYear)
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.slice(5, 7)) - 1 : todayMonthIdx)
  const [yearBase, setYearBase] = useState(() => {
    const y = value ? parseInt(value.slice(0, 4)) : todayYear
    return Math.floor(y / 12) * 12
  })
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 외부에서 value가 바뀌면 뷰 동기화
  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.slice(0, 4)))
      setViewMonth(parseInt(value.slice(5, 7)) - 1)
    }
  }, [value])

  const handleOpen = () => {
    if (disabled) return
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const popW = Math.max(r.width, 280)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8))
      // 뷰포트 하단 잘림 방지: 공간이 부족하면 트리거 위쪽에 표시
      const estimatedH = 340
      const spaceBelow = window.innerHeight - r.bottom - 8
      const topBelow   = r.bottom + 4
      const topAbove   = Math.max(8, r.top - estimatedH - 4)
      setPos({ top: spaceBelow >= estimatedH ? topBelow : topAbove, left, width: popW })
    }
    setView(monthOnly ? 'month' : 'day')
    setOpen(true)
  }

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('ko-KR',
        monthOnly
          ? { year: 'numeric', month: 'long' }
          : { year: 'numeric', month: 'long', day: 'numeric' })
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
      {/* 외부 클릭 닫기 backdrop — 모달(z-200~300) 위에 떠야 하므로 z-[var(--z-lightbox)] */}
      <div className="fixed inset-0 z-[var(--z-lightbox)]" onClick={() => setOpen(false)} />

      <div
        className="fixed z-[calc(var(--z-lightbox)+1)] rounded-xl shadow-lift select-none"
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
            {/* 헤더: ◀ [年] [月] ▶ */}
            <div className="flex items-center gap-1 mb-2">
              <button onClick={prevMonth} aria-label="이전 달" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg></button>
              <div className="flex-1 flex items-center justify-center gap-1">
                <button
                  onClick={() => { setYearBase(Math.floor(viewYear / 12) * 12); setView('year') }}
                  className={headerBtn(false).className}
                  style={headerBtn(false).style}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  {viewYear}년
                </button>
                <button
                  onClick={() => setView('month')}
                  className={headerBtn(false).className}
                  style={headerBtn(false).style}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  {KO_MONTHS[viewMonth]}
                </button>
              </div>
              <button onClick={nextMonth} aria-label="다음 달" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg></button>
            </div>

            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 mb-1">
              {KO_DOW.map((d, i) => (
                <div key={d} className="text-center py-1"
                  style={{ fontSize: 10, fontWeight: 600, color: i === 0 ? 'var(--danger-fg)' : i === 6 ? 'var(--info-fg)' : 'var(--warm-muted)' }}>
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
                      ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                      : isToday
                        ? { background: 'color-mix(in srgb, var(--coral) 12%, transparent)', color: 'var(--coral)', fontWeight: 700 }
                        : { color: dow === 0 ? 'var(--danger-fg)' : dow === 6 ? 'var(--info-fg)' : 'var(--warm-dark)' }
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
              <button onClick={() => setViewYear(y => y - 1)} aria-label="이전 해" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg></button>
              <button
                onClick={() => { setYearBase(Math.floor(viewYear / 12) * 12); setView('year') }}
                className="flex-1 text-sm font-semibold py-0.5 rounded-lg transition-colors text-center"
                style={{ color: 'var(--warm-dark)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--canvas)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                {viewYear}년
              </button>
              <button onClick={() => setViewYear(y => y + 1)} aria-label="다음 해" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {KO_MONTHS.map((label, i) => {
                const isSelected = value
                  ? parseInt(value.slice(0, 4)) === viewYear && parseInt(value.slice(5, 7)) === i + 1
                  : false
                const isCurrent = viewMonth === i
                return (
                  <button key={i}
                    onClick={() => {
                      setViewMonth(i)
                      if (monthOnly) {
                        onChange(`${viewYear}-${String(i + 1).padStart(2, '0')}-01`)
                        setOpen(false)
                      } else {
                        setView('day')
                      }
                    }}
                    className="py-2 text-xs rounded-lg transition-colors font-medium"
                    style={isSelected
                      ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                      : isCurrent
                        ? { background: 'color-mix(in srgb, var(--coral) 10%, transparent)', color: 'var(--coral)' }
                        : { color: 'var(--warm-mid)' }}>
                    {label}
                  </button>
                )
              })}
            </div>
            {/* 올해로 이동 / (월 단위) 초기화 */}
            {(viewYear !== todayYear || (monthOnly && value)) && (
              <div className="mt-2 pt-2 flex gap-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
                {viewYear !== todayYear && (
                  <button
                    onClick={() => setViewYear(todayYear)}
                    className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
                    올해로
                  </button>
                )}
                {monthOnly && value && (
                  <button
                    onClick={() => { onChange(''); setOpen(false) }}
                    className="flex-1 py-1.5 text-xs rounded-lg transition-colors"
                    style={{ color: 'var(--warm-muted)' }}>
                    초기화
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ════ 연도 뷰 ════ */}
        {view === 'year' && (
          <>
            <div className="flex items-center gap-1 mb-3">
              <button onClick={() => setYearBase(b => b - 12)} aria-label="이전 범위" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg></button>
              <div className="flex-1 text-center text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>
                {yearBase} – {yearBase + 11}
              </div>
              <button onClick={() => setYearBase(b => b + 12)} aria-label="다음 범위" className={navBtn.base} style={navBtn.style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }).map((_, i) => {
                const yr = yearBase + i
                const isSelected = value ? parseInt(value.slice(0, 4)) === yr : false
                const isViewYear = yr === viewYear
                return (
                  <button key={yr}
                    onClick={() => { setViewYear(yr); setView('month') }}
                    className="py-2 text-xs rounded-lg transition-colors font-medium"
                    style={isSelected
                      ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                      : isViewYear
                        ? { background: 'color-mix(in srgb, var(--coral) 10%, transparent)', color: 'var(--coral)' }
                        : { color: 'var(--warm-mid)' }}>
                    {yr}
                  </button>
                )
              })}
            </div>
            {/* 현재 연도 범위로 이동 */}
            {(() => {
              const thisYear = todayYear
              const thisBase = Math.floor(thisYear / 12) * 12
              return thisBase !== yearBase ? (
                <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
                  <button
                    onClick={() => setYearBase(thisBase)}
                    className="w-full py-1.5 text-xs rounded-lg font-medium transition-colors"
                    style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
                    현재 연도로
                  </button>
                </div>
              ) : null
            })()}
          </>
        )}
      </div>
    </>
  ) : null

  return (
    <>
      {/* 폼 제출용 hidden input (form 내부에 위치) */}
      {name && <input type="hidden" name={name} value={value} readOnly />}

      {/* truncate — 좁은 칸(2열 폼 셀)에서 "2026년 8월 30일"이 두 줄로 접혀 트리거만 56px 이 되고
          옆 칸 입력(40px)과 행 정렬이 깨지던 자리다. 한 줄로 잠가 두면 §12 입력 높이가 유지된다. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`w-full text-left truncate disabled:opacity-40 ${className ?? ''}`}
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
