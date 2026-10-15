// 영업장 안의 역할을 정하는 순수 판정 정본. 영업장 관문(종 알림 포함)과 크론 푸시가 같은 함수를 부른다.
//
// 왜 한 자리인가(2026-10-15 비품 수령 3차 검수 권장 ①). 종(getMyAlerts)은 lib/auth/propertyAccess 가 정한 역할로,
// 크론 푸시는 route.ts 가 손으로 짠 순서로 알림을 걸렀다. 순서는 맞췄지만 env 슈퍼관리자 승격(역할 줄이 낮아도
// 소유자로 본다)이 크론에는 없었다. 같은 사람이 종에서는 소유자 알림을, 폰 푸시에서는 스태프 알림을 받는 자리다.
// 판정을 글자 대조로만 지키면 역주입이 안 잡혔다(M4). 그래서 순수 함수로 빼고 진리표(scripts/test-resolve-role)를 단다.
//
// 이 파일은 server-only 가 아니다. 진리표가 tsx 로 바로 부른다(DB·쿠키·env 를 읽지 않는다. 부르는 쪽이 값을 넘긴다).
import type { Role } from '@/lib/role-types'

export type RoleFacts = {
  membershipRole: Role | null   // 그 영업장의 역할 줄(UserPropertyRole). 없으면 null
  isOwner: boolean              // property.ownerId 가 이 사용자다(역할 줄 없는 레거시 소유주)
  superByEnv: boolean           // env SUPER_ADMIN_EMAILS 에 든 이메일이다
  superByDb?: boolean           // User.isSuperAdmin 표식(역할 줄이 없을 때만 소유자로 본다)
}

/**
 * 그 영업장에서 이 사용자의 역할. 접근할 수 없으면 null.
 * 1. 역할 줄이 있으면 그 역할. 다만 env 슈퍼관리자는 줄이 낮아도 소유자로 승격한다(getMyRole 종전 동작).
 * 2. 역할 줄이 없으면 소유주이거나 슈퍼관리자(env 또는 DB 표식)일 때만 소유자.
 * 계정 승인 상태(User.status)는 여기서 보지 않는다. 관문과 크론이 각자 먼저 거른다.
 */
export function resolvePropertyRole(f: RoleFacts): Role | null {
  if (f.membershipRole) return f.superByEnv ? 'OWNER' : f.membershipRole
  return f.isOwner || f.superByEnv || !!f.superByDb ? 'OWNER' : null
}

/**
 * 크론 푸시가 한 사용자에게 보낼 영업장별 역할(2단계 검수 R2). 그 사용자가 소유하거나 역할 줄이 있는 영업장마다 위 정본으로 정한다.
 * env 슈퍼관리자 판정(isSuperEmail)은 이 함수 안에서 사용자 행 이메일로 한다. 종(관문)은 로그인 클레임 이메일로 같은 판정을 한다.
 * 판정을 부르는 쪽에 두면 그 줄의 상승 역주입('|| true')을 진리표가 못 본다(검수 inj6). 그래서 이메일과 판정 함수를 받는다.
 */
export function pushRoleMap(input: {
  roleRows: readonly { propertyId: string; role: Role }[]
  ownedIds: readonly string[]
  email: string | null
  isSuperEmail: (email: string | null) => boolean
}): Map<string, Role> {
  const rowRole = new Map(input.roleRows.map(r => [r.propertyId, r.role]))
  const owned = new Set(input.ownedIds)
  const superByEnv = input.isSuperEmail(input.email)
  const out = new Map<string, Role>()
  for (const pid of new Set([...owned, ...rowRole.keys()])) {
    const role = resolvePropertyRole({ membershipRole: rowRole.get(pid) ?? null, isOwner: owned.has(pid), superByEnv })
    if (role) out.set(pid, role)
  }
  return out
}
