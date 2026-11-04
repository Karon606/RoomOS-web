// 스테이음 관리자 가입자 목록의 읽기 정본(server-only). 대기 건수(사이드바 링크·관리자 탭·목록 머리)와 가입 경로·최근 접속 메타.
// 대기 건수는 대기(PENDING)이고 스테이음 관리자가 아니고 정리하지 않은(user_archives 없음) 계정이다(관리자는 게이트가 늘 승인으로 본다).
import 'server-only'
import prisma from '@/lib/prisma'
import { isSuperAdminEmail } from '@/lib/auth/access'

export async function countPendingSignups(): Promise<number> {
  const rows = await prisma.user.findMany({
    where: { status: 'PENDING', isSuperAdmin: false },
    select: { id: true, email: true },
  })
  const archived = new Set((await prisma.userArchive.findMany({ select: { userId: true } })).map(a => a.userId))
  return rows.filter(r => !isSuperAdminEmail(r.email) && !archived.has(r.id)).length
}

export type AuthMeta = { provider: string | null; lastSignInAt: Date | null }

/**
 * 로그인 계정(auth.users)의 가입 경로와 최근 접속. 같은 DB 의 auth 스키마를 읽기만 한다.
 * 읽을 수 없으면(권한·스키마 없음) 빈 지도를 준다. 메타는 보조 정보라 목록을 막지 않는다.
 */
export async function readAuthMeta(): Promise<Map<string, AuthMeta>> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; provider: string | null; last_sign_in_at: Date | null }[]>`
      SELECT id::text AS id, raw_app_meta_data->>'provider' AS provider, last_sign_in_at FROM auth.users`
    return new Map(rows.map(r => [r.id, { provider: r.provider, lastSignInAt: r.last_sign_in_at }]))
  } catch {
    return new Map()
  }
}
