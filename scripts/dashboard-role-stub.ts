// 대시보드 패리티 하네스 전용 lib/role 스텁 — 본문은 lib/role.ts 와 같고 import 경로만 다르다.
// 왜 필요한가. lib/role.ts 는 관문을 상대경로('./auth/propertyAccess')로 부른다. tsconfig paths 는
// 별칭('@/...')만 갈아끼우므로 그 한 줄이 진짜 관문(cookies())으로 새어 canSeeMoney 가 터진다.
// 여기서는 별칭으로 불러 스텁에 닿게 한다. 앱 코드는 절대 이 파일을 import 하지 않는다.
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { canEditScope, type WriteScope } from '@/lib/auth/routeScope'
import type { Role } from '@/lib/role-types'

export type { Role } from '@/lib/role-types'
export type { WriteScope } from '@/lib/auth/routeScope'
export { ROLE_LABEL } from '@/lib/role-types'

export async function getMyRole(): Promise<Role> {
  const { role } = await requirePropertyAccess()
  return role
}

export function canEdit(role: Role): boolean {
  return role === 'OWNER' || role === 'MANAGER'
}

export function canManageMembers(role: Role): boolean {
  return role === 'OWNER'
}

export async function requireEdit(): Promise<Role> {
  const role = await getMyRole()
  if (!canEdit(role)) throw new Error('수정 권한이 없습니다.')
  return role
}

export async function requireScopeEdit(scope: WriteScope): Promise<Role> {
  const role = await getMyRole()
  if (canEdit(role)) return role
  if (canEditScope(role, scope)) return role
  throw new Error('수정 권한이 없습니다.')
}

export async function requireOwner(): Promise<Role> {
  const role = await getMyRole()
  if (!canManageMembers(role)) throw new Error('소유자만 접근할 수 있습니다.')
  return role
}
