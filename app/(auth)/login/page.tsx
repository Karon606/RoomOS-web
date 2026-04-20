import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginButton from './LoginButton'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const { returnTo, error } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-8 px-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">🏢 RoomOS</h1>
          <p className="text-sm text-gray-400">고시원·원룸텔 스마트 관리 시스템</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white">로그인</h2>
            <p className="text-xs text-gray-500 mt-1">구글 계정으로 시작하세요</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <p className="text-red-400 text-sm">로그인에 실패했습니다. 다시 시도해주세요.</p>
            </div>
          )}

          <LoginButton returnTo={returnTo} />
        </div>

        <p className="text-center text-xs text-gray-600">
          로그인 시 서비스 이용약관 및 개인정보처리방침에 동의하게 됩니다.
        </p>
      </div>
    </main>
  )
}