// 스테이음 관리자에게 보이는 '승인 대기' 건수 정본(server-only). 사이드바 링크·관리자 탭 '가입자'·가입자 목록 머리가 같은 수를 쓴다.
// 대기(PENDING)이고 스테이음 관리자가 아닌 계정이다(관리자는 게이트가 늘 승인으로 본다). 정리한 계정(user_archives)은 세지 않는다.
import 'server-only'
import prisma from '@/lib/prisma'
import { isSuperAdminEmail } from '@/lib/auth/access'

export async function countPendingSignups(): Promise<number> {
  const rows = await prisma.user.findMany({
    where: { status: 'PENDING', isSuperAdmin: false },
    select: { id: true, email: true },
  })
  return rows.filter(r => !isSuperAdminEmail(r.email)).length
}
