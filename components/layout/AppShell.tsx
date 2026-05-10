'use client'

import { useState, useTransition, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import SaveFeedback from '@/components/feedback/SaveFeedback'
import { SplashScreen } from '@/components/brand/SplashScreen'
import { User } from '@supabase/supabase-js'

// 페이지 전환 중 오버레이 — 통합 SplashScreen 사용 (loading.tsx 와 시각 일관)
function PageLoadingOverlay() { return <SplashScreen /> }

export default function AppShell({
  user,
  children,
}: {
  user: User
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isPending, startNavigation]  = useTransition()

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0"
               style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }}>
            <span className="text-sm" style={{ color: 'var(--warm-muted)' }}>로딩 중...</span>
          </div>
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
