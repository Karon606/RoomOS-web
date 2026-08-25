'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useStartNavigation } from './NavigationContext'
import { useMyRole } from '@/components/RoleContext'
import { kstMonthStr, kstYmd } from '@/lib/kstDate'
import { resolveMonthChain } from '@/lib/monthParam'

const MONTH_KEY = 'stayeum_selected_month'

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
 * allowFuture: 재무류 화면은 미래 월이 무의미해 이번 달에서 잠그는 것이 기본이지만,
 * 예약이 사는 화면(입퇴실 캘린더)은 미래 월이 본론이라 잠금을 푼다(운영자 지적 2026-08-17).
 *
 * paramKey·fallbackKey: 이 컨트롤이 읽고 쓸 URL 키. 기본은 종전 그대로 `?month=` 다.
 * 입퇴실 캘린더만 자체 키를 넘긴다 — 그 화면의 값은 '조회 장부 월'이 아니라 '지금 보고 있는
 * 트랙 위치'라 뜻이 다르고, 한 키를 공유하면 내비가 그것을 조회 월로 복사해 전역에 흘린다
 * (lib/monthParam TRACK_MONTH_KEY). fallbackKey 는 홈 딥링크(`?tab=moves&month=`) 착지용이다.
 *
 *
 * futureIsNormal: 미래 월을 '경고'로 부르지 않는다. §04 의 warning 은 미납·경고·변동인데,
 * 예약이 사는 화면에서 다음 달을 보는 것은 셋 중 어느 것도 아니다 — 그 화면에서는 미래가
 * 본론이라 정상 사용이 곧 경고 상태가 되고, 트랙을 끌 때마다 노란 테두리가 점멸한다.
 * **과거 방향 경고는 그대로 둔다** — 지난 장부를 현재로 착각하는 위험은 어느 화면에서나 같다.
 * allowFuture 에서 파생시키지 않는 이유는, 파생하면 잠금 정책을 바꾸는 사람이 톤까지 함께
 * 바꾸게 되기 때문이다(두 축은 뜻이 다르다 — '열 수 있는가' 대 '정상 상태인가').
 */
export default function MonthSelector({
  allowFuture = false,
  futureIsNormal = false,
  paramKey = 'month',
  fallbackKey,
}: {
  allowFuture?: boolean
  futureIsNormal?: boolean
  paramKey?: string
  fallbackKey?: string
} = {}) {
  const role = useMyRole()   // 제한 스태프는 월 컨텍스트가 무의미(재고·조회 화면) — 아래에서 숨김
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const startNavigation = useStartNavigation()
  // 오늘 달은 KST 고정 — new Date() 로 뽑으면 매월 1일 KST 00~09시에 서버는 지난달, 기기는 이번달을
  // 보고 '지난달' 배지·조회월 기본값이 갈린다(하이드레이션 #418 + 엉뚱한 달 조회).
  const todayMonth = kstMonthStr()

  const [showPicker, setShowPicker] = useState(false)
  // 라벨과 팝오버는 이제 형제가 아니다(알약이 팝오버를 자르지 않도록 껍데기를 하나 세웠다) —
  // 바깥 클릭 판정은 둘 다 봐야 종전과 같다(◀▶ 를 누르면 닫히던 동작 유지).
  const labelRef    = useRef<HTMLDivElement>(null)
  const popRef      = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPending, startLocal] = useTransition()

  // 표시도 조회와 같은 자를 쓴다 — 잠긴 화면에 미래 월 URL 이 들어오면(입퇴실에서 넘어온 링크)
  // 서버는 이번 달을 그리는데 라벨만 9월이면 둘이 갈린다(lib/monthParam, 운영자 신고 2026-08-18).
  const searchParamsMonth = resolveMonthChain(
    searchParams.get(paramKey),
    fallbackKey ? searchParams.get(fallbackKey) : null,
    { allowFuture },
  )
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
      if (labelRef.current?.contains(t) || popRef.current?.contains(t)) return
      setShowPicker(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showPicker])

  // 전환 자체는 트랜지션으로 둔다(월만 바뀌는 화면에서 스켈레톤으로 전체를 지우면 비교하던 이전 값까지 사라진다).
  // 대신 isPending 을 이 컨트롤에 묶어 '눌렸고 진행 중'을 표시한다 — 셸의 공용 트랜지션은
  // isPending 을 버려서 클릭 후 아무 표시도 없는 구간이 있었다(F페이즈).
  const applyMonth = (m: string) => {
    // 전역 월 저장은 전역 키일 때만. 캘린더의 트랙 위치를 여기에 적으면 URL 로 막은 누수가
    // 저장소 경로로 되살아난다(지금은 이 키를 읽는 코드가 없지만, 복원 기능이 생기는 날 터진다).
    if (paramKey === 'month') localStorage.setItem(MONTH_KEY, m)
    // 스냅샷이 아니라 **발화 시점의 실제 URL** 로 재구성한다 — 350ms 디바운스 동안 다른 코드가
    // 세팅한 파라미터(캘린더의 트랙 위치 등)를 지워 버리던 레이스 방지(lib/useUrlState 와 같은 문법).
    const params = new URLSearchParams(window.location.search)
    params.set(paramKey, m)
    const navigate = () => router.push(`${pathname}?${params.toString()}`)
    startLocal(() => { if (startNavigation) startNavigation(navigate); else navigate() })
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
  const atCurrentMonth = !allowFuture && localMonth >= todayMonth
  const isCurrent = localMonth === todayMonth
  // 이 화면에서 미래가 정상이면 경고 표면·보더·상대월 알약을 안 세운다. 과거는 종전대로 경고다.
  const quietFuture = futureIsNormal && localMonth > todayMonth
  const rel = quietFuture ? null : relMonthLabel(localMonth, todayMonth)
  const jumpToday = () => { setLocalMonth(todayMonth); localMonthRef.current = todayMonth; if (debounceRef.current) clearTimeout(debounceRef.current); applyMonth(todayMonth) }

  if (role === 'LIMITED_STAFF') return null   // 모든 훅 호출 뒤 조건부 렌더(rules-of-hooks 준수)

  return (
    /**
     * 껍데기 — 팝오버의 기준 상자다. 알약 자체에 걸린 overflow-hidden(둥근 모서리가 '오늘' 버튼
     * 배경을 자르는 데 필요하다)이 팝오버까지 잘라 **연월을 눌러도 아무것도 안 뜨던** 결함이
     * 여기서 갈렸다(2026-06-30 6e5d722c 이후 줄곧, 운영자 신고 2026-08-18). 팝오버를 알약 밖으로
     * 한 겹 꺼내면 잘림도 사라지고, right-0 이 알약 오른쪽 모서리에 맞아 320px 에서 왼쪽으로
     * 삐져나가던 것도 함께 맞는다(라벨 기준일 때 -22.6px).
     * 박스 모델은 종전 루트 그대로다 — shrink-0·self-start 를 여기로 옮겼을 뿐이라 호출부 여덟 곳의
     * 자리·폭이 안 흔들린다.
     */
    <div className="relative shrink-0 self-start">
    {/* 이번 달이 아니면 '눈에 띄게' — 감색 테두리·배경 + 상대월 배지 + '오늘' 점프(과거 데이터를 현재로 착각 방지).
        단 미래가 본론인 화면(futureIsNormal)에서 미래 월은 경고가 아니다 — 표면·보더를 세우지 않는다.
        '이번 달이 아님'은 남는 신호 둘이 말한다: 라벨의 절대 연월과, !isCurrent 일 때만 서는 [오늘] 버튼. */}
    <div
      className="flex items-stretch min-h-[44px] rounded-lg overflow-hidden transition-colors"
      aria-busy={isPending}
      style={{
        ...(isCurrent || quietFuture
          ? { background: 'var(--cream)', border: '1px solid var(--warm-border)' }
          : { background: 'var(--warning-bg)', border: '1.5px solid var(--warning-fg)' }),
        // 진행 중 표시 — 앱 전반의 disabled:opacity 문법과 같은 결
        opacity: isPending ? 0.55 : 1,
        transition: 'opacity var(--dur-base)',
      }}
    >
      <button
        onClick={() => changeMonth(-1)}
        className="w-11 flex items-center justify-center transition-colors hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
        style={{ color: 'var(--warm-mid)' }}
        aria-label="이전 달"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div
        ref={labelRef}
        onClick={() => setShowPicker(v => !v)}
        className="text-sm font-semibold text-center cursor-pointer px-2.5 py-2 select-none whitespace-nowrap flex items-center gap-1.5"
        style={{ color: 'var(--warm-dark)' }}
        role="button"
        aria-expanded={showPicker}
        aria-label="월 선택"
      >
        {displayMonth}
        {rel && (
          <span className="text-[0.65625rem] font-bold px-1.5 py-0.5 rounded-sm leading-none"
            style={{ background: 'var(--warning-solid)', color: 'var(--on-solid)' }}>{rel}</span>
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
    {showPicker && (
      <MonthPicker
        ref={popRef}
        current={localMonth}
        todayMonth={todayMonth}
        allowFuture={allowFuture}
        onSelect={(m) => { setShowPicker(false); setLocalMonth(m); localMonthRef.current = m; applyMonth(m) }}
        onClose={() => setShowPicker(false)}
      />
    )}
    </div>
  )
}

function MonthPicker({
  current, todayMonth, allowFuture = false, onSelect, onClose, ref
}: {
  current: string
  todayMonth: string
  allowFuture?: boolean
  onSelect: (month: string) => void
  onClose: () => void
  ref?: React.Ref<HTMLDivElement>
}) {
  const [year, setYear] = useState(Number(current.split('-')[0]))
  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  // 미래 월 비활성 경계도 KST 기준 — 위 todayMonth 와 같은 시계를 봐야 1일 새벽에 어긋나지 않는다.
  const { year: maxYear, month: maxMonth } = kstYmd()

  return (
    /* right-0: 페이지 상단 우측 정렬 컨트롤이므로 알약 우측 모서리에 맞춰 화면 밖으로 넘치지 않게 */
    <div
      ref={ref}
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
          const disabled = !allowFuture && (year > maxYear || (year === maxYear && i + 1 > maxMonth))
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
