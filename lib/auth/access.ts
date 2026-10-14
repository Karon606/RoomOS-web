import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

/**
 * 앱 접근 제어 (베타 게이팅 + 운영자).
 * 영업장 단위 역할(UserRole)과는 별개인 "앱 전체" 권한.
 *
 * 슈퍼관리자 식별: env `SUPER_ADMIN_EMAILS`(콤마 구분, 부트스트랩·잠김 방지) OR `User.isSuperAdmin`(DB).
 */

/** env SUPER_ADMIN_EMAILS 에 포함된 이메일인지 (대소문자 무시). */
export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const list = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}

export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export type AccessContext = {
  userId: string
  email: string | null
  status: AccessStatus
  isSuperAdmin: boolean
}

/**
 * 현재 인증된 사용자의 접근 컨텍스트. 미인증이면 null.
 * 슈퍼관리자는 status 와 무관하게 항상 APPROVED 로 간주(게이트 통과).
 */
export async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return null

  const userId = claims.sub as string
  const claimEmail = (claims.email as string | undefined) ?? null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, isSuperAdmin: true, email: true },
  })

  const isSuperAdmin = isSuperAdminEmail(claimEmail ?? user?.email) || (user?.isSuperAdmin ?? false)
  const status: AccessStatus = isSuperAdmin ? 'APPROVED' : ((user?.status as AccessStatus | undefined) ?? 'PENDING')

  return { userId, email: claimEmail ?? user?.email ?? null, status, isSuperAdmin }
}

/**
 * 계정 승인 문(영업장 무관). 영업장을 고르기 전 단계(영업장 선택·개설·참여 요청·오너 관리)와
 * 사용자 단위 쓰기(푸시 구독)가 쓴다. getAccessContext 는 상태를 돌려주기만 하고 막지 않아서,
 * 그것만 부르면 거절·대기 계정도 지나갔다(권한 감사 P0 독립 검수 M1, 2026-10-14).
 * 미인증이면 /login, 슈퍼관리자가 아니고 승인(APPROVED)이 아니면 /pending. 통과 시 컨텍스트 반환.
 */
export async function requireApprovedAccount(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  if (!ctx.isSuperAdmin && ctx.status !== 'APPROVED') redirect('/pending')
  return ctx
}

/** 슈퍼관리자 전용 라우트 가드. 미인증→/login, 권한없음→/dashboard. 통과 시 컨텍스트 반환. */
export async function requireSuperAdmin(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  if (!ctx.isSuperAdmin) redirect('/dashboard')
  return ctx
}
