// 역할 기반 스코프 리졸버 — 순수 모듈(서버·클라 공유). 서버 게이트와 클라 훅이 같은 규칙을 쓴다.
// 제한 스태프(LIMITED_STAFF): 재고만 쓰기, 금액 읽기 차단, 허용 라우트 화이트리스트(오류신고 65992b0a).
// 1단계는 역할 프리셋. 2단계에서 사용자별 커스터마이즈가 필요하면 이 리졸버 내부만 컬럼 조회로 교체한다.

import type { Role } from '@/lib/role-types'

// ── 쓰기 스코프 ────────────────────────────────────────────────
export type WriteScope = 'inventory'

// 역할 → 허용 쓰기 스코프. 여기 없는 역할은 스코프 쓰기 없음(canEdit 전면 쓰기와 별개).
const WRITE_SCOPE_PRESET: Partial<Record<Role, ReadonlySet<WriteScope>>> = {
  LIMITED_STAFF: new Set(['inventory']),
}

export function canEditScope(role: Role, scope: WriteScope): boolean {
  return WRITE_SCOPE_PRESET[role]?.has(scope) ?? false
}

// ── 읽기 스코프(민감 데이터 차단) ─────────────────────────────
// 쓰기와 별도 맵 — 재고 쓰기 부여가 금액 읽기로 전이되지 않게(누수 방지, 적대검증 필수).
export type ReadScope = 'money'

const READ_SCOPE_DENY: Partial<Record<Role, ReadonlySet<ReadScope>>> = {
  LIMITED_STAFF: new Set(['money']),
}

export function canReadScope(role: Role, scope: ReadScope): boolean {
  return !(READ_SCOPE_DENY[role]?.has(scope))
}

// ── 라우트 접근(화이트리스트, 기본 차단) ──────────────────────
// 제한 스태프가 접근 가능한 경로 접두어. 새 라우트는 기본 차단(안전측).
const LIMITED_STAFF_ROUTES: readonly string[] = [
  '/inventory', '/room-manage', '/tenants', '/requests', '/search',
]

export function canAccessRoute(role: Role, pathname: string): boolean {
  if (role !== 'LIMITED_STAFF') return true   // 그 외 역할은 전 라우트 허용(현행 유지)
  return LIMITED_STAFF_ROUTES.some(p => pathname === p || pathname.startsWith(p + '/'))
}

// 역할별 홈(차단 라우트 리다이렉트·로고 목적지)
export function roleHome(role: Role): string {
  return role === 'LIMITED_STAFF' ? '/inventory' : '/dashboard'
}
