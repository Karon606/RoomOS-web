import { requireSuperAdmin } from '@/lib/auth/access'
import prisma from '@/lib/prisma'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import SaveFeedback from '@/components/feedback/SaveFeedback'
import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import AdminNav from './AdminNav'
import AdminProfile from './AdminProfile'

// 운영자(슈퍼관리자) 전용 영역. (app) 셸 게이트 밖 — 자체 가드.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSuperAdmin()
  // 관리할 영업장이 있는 운영자에게만 '앱으로' 표시 (영업장 없는 순수 운영자는 갈 곳 없음)
  const myPropertyCount = await prisma.userPropertyRole.count({ where: { userId: ctx.userId } })

  // 루트 html/body가 overflow:hidden(iOS 헤더 보호용)이라 페이지 자체 스크롤 불가 →
  // (app) 셸과 같은 패턴: 전체 h-dvh + 헤더 shrink-0 + main 자체에 overflow-y-auto.
  return (
    <div className="flex flex-col h-dvh" style={{ background: 'var(--canvas)' }}>
      <header
        className="shrink-0 border-b"
        style={{ background: 'var(--cream)', borderColor: 'var(--cream-3)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <StayeumWordmark height={18} />
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap inline-flex items-center gap-1"
              style={{ background: 'var(--pill-bg)', color: 'var(--on-solid)', letterSpacing: '0.02em' }}
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

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-5">{children}</div>
      </main>
      {/* 토스트·상단 진행바·확인 다이얼로그 — (app) 셸 밖이라 여기에도 마운트 */}
      <SaveFeedback />
      <ConfirmHost />
    </div>
  )
}
