import { getMyProperties } from './actions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PropertyList from './PropertyList'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import { getAccessContext } from '@/lib/auth/access'

function StayeumLogo() {
  return <StayeumWordmark height={36} />
}

export default async function PropertySelectPage() {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  // 베타 게이팅 — 승인 안 된 일반 사용자는 진입 차단(승인 대기 안내로)
  if (!ctx.isSuperAdmin && ctx.status !== 'APPROVED') redirect('/pending')

  const properties = await getMyProperties()
  // 운영자인데 소속 영업장이 없으면 운영자 페이지로 바로 이동
  if (ctx.isSuperAdmin && properties.length === 0) redirect('/admin')

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-3">
          <StayeumLogo />
          <div className="space-y-1 pt-1">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--warm-dark)' }}>영업장 선택</h1>
            <p className="text-sm" style={{ color: 'var(--warm-muted)' }}>
              {ctx.email} · 관리할 영업장을 선택하세요
            </p>
          </div>
        </div>

        <PropertyList properties={properties} />

        {ctx.isSuperAdmin && (
          <div className="text-center">
            <Link href="/admin" className="text-sm font-medium" style={{ color: 'var(--persimmon)' }}>
              운영자 페이지 ›
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
