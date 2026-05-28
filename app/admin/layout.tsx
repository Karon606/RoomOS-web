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
              className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap"
              style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon-d)' }}
            >
              운영자
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
