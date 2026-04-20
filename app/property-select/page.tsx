import { getMyProperties } from './actions'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PropertyList from './PropertyList'

function RoomOSLogo() {
  return (
    <div className="flex items-center justify-center gap-3">
      <svg width="36" height="28" viewBox="0 0 28 22" fill="none">
        <rect y="0"  width="28" height="4" rx="2" fill="#f4623a" />
        <rect y="6"  width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.6" />
        <rect y="12" width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.4" />
        <rect y="18" width="28" height="4" rx="2" fill="#7a6a5a" opacity="0.25" />
      </svg>
      <span className="text-3xl tracking-tight" style={{ color: '#5a4a3a' }}>
        <span style={{ fontWeight: 300 }}>Room</span>
        <span style={{ fontWeight: 700, color: '#f4623a' }}>OS</span>
      </span>
    </div>
  )
}

export default async function PropertySelectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const properties = await getMyProperties()

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-3">
          <RoomOSLogo />
          <div className="space-y-1 pt-1">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--warm-dark)' }}>영업장 선택</h1>
            <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>
              {user.email} · 관리할 영업장을 선택하세요
            </p>
          </div>
        </div>

        <PropertyList properties={properties} />
      </div>
    </main>
  )
}
