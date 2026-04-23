'use client'

import { useState, useTransition, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import BottomNav from '@/components/layout/BottomNav'
import { User } from '@supabase/supabase-js'

function PageLoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'var(--canvas)' }}>
      <style>{`
        @keyframes roos-from-left {
          0%   { transform: translateX(-54px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(54px); }
        }
        @keyframes roos-from-right {
          0%   { transform: translateX(54px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(-54px); }
        }
        .rl-b1 { animation: roos-from-left  2.4s ease-in-out infinite 0s;    }
        .rl-b2 { animation: roos-from-right 2.4s ease-in-out infinite 0.16s; }
        .rl-b3 { animation: roos-from-left  2.4s ease-in-out infinite 0.32s; }
        .rl-b4 { animation: roos-from-right 2.4s ease-in-out infinite 0.48s; }
      `}</style>
      <div style={{ width: 54, height: 54, overflow: 'hidden', position: 'relative' }} aria-label="로딩 중">
        <svg width="54" height="54" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
          <g className="rl-b1"><line x1="3" y1="6"  x2="57" y2="6"  stroke="#f4623a" strokeWidth="8" strokeLinecap="round" /></g>
          <g className="rl-b2"><line x1="3" y1="23" x2="38" y2="23" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.5" /></g>
          <g className="rl-b3"><line x1="3" y1="40" x2="57" y2="40" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.72" /></g>
          <g className="rl-b4"><line x1="3" y1="57" x2="30" y2="57" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.38" /></g>
        </svg>
      </div>
    </div>
  )
}

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
    </div>
  )
}
