import { getMyProperties, selectProperty, signOut } from './actions'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const ROLE_STYLE: Record<string, string> = {
  OWNER:   'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  MANAGER: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  STAFF:   'bg-gray-500/20 text-gray-400 border border-gray-500/30',
}
const ROLE_LABEL: Record<string, string> = {
  OWNER: '오너', MANAGER: '매니저', STAFF: '스태프',
}

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

        {properties.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-3">
            <p className="text-4xl">🏗️</p>
            <p className="text-white font-medium">소속된 영업장이 없습니다</p>
            <p className="text-sm text-gray-500">
              영업장 오너로부터 초대를 받거나<br />새 영업장을 직접 개설하세요.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {properties.map(p => (
              <li key={p.propertyId}>
                <form action={selectProperty.bind(null, p.propertyId)}>
                  <button
                    type="submit"
                    disabled={!p.isActive}
                    className="w-full text-left bg-gray-900 hover:bg-gray-800
                               border border-gray-800 hover:border-indigo-500/50
                               rounded-2xl p-5 transition-all group
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white group-hover:text-indigo-300
                                      transition-colors truncate">
                          {p.propertyName}
                          {!p.isActive && <span className="text-xs text-gray-600 ml-2">(운영 종료)</span>}
                        </p>
                        {p.address && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{p.address}</p>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_STYLE[p.role]}`}>
                        {ROLE_LABEL[p.role]}
                      </span>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <span className="text-gray-600 group-hover:text-indigo-400 transition-colors text-sm">
                        선택 →
                      </span>
                    </div>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={signOut}>
          <button type="submit" className="w-full text-sm text-gray-600 hover:text-gray-400 transition-colors py-2">
            다른 계정으로 로그인
          </button>
        </form>
      </div>
    </main>
  )
}