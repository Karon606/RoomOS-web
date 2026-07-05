import { requirePropertyAccess } from './auth/propertyAccess'

export type { Role } from './role-types'
export { ROLE_LABEL } from './role-types'
import type { Role } from './role-types'

// 격리 관문(requirePropertyAccess) 위에서 역할만 꺼낸다.
// 기존과 달라진 점: 멤버도 소유주도 아닌 사용자에게 주던 STAFF 폴백(읽기 허용)을 제거 —
// 무단 쿠키는 /property-select 로 보낸다(보안 감사 2026-07-04 §4 승인 2026-07-06).
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

export async function requireOwner(): Promise<Role> {
  const role = await getMyRole()
  if (!canManageMembers(role)) throw new Error('소유자만 접근할 수 있습니다.')
  return role
}
