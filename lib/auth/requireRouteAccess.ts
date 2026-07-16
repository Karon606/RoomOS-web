// 페이지 레벨 라우트 가드 — 레이아웃은 전체 로드에서만 재실행되므로, 클라 내비로 진입하는 민감 page.tsx는
// 이 헬퍼로 직접 방어한다(제한 스태프 뒷문 차단, 65992b0a). 허용 밖이면 조용히 역할 홈으로 리다이렉트.
import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getMyRole } from '@/lib/role'
import { canAccessRoute, roleHome } from '@/lib/auth/routeScope'

export async function requireRouteAccess(): Promise<void> {
  const role = await getMyRole().catch(() => null)
  if (!role) return   // 인증·격리는 layout이 처리 — 여기선 역할 있을 때만 스코프 판정
  const path = (await headers()).get('x-pathname')?.split('?')[0] ?? ''
  if (path && !canAccessRoute(role, path)) redirect(roleHome(role))
}
