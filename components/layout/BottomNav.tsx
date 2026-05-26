'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

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
    Icon: () => <svg {...ico}><rect x="2" y="2" width="8" height="8" rx="1.5"/><rect x="12" y="2" width="8" height="8" rx="1.5"/><rect x="2" y="12" width="8" height="8" rx="1.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/></svg>,
  },
  {
    href: '/room-manage',
    label: '방',
    Icon: () => <svg {...ico}><rect x="2" y="2" width="18" height="18" rx="2.5"/><line x1="2" y1="9" x2="20" y2="9"/><line x1="9" y1="9" x2="9" y2="20"/></svg>,
  },
  {
    href: '/tenants',
    label: '입주자',
    Icon: () => <svg {...ico}><circle cx="12" cy="7" r="4"/><path d="M3 20c0-4.4 3.6-7 9-7s9 2.6 9 7"/></svg>,
  },
  {
    href: '/rooms',
    label: '수납',
    Icon: () => <svg {...ico}><rect x="3" y="6" width="16" height="12" rx="2"/><path d="M7 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"/><circle cx="12" cy="12" r="2"/></svg>,
  },
  {
    href: '/finance',
    label: '지출',
    Icon: () => <svg {...ico}><path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/></svg>,
  },
  {
    href: '/inventory',
    label: '재고',
    Icon: () => <svg {...ico}><path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>,
  },
]

// '전체' 탭에서 활성으로 보일 경로 — 핵심 4개에 없는 메뉴들
const PRIMARY_HREFS = new Set(NAV_ITEMS.map(i => i.href))

export default function BottomNav({ onMenuOpen }: { onMenuOpen?: () => void }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get('month')
  // 현재 경로가 핵심 4개가 아니면 '전체'를 활성 표시 (해당 메뉴가 전체 안에 있으므로)
  const menuActive = !PRIMARY_HREFS.has(pathname)

  return (
    /* HIG: 탭 바는 화면 하단 고정, safe area 위에 콘텐츠 배치 */
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex safe-b"
      style={{ background: 'var(--cream)', borderTop: '1px solid var(--warm-border)' }}
    >
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isActive = pathname === href
        const linkHref = month ? `${href}?month=${month}` : href
        return (
          <Link
            key={href}
            href={linkHref}
            /* HIG: 탭 아이템 최소 높이 49pt, 아이콘+레이블 수직 중앙 */
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
            style={{ color: isActive ? 'var(--coral)' : 'var(--warm-muted)', minHeight: 49 }}
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
