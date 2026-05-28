import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import ProfileSetupForm from './ProfileSetupForm'

// Google OAuth 등 가입 시 정보 수집이 없었던 케이스용 후처리 페이지.
// (app)/layout 이 (승인된 일반 사용자 + realName null + 스킵 쿠키 없음) 일 때 이리로 보냄.
export default async function ProfileSetupPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: claims.sub as string },
    select: { email: true, realName: true, phone: true, address: true, name: true },
  })
  if (!user) redirect('/login')

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="flex justify-center"><StayeumWordmark height={32} /></div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>프로필 정보 입력</h1>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
              운영에 필요한 기본 정보입니다.<br />
              가입 시 미수집된 항목을 채워주세요.
            </p>
          </div>
        </div>
        <ProfileSetupForm
          email={user.email}
          initial={{
            realName: user.realName ?? user.name ?? '',
            phone:    user.phone ?? '',
            address:  user.address ?? '',
          }}
        />
      </div>
    </main>
  )
}
