'use client'

// 과거(또는 미래) 월을 보고 있을 때 콘텐츠 최상단에 '눈에 확 띄는' 전체 폭 배너.
// 상단 코너의 작은 월 알약은 잘 안 보인다는 피드백(2026-06-30) → 본문 폭 amber 배너 + '오늘로'.
// 월이 의미 있는 페이지에서만 노출. 클라 마운트 후 렌더(서버/클라 '오늘' 불일치 #418 방지).
import { useEffect, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'

const MONTH_PAGES = ['/dashboard', '/finance', '/rooms', '/tenants']

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
  const onMonthPage = MONTH_PAGES.some(p => pathname?.startsWith(p))
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
    <div
      className="mb-3 flex items-center gap-2.5 rounded-xl px-4 py-3"
      style={{ background: 'rgba(180,120,10,.14)', border: '1.5px solid var(--warning-fg)', borderLeft: '5px solid var(--persimmon)' }}
    >
      <span className="font-extrabold text-base" style={{ color: 'var(--warning-fg)' }}>{vy}년 {vm}월</span>
      <span className="text-sm font-semibold" style={{ color: 'var(--warning-fg)' }}>· {rel} 보는 중 — 현재 월 아님</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={goToday}
        className="text-sm font-bold px-3.5 py-2 rounded-lg shrink-0"
        style={{ background: 'var(--persimmon)', color: '#fff' }}
      >
        오늘로
      </button>
    </div>
  )
}
