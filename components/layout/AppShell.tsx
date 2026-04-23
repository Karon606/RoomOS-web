'use client'

import { useState, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import { User } from '@supabase/supabase-js'

export default function AppShell({
  user,
  children,
}: {
  user: User
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--canvas)' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0"
               style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }}>
            <span className="text-sm" style={{ color: 'var(--warm-muted)' }}>로딩 중...</span>
          </div>
        }>
          <Header user={user} onMenuClick={() => setSidebarOpen(true)} />
        </Suspense>

        {/* app-main: 모바일에서 BottomNav 높이 + safe area만큼 하단 여백 확보 */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 app-main">
          {children}
        </main>
      </div>

      {/* HIG: iPhone에서 1차 내비게이션은 하단 탭바 */}
      <BottomNav />
    </div>
  )
}
