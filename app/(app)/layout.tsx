import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { isInternalPath } from '@/lib/auth/returnTo'
import { canAccessRoute, roleHome } from '@/lib/auth/routeScope'
import prisma from '@/lib/prisma'
import AppShell from '@/components/layout/AppShell'
import { EntityModalProvider } from '@/components/entity-modal/EntityModal'
import ClearAppBadge from '@/components/ClearAppBadge'
import PeekFrameGuard from '@/components/PeekFrameGuard'
import { RoleProvider } from '@/components/RoleContext'
import NewVersionNotice from '@/components/NewVersionNotice'
import BreadcrumbTracker from '@/components/BreadcrumbTracker'
import ErrorReportButton from '@/components/ErrorReportButton'
import { isSuperAdminEmail } from '@/lib/auth/access'
import { GlobalSearchHost } from '@/components/search/GlobalSearchHost'
import { buildDriveThumbnailUrl } from '@/lib/google-drive'

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
  if (!claims) {
    // 세션 만료 시 원래 보던 화면으로 복귀 — proxy 가 실은 x-pathname 을 returnTo 로.
    // isInternalPath 로 정제해 오픈 리다이렉트 차단, 로그인 후 proxy 가 returnTo 로 보냄.
    const path = (await headers()).get('x-pathname')
    redirect(isInternalPath(path) ? `/login?returnTo=${encodeURIComponent(path)}` : '/login')
  }

  // ── 베타 접근 게이팅 ── 승인된 사용자(또는 슈퍼관리자)만 앱 진입.
  // 미승인/거절은 /pending 으로. (슈퍼관리자는 status 무관 통과 — env 또는 DB)
  const userId = claims.sub as string
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, isSuperAdmin: true, realName: true },
  })
  const isSuperAdmin = isSuperAdminEmail(claims.email as string | undefined) || (me?.isSuperAdmin ?? false)
  if (!isSuperAdmin && me?.status !== 'APPROVED') redirect('/pending')

  // 헤더 영업장 스위처용. 일반 사용자 = 본인 소속 영업장만. 슈퍼관리자 = 전체 활성 영업장(자유 전환).
  const cookieStore = await cookies()

  // 프로필 미입력 안내 — Google OAuth 등 가입 시 실명·연락처 수집 폼이 없었던 케이스용 후처리.
  // 슈퍼관리자는 제외(시스템 운영자), 한 번 '나중에' 선택했으면 30일간 안내 안 함.
  if (!isSuperAdmin && !me?.realName) {
    const skipped = cookieStore.get('profile_setup_skipped')?.value === '1'
    if (!skipped) redirect('/profile-setup')
  }
  const currentPropertyId = cookieStore.get('selected_property_id')?.value ?? null
  let properties: { id: string; name: string; appLogoUrl?: string | null }[]
  let myPropertyIds: Set<string>
  const appLogo = (id: string | null) => id ? buildDriveThumbnailUrl(id, 120) : null
  if (isSuperAdmin) {
    const all = await prisma.property.findMany({
      where: { isActive: true },
      select: { id: true, name: true, appLogoDriveFileId: true },
      orderBy: { createdAt: 'asc' },
    })
    properties = all.map(p => ({ id: p.id, name: p.name, appLogoUrl: appLogo(p.appLogoDriveFileId) }))
    const myRoles = await prisma.userPropertyRole.findMany({
      where: { userId },
      select: { propertyId: true },
    })
    myPropertyIds = new Set(myRoles.map(r => r.propertyId))
  } else {
    const roles = await prisma.userPropertyRole.findMany({
      where: { userId },
      select: { property: { select: { id: true, name: true, appLogoDriveFileId: true } } },
      orderBy: { createdAt: 'asc' },
    })
    properties = roles.map(r => ({ id: r.property.id, name: r.property.name, appLogoUrl: appLogo(r.property.appLogoDriveFileId) }))
    myPropertyIds = new Set(properties.map(p => p.id))
  }

  // 활성 영업장이 0개면 진입 불가 (데이터가 영업장 단위라 빈 컨텍스트면 로드 실패). 운영자는 /admin, 그 외엔 /property-select.
  if (properties.length === 0) redirect(isSuperAdmin ? '/admin' : '/property-select')

  // 격리 관문: 선택 쿠키가 내 소속 영업장이 아니면 재선택으로 (역할 행 없는 레거시 소유주는 getPropertyAccess 가 허용).
  // 슈퍼관리자는 제외 — 아래 관리자 뷰(isAdminView)로 전 영업장 전환을 허용하는 기존 규칙 유지.
  if (!isSuperAdmin && currentPropertyId && !myPropertyIds.has(currentPropertyId)) {
    if (!(await getPropertyAccess())) redirect('/property-select')
  }
  // 역할 컨텍스트용 — 현재 영업장에서의 내 역할(멤버 아니면 null → OWNER 폴백, 슈퍼관리자 뷰 포함)
  const access = await getPropertyAccess()

  // 제한 스태프 라우트 가드 — 허용 밖 경로(직접 URL·새로고침·외부 링크) 진입 시 조용히 역할 홈으로(뒷문 차단, 65992b0a).
  // 레이아웃은 전체 로드에서만 재실행되므로 클라 내비 방어는 각 민감 page.tsx의 requireRouteAccess가 담당.
  if (access?.role) {
    const curPath = (await headers()).get('x-pathname')?.split('?')[0] ?? ''
    if (curPath && !canAccessRoute(access.role, curPath)) redirect(roleHome(access.role))
  }

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
      <PeekFrameGuard />
      <NewVersionNotice />
      <BreadcrumbTracker />
      <EntityModalProvider>
        {/* 역할 컨텍스트 — 뷰어(STAFF) 편집 버튼 숨김 가드(감사 D3). access 없으면 OWNER 폴백(서버가 최종 방어) */}
        <RoleProvider role={access?.role ?? 'OWNER'}>
          {children}
        </RoleProvider>
        {/* 전역 통합 검색 — Prism(entityModal) 착지를 위해 Provider 안쪽에 마운트 */}
        <GlobalSearchHost propertyId={currentPropertyId} />
      </EntityModalProvider>
      <ErrorReportButton />
    </AppShell>
  )
}
