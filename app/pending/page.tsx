import { redirect } from 'next/navigation'
import { getAccessContext } from '@/lib/auth/access'
import { signOut } from '@/app/property-select/actions'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'

// 베타 승인 대기 / 거절 안내. (app) 레이아웃 게이트가 미승인 사용자를 여기로 보냄.
export default async function PendingPage() {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  // 운영자는 운영자 페이지로(영업장 없을 수 있음), 일반 승인 사용자는 앱으로
  if (ctx.isSuperAdmin) redirect('/admin')
  if (ctx.status === 'APPROVED') redirect('/dashboard')

  const rejected = ctx.status === 'REJECTED'

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--canvas)' }}
    >
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <StayeumWordmark height={32} />
        </div>

        <div
          className="rounded-2xl p-7 space-y-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)' }}
        >
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {rejected ? '가입이 승인되지 않았습니다' : '승인 대기 중입니다'}
          </h1>

          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            {rejected ? (
              <>
                현재 계정은 서비스 이용이 제한되어 있습니다.
                <br />
                문의가 필요하시면 운영자에게 연락해주세요.
              </>
            ) : (
              <>
                스테이음은 현재 <b style={{ color: 'var(--persimmon)' }}>베타 운영 중</b>입니다.
                <br />
                운영자 승인 후 모든 기능을 이용하실 수 있어요.
                <br />
                승인되면 다시 로그인해주세요.
              </>
            )}
          </p>

          <div
            className="text-xs rounded-lg px-3 py-2"
            style={{ background: 'var(--cream-soft)', color: 'var(--ink-mute)' }}
          >
            {ctx.email}
          </div>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="text-sm underline underline-offset-2"
            style={{ color: 'var(--ink-3)' }}
          >
            로그아웃
          </button>
        </form>
      </div>
    </main>
  )
}
