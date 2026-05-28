import { requireSuperAdmin } from '@/lib/auth/access'
import prisma from '@/lib/prisma'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import AdminNav from './AdminNav'
import AdminProfile from './AdminProfile'

// 운영자(슈퍼관리자) 전용 영역. (app) 셸 게이트 밖 — 자체 가드.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSuperAdmin()
  // 관리할 영업장이 있는 운영자에게만 '앱으로' 표시 (영업장 없는 순수 운영자는 갈 곳 없음)
  const myPropertyCount = await prisma.userPropertyRole.count({ where: { userId: ctx.userId } })

  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <StayeumWordmark height={18} />
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap inline-flex items-center gap-1"
              style={{ background: 'var(--ink-2)', color: 'var(--sand)', letterSpacing: '0.02em' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2 4 6v6c0 5 3.4 7.7 8 10 4.6-2.3 8-5 8-10V6l-8-4Z"/>
              </svg>
              스테이음 관리자
            </span>
          </div>
          <AdminProfile email={ctx.email} hasProperties={myPropertyCount > 0} />
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-2">
          <AdminNav />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">{children}</main>
    </div>
  )
}
