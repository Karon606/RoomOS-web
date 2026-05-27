import Link from 'next/link'
import { requireSuperAdmin } from '@/lib/auth/access'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import AdminNav from './AdminNav'

// 운영자(슈퍼관리자) 전용 영역. (app) 셸 게이트 밖 — 자체 가드.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin()

  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <StayeumWordmark height={18} />
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap"
              style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon-d)' }}
            >
              운영자
            </span>
          </div>
          <Link href="/dashboard" className="text-sm whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
            앱으로 →
          </Link>
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-2">
          <AdminNav />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">{children}</main>
    </div>
  )
}
