import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginButton from './LoginButton'
import EmailLoginForm from './EmailLoginForm'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import DocumentScroll from '@/components/layout/DocumentScroll'

function StayeumLogo() {
  return <StayeumWordmark height={36} />
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; message?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const { returnTo, error, message } = await searchParams

  return (
    <main className="min-h-dvh flex items-center justify-center p-4"
          style={{ background: 'var(--canvas)' }}>
      <DocumentScroll />
      <div className="w-full max-w-sm space-y-8 px-2">
        <div className="text-center space-y-3">
          <StayeumLogo />
          <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>고시원·원룸텔 스마트 관리 시스템</p>
        </div>

        <div className="rounded-xl p-8 space-y-5"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--warm-dark)' }}>로그인 / 회원가입</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>이메일 또는 구글 계정으로 시작하세요</p>
          </div>

          {message === 'password_updated' && (
            <div className="rounded-xl p-3"
                 style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)' }}>
              <p className="text-sm" style={{ color: 'var(--success-fg)' }}>비밀번호가 변경됐습니다. 새 비밀번호로 로그인해주세요.</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl p-3"
                 style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-ring)' }}>
              <p className="text-[var(--danger-fg)] text-sm">로그인에 실패했습니다. 다시 시도해주세요.</p>
            </div>
          )}

          <EmailLoginForm returnTo={returnTo} />

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px" style={{ background: 'var(--warm-border)' }} />
            <span className="text-xs" style={{ color: 'var(--warm-muted)' }}>또는</span>
            <div className="flex-1 h-px" style={{ background: 'var(--warm-border)' }} />
          </div>

          <LoginButton returnTo={returnTo} />
        </div>

        {/* 이 문장이 가리킬 문서가 없던 상태를 봉합했다(2026-08-26) — 문서 없이 동의를 말하면
            그 문장 자체가 사실이 아니고, 무엇에 동의했는지 나중에 아무도 답할 수 없다. */}
        <p className="text-center text-xs" style={{ color: 'var(--warm-muted)' }}>
          로그인 시{' '}
          <Link href="/terms" className="underline underline-offset-2" style={{ color: 'var(--warm-mid)' }}>서비스 이용약관</Link>
          {' '}및{' '}
          <Link href="/privacy" className="underline underline-offset-2" style={{ color: 'var(--warm-mid)' }}>개인정보 처리방침</Link>
          에 동의하게 됩니다.
        </p>
      </div>
    </main>
  )
}
