'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { RoomOSWordmark } from '@/components/brand/RoomOSWordmark'

// ── SVG Icons — RoomOS Design Guide v2 (Lucide style)
//   24×24 viewBox · stroke-width 1.6 · round caps/joins · currentColor
const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 18, height: 18, style: { flexShrink: 0 } }

// 대시보드 — LayoutGrid (4 rect)
function IcoDashboard() {
  return <svg {...ico}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
}
// 호실 관리 — Floor plan
function IcoRooms() {
  return <svg {...ico}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11"/><path d="M14 6h3"/></svg>
}
// 입주자 — Person
function IcoTenants() {
  return <svg {...ico}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
}
// 수납 관리 — Wallet
function IcoFinance() {
  return <svg {...ico}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 6V5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1"/><circle cx="12" cy="13" r="2.5"/></svg>
}
// 지출/기타수익 — TrendingUp
function IcoWallet() {
  return <svg {...ico}><path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/></svg>
}
// 재고 관리 — Boxes
function IcoInventory() {
  return <svg {...ico}><path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>
}
// 결산 보고서 — FileText
function IcoReport() {
  return <svg {...ico}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 14l2 2 4-4"/></svg>
}
// 체크리스트 — CalendarCheck
function IcoChecklist() {
  return <svg {...ico}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4M8 15l2 2 4-4"/></svg>
}
// 시세조사 — Search
function IcoMarket() {
  return <svg {...ico}><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
}
// 환경설정 — Cog
function IcoSettings() {
  return <svg {...ico}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

// ── Nav structure ──────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: '메인',
    items: [
      { href: '/dashboard',   label: '대시보드',    Icon: IcoDashboard },
      { href: '/room-manage', label: '호실 관리',     Icon: IcoRooms },
      { href: '/tenants',     label: '입주자 관리',  Icon: IcoTenants },
    ],
  },
  {
    label: '수익/지출',
    items: [
      { href: '/rooms',     label: '수납 관리',     Icon: IcoFinance   },  // Wallet
      { href: '/finance',   label: '지출/기타수익', Icon: IcoWallet    },  // TrendingUp
      { href: '/inventory', label: '재고 관리',     Icon: IcoInventory },  // Boxes
      { href: '/report',    label: '결산 보고서',   Icon: IcoReport    },  // FileText
    ],
  },
  {
    label: '운영',
    items: [
      { href: '/checklist', label: '체크리스트', Icon: IcoChecklist },
      { href: '/requests',  label: '요청·컴플레인', Icon: IcoTenants },
      { href: '/contracts', label: '계약서',        Icon: IcoReport },
    ],
  },
  {
    label: '시장분석',
    items: [
      { href: '/market-analysis', label: '시세 조사', Icon: IcoMarket },
    ],
  },
  {
    label: '설정',
    items: [
      { href: '/settings', label: '환경설정', Icon: IcoSettings },
    ],
  },
]

// ── Logo variants ──────────────────────────────────────────────────
function LogoFull() {
  return (
    <div className="flex items-center gap-3">
      <svg width="28" height="30" viewBox="0 0 28 30" fill="none">
        <line x1="0" y1="3.5"  x2="28" y2="3.5"  stroke="var(--persimmon)" strokeWidth="4.5" strokeLinecap="round"/>
        <line x1="0" y1="12"   x2="18" y2="12"   stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.42"/>
        <line x1="0" y1="20.5" x2="28" y2="20.5" stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.62"/>
        <line x1="0" y1="29"   x2="14" y2="29"   stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.28"/>
      </svg>
      <RoomOSWordmark height={22} />
    </div>
  )
}

function LogoMark() {
  return (
    <svg width="28" height="30" viewBox="0 0 28 30" fill="none">
      <line x1="0" y1="3.5"  x2="28" y2="3.5"  stroke="var(--persimmon)" strokeWidth="4.5" strokeLinecap="round"/>
      <line x1="0" y1="12"   x2="18" y2="12"   stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.42"/>
      <line x1="0" y1="20.5" x2="28" y2="20.5" stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.62"/>
      <line x1="0" y1="29"   x2="14" y2="29"   stroke="var(--ink-3)" strokeWidth="4.5" strokeLinecap="round" opacity="0.28"/>
    </svg>
  )
}

// ── NavContent ─────────────────────────────────────────────────────
function NavContent({
  variant,
  pathname,
  month,
  onClose,
}: {
  variant: 'sidebar' | 'drawer'
  pathname: string
  month: string | null
  onClose?: () => void
}) {
  const drawer = variant === 'drawer'

  return (
    <>
      {/* Logo */}
      <div
        className="flex items-center shrink-0"
        style={{
          minHeight: 56,
          padding: drawer ? '0 20px' : undefined,
          borderBottom: '1px solid var(--warm-border)',
        }}
      >
        {drawer ? (
          <LogoFull />
        ) : (
          <>
            <div className="hidden lg:flex px-5"><LogoFull /></div>
            <div className="flex lg:hidden w-full justify-center"><LogoMark /></div>
          </>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-1">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {/* Group label — HIG 최소 11pt */}
            <div
              className={drawer ? 'block' : 'hidden lg:block'}
              style={{
                padding: '12px 20px 4px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: 'rgba(120,90,60,0.45)',
              }}
            >
              {group.label}
            </div>

            {group.items.map(({ href, label, Icon }) => {
              const isActive = pathname === href
              const linkHref = month ? `${href}?month=${month}` : href
              return (
                <Link
                  key={href}
                  href={linkHref}
                  onClick={onClose}
                  /* HIG: 최소 44pt 터치 타겟 — py-3.5로 달성 (14×2 + 아이콘17 = 45px) */
                  className={[
                    'flex items-center transition-colors min-h-[44px]',
                    drawer
                      ? 'gap-2.5 px-5 py-3.5 border-l-[2.5px]'
                      : 'gap-0 py-3.5 justify-center border-l-0 lg:gap-2.5 lg:px-5 lg:justify-start lg:border-l-[2.5px]',
                  ].join(' ')}
                  style={isActive ? {
                    color: 'var(--coral)',
                    fontWeight: 500,
                    background: 'rgba(244,98,58,0.06)',
                    borderLeftColor: 'var(--coral)',
                  } : {
                    color: 'var(--warm-muted)',
                    borderLeftColor: 'transparent',
                  }}
                >
                  <Icon />
                  <span className={`text-[13px] ${drawer ? 'block' : 'hidden lg:block'}`}>
                    {label}
                  </span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────
export default function Sidebar({
  isOpen = false,
  onClose,
}: {
  isOpen?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get('month')

  const style = {
    background: 'var(--cream)',
    borderRight: '1px solid var(--warm-border)',
  }

  return (
    <>
      {/* ── 태블릿(md) + 데스크탑(lg): in-flow 사이드바 ── */}
      <aside
        className="hidden md:flex md:w-16 lg:w-[220px] flex-col shrink-0"
        style={style}
      >
        <NavContent variant="sidebar" pathname={pathname} month={month} />
      </aside>

      {/* ── 모바일: 슬라이드 드로어 ── */}
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-[240px] flex flex-col md:hidden"
            style={style}
          >
            <NavContent variant="drawer" pathname={pathname} month={month} onClose={onClose} />
          </aside>
        </>
      )}
    </>
  )
}
