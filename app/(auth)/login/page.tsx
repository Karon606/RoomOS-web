import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginButton from './LoginButton'

function RoomOSLogo() {
  return (
    <div className="flex items-center justify-center gap-3">
      <svg width="36" height="38" viewBox="0 0 28 30" fill="none">
        <line x1="0" y1="3.5"  x2="28" y2="3.5"  stroke="#f4623a" strokeWidth="4.5" strokeLinecap="round"/>
        <line x1="0" y1="12"   x2="18" y2="12"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.42"/>
        <line x1="0" y1="20.5" x2="28" y2="20.5" stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.62"/>
        <line x1="0" y1="29"   x2="14" y2="29"   stroke="#7a6a5a" strokeWidth="4.5" strokeLinecap="round" opacity="0.28"/>
      </svg>
      <span className="text-3xl tracking-tight" style={{ color: '#5a4a3a' }}>
        <span style={{ fontWeight: 300 }}>Room</span>
        <span style={{ fontWeight: 700, color: '#f4623a' }}>OS</span>
      </span>
    </div>
  )
}

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
    <main className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-sm space-y-8 px-2">
        <div className="text-center space-y-3">
          <RoomOSLogo />
          <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>고시원·원룸텔 스마트 관리 시스템</p>
        </div>

        <div className="rounded-2xl p-8 space-y-6"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--warm-dark)' }}>로그인 / 회원가입</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>구글 계정으로 로그인하면 자동으로 가입됩니다</p>
          </div>

          {error && (
            <div className="rounded-xl p-3"
                 style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p className="text-red-500 text-sm">로그인에 실패했습니다. 다시 시도해주세요.</p>
            </div>
          )}

          <LoginButton returnTo={returnTo} />
        </div>

        <p className="text-center text-xs" style={{ color: 'var(--warm-muted)' }}>
          로그인 시 서비스 이용약관 및 개인정보처리방침에 동의하게 됩니다.
        </p>
      </div>
    </main>
  )
}
