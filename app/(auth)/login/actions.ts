'use server'

import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function syncUserToDB(extra?: {
  realName?: string
  phone?: string
  address?: string
  inviteCode?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const meta = user.user_metadata ?? {}
  // 이메일 인증이 켜져 있으면 signUp 직후엔 세션이 없어 이 함수가 no-op이 된다.
  // 그래서 가입 폼이 실명·연락처·초대코드를 user_metadata 에 실어두고, 첫 로그인 때 여기서 회수한다.
  const realName = extra?.realName ?? (meta.real_name as string | undefined)
  const phone = extra?.phone ?? (meta.phone as string | undefined)
  const address = extra?.address ?? (meta.address as string | undefined)
  const inviteCode = (extra?.inviteCode ?? (meta.invite_code as string | undefined) ?? '').trim().toUpperCase()

  const dbUser = await prisma.user.upsert({
    where:  { id: user.id },
    create: {
      id:        user.id,
      email:     user.email!,
      name:      meta.full_name ?? null,
      avatarUrl: meta.avatar_url ?? null,
      realName:  realName || null,
      phone:     phone    || null,
      address:   address  || null,
    },
    update: {
      name:      meta.full_name ?? null,
      avatarUrl: meta.avatar_url ?? null,
      ...(realName !== undefined && { realName: realName || null }),
      ...(phone    !== undefined && { phone:    phone    || null }),
      ...(address  !== undefined && { address:  address  || null }),
    },
    select: { id: true, status: true, inviteCode: true },
  })

  // 초대코드 자동 승인 — 아직 PENDING이고 코드 미사용 상태일 때만 1회.
  if (inviteCode && dbUser.status === 'PENDING' && !dbUser.inviteCode) {
    await redeemInviteCode(user.id, inviteCode)
  }
}

// 초대코드 적용(선착순). autoApprove 코드면 status=APPROVED. 비-server 헬퍼(export 아님).
async function redeemInviteCode(userId: string, codeStr: string) {
  await prisma.$transaction(async (tx) => {
    const code = await tx.inviteCode.findUnique({ where: { code: codeStr } })
    if (!code || !code.isActive) return
    if (code.expiresAt && code.expiresAt < new Date()) return
    if (code.maxUses > 0 && code.usedCount >= code.maxUses) return
    if (!code.autoApprove) {
      // 코드 기록만 — 승인은 운영자 수동
      await tx.user.update({ where: { id: userId }, data: { inviteCode: codeStr } })
      return
    }
    await tx.inviteCode.update({ where: { id: code.id }, data: { usedCount: { increment: 1 } } })
    await tx.user.update({
      where: { id: userId },
      data: { status: 'APPROVED', approvedAt: new Date(), inviteCode: codeStr },
    })
  })
}
