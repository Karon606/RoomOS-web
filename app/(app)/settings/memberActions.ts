'use server'

// D — 영업장 참여 코드 + 참여 요청 처리 (운영자 측).
// 기존 settings/actions.ts 의 inviteMember/updateMemberRole/removeMember 와 중복 X (그건 이메일 직접 초대).
// 여기는 "사용자가 참여 코드 입력 → 운영자 승인" 흐름 전용.

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { requireEdit, requireOwner } from '@/lib/role'
import type { UserRole } from '@prisma/client'

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

async function getMyUserId(): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const uid = data?.claims?.sub as string | undefined
  if (!uid) throw new Error('로그인이 필요합니다.')
  return uid
}

// 헷갈리는 0/O/1/I 제외한 6자
function genCode(): string {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let r = ''
  for (let i = 0; i < 6; i++) r += s[Math.floor(Math.random() * s.length)]
  return r
}

// ── 참여 코드 ────────────────────────────────────────────────────

export async function getJoinCode(): Promise<string | null> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { joinCode: true } })
  return p?.joinCode ?? null
}

// 최초 발급 — 이미 코드가 있으면 그대로 반환한다(멱등). 연타로 코드가 계속 바뀌어
// 화면 코드와 DB 코드가 갈리던 문제 방지(getOrCreateCalendarToken 과 같은 문법).
// '재발급'(기존 코드 무효화)은 의도적 행위이므로 아래 regenerateJoinCode 로 분리 — 그쪽은
// 매번 새 코드가 나오는 게 정상이고 확인 다이얼로그가 앞을 막는다.
export async function getOrCreateJoinCode(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  await requireOwner()
  const propertyId = await getPropertyId()
  const cur = await prisma.property.findUnique({ where: { id: propertyId }, select: { joinCode: true } })
  if (cur?.joinCode) return { ok: true, code: cur.joinCode }
  return regenerateJoinCode()
}

export async function regenerateJoinCode(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  await requireOwner()
  const propertyId = await getPropertyId()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode()
    try {
      await prisma.property.update({ where: { id: propertyId }, data: { joinCode: code } })
      revalidatePath('/settings')
      return { ok: true, code }
    } catch {
      // unique 충돌이면 재시도
    }
  }
  return { ok: false, error: '코드 발급 실패. 다시 시도해주세요.' }
}

// ── 참여 요청 ────────────────────────────────────────────────────

export async function listJoinRequests() {
  await requireEdit()
  const propertyId = await getPropertyId()
  return prisma.joinRequest.findMany({
    where: { propertyId, status: 'PENDING' },
    select: {
      id: true,
      role: true,
      message: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, realName: true, phone: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function approveJoinRequest(requestId: string, role: UserRole = 'STAFF'): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner()
  const propertyId = await getPropertyId()
  const me = await getMyUserId()

  const req = await prisma.joinRequest.findUnique({ where: { id: requestId } })
  if (!req || req.propertyId !== propertyId) return { ok: false, error: '요청을 찾을 수 없습니다.' }
  if (req.status !== 'PENDING') return { ok: false, error: '이미 처리된 요청입니다.' }

  await prisma.$transaction(async tx => {
    const existing = await tx.userPropertyRole.findUnique({
      where: { userId_propertyId: { userId: req.userId, propertyId } },
    })
    if (existing) {
      await tx.userPropertyRole.update({ where: { id: existing.id }, data: { role } })
    } else {
      await tx.userPropertyRole.create({ data: { userId: req.userId, propertyId, role } })
    }
    await tx.joinRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', role, decidedAt: new Date(), decidedBy: me },
    })
  })

  revalidatePath('/settings')
  return { ok: true }
}

export async function rejectJoinRequest(requestId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner()
  const propertyId = await getPropertyId()
  const me = await getMyUserId()

  const req = await prisma.joinRequest.findUnique({ where: { id: requestId } })
  if (!req || req.propertyId !== propertyId) return { ok: false, error: '요청을 찾을 수 없습니다.' }
  if (req.status !== 'PENDING') return { ok: false, error: '이미 처리된 요청입니다.' }

  await prisma.joinRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedBy: me },
  })
  revalidatePath('/settings')
  return { ok: true }
}
