'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',   label: '홈',                  icon: '📊' },
  { href: '/rooms',       label: '수납 관리',            icon: '🏠' },
  { href: '/tenants',     label: '입주자 관리',          icon: '👤' },
  { href: '/finance',     label: '지출/기타수익 관리',   icon: '💰' },
  { href: '/room-manage', label: '호실 관리',            icon: '🔧' },
  { href: '/settings',    label: '설정',                 icon: '⚙️' },
]

function NavContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <>
      <div className="h-14 md:h-16 flex items-center px-6 border-b border-gray-800 shrink-0">
        <span className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
          🏢 RoomOS
        </span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl
                         text-sm font-medium transition-colors
                         ${isActive
                           ? 'bg-indigo-600 text-white'
                           : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                         }`}
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

  return (
    <>
      {/* ── 데스크탑: 레이아웃 흐름에 참여하는 정적 사이드바 ── */}
      <aside className="hidden md:flex w-56 flex-col shrink-0 bg-gray-900 border-r border-gray-800">
        <NavContent pathname={pathname} />
      </aside>

      {/* ── 모바일: isOpen 시 드로어로 오버레이 ─────────────── */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-56 flex flex-col shrink-0 bg-gray-900 border-r border-gray-800">
            <NavContent pathname={pathname} onClose={onClose} />
          </aside>
        </>
      )}
    </>
  )
}
