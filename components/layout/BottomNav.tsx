'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',   label: '대시보드', icon: '📊' },
  { href: '/rooms',       label: '수납현황', icon: '🏠' },
  { href: '/tenants',     label: '입주자',   icon: '👤' },
  { href: '/finance',     label: '입출금',   icon: '💰' },
  { href: '/room-manage', label: '호실',     icon: '🔧' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-gray-900 border-t border-gray-800 flex safe-b">
      {NAV_ITEMS.map(item => {
        const isActive = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
              isActive
                ? 'text-indigo-400'
                : 'text-gray-500 active:text-gray-300'
            }`}
          >
            <span className="text-[20px] leading-none">{item.icon}</span>
            <span className="mt-0.5">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
