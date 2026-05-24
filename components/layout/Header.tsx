'use client'

import { selectProperty } from '@/app/property-select/actions'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { pushToast } from '@/lib/saveStatus'

const MONTH_KEY = 'stayeum_selected_month'
// '월'이 의미 있는 페이지에서만 월 네비 노출 (맥락형) — 나머지는 영업장명만
const MONTH_PAGES = new Set(['/dashboard', '/rooms', '/finance', '/report', '/stats'])

function todayMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// 레이아웃이 getClaims()로 넘기는 최소 사용자 정보 (Header에서 쓰는 필드만)
export type AppUser = {
  email?: string
  user_metadata?: { avatar_url?: string; full_name?: string }
}
// 영업장 스위처용 — id·name만
export type SwitchProperty = { id: string; name: string }

export default function Header({
  properties,
  currentPropertyId,
  startNavigation,
}: {
  properties: SwitchProperty[]
  currentPropertyId: string | null
  startNavigation?: (fn: () => void) => void
}) {
  const [propOpen, setPropOpen]     = useState(false)  // 영업장 스위처
  const [bellOpen, setBellOpen]     = useState(false)  // 알림(종)
  const [showPicker, setShowPicker] = useState(false)  // 월 선택
  const router       = useRouter()
  const todayMonth   = todayMonthStr()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const pickerRef    = useRef<HTMLDivElement>(null)
  const propRef      = useRef<HTMLDivElement>(null)
  const bellRef      = useRef<HTMLDivElement>(null)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showMonth = MONTH_PAGES.has(pathname)
  const currentProperty = properties.find(p => p.id === currentPropertyId) ?? properties[0]

  const searchParamsMonth = searchParams.get('month') ?? todayMonth

  const [localMonth, setLocalMonth] = useState(searchParamsMonth)
  const localMonthRef = useRef(localMonth)

  useEffect(() => {
    setLocalMonth(searchParamsMonth)
    localMonthRef.current = searchParamsMonth
  }, [searchParamsMonth])

  // 날짜 롤오버 감지: URL에 month 쿼리가 없을 때 자정이 지나 달이 바뀌면
  // 서버 컴포넌트가 stale한 상태로 남으므로 router.refresh()로 재요청한다.
  const prevTodayMonthRef = useRef(todayMonth)
  useEffect(() => {
    if (prevTodayMonthRef.current === todayMonth) return
    prevTodayMonthRef.current = todayMonth
    if (!searchParams.has('month')) router.refresh()
  }, [todayMonth, searchParams, router])

  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const ms = nextMidnight.getTime() - now.getTime()
    const t = setTimeout(() => {
      const next = todayMonthStr()
      if (prevTodayMonthRef.current !== next) {
        prevTodayMonthRef.current = next
        setLocalMonth(prev => (searchParams.has('month') ? prev : next))
        if (!searchParams.has('month')) router.refresh()
      }
    }, ms)
    return () => clearTimeout(t)
  }, [searchParams, router])

  // 새 탭·앱 재진입 시: 마지막으로 본 달과 오늘 달이 다르면 즉시 갱신
  useEffect(() => {
    const SEEN_KEY = 'stayeum_seen_month'
    const seen = sessionStorage.getItem(SEEN_KEY)
    if (seen !== todayMonth) {
      sessionStorage.setItem(SEEN_KEY, todayMonth)
      if (!searchParams.has('month')) router.refresh()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 드롭다운 바깥 클릭 시 닫기 (각각)
  useEffect(() => {
    if (!showPicker && !propOpen && !bellOpen) return
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      if (showPicker && pickerRef.current && !pickerRef.current.contains(t)) setShowPicker(false)
      if (propOpen   && propRef.current   && !propRef.current.contains(t))   setPropOpen(false)
      if (bellOpen   && bellRef.current   && !bellRef.current.contains(t))   setBellOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showPicker, propOpen, bellOpen])

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

  // 영업장 전환 — 권한은 selectProperty가 재확인. 전환 후 대시보드로(타 영업장 딥링크 깨짐 방지).
  const onSelectProperty = (id: string) => {
    setPropOpen(false)
    if (id === currentPropertyId) return
    const run = async () => {
      const res = await selectProperty(id)
      if (res.ok) { router.push('/dashboard'); router.refresh() }
      else pushToast('error', res.error)
    }
    if (startNavigation) startNavigation(run)
    else run()
  }

  const [cy, cm] = localMonth.split('-')
  const displayMonth = `${cy}년 ${parseInt(cm)}월`

  return (
    /* relative z-[100]: 헤더가 사이드바(z-50)보다 항상 위 → 드롭다운 겹침 방지 */
    <header
      className="h-14 md:h-16 flex items-center justify-between gap-2 px-3 md:px-6 shrink-0 relative z-[100]"
      style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }}
    >
      {/* ── 좌: 영업장 스위처 + (맥락형) 월 네비 ── */}
      <div className="flex items-center gap-1 min-w-0">
        <div ref={propRef} className="relative min-w-0">
          <button
            onClick={() => { setPropOpen(v => !v); setBellOpen(false); setShowPicker(false) }}
            className="flex items-center gap-1 max-w-[42vw] md:max-w-none px-2 py-2 rounded-xl transition-colors hover:bg-[var(--canvas)]"
            aria-label="영업장 선택"
            aria-expanded={propOpen}
          >
            <span className="text-sm font-bold truncate" style={{ color: 'var(--warm-dark)' }}>
              {currentProperty?.name ?? '영업장 선택'}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--warm-muted)', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {propOpen && (
            <div className="absolute left-0 top-12 w-60 rounded-xl shadow-lift z-50 overflow-hidden"
                 style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
              <div className="px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide"
                   style={{ color: 'var(--warm-muted)' }}>
                영업장
              </div>
              <div className="max-h-[50vh] overflow-y-auto p-1">
                {properties.map(p => {
                  const active = p.id === (currentProperty?.id ?? '')
                  return (
                    <button key={p.id} type="button" onClick={() => onSelectProperty(p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                      style={{ color: 'var(--warm-dark)', background: active ? 'rgba(244,98,58,0.06)' : undefined }}>
                      <span className="flex-1 truncate" style={{ fontWeight: active ? 600 : 400, color: active ? 'var(--coral)' : 'var(--warm-dark)' }}>
                        {p.name}
                      </span>
                      {active && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                      )}
                    </button>
                  )
                })}
              </div>
              <Link href="/property-select" onClick={() => setPropOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                style={{ color: 'var(--warm-mid)', borderTop: '1px solid var(--warm-border)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                영업장 관리·추가
              </Link>
            </div>
          )}
        </div>

        {/* 월 네비 — 맥락형 (월이 의미 있는 페이지에서만) */}
        {showMonth && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => changeMonth(-1)}
              className="w-9 h-9 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-sm transition-colors"
              style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}
              aria-label="이전 달"
            >
              ◀
            </button>
            <div ref={pickerRef} className="relative">
              <div
                onClick={() => { setShowPicker(v => !v); setPropOpen(false); setBellOpen(false) }}
                className="text-sm font-semibold text-center cursor-pointer px-1.5 py-2 rounded-lg select-none whitespace-nowrap"
                style={{ color: 'var(--warm-dark)' }}
                role="button"
                aria-label="월 선택"
              >
                {displayMonth}
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
            {localMonth < todayMonth && (
              <button
                onClick={() => changeMonth(1)}
                className="w-9 h-9 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-sm transition-colors"
                style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}
                aria-label="다음 달"
              >
                ▶
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── 우: 알림(종) ── (프로필/계정은 전체 메뉴로 이동) */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* 알림 — Phase 1: 진입점 셸. 내용(살아있는 알림 목록)은 L-2에서 채움 */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => { setBellOpen(v => !v); setPropOpen(false); setShowPicker(false) }}
            className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--warm-mid)' }}
            aria-label="알림"
            aria-expanded={bellOpen}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-12 w-72 rounded-xl shadow-lift z-50 overflow-hidden"
                 style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
              <div className="px-3.5 py-2.5 text-sm font-semibold" style={{ color: 'var(--warm-dark)', borderBottom: '1px solid var(--warm-border)' }}>
                알림
              </div>
              <div className="px-3.5 py-5 text-center">
                <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
                  오늘 챙길 일(미납·퇴실·투어·재고 등)을<br />여기 모아 보여드릴 예정이에요.
                </p>
              </div>
              <Link href="/dashboard" onClick={() => setBellOpen(false)}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                style={{ color: 'var(--coral)', borderTop: '1px solid var(--warm-border)' }}>
                대시보드에서 보기
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </Link>
            </div>
          )}
        </div>
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
      className="absolute top-9 left-0 rounded-2xl shadow-lift p-4 w-72 max-w-[88vw]"
      style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
      onClick={e => e.stopPropagation()}
    >
      {/* 연도 네비 — HIG: 44pt 터치 타겟 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setYear(y => y - 1)}
          className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--warm-mid)' }}
          aria-label="이전 연도"
        >
          ◀
        </button>
        <span className="font-semibold text-sm" style={{ color: 'var(--warm-dark)' }}>{year}년</span>
        <button
          onClick={() => setYear(y => y + 1)}
          className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--warm-mid)' }}
          aria-label="다음 연도"
        >
          ▶
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
              className="py-3 text-sm rounded-xl transition-colors font-medium"
              style={isActive
                ? { background: 'var(--coral)', color: '#fff' }
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
          className="flex-1 py-3 text-sm rounded-xl transition-colors font-medium"
          style={current === todayMonth
            ? { background: 'var(--persimmon)', color: '#fff', cursor: 'default' }
            : { background: 'var(--canvas)', color: 'var(--warm-mid)' }}
        >
          이번달
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-3 text-sm rounded-xl transition-colors"
          style={{ color: 'var(--warm-muted)' }}
        >
          닫기
        </button>
      </div>
    </div>
  )
}
