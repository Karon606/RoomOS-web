'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const ico = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.6',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 19,
  height: 19,
}

// 하단 1차 내비 — 핵심 6개(홈/방/입주자/수납/지출/재고). 나머지(결산·체크리스트·계약서·시세·설정 등)는 '전체'.
const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: '홈',
    Icon: () => <svg {...ico}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>,
  },
  {
    href: '/room-manage',
    label: '방',
    Icon: () => <svg {...ico}><path d="M5 21V5.5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 5.5V21"/><path d="M3.5 21h17"/><circle cx="15.3" cy="12.5" r="1"/></svg>,
  },
  {
    href: '/tenants',
    label: '입주자',
    Icon: () => <svg {...ico}><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>,
  },
  {
    href: '/rooms',
    label: '수납',
    Icon: () => <svg {...ico}><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h12.5a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18z"/><path d="M3.5 8.5V7a1.5 1.5 0 0 1 1.5-1.5h9.5"/><path d="M18.5 11.5h-2.2a1.6 1.6 0 0 0 0 3.2h2.2"/><path d="M9.5 4.2 13 7"/></svg>,
  },
  {
    href: '/finance',
    label: '지출',
    Icon: () => <svg {...ico}><path d="M7 3.5 4 6.5l3 3"/><path d="M4 6.5h10.5A5.5 5.5 0 0 1 20 12"/><path d="M17 20.5l3-3-3-3"/><path d="M20 17.5H9.5A5.5 5.5 0 0 1 4 12"/></svg>,
  },
  {
    href: '/inventory',
    label: '재고',
    Icon: () => <svg {...ico}><rect x="3.5" y="9.5" width="8" height="7.5" rx="1.2"/><rect x="12.5" y="9.5" width="8" height="7.5" rx="1.2"/><rect x="8" y="3.5" width="8" height="6" rx="1.2"/></svg>,
  },
]

// '전체' 탭에서 활성으로 보일 경로 — 핵심 4개에 없는 메뉴들
const PRIMARY_HREFS = new Set(NAV_ITEMS.map(i => i.href))

export default function BottomNav({ onMenuOpen }: { onMenuOpen?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const month = searchParams.get('month')
  // 현재 경로가 핵심 4개가 아니면 '전체'를 활성 표시 (해당 메뉴가 전체 안에 있으므로)
  const menuActive = !PRIMARY_HREFS.has(pathname)
  // 클릭 즉시 시각 피드백 — Next.js 라우팅이 비동기라 사용자가 누른 직후 아무 반응이 없어
  // 여러 번 누르게 되는 문제 해결 (사용자 피드백 2026-06-01).
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  // 라우팅 완료(또는 pathname 변경) 시 pending 해제
  useEffect(() => { setPendingHref(null) }, [pathname])

  const handleNavClick = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (pathname === href) return
    setPendingHref(href)
    const linkHref = month ? `${href}?month=${month}` : href
    startTransition(() => { router.push(linkHref) })
  }

  // 슬라이딩 인디케이터(§25.3) — 탭 7개 균등 폭이라 활성 인덱스 × (100/7)% 로 이동.
  // 누르는 즉시(pending) 인디케이터가 먼저 움직여 라우팅 지연 동안에도 반응이 보인다.
  const TAB_COUNT = NAV_ITEMS.length + 1
  const pendingIdx = pendingHref ? NAV_ITEMS.findIndex(i => i.href === pendingHref) : -1
  const activeIdx = pendingIdx >= 0 ? pendingIdx
    : menuActive ? TAB_COUNT - 1
    : NAV_ITEMS.findIndex(i => i.href === pathname)

  return (
    /* HIG: 탭 바는 화면 하단 고정, safe area 위에 콘텐츠 배치 */
    <nav
      className="fixed bottom-0 left-0 right-0 z-[var(--z-sticky)] md:hidden flex safe-b"
      style={{ background: 'var(--cream)', borderTop: '1px solid var(--warm-border)' }}
    >
      {activeIdx >= 0 && (
        <div aria-hidden
          className="absolute top-0 h-[2px] rounded-full bg-[var(--coral)] motion-safe:transition-[left] motion-safe:duration-200 motion-safe:ease-out"
          style={{ left: `calc(${activeIdx} * 100% / ${TAB_COUNT} + 100% / ${TAB_COUNT} / 4)`, width: `calc(100% / ${TAB_COUNT} / 2)` }} />
      )}
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isActive = pathname === href
        const isPending = pendingHref === href
        const showHighlight = isActive || isPending
        const linkHref = month ? `${href}?month=${month}` : href
        return (
          <Link
            key={href}
            href={linkHref}
            onClick={handleNavClick(href)}
            /* HIG: 탭 아이템 최소 높이 49pt, 아이콘+레이블 수직 중앙 */
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset active:bg-[var(--coral)]/10"
            style={{
              color: showHighlight ? 'var(--coral)' : 'var(--warm-muted)',
              background: isPending ? 'var(--coral-pale, rgba(184,80,66,0.08))' : undefined,
              minHeight: 49,
            }}
          >
            <Icon />
            <span className="text-[0.625rem] font-medium leading-none">{label}</span>
          </Link>
        )
      })}

      {/* ── 전체 (전체 메뉴 드로어 열기) ── */}
      <button
        type="button"
        onClick={onMenuOpen}
        aria-label="전체 메뉴"
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
        style={{ color: menuActive ? 'var(--coral)' : 'var(--warm-muted)', minHeight: 49 }}
      >
        <svg {...ico}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        <span className="text-[0.625rem] font-medium leading-none">전체</span>
      </button>
    </nav>
  )
}
