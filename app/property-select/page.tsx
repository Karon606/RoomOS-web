import { getMyProperties } from './actions'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PropertyList from './PropertyList'

export default async function PropertySelectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const properties = await getMyProperties()

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">🏢 영업장 선택</h1>
          <p className="text-sm text-gray-400">{user.email} · 관리할 영업장을 선택하세요</p>
        </div>

        <PropertyList properties={properties} />
      </div>
    </main>
  )
}
