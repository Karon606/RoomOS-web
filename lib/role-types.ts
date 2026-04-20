export type Role = 'OWNER' | 'MANAGER' | 'STAFF'

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: '소유자',
  MANAGER: '관리자',
  STAFF: '스태프',
}
