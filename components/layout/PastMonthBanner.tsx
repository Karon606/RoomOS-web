'use client'

// 과거(또는 미래) 월을 보고 있을 때 콘텐츠 최상단에 '눈에 확 띄는' 전체 폭 배너.
// 상단 코너의 작은 월 알약은 잘 안 보인다는 피드백(2026-06-30) → 본문 폭 amber 배너 + '오늘로'.
// 월이 의미 있는 페이지에서만 노출. 클라 마운트 후 렌더(서버/클라 '오늘' 불일치 #418 방지).
import { useEffect, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'

// 월이 의미 있는(월 넘김 필요) 페이지. 고객관리(tenants)는 월이 결제 표시에만 영향 → 제외(2026-07-01).
const MONTH_PAGES = ['/dashboard', '/finance', '/rooms', '/inventory', '/card-settlement', '/requests']

function todayMonthStr() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

export default function PastMonthBanner() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const month = sp.get('month')
  const today = todayMonthStr()
  // 비품·자재(/inventory/assets)는 내구재 뷰라 월 단위 아님 → 배너 제외.
  const onMonthPage = MONTH_PAGES.some(p => pathname?.startsWith(p)) && pathname !== '/inventory/assets'
  if (!onMonthPage || !month || month === today) return null

  const [vy, vm] = month.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const diff = (ty - vy) * 12 + (tm - vm)   // +면 과거
  const rel = diff === 1 ? '지난달' : diff > 1 ? `${diff}개월 전` : diff === -1 ? '다음달' : `${-diff}개월 후`

  const goToday = () => {
    const p = new URLSearchParams(sp.toString())
    p.set('month', today)
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    // 컴팩트 슬림 바 — '2026년 6월 (지난달) 오늘'. 눈엔 띄되(amber) 과하지 않게. (2026-07-01 피드백)
    <div
      className="mb-2.5 flex items-center gap-1.5 rounded-lg px-3 py-1.5"
      style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-fg)' }}
    >
      <span className="text-xs font-bold" style={{ color: 'var(--warning-fg)' }}>{vy}년 {vm}월</span>
      <span className="text-[0.6875rem] font-medium" style={{ color: 'var(--warning-fg)' }}>({rel})</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={goToday}
        className="text-[0.6875rem] font-bold px-2.5 py-1 rounded-md shrink-0"
        style={{ background: 'var(--persimmon)', color: '#fff' }}
      >
        오늘
      </button>
    </div>
  )
}
