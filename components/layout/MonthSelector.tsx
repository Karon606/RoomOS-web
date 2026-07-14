'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useStartNavigation } from './NavigationContext'

const MONTH_KEY = 'stayeum_selected_month'

function todayMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// 보고 있는 월이 '이번 달'과 얼마나 떨어졌는지 라벨 (과거=양수). 같으면 null.
function relMonthLabel(view: string, today: string): string | null {
  if (view === today) return null
  const [vy, vm] = view.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const diff = (ty - vy) * 12 + (tm - vm)   // +면 과거
  if (diff === 1) return '지난달'
  if (diff > 1) return `${diff}개월 전`
  if (diff === -1) return '다음달'
  return `${-diff}개월 후`
}

/**
 * 보이는 월 컨트롤 ◀ 5월 ▶ + 월 선택 팝오버.
 * 헤더가 아니라 각 월-페이지(대시보드·수납·지출) 콘텐츠 상단에 둔다 ('기간은 데이터 옆에').
 * 자정 롤오버 등 보이지 않는 자동 새로고침은 MonthSync(셸 상주)가 담당한다.
 */
export default function MonthSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const startNavigation = useStartNavigation()
  const todayMonth = todayMonthStr()

  const [showPicker, setShowPicker] = useState(false)
  const pickerRef   = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchParamsMonth = searchParams.get('month') ?? todayMonth
  // localMonth: ◀/▶ 클릭 시 URL 반영(디바운스 350ms) 전까지 즉시 보여주는 낙관적 표시값.
  const [localMonth, setLocalMonth] = useState(searchParamsMonth)
  const localMonthRef = useRef(localMonth)

  // URL의 month가 외부 요인(전환 완료·딥링크)으로 바뀌면 로컬 표시를 거기에 맞춘다.
  // useEffect 대신 렌더 중 조정(React 권장 패턴) — 추가 리렌더·cascading 없음.
  const [syncedMonth, setSyncedMonth] = useState(searchParamsMonth)
  if (searchParamsMonth !== syncedMonth) {
    setSyncedMonth(searchParamsMonth)
    setLocalMonth(searchParamsMonth)
  }

  // ref(낙관적 시퀀스 계산용)를 커밋된 localMonth와 동기화 — 렌더 중 ref 쓰기 금지라 effect에서.
  useEffect(() => { localMonthRef.current = localMonth }, [localMonth])

  // 팝오버 바깥 클릭 시 닫기
  useEffect(() => {
    if (!showPicker) return
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      if (pickerRef.current && !pickerRef.current.contains(t)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showPicker])

  const applyMonth = (m: string) => {
    localStorage.setItem(MONTH_KEY, m)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', m)
    const navigate = () => router.push(`${pathname}?${params.toString()}`)
    if (startNavigation) startNavigation(navigate)
    else navigate()
  }

  const changeMonth = (delta: number) => {
    const [yyyy, mm] = localMonthRef.current.split('-').map(Number)
    const d = new Date(yyyy, mm - 1 + delta, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    localMonthRef.current = next
    setLocalMonth(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => applyMonth(localMonthRef.current), 350)
  }

  const [cy, cm] = localMonth.split('-')
  const displayMonth = `${cy}년 ${parseInt(cm)}월`
  const atCurrentMonth = localMonth >= todayMonth
  const isCurrent = localMonth === todayMonth
  const rel = relMonthLabel(localMonth, todayMonth)
  const jumpToday = () => { setLocalMonth(todayMonth); localMonthRef.current = todayMonth; if (debounceRef.current) clearTimeout(debounceRef.current); applyMonth(todayMonth) }

  return (
    // 이번 달이 아니면 '눈에 띄게' — 감색 테두리·배경 + 상대월 배지 + '오늘' 점프(과거 데이터를 현재로 착각 방지).
    <div
      className="flex items-stretch min-h-[44px] rounded-lg shrink-0 self-start overflow-hidden transition-colors"
      style={isCurrent
        ? { background: 'var(--cream)', border: '1px solid var(--warm-border)' }
        : { background: 'var(--warning-bg)', border: '1.5px solid var(--warning-fg)' }}
    >
      <button
        onClick={() => changeMonth(-1)}
        className="w-11 flex items-center justify-center transition-colors hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
        style={{ color: 'var(--warm-mid)' }}
        aria-label="이전 달"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div ref={pickerRef} className="relative flex">
        <div
          onClick={() => setShowPicker(v => !v)}
          className="text-sm font-semibold text-center cursor-pointer px-2.5 py-2 select-none whitespace-nowrap flex items-center gap-1.5"
          style={{ color: 'var(--warm-dark)' }}
          role="button"
          aria-label="월 선택"
        >
          {displayMonth}
          {rel && (
            <span className="text-[0.65625rem] font-bold px-1.5 py-0.5 rounded-full leading-none"
              style={{ background: 'var(--warning-solid)', color: 'var(--on-solid)' }}>{rel}</span>
          )}
        </div>
        {showPicker && (
          <MonthPicker
            current={localMonth}
            todayMonth={todayMonth}
            onSelect={(m) => { setShowPicker(false); setLocalMonth(m); localMonthRef.current = m; applyMonth(m) }}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
      <button
        onClick={() => changeMonth(1)}
        disabled={atCurrentMonth}
        className="w-11 flex items-center justify-center transition-colors enabled:hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
        style={{ color: atCurrentMonth ? 'var(--warm-border)' : 'var(--warm-mid)', cursor: atCurrentMonth ? 'default' : 'pointer' }}
        aria-label="다음 달"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6"/></svg>
      </button>
      {!isCurrent && (
        <button
          onClick={jumpToday}
          className="px-2.5 flex items-center text-xs font-bold transition-colors border-l focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/40 focus-visible:ring-inset"
          style={{ color: 'var(--on-solid)', background: 'var(--persimmon)', borderColor: 'var(--persimmon)' }}
          aria-label="이번 달로"
        >
          오늘
        </button>
      )}
    </div>
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
    /* right-0: 페이지 상단 우측 정렬 컨트롤이므로 우측 모서리에 맞춰 화면 밖으로 넘치지 않게 */
    <div
      className="absolute top-full mt-1.5 right-0 rounded-xl shadow-lift p-4 w-72 max-w-[88vw] z-[var(--z-dropdown)]"
      style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
      onClick={e => e.stopPropagation()}
    >
      {/* 연도 네비 — HIG: 44pt 터치 타겟 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setYear(y => y - 1)}
          className="w-11 h-11 flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
          style={{ color: 'var(--warm-mid)' }}
          aria-label="이전 연도"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="font-semibold text-sm" style={{ color: 'var(--warm-dark)' }}>{year}년</span>
        <button
          onClick={() => setYear(y => y + 1)}
          className="w-11 h-11 flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
          style={{ color: 'var(--warm-mid)' }}
          aria-label="다음 연도"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      {/* 월 그리드 — HIG: 최소 44pt 높이 */}
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
              className="py-3 text-sm rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
              style={isActive
                ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                : disabled
                  ? { color: 'var(--warm-border)', cursor: 'not-allowed' }
                  : { color: 'var(--warm-mid)' }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* 하단 버튼 — HIG: 44pt 높이 */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSelect(todayMonth)}
          className="flex-1 py-3 text-sm rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
          style={current === todayMonth
            ? { background: 'var(--persimmon)', color: 'var(--on-solid)', cursor: 'default' }
            : { background: 'var(--canvas)', color: 'var(--warm-mid)' }}
        >
          이번달
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-3 text-sm rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
          style={{ color: 'var(--warm-muted)' }}
        >
          닫기
        </button>
      </div>
    </div>
  )
}
