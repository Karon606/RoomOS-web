'use client'

import { useState, useTransition, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header, { type AppUser } from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import SaveFeedback from '@/components/feedback/SaveFeedback'
import { ARCH_PATH } from '@/components/brand/StayeumWordmark'

// 페이지 전환용 경량 로더 — 브랜드 Arch Symbol이 호흡하듯 펄스
function PageLoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-[60]" style={{ background: 'var(--canvas)' }}>
      <style>{`
        @keyframes stm-pulse {
          0%, 100% { opacity: 0.38; transform: scale(0.9); }
          50%      { opacity: 1;    transform: scale(1); }
        }
        .stm-pulse { transform-box: fill-box; transform-origin: center;
                     animation: stm-pulse 1.4s ease-in-out infinite; }
      `}</style>
      <svg width="54" height="35" viewBox="8 8 113 74" xmlns="http://www.w3.org/2000/svg" aria-label="로딩 중">
        <path className="stm-pulse" d={ARCH_PATH} fill="var(--persimmon)" />
      </svg>
    </div>
  )
}

export default function AppShell({
  user,
  children,
}: {
  user: AppUser
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isPending, startNavigation]  = useTransition()

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* fallback은 실제 헤더와 동일한 외형 — 내용물만 없앤 투명 껍데기.
            이렇게 해야 router.refresh() 중에도 헤더 영역이 깜박이지 않는다. */}
        <Suspense fallback={
          <div className="h-14 md:h-16 shrink-0"
               style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }} />
        }>
          <Header user={user} onMenuClick={() => setSidebarOpen(true)} startNavigation={startNavigation} />
        </Suspense>

        {/* app-main: relative로 로딩 오버레이 containment */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 app-main relative">
          {children}
          {isPending && <PageLoadingOverlay />}
        </main>
      </div>

      {/* HIG: iPhone에서 1차 내비게이션은 하단 탭바 */}
      <BottomNav />

      {/* 글로벌 저장 진행 표시 + 토스트 */}
      <SaveFeedback />
    </div>
  )
}
