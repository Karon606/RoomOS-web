'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma, { type PrismaDb } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { requireSuperAdmin, isSuperAdminEmail } from '@/lib/auth/access'
import { signUndoBody, verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import {
  ADMIN_USER_UNDO_DOMAIN, ADMIN_UNDO_SCOPE, ADMIN_UNDO_CONFLICT, ADMIN_UNDO_INVALID,
  adminChangeBlock, canonicalAdminUserUndo, parseAdminUserUndo, sameSnap, snapOf,
  type AccessStatus, type AdminUserUndo, type UserAccessSnap,
} from '@/lib/adminAccess'

// 슈퍼관리자가 임의 영업장에 진입 (가입 여부 무관). 쿠키 설정 + /dashboard 이동.
export async function enterPropertyAsAdmin(formData: FormData) {
  await requireSuperAdmin()
  const propertyId = formData.get('propertyId') as string | null
  if (!propertyId) return
  const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } })
  if (!exists) return
  const cookieStore = await cookies()
  cookieStore.set('selected_property_id', propertyId, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 7,
  })
  redirect('/dashboard')
}

// ── 가입자 목록 ──
export async function getSignups() {
  await requireSuperAdmin()
  const [users, propertyCount] = await Promise.all([
    prisma.user.findMany({
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
    }),
    prisma.property.count(),
  ])
  return { users: users.map(u => ({ ...u, envAdmin: isSuperAdminEmail(u.email) })), propertyCount }
}

// ── 권한·상태 변경 공용 ──
// 바꾸는 쓰기·감사 기록(admin_audit_logs)·적용취소 토큰이 한 벌이다(2026-11-04 운영자 승인 '추천대로', 갈림길 B·C).
// 기록은 같은 트랜잭션이라 기록 없이 권한만 바뀌는 일이 없다. 토큰은 쓰기 전·쓴 직후 모습을 쥐고 서버가 서명한다.

type AdminResult = { ok: true; undo: AdminUserUndo | null } | { ok: false; error: string }
type Tx = Pick<PrismaDb, 'adminAuditLog'>

const ACCESS_SELECT = { id: true, email: true, status: true, isSuperAdmin: true, approvedAt: true, approvedBy: true } as const

function signAdminUndo(u: Omit<AdminUserUndo, 'sig' | 'v'>): AdminUserUndo | null {
  const body: Omit<AdminUserUndo, 'sig'> = { v: 1, ...u }
  const sig = signUndoBody(ADMIN_USER_UNDO_DOMAIN, ADMIN_UNDO_SCOPE, canonicalAdminUserUndo(body))
  if (sig === null) return null
  return { ...body, ...(sig ? { sig } : {}) }
}

async function writeAudit(tx: Tx, actorId: string, targetUserId: string, action: string, before: unknown, after: unknown) {
  await tx.adminAuditLog.create({
    data: { actorId, targetUserId, action, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
  })
}

/** 대상 행을 읽고 막힘을 판정한 뒤 patch 를 쓴다. 감사 기록과 토큰까지 한 트랜잭션. */
async function changeAccess(
  adminId: string,
  userId: string,
  kind: 'status' | 'grant' | 'revoke',
  action: string,
  patch: (before: UserAccessSnap) => { status?: AccessStatus; isSuperAdmin?: boolean; approvedAt?: Date | null; approvedBy?: string | null },
): Promise<AdminResult> {
  return prisma.$transaction(async (tx) => {
    const cur = await tx.user.findUnique({ where: { id: userId }, select: ACCESS_SELECT })
    if (!cur) return { ok: false as const, error: '가입자를 찾지 못했습니다. 새로고침 후 다시 확인해 주세요.' }
    const block = adminChangeBlock(kind, { isSelf: userId === adminId, dbAdmin: cur.isSuperAdmin, envAdmin: isSuperAdminEmail(cur.email) })
    if (block) return { ok: false as const, error: block }
    const before = snapOf(cur)
    const data = patch(before)
    const upd = await tx.user.update({ where: { id: userId }, data, select: ACCESS_SELECT })
    const after = snapOf(upd)
    await writeAudit(tx, adminId, userId, action, before, after)
    return { ok: true as const, undo: signAdminUndo({ userId, before, after }) }
  })
}

// ── 승인 상태 변경 (승인/거절/대기) ──
export async function setUserStatus(userId: string, status: AccessStatus): Promise<AdminResult> {
  const admin = await requireSuperAdmin()
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return { ok: false, error: '알 수 없는 상태입니다.' }
  const res = await changeAccess(admin.userId, userId, 'status', 'SET_STATUS', () => ({
    status,
    approvedAt: status === 'APPROVED' ? new Date() : null,
    approvedBy: admin.userId,
  }))
  revalidatePath('/admin/users')
  return res
}

// ── 스테이음 관리자 권한 주기·회수 (DB 플래그) ──
// 주면 자동 승인까지 한다(종전 규칙 유지). 적용취소는 쓰기 전 모습 전부(상태·승인 시각·승인자 포함)로 되돌린다.
export async function setSuperAdmin(userId: string, value: boolean): Promise<AdminResult> {
  const admin = await requireSuperAdmin()
  const res = value
    ? await changeAccess(admin.userId, userId, 'grant', 'GRANT_SUPER_ADMIN', (b) => ({
        isSuperAdmin: true,
        ...(b.status === 'APPROVED' ? {} : { status: 'APPROVED' as const, approvedAt: new Date(), approvedBy: admin.userId }),
      }))
    : await changeAccess(admin.userId, userId, 'revoke', 'REVOKE_SUPER_ADMIN', () => ({ isSuperAdmin: false }))
  revalidatePath('/admin/users')
  return res
}

// ── 적용취소 ──
// 지금이 '쓴 직후' 모습 그대로일 때만 '쓰기 전' 으로 돌린다. 승인과 함께 넣은 역할 줄은 그 역할 그대로일 때만 되돌린다.
export async function undoAdminUserChange(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin()
  const u = parseAdminUserUndo(raw)
  if (!u || !verifyUndoBody(ADMIN_USER_UNDO_DOMAIN, ADMIN_UNDO_SCOPE, canonicalAdminUserUndo(u), u.sig)) return { ok: false, error: ADMIN_UNDO_INVALID }
  if (u.userId === admin.userId) return { ok: false, error: ADMIN_UNDO_INVALID }
  const res = await prisma.$transaction(async (tx) => {
    const cur = await tx.user.findUnique({ where: { id: u.userId }, select: ACCESS_SELECT })
    if (!cur || !sameSnap(snapOf(cur), u.after)) return { ok: false as const, error: ADMIN_UNDO_CONFLICT }
    if (u.role) {
      const role = await tx.userPropertyRole.findUnique({
        where: { userId_propertyId: { userId: u.userId, propertyId: u.role.propertyId } }, select: { role: true },
      })
      if (role?.role !== u.role.after) return { ok: false as const, error: ADMIN_UNDO_CONFLICT }
      if (u.role.before === null) await tx.userPropertyRole.delete({ where: { userId_propertyId: { userId: u.userId, propertyId: u.role.propertyId } } })
      else await tx.userPropertyRole.update({ where: { userId_propertyId: { userId: u.userId, propertyId: u.role.propertyId } }, data: { role: u.role.before } })
    }
    await tx.user.update({
      where: { id: u.userId },
      data: {
        status: u.before.status,
        isSuperAdmin: u.before.isSuperAdmin,
        approvedAt: u.before.approvedAt ? new Date(u.before.approvedAt) : null,
        approvedBy: u.before.approvedBy,
      },
    })
    await writeAudit(tx, admin.userId, u.userId, 'UNDO', { ...u.after, role: u.role?.after ?? null }, { ...u.before, role: u.role ? u.role.before : null })
    return { ok: true as const }
  })
  revalidatePath('/admin/users')
  return res
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
