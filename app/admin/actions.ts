'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma, { type PrismaDb } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { requireSuperAdmin, isSuperAdminEmail } from '@/lib/auth/access'
import { signUndoBody, verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import {
  ADMIN_USER_UNDO_DOMAIN, ADMIN_UNDO_SCOPE, ADMIN_UNDO_CONFLICT, ADMIN_UNDO_INVALID,
  adminChangeBlock, canonicalAdminUserUndo, parseAdminUserUndo, sameSnap, snapOf,
  STAFF_ROLES, isStaleSignup,
  type AccessStatus, type AdminUserUndo, type RoleChange, type UserAccessSnap,
} from '@/lib/adminAccess'
import type { Role } from '@/lib/role-types'
import { readAuthMeta } from '@/lib/adminSignups'

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
  const admin = await requireSuperAdmin()
  const [users, propertyCount, myProperties, authMeta, archives] = await Promise.all([
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
    myOwnedProperties(admin.userId),
    readAuthMeta(),
    prisma.userArchive.findMany({ select: { userId: true, archivedAt: true } }),
  ])
  const archivedAt = new Map(archives.map(a => [a.userId, a.archivedAt]))
  return {
    users: users.map(u => ({
      ...u,
      envAdmin: isSuperAdminEmail(u.email),
      provider: authMeta.get(u.id)?.provider ?? null,
      lastSignInAt: authMeta.get(u.id)?.lastSignInAt ?? null,
      archivedAt: archivedAt.get(u.id) ?? null,
    })),
    propertyCount,
    myProperties,
  }
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

// ── 승인 + 내 영업장 직원으로도 추가 (갈림길 E, 2026-11-04 운영자 승인 '추천대로') ──
// 승인 확인창의 '내 영업장 직원으로도 추가'(기본 꺼짐). 켜면 승인과 역할 줄을 한 트랜잭션에 쓰고 적용취소도 한 벌이다.
// 자기 영업장을 따로 만들어 운영할 사람(구관기 님 사례)은 끈 채로 승인한다. 넣을 수 있는 영업장은 관리자 본인이 소유한 활성 영업장뿐이다.
async function myOwnedProperties(adminId: string) {
  return prisma.property.findMany({
    where: { isActive: true, OR: [{ ownerId: adminId }, { userRoles: { some: { userId: adminId, role: 'OWNER' } } }] },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function approveUser(userId: string, addMember?: { propertyId: string; role: Role } | null): Promise<AdminResult> {
  const admin = await requireSuperAdmin()
  if (addMember) {
    if (!STAFF_ROLES.includes(addMember.role)) return { ok: false, error: '넣을 수 없는 역할입니다.' }
    if (!(await myOwnedProperties(admin.userId)).some(p => p.id === addMember.propertyId)) {
      return { ok: false, error: '내가 소유한 영업장에만 직원으로 넣을 수 있습니다.' }
    }
  }
  const res = await prisma.$transaction(async (tx) => {
    const cur = await tx.user.findUnique({ where: { id: userId }, select: ACCESS_SELECT })
    if (!cur) return { ok: false as const, error: '가입자를 찾지 못했습니다. 새로고침 후 다시 확인해 주세요.' }
    const block = adminChangeBlock('status', { isSelf: userId === admin.userId, dbAdmin: cur.isSuperAdmin, envAdmin: isSuperAdminEmail(cur.email) })
    if (block) return { ok: false as const, error: block }
    if (cur.status === 'APPROVED') return { ok: false as const, error: '이미 승인된 계정입니다.' }
    const before = snapOf(cur)
    const upd = await tx.user.update({
      where: { id: userId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: admin.userId }, select: ACCESS_SELECT,
    })
    const after = snapOf(upd)
    let role: RoleChange | undefined
    if (addMember) {
      const existing = await tx.userPropertyRole.findUnique({
        where: { userId_propertyId: { userId, propertyId: addMember.propertyId } }, select: { role: true },
      })
      // 이미 그 영업장 구성원이면 역할을 바꾸지 않는다(승인만). 역할 변경은 멤버 관리의 몫이다.
      if (!existing) {
        await tx.userPropertyRole.create({ data: { userId, propertyId: addMember.propertyId, role: addMember.role } })
        role = { propertyId: addMember.propertyId, before: null, after: addMember.role }
      }
    }
    await writeAudit(tx, admin.userId, userId, 'APPROVE', before, { ...after, role: role ?? null })
    return { ok: true as const, undo: signAdminUndo({ userId, before, after, ...(role ? { role } : {}) }) }
  })
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

// ── 오래된 계정 정리 (갈림길 F, 2026-11-04 운영자 승인 '추천대로') ──
// 자동 삭제가 아니라 관리자가 누르는 정리다. 계정·로그인은 그대로 두고 목록에서만 걷는다(user_archives 행). 대기·거절 계정은
// 이미 게이트에서 막히므로 피해가 없고, 정리는 목록을 읽기 쉽게 하는 일이다. 후보 판정은 화면과 같은 정본 isStaleSignup 이고
// 서버가 다시 센다. 화면이 넘긴 id 중 지금도 후보인 것만 걷는다. 적용취소는 그때 걷은 행만(같은 시각 도장) 되살린다.
async function staleCandidateIds(adminId: string, now: Date): Promise<string[]> {
  const [users, authMeta, archives] = await Promise.all([
    prisma.user.findMany({
      where: { status: { in: ['PENDING', 'REJECTED'] }, isSuperAdmin: false },
      select: { id: true, email: true, status: true, createdAt: true, _count: { select: { ownedProperties: true, propertyRoles: true } } },
    }),
    readAuthMeta(),
    prisma.userArchive.findMany({ select: { userId: true } }),
  ])
  const archived = new Set(archives.map(a => a.userId))
  return users.filter(u => isStaleSignup({
    status: u.status as AccessStatus, dbAdmin: false, envAdmin: isSuperAdminEmail(u.email), isSelf: u.id === adminId,
    ownedCount: u._count.ownedProperties, roleCount: u._count.propertyRoles, archived: archived.has(u.id),
    lastActiveAt: authMeta.get(u.id)?.lastSignInAt ?? u.createdAt,
  }, now)).map(u => u.id)
}

export async function archiveStaleSignups(ids: string[]): Promise<{ ok: true; count: number; undo: { ids: string[]; at: string } } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin()
  const now = new Date()
  const want = new Set(Array.isArray(ids) ? ids.filter(x => typeof x === 'string') : [])
  const target = (await staleCandidateIds(admin.userId, now)).filter(id => want.has(id))
  if (target.length === 0) return { ok: false, error: '정리할 계정이 없습니다. 새로고침 후 다시 확인해 주세요.' }
  await prisma.$transaction(async (tx) => {
    await tx.userArchive.createMany({ data: target.map(userId => ({ userId, archivedAt: now, archivedBy: admin.userId })), skipDuplicates: true })
    await tx.adminAuditLog.createMany({ data: target.map(targetUserId => ({ actorId: admin.userId, targetUserId, action: 'ARCHIVE', before: Prisma.DbNull, after: { archivedAt: now.toISOString() } })) })
  })
  revalidatePath('/admin/users')
  return { ok: true, count: target.length, undo: { ids: target, at: now.toISOString() } }
}

// 정리 적용취소(토스트) 와 한 계정 되살리기(정리됨 카드)가 같은 길이다. at 을 주면 그 시각에 걷은 행만 되살린다.
export async function unarchiveSignups(ids: string[], at?: string | null): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin()
  const list = Array.isArray(ids) ? ids.filter(x => typeof x === 'string').slice(0, 500) : []
  const stamp = at ? new Date(at) : null
  if (stamp && Number.isNaN(stamp.getTime())) return { ok: false, error: ADMIN_UNDO_INVALID }
  const count = await prisma.$transaction(async (tx) => {
    const rows = await tx.userArchive.findMany({ where: { userId: { in: list }, ...(stamp ? { archivedAt: stamp } : {}) }, select: { userId: true, archivedAt: true } })
    if (rows.length === 0) return 0
    await tx.userArchive.deleteMany({ where: { userId: { in: rows.map(r => r.userId) } } })
    await tx.adminAuditLog.createMany({ data: rows.map(r => ({ actorId: admin.userId, targetUserId: r.userId, action: 'UNARCHIVE', before: { archivedAt: r.archivedAt.toISOString() }, after: Prisma.DbNull })) })
    return rows.length
  })
  revalidatePath('/admin/users')
  return count > 0 ? { ok: true, count } : { ok: false, error: '그사이 이미 되살렸거나 다시 정리돼 되돌리지 않았습니다.' }
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

// 켜고 끄기. 토스트 [적용취소]는 같은 함수로 직전 값을 다시 쓴다(값을 지정해 쓰므로 두 번 눌러도 같다).
export async function toggleInviteCode(id: string, isActive: boolean) {
  await requireSuperAdmin()
  await prisma.inviteCode.update({ where: { id }, data: { isActive } })
  revalidatePath('/admin/invites')
  return { ok: true as const }
}

// 발급 적용취소. 아직 아무도 안 쓴 코드만 지운다(누가 이미 썼으면 거부, 그 가입의 근거가 사라지면 안 된다).
export async function undoCreateInviteCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperAdmin()
  const n = await prisma.inviteCode.deleteMany({ where: { code, usedCount: 0 } })
  revalidatePath('/admin/invites')
  return n.count === 1 ? { ok: true } : { ok: false, error: '그사이 이 코드로 가입한 사람이 있어 지우지 않았습니다.' }
}

export type InviteCodeSnap = {
  id: string; code: string; note: string | null; maxUses: number; usedCount: number; autoApprove: boolean
  isActive: boolean; expiresAt: string | null; createdAt: string; createdBy: string | null
}

// 삭제. 지운 행 전체를 돌려주어 토스트 [적용취소]가 그대로 되살린다(restoreInviteCode).
export async function deleteInviteCode(id: string): Promise<{ ok: true; snap: InviteCodeSnap } | { ok: false; error: string }> {
  await requireSuperAdmin()
  const row = await prisma.inviteCode.findUnique({ where: { id } })
  if (!row) return { ok: false, error: '코드를 찾지 못했습니다. 새로고침 후 다시 확인해 주세요.' }
  await prisma.inviteCode.delete({ where: { id } })
  revalidatePath('/admin/invites')
  return {
    ok: true,
    snap: {
      id: row.id, code: row.code, note: row.note, maxUses: row.maxUses, usedCount: row.usedCount, autoApprove: row.autoApprove,
      isActive: row.isActive, expiresAt: row.expiresAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), createdBy: row.createdBy,
    },
  }
}

// 삭제 적용취소. 같은 코드가 그사이 다시 생겼으면 거부한다(덮지 않는다).
export async function restoreInviteCode(snap: InviteCodeSnap): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSuperAdmin()
  if (await prisma.inviteCode.findFirst({ where: { OR: [{ id: snap.id }, { code: snap.code }] }, select: { id: true } })) {
    return { ok: false, error: '같은 코드가 이미 있어 되살리지 않았습니다.' }
  }
  await prisma.inviteCode.create({
    data: {
      id: snap.id, code: snap.code, note: snap.note, maxUses: snap.maxUses, usedCount: snap.usedCount, autoApprove: snap.autoApprove,
      isActive: snap.isActive, expiresAt: snap.expiresAt ? new Date(snap.expiresAt) : null, createdAt: new Date(snap.createdAt), createdBy: snap.createdBy,
    },
  })
  revalidatePath('/admin/invites')
  return { ok: true }
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
