// 스테이음 관리자 페이지(가입자 카드) 판정·문구·적용취소 토큰 모양 정본(순수). 서명·쓰기는 app/admin/actions.ts 가 한다.
//
// 왜(2026-11-04 운영자 승인 '추천대로'). 가입자 카드의 [운영자 지정]이 바로 눌려 남에게 플랫폼 슈퍼관리자(모든 영업장 소유자급 +
// 관리자 페이지)가 걸렸다. 이 앱의 사용자 자신이 '고시원 운영자'라 낱말도 헷갈렸다. 그래서
//   · 플랫폼 쪽 이름은 '스테이음 관리자' 하나로 부른다(PLATFORM_ADMIN_LABEL).
//   · 권한 주기는 카드 '관리' 메뉴 안이고(바로 누를 수 없다), 파괴 단계 확인창에 이 사람이 볼 수 있게 되는 것을 적는다.
//   · 실행 뒤 토스트 [적용취소]. 토큰은 쓰기 전·쓴 직후 모습을 함께 쥐고, 지금이 쓴 직후 그대로일 때만 쓰기 전으로 돌린다.
//   · 본인 카드는 버튼이 없다(서버도 본인 변경을 거부한다).
// 카드에 서는 버튼은 cardActions 한 함수가 정하고, 서버가 거부하는 동작은 화면에 세우지 않는다(같은 판정 adminChangeBlock).

import type { Role } from '@/lib/role-types'

export const PLATFORM_ADMIN_LABEL = '스테이음 관리자'

export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** 권한·상태 칸 스냅샷. 날짜는 ISO 문자열(화면을 거쳐 돌아오므로). */
export type UserAccessSnap = {
  status: AccessStatus
  isSuperAdmin: boolean
  approvedAt: string | null
  approvedBy: string | null
}

/** 승인과 함께 내 영업장 직원으로 넣은 역할 줄(4단계). before 가 null 이면 새로 만든 줄이다. */
export type RoleChange = { propertyId: string; before: Role | null; after: Role }

export const ADMIN_USER_UNDO_DOMAIN = 'admin-user-access-v1'
/** 서명 범위. 영업장이 아니라 플랫폼 단위라 고정 문자열이다. */
export const ADMIN_UNDO_SCOPE = 'platform'

export type AdminUserUndo = {
  v: 1
  userId: string
  before: UserAccessSnap
  after: UserAccessSnap
  role?: RoleChange
  sig?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: readonly AccessStatus[] = ['PENDING', 'APPROVED', 'REJECTED']
const ROLES: readonly Role[] = ['OWNER', 'MANAGER', 'STAFF', 'LIMITED_STAFF']

export function snapOf(u: { status: string; isSuperAdmin: boolean; approvedAt: Date | string | null; approvedBy: string | null }): UserAccessSnap {
  return {
    status: u.status as AccessStatus,
    isSuperAdmin: u.isSuperAdmin,
    approvedAt: u.approvedAt ? new Date(u.approvedAt).toISOString() : null,
    approvedBy: u.approvedBy,
  }
}

export function sameSnap(a: UserAccessSnap, b: UserAccessSnap): boolean {
  return a.status === b.status && a.isSuperAdmin === b.isSuperAdmin && a.approvedAt === b.approvedAt && a.approvedBy === b.approvedBy
}

export function canonicalAdminUserUndo(u: Omit<AdminUserUndo, 'sig'>): string {
  const s = (x: UserAccessSnap) => ({ status: x.status, isSuperAdmin: x.isSuperAdmin, approvedAt: x.approvedAt, approvedBy: x.approvedBy })
  return JSON.stringify({
    v: 1, userId: u.userId, before: s(u.before), after: s(u.after),
    role: u.role ? { propertyId: u.role.propertyId, before: u.role.before, after: u.role.after } : null,
  })
}

function parseSnap(raw: unknown): UserAccessSnap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).length !== 4) return null
  if (!STATUSES.includes(o.status as AccessStatus) || typeof o.isSuperAdmin !== 'boolean') return null
  if (!(o.approvedAt === null || (typeof o.approvedAt === 'string' && !Number.isNaN(new Date(o.approvedAt).getTime())))) return null
  if (!(o.approvedBy === null || (typeof o.approvedBy === 'string' && UUID.test(o.approvedBy)))) return null
  return { status: o.status as AccessStatus, isSuperAdmin: o.isSuperAdmin, approvedAt: o.approvedAt as string | null, approvedBy: o.approvedBy as string | null }
}

/** 화면에서 돌아온 토큰의 모양 검사. 어긋나면 null(아무것도 안 고친다). */
export function parseAdminUserUndo(raw: unknown): AdminUserUndo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || typeof u.userId !== 'string' || !UUID.test(u.userId)) return null
  const before = parseSnap(u.before), after = parseSnap(u.after)
  if (!before || !after) return null
  let role: RoleChange | undefined
  if (u.role !== undefined && u.role !== null) {
    const r = u.role as Record<string, unknown>
    if (typeof r !== 'object' || typeof r.propertyId !== 'string' || !UUID.test(r.propertyId)) return null
    if (!(r.before === null || ROLES.includes(r.before as Role)) || !ROLES.includes(r.after as Role)) return null
    role = { propertyId: r.propertyId, before: r.before as Role | null, after: r.after as Role }
  }
  return { v: 1, userId: u.userId, before, after, ...(role ? { role } : {}), ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

// ── 카드 버튼 진리표 ─────────────────────────────────────────────

export type CardActionKey =
  | 'approve'        // 대기 카드 주 동작
  | 'reject'         // 대기 카드 보조 동작
  | 'reapprove'      // 거절 카드 주 동작(다시 승인)
  | 'toPending'      // 관리 메뉴 '대기로 되돌리기'
  | 'revokeApproval' // 관리 메뉴 구분선 아래 '승인 취소'(거절로)
  | 'grantAdmin'     // 관리 메뉴 구분선 아래 '스테이음 관리자 권한 주기'
  | 'revokeAdmin'    // 관리 메뉴 '스테이음 관리자 권한 회수'

export type CardRow = {
  status: AccessStatus
  /** DB 칸 isSuperAdmin */
  dbAdmin: boolean
  /** env SUPER_ADMIN_EMAILS 에 든 계정(여기서 못 바꾼다) */
  envAdmin: boolean
  isSelf: boolean
}

/** 카드에 서는 동작. primary 는 카드 발끝 버튼(왼쪽부터), manage 는 '관리' 메뉴 위 칸, danger 는 구분선 아래 칸이다. */
export function cardActions(r: CardRow): { primary: CardActionKey[]; manage: CardActionKey[]; danger: CardActionKey[] } {
  const none = { primary: [], manage: [], danger: [] }
  if (r.isSelf) return none
  if (r.envAdmin) return none                      // 환경 설정 관리자. 화면에서 바꿀 것이 없다
  if (r.dbAdmin) return { primary: [], manage: ['revokeAdmin'], danger: [] }   // 관리자는 상태가 뜻이 없다(게이트가 늘 승인으로 본다)
  if (r.status === 'PENDING') return { primary: ['reject', 'approve'], manage: [], danger: [] }
  if (r.status === 'REJECTED') return { primary: ['reapprove'], manage: ['toPending'], danger: [] }
  return { primary: [], manage: ['toPending'], danger: ['revokeApproval', 'grantAdmin'] }
}

/**
 * 서버 거부 판정 한 벌. 화면은 cardActions 로 세우고, 서버는 이것으로 막는다(문장 그대로 토스트).
 * null 이면 통과.
 */
export function adminChangeBlock(
  kind: 'status' | 'grant' | 'revoke',
  t: { isSelf: boolean; dbAdmin: boolean; envAdmin: boolean },
): string | null {
  if (t.isSelf) return '본인 계정은 여기서 바꿀 수 없습니다.'
  if (t.envAdmin) return '환경 설정으로 지정된 스테이음 관리자라 여기서 바꿀 수 없습니다.'
  if (kind === 'status' && t.dbAdmin) return '스테이음 관리자 계정이라 상태를 바꿀 수 없습니다 · 먼저 권한을 회수하면 됩니다.'
  if (kind === 'grant' && t.dbAdmin) return '이미 스테이음 관리자입니다.'
  if (kind === 'revoke' && !t.dbAdmin) return '스테이음 관리자가 아닙니다.'
  return null
}

export const ACTION_LABEL: Record<CardActionKey, string> = {
  approve: '승인',
  reject: '거절',
  reapprove: '다시 승인',
  toPending: '대기로 되돌리기',
  revokeApproval: '승인 취소',
  grantAdmin: `${PLATFORM_ADMIN_LABEL} 권한 주기`,
  revokeAdmin: `${PLATFORM_ADMIN_LABEL} 권한 회수`,
}

/** 권한 주기 확인창의 영향 목록. 건수는 서버가 센 실데이터만 넣는다. */
export function grantImpact(c: { propertyCount: number; signupCount: number }): { label: string }[] {
  return [
    { label: `모든 영업장 ${c.propertyCount}곳에 소유자로 들어갑니다. 입주자 개인정보와 돈 기록을 보고 고칠 수 있습니다.` },
    { label: `스테이음 관리자 화면이 열립니다. 가입자 ${c.signupCount}명의 이메일·연락처를 보고 권한을 바꿀 수 있습니다.` },
    { label: '직원 권한만 줄 거라면 이 권한이 아니라 환경설정 > 멤버 관리에서 초대합니다.' },
  ]
}

/** 승인과 함께 넣을 수 있는 직원 역할(소유자는 넣지 않는다). 멤버 초대와 같은 목록·라벨. */
export const STAFF_ROLES: readonly Role[] = ['MANAGER', 'STAFF', 'LIMITED_STAFF']
export const STAFF_ROLE_LABEL: Record<'MANAGER' | 'STAFF' | 'LIMITED_STAFF', string> = { MANAGER: '관리자', STAFF: '스태프', LIMITED_STAFF: '제한 스태프' }

/**
 * 영업장에 들어가는 길과 계정 승인의 관계(4단계 '같은 판정'). 역할 줄이 있어도 계정이 승인 전이면 그 사람은 대기 화면에 선다.
 *   ready    승인된 계정 → 역할 줄이 서면 바로 들어온다
 *   waiting  승인 전 계정 → 역할 줄은 서지만 스테이음 팀 승인 뒤에 들어온다(멤버 초대가 알리고, 대기 화면이 영업장 이름을 보인다)
 *   blocked  거절된 계정 → 역할 줄을 세워도 못 들어온다
 */
export function memberJoinState(status: AccessStatus, isSuperAdmin = false): 'ready' | 'waiting' | 'blocked' {
  if (isSuperAdmin || status === 'APPROVED') return 'ready'
  return status === 'PENDING' ? 'waiting' : 'blocked'
}

/** 대기 계정을 멤버로 초대했을 때 스테이음 관리자에게 가는 푸시 문장. */
export function memberInvitePendingPush(who: string, propertyName: string) {
  return { title: '가입 승인 요청', body: `${propertyName}에서 ${who} 님을 직원으로 초대했습니다 · 승인 대기`, url: '/admin/users', tag: 'signup-pending' }
}

/** 멤버 초대 뒤 토스트 문장(화면). 대기 계정이면 들어오는 때를 알린다. */
export function memberInviteToast(joinState: 'ready' | 'waiting'): string {
  return joinState === 'waiting'
    ? '멤버로 추가했습니다 · 아직 스테이음 팀 승인 전 계정이라 승인되면 바로 들어옵니다'
    : '멤버가 추가되었습니다.'
}

// ── 6단계: 가입 경로 메타 · 오래된 계정 정리 (갈림길 F, 2026-11-04 운영자 승인 '추천대로') ──

/** 가입 경로 칩 글자(auth.users app_metadata.provider). 모르면 null(칩 없음). */
export function providerLabel(provider: string | null | undefined): string | null {
  if (provider === 'google') return '구글 가입'
  if (provider === 'email') return '이메일 가입'
  return provider ? `${provider} 가입` : null
}

/** 정리 기준 일수. 마지막 활동(최근 접속, 없으면 가입일)이 이보다 오래된 계정만. */
export const STALE_DAYS = 30

/**
 * 오래된 계정 정리 후보 판정(화면 버튼·확인창 건수와 서버 쓰기가 같은 함수). 대기·거절이고, 스테이음 관리자가 아니고,
 * 소유·참여 영업장이 없고, 아직 정리 안 했고, 마지막 활동이 STALE_DAYS 일보다 오래됐다. 정리는 삭제가 아니라 목록에서 걷기다.
 */
export function isStaleSignup(u: {
  status: AccessStatus; dbAdmin: boolean; envAdmin: boolean; ownedCount: number; roleCount: number; archived: boolean
  lastActiveAt: Date | string; isSelf?: boolean
}, now: Date = new Date()): boolean {
  if (u.isSelf || u.archived || u.dbAdmin || u.envAdmin) return false
  if (u.status === 'APPROVED') return false
  if (u.ownedCount > 0 || u.roleCount > 0) return false
  return now.getTime() - new Date(u.lastActiveAt).getTime() > STALE_DAYS * 86_400_000
}

export const ADMIN_UNDO_INVALID = '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.'
export const ADMIN_UNDO_CONFLICT = '그사이 이 계정의 권한이나 상태가 다시 바뀌어 되돌리지 않았습니다. 지금 상태를 확인해 주세요.'
