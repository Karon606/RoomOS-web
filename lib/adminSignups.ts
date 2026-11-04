// 스테이음 관리자 가입자 목록의 읽기 정본(server-only). 대기 건수(사이드바 링크·관리자 탭·목록 머리)와 가입 경로·최근 접속 메타.
// 대기 건수는 대기(PENDING)이고 스테이음 관리자가 아니고 정리하지 않은(user_archives 없음) 계정이다(관리자는 게이트가 늘 승인으로 본다).
import 'server-only'
import prisma from '@/lib/prisma'
import { isSuperAdminEmail } from '@/lib/auth/access'

// 앱 셸(관리자 계정의 사이드바)과 관리자 레이아웃이 기다리는 값이라, 실패해도 던지지 않고 0 을 준다(로그만).
// user_archives 표가 아직 없는 배포에서 관리자 계정의 앱 셸 전체가 500 이 되던 것을 막는다(독립 검수 B1).
export async function countPendingSignups(): Promise<number> {
  try {
    const rows = await prisma.user.findMany({
      where: { status: 'PENDING', isSuperAdmin: false },
      select: { id: true, email: true },
    })
    const archived = new Set((await prisma.userArchive.findMany({ select: { userId: true } })).map(a => a.userId))
    return rows.filter(r => !isSuperAdminEmail(r.email) && !archived.has(r.id)).length
  } catch (e) {
    console.error('[adminSignups] 대기 건수를 세지 못했습니다', (e as Error)?.message)
    return 0
  }
}

export type AuthMeta = { provider: string | null; lastSignInAt: Date | null }

/**
 * 로그인 계정(auth.users)의 가입 경로와 최근 접속. 같은 DB 의 auth 스키마를 읽기만 한다.
 * 읽을 수 없으면(권한·스키마 없음) null. 목록은 빈 메타로 서고, 최근 접속이 필요한 정리 쓰기는 거부한다(독립 검수 R3).
 */
export async function readAuthMeta(): Promise<Map<string, AuthMeta> | null> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; provider: string | null; last_sign_in_at: Date | null }[]>`
      SELECT id::text AS id, raw_app_meta_data->>'provider' AS provider, last_sign_in_at FROM auth.users`
    return new Map(rows.map(r => [r.id, { provider: r.provider, lastSignInAt: r.last_sign_in_at }]))
  } catch (e) {
    console.error('[adminSignups] auth.users 를 읽지 못했습니다', (e as Error)?.message)
    return null
  }
}
