import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { isSuperAdminEmail } from '@/lib/auth/access'
import type { Role } from '@/lib/role-types'

/**
 * 영업장 격리의 단일 관문 (보안 감사 2026-07-04 후속).
 *
 * 배경: 각 액션 파일의 로컬 getPropertyId()가 쿠키 selected_property_id 를
 * 멤버십 재검증 없이 신뢰 → 인증된 사용자가 남의 영업장 UUID 를 쿠키에 실어
 * 보내면 읽기 접근이 가능했다(격리가 UUID 비밀성에 의존). 여기서 매 요청
 * userId×propertyId 소속을 확인해 접근통제를 ID 비밀성에서 분리한다.
 *
 * 허용 경로: ① UserPropertyRole 행(일반 멤버, PK 조회 1회)
 *           ② property.ownerId(역할 행 없는 레거시 소유주)
 *           ③ 슈퍼관리자(전 영업장 OWNER 간주 — 레이아웃의 관리자 뷰와 동일 규칙)
 * React cache() 로 같은 요청 안에서는 1회만 조회한다.
 */

export type PropertyAccess = {
  userId: string
  email: string | null
  propertyId: string
  role: Role
  isSuperAdmin: boolean
}

type LoadResult =
  | { ok: true; access: PropertyAccess }
  | { ok: false; reason: 'unauthenticated' | 'no-property' | 'no-membership' }

const load = cache(async (): Promise<LoadResult> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  const userId = claims?.sub as string | undefined
  if (!userId) return { ok: false, reason: 'unauthenticated' }
  const email = (claims?.email as string | undefined) ?? null

  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) return { ok: false, reason: 'no-property' }

  const membership = await prisma.userPropertyRole.findUnique({
    where: { userId_propertyId: { userId, propertyId } },
    select: { role: true },
  })
  if (membership) {
    // env 슈퍼관리자는 역할 행이 있어도 OWNER 로 승격 (getMyRole 기존 동작 유지)
    const superByEnv = isSuperAdminEmail(email)
    return {
      ok: true,
      access: {
        userId, email, propertyId,
        role: superByEnv ? 'OWNER' : (membership.role as Role),
        isSuperAdmin: superByEnv,
      },
    }
  }

  // 역할 행 없음 — 소유주(레거시) / 슈퍼관리자(DB 플래그 포함)만 허용
  const [property, me] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true, email: true } }),
  ])
  const superAdmin = isSuperAdminEmail(email ?? me?.email ?? null) || !!me?.isSuperAdmin
  if (property && (property.ownerId === userId || superAdmin)) {
    return { ok: true, access: { userId, email, propertyId, role: 'OWNER', isSuperAdmin: superAdmin } }
  }
  return { ok: false, reason: 'no-membership' }
})

/** 페이지·서버 액션용: 접근 불가면 로그인/영업장 선택으로 보낸다(기존 로컬 헬퍼들과 동일한 이동 규칙). */
export async function requirePropertyAccess(): Promise<PropertyAccess> {
  const r = await load()
  if (r.ok) return r.access
  redirect(r.reason === 'unauthenticated' ? '/login' : '/property-select')
}

/** API 라우트·선택적 컨텍스트용: 접근 불가면 null (redirect 없음). */
export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  const r = await load()
  return r.ok ? r.access : null
}
