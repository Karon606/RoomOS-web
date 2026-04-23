'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// ── SVG Icons ──────────────────────────────────────────────────────
const ico = { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 17, height: 17, style: { flexShrink: 0 } }

function IcoDashboard() {
  return <svg {...ico}><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>
}
function IcoRooms() {
  return <svg {...ico}><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="7" y1="7" x2="7" y2="14"/></svg>
}
function IcoTenants() {
  return <svg {...ico}><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5"/></svg>
}
function IcoFinance() {
  return <svg {...ico}><rect x="2" y="4" width="12" height="9" rx="1.5"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><circle cx="8" cy="9" r="1.5"/></svg>
}
function IcoWallet() {
  return <svg {...ico}><rect x="1" y="4" width="14" height="10" rx="1.5"/><path d="M11 9h2"/><circle cx="11.5" cy="9" r="0.5" fill="currentColor"/></svg>
}
function IcoSettings() {
  return <svg {...ico}><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/></svg>
}
function IcoMarket() {
  return <svg {...ico}><rect x="1" y="8" width="3" height="6" rx="0.5"/><rect x="6" y="5" width="3" height="9" rx="0.5"/><rect x="11" y="2" width="3" height="12" rx="0.5"/><line x1="0" y1="14.5" x2="15" y2="14.5"/></svg>
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
      { href: '/rooms',   label: '수납 관리',    Icon: IcoFinance },
      { href: '/finance', label: '지출/기타수익', Icon: IcoWallet  },
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
        <line x1="0" y1="3.5"  x2="28" y2="3.5"  stroke="#f4623a" strokeWidth="4.5" strokeLinecap="round"/>
        <line x1="0" y1="12"   x2="18" y2="12"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.42"/>
        <line x1="0" y1="20.5" x2="28" y2="20.5" stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.62"/>
        <line x1="0" y1="29"   x2="14" y2="29"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.28"/>
      </svg>
      <span className="text-[18px] tracking-tight" style={{ color: 'var(--warm-dark)' }}>
        <span style={{ fontWeight: 300 }}>Room</span>
        <span style={{ fontWeight: 700, color: 'var(--coral)' }}>OS</span>
      </span>
    </div>
  )
}

function LogoMark() {
  return (
    <svg width="28" height="30" viewBox="0 0 28 30" fill="none">
      <line x1="0" y1="3.5"  x2="28" y2="3.5"  stroke="#f4623a" strokeWidth="4.5" strokeLinecap="round"/>
      <line x1="0" y1="12"   x2="18" y2="12"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.42"/>
      <line x1="0" y1="20.5" x2="28" y2="20.5" stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.62"/>
      <line x1="0" y1="29"   x2="14" y2="29"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.28"/>
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
