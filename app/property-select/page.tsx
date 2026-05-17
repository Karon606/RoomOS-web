import { getMyProperties } from './actions'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PropertyList from './PropertyList'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'

function StayeumLogo() {
  return <StayeumWordmark height={36} />
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
          <StayeumLogo />
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
