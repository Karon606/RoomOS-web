'use client'

// 현재 영업장에서의 내 역할을 클라이언트에 내리는 컨텍스트 — 뷰어(STAFF)에게 편집 버튼을 숨기기 위한 가드용.
// (감사 D3, 2026-07-10: 서버 액션 requireEdit만 있고 클라 가드가 없어 직원이 눌러봐야 실패를 알던 문제)
import { createContext, useContext, type ReactNode } from 'react'
import type { Role } from '@/lib/role-types'
import { canEditScope, canReadScope, type WriteScope, type ReadScope } from '@/lib/auth/routeScope'

const RoleContext = createContext<Role>('OWNER')   // 폴백 OWNER — 로딩 실패 시 버튼을 숨기지 않음(서버가 최종 방어)

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
}

/** 편집 가능 여부 — OWNER/MANAGER true, STAFF(뷰어) false. UI 노출 제어 전용(권한 최종 검증은 서버). */
export function useCanEdit(): boolean {
  const role = useContext(RoleContext)
  return role === 'OWNER' || role === 'MANAGER'
}

/** 스코프별 편집 가능 — 전면 편집이거나 그 스코프 쓰기 보유(제한 스태프 재고). 서버가 최종 방어. */
export function useCanEditScope(scope: WriteScope): boolean {
  const role = useContext(RoleContext)
  return role === 'OWNER' || role === 'MANAGER' || canEditScope(role, scope)
}

/** 내 역할(클라 UI 분기용 — 금액 마스킹·내비 등). 최종 방어는 서버. */
export function useMyRole(): Role {
  return useContext(RoleContext)
}

/** 민감 데이터 읽기 가능 — 제한 스태프는 'money' 차단. UI 마스킹 전용, 서버 redact가 최종 방어. */
export function useCanReadScope(scope: ReadScope): boolean {
  const role = useContext(RoleContext)
  return canReadScope(role, scope)
}
