import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { EntityModalProvider } from '@/components/entity-modal/EntityModal'
import ClearAppBadge from '@/components/ClearAppBadge'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  // proxy.ts가 매 요청에서 세션을 갱신하므로, 레이아웃에서는 JWT를 검증하는
  // getClaims()로 인증 확인 — getUser()의 중복 네트워크 왕복 제거.
  // (Supabase가 비대칭 JWT 서명키를 쓰면 로컬 검증 → 네트워크 호출 없음)
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect('/login')

  return (
    <AppShell user={{ email: claims.email, user_metadata: claims.user_metadata }}>
      <ClearAppBadge />
      <EntityModalProvider>
        {children}
      </EntityModalProvider>
    </AppShell>
  )
}
