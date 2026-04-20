'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',   label: '홈',                  icon: '📊' },
  { href: '/rooms',       label: '수납 관리',            icon: '🏠' },
  { href: '/tenants',     label: '입주자 관리',          icon: '👤' },
  { href: '/finance',     label: '지출/기타수익 관리',   icon: '💰' },
  { href: '/room-manage', label: '호실 관리',            icon: '🔧' },
  { href: '/settings',    label: '설정',                 icon: '⚙️' },
]

function RoomOSLogo() {
  return (
    <div className="flex items-center gap-2.5">
      {/* Floor-mark: 4 horizontal lines, first is coral */}
      <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
        <rect y="0"  width="28" height="4" rx="2" fill="#f4623a" />
        <rect y="6"  width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.6" />
        <rect y="12" width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.4" />
        <rect y="18" width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.25" />
      </svg>
      <span className="text-lg tracking-tight" style={{ color: 'var(--warm-dark)' }}>
        <span style={{ fontWeight: 300 }}>Room</span>
        <span style={{ fontWeight: 700, color: 'var(--coral)' }}>OS</span>
      </span>
    </div>
  )
}

function NavContent({ pathname, month, onClose }: { pathname: string; month: string | null; onClose?: () => void }) {
  return (
    <>
      <div className="h-14 md:h-16 flex items-center px-6 shrink-0"
           style={{ borderBottom: '1px solid var(--warm-border)' }}>
        <RoomOSLogo />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href
          const href = month ? `${item.href}?month=${month}` : item.href
          return (
            <Link
              key={item.href}
              href={href}
              onClick={onClose}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={isActive ? {
                background: 'var(--coral)',
                color: '#fff',
              } : {
                color: 'var(--warm-mid)',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--coral-light)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--coral-dark)'
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = ''
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--warm-mid)'
                }
              }}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

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

  const sidebarStyle = {
    background: 'var(--cream)',
    borderRight: '1px solid var(--warm-border)',
  }

  return (
    <>
      {/* ── 데스크탑: 정적 사이드바 ── */}
      <aside className="hidden md:flex w-56 flex-col shrink-0" style={sidebarStyle}>
        <NavContent pathname={pathname} month={month} />
      </aside>

      {/* ── 모바일: 드로어 ── */}
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
          <aside className="fixed inset-y-0 left-0 z-50 w-56 flex flex-col shrink-0" style={sidebarStyle}>
            <NavContent pathname={pathname} month={month} onClose={onClose} />
          </aside>
        </>
      )}
    </>
  )
}
