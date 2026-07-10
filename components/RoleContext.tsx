'use client'

// 현재 영업장에서의 내 역할을 클라이언트에 내리는 컨텍스트 — 뷰어(STAFF)에게 편집 버튼을 숨기기 위한 가드용.
// (감사 D3, 2026-07-10: 서버 액션 requireEdit만 있고 클라 가드가 없어 직원이 눌러봐야 실패를 알던 문제)
import { createContext, useContext, type ReactNode } from 'react'
import type { Role } from '@/lib/role-types'

const RoleContext = createContext<Role>('OWNER')   // 폴백 OWNER — 로딩 실패 시 버튼을 숨기지 않음(서버가 최종 방어)

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
}

/** 편집 가능 여부 — OWNER/MANAGER true, STAFF(뷰어) false. UI 노출 제어 전용(권한 최종 검증은 서버). */
export function useCanEdit(): boolean {
  const role = useContext(RoleContext)
  return role === 'OWNER' || role === 'MANAGER'
}
