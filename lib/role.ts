import { requirePropertyAccess } from './auth/propertyAccess'
import { canEditScope, type WriteScope } from './auth/routeScope'

export type { Role } from './role-types'
export type { WriteScope } from './auth/routeScope'
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

// 스코프별 쓰기 — 전면 쓰기(canEdit)가 아니어도 특정 스코프만 쓰기를 허용(제한 스태프 재고).
// canEdit(OWNER|MANAGER)는 무조건 통과, 그 외는 canEditScope 보유 역할만. requireEdit·requireOwner 무변경.
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
