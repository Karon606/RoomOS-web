'use client'

import { useState, useTransition, Suspense } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import Header, { type AppUser, type SwitchProperty } from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import SaveFeedback from '@/components/feedback/SaveFeedback'
import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import MonthSync from '@/components/layout/MonthSync'
import { NavigationProvider } from '@/components/layout/NavigationContext'

// §18.1 (v1.3.1): 셸이 살아있는 라우트 전환은 본문 스켈레톤만 — 브랜드 로더 오버레이는
// 스켈레톤과 이중 발동이라 폐지. 브랜드 로더는 셸 없는 구간(콜드 부트·로그아웃)에서만(SplashScreen).

export default function AppShell({
  user,
  properties,
  currentPropertyId,
  isSuperAdmin = false,
  isAdminView = false,
  children,
}: {
  user: AppUser
  properties: SwitchProperty[]
  currentPropertyId: string | null
  isSuperAdmin?: boolean
  isAdminView?: boolean
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // isPending 미사용 — 전환 표시는 라우트 loading.tsx 스켈레톤이 담당(§18.1 ③)
  const [, startNavigation]  = useTransition()

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--canvas)' }}>
      {isAdminView && (
        <Link href="/admin"
          className="fixed top-0 inset-x-0 z-[70] flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium hover:opacity-90 transition-opacity"
          style={{ background: 'var(--ink-2)', color: 'var(--sand)', letterSpacing: '0.02em' }}>
          <span style={{ opacity: 0.7 }}>←</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2 4 6v6c0 5 3.4 7.7 8 10 4.6-2.3 8-5 8-10V6l-8-4Z"/>
          </svg>
          스테이음 관리자 뷰 · 클릭해서 관리자 페이지로 돌아가기
        </Link>
      )}
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

        {/* NavigationProvider: 페이지 안 MonthSelector 등이 전환 transition을 공유.
            전환 중 표시는 라우트 세그먼트 loading.tsx(본문 스켈레톤)가 담당 — §18.1 ③ */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 app-main relative">
          {/* 과거월 표시는 페이지 상단 MonthSelector 가 겸함(amber+'지난달'+오늘) — 별도 배너 제거(중복). */}
          <NavigationProvider startNavigation={startNavigation}>
            {children}
          </NavigationProvider>
        </main>
      </div>

      {/* HIG: iPhone에서 1차 내비게이션은 하단 탭바. '전체' 탭이 Sidebar 드로어(전체 메뉴)를 연다. */}
      <BottomNav onMenuOpen={() => setSidebarOpen(true)} />

      {/* 글로벌 저장 진행 표시 + 토스트 + 확인 다이얼로그(v1.3 §9) */}
      <SaveFeedback />
      <ConfirmHost />
    </div>
  )
}
