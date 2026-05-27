'use client'

import { useState, useTransition, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header, { type AppUser, type SwitchProperty } from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import SaveFeedback from '@/components/feedback/SaveFeedback'
import { BrandLoader } from '@/components/brand/BrandLoader'
import MonthSync from '@/components/layout/MonthSync'
import { NavigationProvider } from '@/components/layout/NavigationContext'

// 페이지 전환용 경량 로더 — Brand Guide v1.2 의 Arch line-draw 모션 (워드마크 없음)
function PageLoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-[60]" style={{ background: 'var(--canvas)' }}>
      <BrandLoader size="md" />
    </div>
  )
}

export default function AppShell({
  user,
  properties,
  currentPropertyId,
  isSuperAdmin = false,
  children,
}: {
  user: AppUser
  properties: SwitchProperty[]
  currentPropertyId: string | null
  isSuperAdmin?: boolean
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isPending, startNavigation]  = useTransition()

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <Sidebar user={user} isSuperAdmin={isSuperAdmin} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* fallback은 실제 헤더와 동일한 외형 — 내용물만 없앤 투명 껍데기.
            이렇게 해야 router.refresh() 중에도 헤더 영역이 깜박이지 않는다. */}
        <Suspense fallback={
          <div className="h-14 md:h-16 shrink-0"
               style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }} />
        }>
          <Header
            properties={properties}
            currentPropertyId={currentPropertyId}
            startNavigation={startNavigation}
          />
        </Suspense>

        {/* 보이지 않는 월 동기화기 — 자정 롤오버·재진입 시 router.refresh().
            useSearchParams를 쓰므로 Suspense 경계 필요. 보이는 월 컨트롤은 MonthSelector(페이지 상단). */}
        <Suspense fallback={null}>
          <MonthSync />
        </Suspense>

        {/* app-main: relative로 로딩 오버레이 containment.
            NavigationProvider: 페이지 안 MonthSelector가 전환 로딩 오버레이를 공유. */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 app-main relative">
          <NavigationProvider startNavigation={startNavigation}>
            {children}
          </NavigationProvider>
          {isPending && <PageLoadingOverlay />}
        </main>
      </div>

      {/* HIG: iPhone에서 1차 내비게이션은 하단 탭바. '전체' 탭이 Sidebar 드로어(전체 메뉴)를 연다. */}
      <BottomNav onMenuOpen={() => setSidebarOpen(true)} />

      {/* 글로벌 저장 진행 표시 + 토스트 */}
      <SaveFeedback />
    </div>
  )
}
