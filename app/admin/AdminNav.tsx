'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin/users', label: '가입자' },
  { href: '/admin/properties', label: '영업장' },
  { href: '/admin/invites', label: '초대코드' },
]

export default function AdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--persimmon)' : 'transparent',
              color: active ? '#fff' : 'var(--ink-3)',
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
