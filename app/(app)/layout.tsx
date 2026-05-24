import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
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

  // 헤더 영업장 스위처용 — getUser() 네트워크 왕복을 피하려 claims.sub로 직접 조회.
  // 헤더엔 id·name만 필요(실제 전환은 selectProperty가 권한 재확인).
  const cookieStore = await cookies()
  const currentPropertyId = cookieStore.get('selected_property_id')?.value ?? null
  const roles = await prisma.userPropertyRole.findMany({
    where: { userId: claims.sub as string },
    select: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const properties = roles.map(r => ({ id: r.property.id, name: r.property.name }))

  return (
    <AppShell
      user={{ email: claims.email, user_metadata: claims.user_metadata }}
      properties={properties}
      currentPropertyId={currentPropertyId}
    >
      <ClearAppBadge />
      <EntityModalProvider>
        {children}
      </EntityModalProvider>
    </AppShell>
  )
}
