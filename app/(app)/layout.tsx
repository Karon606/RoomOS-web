import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import AppShell from '@/components/layout/AppShell'
import { EntityModalProvider } from '@/components/entity-modal/EntityModal'
import ClearAppBadge from '@/components/ClearAppBadge'
import { isSuperAdminEmail } from '@/lib/auth/access'

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

  // ── 베타 접근 게이팅 ── 승인된 사용자(또는 슈퍼관리자)만 앱 진입.
  // 미승인/거절은 /pending 으로. (슈퍼관리자는 status 무관 통과 — env 또는 DB)
  const userId = claims.sub as string
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, isSuperAdmin: true },
  })
  const isSuperAdmin = isSuperAdminEmail(claims.email as string | undefined) || (me?.isSuperAdmin ?? false)
  if (!isSuperAdmin && me?.status !== 'APPROVED') redirect('/pending')

  // 헤더 영업장 스위처용. 일반 사용자 = 본인 소속 영업장만. 슈퍼관리자 = 전체 활성 영업장(자유 전환).
  const cookieStore = await cookies()
  const currentPropertyId = cookieStore.get('selected_property_id')?.value ?? null
  let properties: { id: string; name: string }[]
  let myPropertyIds: Set<string>
  if (isSuperAdmin) {
    const all = await prisma.property.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
    properties = all
    const myRoles = await prisma.userPropertyRole.findMany({
      where: { userId },
      select: { propertyId: true },
    })
    myPropertyIds = new Set(myRoles.map(r => r.propertyId))
  } else {
    const roles = await prisma.userPropertyRole.findMany({
      where: { userId },
      select: { property: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    properties = roles.map(r => ({ id: r.property.id, name: r.property.name }))
    myPropertyIds = new Set(properties.map(p => p.id))
  }

  // 활성 영업장이 0개면 진입 불가 (데이터가 영업장 단위라 빈 컨텍스트면 로드 실패). 운영자는 /admin, 그 외엔 /property-select.
  if (properties.length === 0) redirect(isSuperAdmin ? '/admin' : '/property-select')

  // 슈퍼관리자가 본인 소속 아닌 영업장을 보고 있으면 = 관리자 뷰
  const isAdminView = isSuperAdmin && currentPropertyId != null && !myPropertyIds.has(currentPropertyId)

  return (
    <AppShell
      user={{ email: claims.email, user_metadata: claims.user_metadata }}
      properties={properties}
      currentPropertyId={currentPropertyId}
      isSuperAdmin={isSuperAdmin}
      isAdminView={isAdminView}
    >
      <ClearAppBadge />
      <EntityModalProvider>
        {children}
      </EntityModalProvider>
    </AppShell>
  )
}
