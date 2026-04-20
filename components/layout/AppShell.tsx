'use client'

import { useState, Suspense } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
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
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-14 md:h-16 bg-gray-900 border-b border-gray-800 flex items-center px-4 md:px-6">
            <span className="text-sm text-gray-500">로딩 중...</span>
          </div>
        }>
          <Header user={user} onMenuClick={() => setSidebarOpen(true)} />
        </Suspense>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
