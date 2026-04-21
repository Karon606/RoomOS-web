'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const ico = { viewBox: '0 0 22 22', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 22, height: 22 }

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: '대시보드',
    Icon: () => <svg {...ico}><rect x="2" y="2" width="8" height="8" rx="1.5"/><rect x="12" y="2" width="8" height="8" rx="1.5"/><rect x="2" y="12" width="8" height="8" rx="1.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/></svg>,
  },
  {
    href: '/room-manage',
    label: '방 관리',
    Icon: () => <svg {...ico}><rect x="2" y="2" width="18" height="18" rx="2.5"/><line x1="2" y1="9" x2="20" y2="9"/><line x1="9" y1="9" x2="9" y2="20"/></svg>,
  },
  {
    href: '/tenants',
    label: '입주자',
    Icon: () => <svg {...ico}><circle cx="11" cy="7" r="4"/><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>,
  },
  {
    href: '/rooms',
    label: '수납',
    Icon: () => <svg {...ico}><rect x="3" y="6" width="16" height="12" rx="2"/><path d="M7 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"/><circle cx="11" cy="12" r="2"/></svg>,
  },
  {
    href: '/settings',
    label: '설정',
    Icon: () => <svg {...ico}><circle cx="11" cy="11" r="3"/><path d="M11 2v2M11 18v2M2 11h2M18 11h2M4.9 4.9l1.4 1.4M15.7 15.7l1.4 1.4M4.9 17.1l1.4-1.4M15.7 6.3l1.4-1.4"/></svg>,
  },
]

export default function BottomNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get('month')

  return (
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
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors"
            style={{ color: isActive ? 'var(--coral)' : 'var(--warm-muted)' }}
          >
            <Icon />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
