// 로그인한 사람의 앱 users 행 보장 정본(server-only). 콜백·로그인 동기화·계정 관문(getAccessContext)이 모두 이 함수를 부른다.
//
// 왜(2026-11-04 운영자 승인 '추천대로', 구관기 님 이메일 가입). 행을 만드는 자리가 콜백과 로그인 직후 서버 액션 둘뿐이었고, 둘 다 빠질 수 있었다.
//   · 이메일 인증 링크가 콜백이 아니라 첫 화면으로 돌아와 코드를 교환하지 않았다(콜백을 안 거침).
//   · 비밀번호 로그인 직후의 서버 액션은 proxy 가 로그인 상태의 /login 요청을 앱으로 307 보내면서 실행되지 않았다(재현 확정, proxy.ts 주석).
// 그러면 로그인은 됐는데 행이 없어, 게이트는 대기로 보고 /pending 에 세우는데 관리자 목록(users 표)에는 그 사람이 없었다.
// 그래서 관문이 행이 없는 신원을 보면 여기서 만든다. 어떤 경로로 로그인했든 관리자 목록에 반드시 선다.
//
// 규칙.
//   · 없으면 만든다(대기). 이미 있으면 상태·관리자 표식은 절대 안 덮는다. refreshProfile 일 때만 이름·사진(그리고 넘긴 칸)을 고친다.
//   · 실명·연락처·주소·초대코드는 넘긴 값(extra) 다음 user_metadata 에서 회수한다(이메일 가입 폼이 메타데이터에 실어 둔다).
//   · 초대코드는 아직 대기이고 코드를 안 쓴 계정에만 한 번 적용한다(자동 승인 코드면 승인).
//   · 같은 이메일의 다른 행이 이미 있으면(지워졌다 다시 만든 인증 계정 등) 만들지 않고 null 을 준다. 관문은 대기로 본다.
import 'server-only'
import prisma from '@/lib/prisma'
import type { AccessStatus } from '@/lib/adminAccess'

export type AuthIdentity = {
  id: string
  email: string | null
  userMeta: Record<string, unknown>
  provider: string | null
}

export type SignupExtra = { realName?: string; phone?: string; address?: string; inviteCode?: string }

/** JWT 클레임에서 신원을 꺼낸다(Supabase 액세스 토큰은 user_metadata·app_metadata 를 싣는다). */
export function identityFromClaims(claims: Record<string, unknown>): AuthIdentity {
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>
  return {
    id: claims.sub as string,
    email: (claims.email as string | undefined) ?? null,
    userMeta: (claims.user_metadata ?? {}) as Record<string, unknown>,
    provider: typeof app.provider === 'string' ? app.provider : null,
  }
}

/** supabase auth 사용자 객체에서 신원을 꺼낸다(콜백·로그인 동기화). */
export function identityFromAuthUser(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null }): AuthIdentity {
  const app = user.app_metadata ?? {}
  return { id: user.id, email: user.email ?? null, userMeta: user.user_metadata ?? {}, provider: typeof app.provider === 'string' ? app.provider : null }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export type EnsureResult = { created: boolean; status: AccessStatus | null }

export async function ensureAppUser(idn: AuthIdentity, opts?: { extra?: SignupExtra; refreshProfile?: boolean }): Promise<EnsureResult> {
  if (!idn.email) return { created: false, status: null }
  const meta = idn.userMeta
  const extra = opts?.extra
  const realName = extra?.realName ?? str(meta.real_name)
  const phone = extra?.phone ?? str(meta.phone)
  const address = extra?.address ?? str(meta.address)
  const inviteCode = (extra?.inviteCode ?? str(meta.invite_code) ?? '').trim().toUpperCase()
  const name = str(meta.full_name) ?? null
  const avatarUrl = str(meta.avatar_url) ?? null

  const SELECT = { id: true, status: true, inviteCode: true } as const
  let row = await prisma.user.findUnique({ where: { id: idn.id }, select: SELECT })
  let created = false
  if (!row) {
    // 같은 이메일의 다른 행(다른 id)이 있으면 만들지 않는다. 덮으면 남의 행을 가로챈다.
    const sameEmail = await prisma.user.findUnique({ where: { email: idn.email }, select: { id: true } })
    if (sameEmail) return { created: false, status: null }
    try {
      row = await prisma.user.create({
        data: { id: idn.id, email: idn.email, name, avatarUrl, realName: realName || null, phone: phone || null, address: address || null },
        select: SELECT,
      })
      created = true
    } catch (e) {
      // 동시에 두 요청이 만들었거나(같은 id), 같은 이메일의 다른 행이 있다(다른 id). 앞의 경우만 행을 다시 읽는다.
      if ((e as { code?: string })?.code !== 'P2002') throw e
      row = await prisma.user.findUnique({ where: { id: idn.id }, select: SELECT })
      if (!row) return { created: false, status: null }
    }
  } else if (opts?.refreshProfile) {
    await prisma.user.update({
      where: { id: idn.id },
      data: {
        name,
        avatarUrl,
        ...(realName !== undefined && { realName: realName || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(address !== undefined && { address: address || null }),
      },
    })
  }

  let status = row.status as AccessStatus
  // 초대코드 자동 승인 — 아직 대기이고 코드 미사용 상태일 때만 1회.
  if (inviteCode && status === 'PENDING' && !row.inviteCode) {
    status = await redeemInviteCode(idn.id, inviteCode)
  }
  return { created, status }
}

// 초대코드 적용(선착순). autoApprove 코드면 status=APPROVED. 적용 뒤 상태를 돌려준다.
async function redeemInviteCode(userId: string, codeStr: string): Promise<AccessStatus> {
  return prisma.$transaction(async (tx) => {
    const code = await tx.inviteCode.findUnique({ where: { code: codeStr } })
    const usable = !!code && code.isActive && !(code.expiresAt && code.expiresAt < new Date()) && !(code.maxUses > 0 && code.usedCount >= code.maxUses)
    if (!code || !usable) return 'PENDING' as const
    if (!code.autoApprove) {
      // 코드 기록만 — 승인은 스테이음 관리자가 손으로
      await tx.user.update({ where: { id: userId }, data: { inviteCode: codeStr } })
      return 'PENDING' as const
    }
    await tx.inviteCode.update({ where: { id: code.id }, data: { usedCount: { increment: 1 } } })
    await tx.user.update({ where: { id: userId }, data: { status: 'APPROVED', approvedAt: new Date(), inviteCode: codeStr } })
    return 'APPROVED' as const
  })
}
