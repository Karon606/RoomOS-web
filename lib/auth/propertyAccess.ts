import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { isSuperAdminEmail } from '@/lib/auth/access'
// 역할 판정 정본(순수). 크론 푸시(app/api/cron/push-alerts)도 같은 함수로 역할을 정한다(env 슈퍼관리자 승격 경계 한 벌).
import { resolvePropertyRole } from '@/lib/auth/resolveRole'
import type { Role } from '@/lib/role-types'

/**
 * 영업장 격리의 단일 관문 (보안 감사 2026-07-04 후속).
 *
 * 배경: 각 액션 파일의 로컬 getPropertyId()가 쿠키 selected_property_id 를
 * 멤버십 재검증 없이 신뢰 → 인증된 사용자가 남의 영업장 UUID 를 쿠키에 실어
 * 보내면 읽기 접근이 가능했다(격리가 UUID 비밀성에 의존). 여기서 매 요청
 * userId×propertyId 소속을 확인해 접근통제를 ID 비밀성에서 분리한다.
 *
 * 허용 경로: ① UserPropertyRole 행(일반 멤버. 사용자·영업장 행과 함께 PK 조회 셋을 병렬 1회)
 *           ② property.ownerId(역할 행 없는 레거시 소유주)
 *           ③ 슈퍼관리자(전 영업장 OWNER 간주 — 레이아웃의 관리자 뷰와 동일 규칙)
 * 계정 승인 상태(User.status)도 여기서 본다(권한 감사 P0, 2026-10-14). 종전에는 (app) 레이아웃만 봐서
 * 거절·대기로 돌린 계정이 화면만 /pending 으로 가고 서버 액션·API 는 계속 썼다. 규칙은 레이아웃과 같다.
 * 승인(APPROVED)이거나 슈퍼관리자(env 또는 DB 플래그)여야 통과한다. 사용자 행이 없으면 승인 아님이다.
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
  | { ok: false; reason: 'unauthenticated' | 'not-approved' | 'no-property' | 'no-membership' }

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

  // 역할 행·사용자(승인 상태)·영업장 소유주를 병렬로 한 번에 읽는다. Prisma relationJoins 가 꺼져 있어
  // 관계 select(역할 행 안의 user)는 SQL 두 개를 차례로 낸다. 셋을 Promise.all 로 묶으면 어느 갈래든
  // DB 왕복이 한 번이다(역할 행 없는 갈래는 종전 순차 2회). 판정식은 갈래마다 종전과 같다.
  const [membership, me, property] = await Promise.all([
    prisma.userPropertyRole.findUnique({
      where: { userId_propertyId: { userId, propertyId } },
      select: { role: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true, email: true, status: true } }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } }),
  ])
  if (membership) {
    // env 슈퍼관리자는 역할 행이 있어도 OWNER 로 승격 (getMyRole 기존 동작 유지)
    const superByEnv = isSuperAdminEmail(email)
    if (!superByEnv && !me?.isSuperAdmin && me?.status !== 'APPROVED') {
      return { ok: false, reason: 'not-approved' }
    }
    return {
      ok: true,
      access: {
        userId, email, propertyId,
        // 역할 줄이 있으면 그 역할, env 슈퍼관리자면 소유자(정본 resolvePropertyRole). 역할 줄이 있으면 null 이 없다.
        role: resolvePropertyRole({ membershipRole: membership.role as Role, isOwner: property?.ownerId === userId, superByEnv }) as Role,
        isSuperAdmin: superByEnv,
      },
    }
  }

  // 역할 행 없음 — 소유주(레거시) / 슈퍼관리자(DB 플래그 포함)만 허용
  const superByEnvNoRow = isSuperAdminEmail(email ?? me?.email ?? null)
  const superAdmin = superByEnvNoRow || !!me?.isSuperAdmin
  if (!superAdmin && me?.status !== 'APPROVED') return { ok: false, reason: 'not-approved' }
  // 역할 줄이 없으면 소유주·슈퍼관리자만 소유자, 나머지는 접근 없음(정본 resolvePropertyRole). 영업장 행이 없으면 접근 없음.
  const noRowRole = property
    ? resolvePropertyRole({ membershipRole: null, isOwner: property.ownerId === userId, superByEnv: superByEnvNoRow, superByDb: !!me?.isSuperAdmin })
    : null
  if (noRowRole) {
    return { ok: true, access: { userId, email, propertyId, role: noRowRole, isSuperAdmin: superAdmin } }
  }
  return { ok: false, reason: 'no-membership' }
})

/** 페이지·서버 액션용: 접근 불가면 로그인/승인 대기/영업장 선택으로 보낸다(레이아웃 게이트와 같은 이동 규칙). */
export async function requirePropertyAccess(): Promise<PropertyAccess> {
  const r = await load()
  if (r.ok) return r.access
  redirect(r.reason === 'unauthenticated' ? '/login' : r.reason === 'not-approved' ? '/pending' : '/property-select')
}

/** API 라우트·선택적 컨텍스트용: 접근 불가면 null (redirect 없음). */
export async function getPropertyAccess(): Promise<PropertyAccess | null> {
  const r = await load()
  return r.ok ? r.access : null
}
