import { redirect } from 'next/navigation'
import { getAccessContext } from '@/lib/auth/access'
import prisma from '@/lib/prisma'
import { signOut } from '@/app/property-select/actions'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import DocumentScroll from '@/components/layout/DocumentScroll'
import { Btn } from '@/components/ui/Btn'
import PendingAutoCheck from './PendingAutoCheck'

// 베타 승인 대기 / 거절 안내. (app) 레이아웃 게이트가 미승인 사용자를 여기로 보냄.
// 승인되면 화면이 스스로 넘어간다(PendingAutoCheck). 행이 없던 신원은 getAccessContext 가 여기서 행을 만든다(관리자 목록에 선다).
export default async function PendingPage() {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  // 스테이음 관리자는 관리자 페이지로(영업장 없을 수 있음), 일반 승인 사용자는 앱으로
  if (ctx.isSuperAdmin) redirect('/admin')
  if (ctx.status === 'APPROVED') redirect('/dashboard')

  const rejected = ctx.status === 'REJECTED'
  // 승인 전에 영업장 직원으로 초대받았으면 그 사실을 보인다(4단계). 종전에는 초대를 받아도 이 화면에 갇힌 이유를 몰랐다.
  const invitedTo = rejected ? [] : await prisma.userPropertyRole.findMany({
    where: { userId: ctx.userId }, select: { property: { select: { name: true } } }, orderBy: { createdAt: 'asc' },
  })

  return (
    <main
      className="min-h-dvh flex items-center justify-center p-4"
      style={{ background: 'var(--canvas)' }}
    >
      <DocumentScroll />
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <StayeumWordmark height={32} />
        </div>

        <div
          className="rounded-xl p-7 space-y-4"
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
                문의가 필요하시면 스테이음 팀에 연락해 주세요.
              </>
            ) : (
              <>
                스테이음은 현재 <b style={{ color: 'var(--tc-text)' }}>베타 운영 중</b>입니다.
                <br />
                스테이음 팀 승인 후 모든 기능을 이용하실 수 있어요.
                <br />
                승인되면 이 화면이 자동으로 넘어갑니다.
              </>
            )}
          </p>

          <div className="space-y-1.5">
            <div
              className="text-xs rounded-lg px-3 py-2 break-all"
              style={{ background: 'var(--cream-soft)', color: 'var(--ink-mute)' }}
            >
              {ctx.email}
            </div>
            {!rejected && invitedTo.length === 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
                고시원 직원으로 합류하신다면 사장님께 위 이메일을 알려 주세요.
              </p>
            )}
            {invitedTo.length > 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                {invitedTo.map(r => r.property.name).join(', ')}에서 직원으로 초대했습니다. 스테이음 팀 승인 뒤 바로 들어갑니다.
              </p>
            )}
          </div>

          <PendingAutoCheck initial={rejected ? 'REJECTED' : 'PENDING'} />
        </div>

        <form action={signOut}>
          <Btn type="submit" variant="ghost" size="sm">로그아웃</Btn>
        </form>
      </div>
    </main>
  )
}
