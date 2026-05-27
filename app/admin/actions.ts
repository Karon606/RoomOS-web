'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/access'
import type { AccessStatus } from '@/lib/auth/access'

// ── 가입자 목록 ──
export async function getSignups() {
  await requireSuperAdmin()
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      realName: true,
      phone: true,
      address: true,
      status: true,
      isSuperAdmin: true,
      inviteCode: true,
      createdAt: true,
      approvedAt: true,
      _count: { select: { ownedProperties: true, propertyRoles: true } },
    },
  })
  return users
}

// ── 승인 상태 변경 (승인/거절/대기) ──
export async function setUserStatus(userId: string, status: AccessStatus) {
  const admin = await requireSuperAdmin()
  if (userId === admin.userId) {
    return { ok: false as const, error: '본인 계정 상태는 변경할 수 없습니다.' }
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      status,
      approvedAt: status === 'APPROVED' ? new Date() : null,
      approvedBy: admin.userId,
    },
  })
  revalidatePath('/admin/users')
  return { ok: true as const }
}

// ── 슈퍼관리자 토글 (DB 플래그) ──
export async function setSuperAdmin(userId: string, value: boolean) {
  const admin = await requireSuperAdmin()
  if (userId === admin.userId) {
    return { ok: false as const, error: '본인 운영자 권한은 여기서 변경할 수 없습니다.' }
  }
  await prisma.user.update({
    where: { id: userId },
    // 운영자로 지정하면 자동 승인 처리
    data: value ? { isSuperAdmin: true, status: 'APPROVED' } : { isSuperAdmin: false },
  })
  revalidatePath('/admin/users')
  return { ok: true as const }
}

// ── 초대코드/쿠폰 ──
function genCode() {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 헷갈리는 0/O/1/I 제외
  let r = ''
  for (let i = 0; i < 6; i++) r += s[Math.floor(Math.random() * s.length)]
  return 'STAY-' + r
}

export async function getInviteCodes() {
  await requireSuperAdmin()
  return prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function createInviteCode(input: {
  code?: string
  note?: string
  maxUses?: number
  autoApprove?: boolean
  expiresAt?: string | null
}) {
  const admin = await requireSuperAdmin()
  const raw = (input.code ?? '').trim().toUpperCase()
  const maxUses = Number.isFinite(input.maxUses) ? Number(input.maxUses) : 1

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = raw || genCode()
    try {
      await prisma.inviteCode.create({
        data: {
          code,
          note: input.note?.trim() || null,
          maxUses,
          autoApprove: input.autoApprove ?? true,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdBy: admin.userId,
        },
      })
      revalidatePath('/admin/invites')
      return { ok: true as const, code }
    } catch {
      // 코드 직접 지정 시 중복이면 즉시 실패, 자동생성이면 재시도
      if (raw) return { ok: false as const, error: '이미 존재하는 코드입니다.' }
      if (attempt === 4) return { ok: false as const, error: '코드 생성 실패. 다시 시도해주세요.' }
    }
  }
  return { ok: false as const, error: '코드 생성 실패.' }
}

export async function toggleInviteCode(id: string, isActive: boolean) {
  await requireSuperAdmin()
  await prisma.inviteCode.update({ where: { id }, data: { isActive } })
  revalidatePath('/admin/invites')
  return { ok: true as const }
}

export async function deleteInviteCode(id: string) {
  await requireSuperAdmin()
  await prisma.inviteCode.delete({ where: { id } })
  revalidatePath('/admin/invites')
  return { ok: true as const }
}

// ── 영업장 현황 ──
export async function getPropertiesOverview() {
  await requireSuperAdmin()
  const properties = await prisma.property.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      address: true,
      isActive: true,
      createdAt: true,
      owner: { select: { email: true, realName: true, name: true } },
      _count: {
        select: { rooms: true, tenants: true, userRoles: true },
      },
    },
  })
  return properties
}
