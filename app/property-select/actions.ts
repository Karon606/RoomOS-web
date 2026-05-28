'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getAccessContext } from '@/lib/auth/access'

export async function getMyProperties() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const roles = await prisma.userPropertyRole.findMany({
    where:   { userId: user.id },
    include: {
      property: {
        select: {
          id:       true,
          name:     true,
          address:  true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return roles.map(r => ({
    propertyId:   r.property.id,
    propertyName: r.property.name,
    address:      r.property.address,
    isActive:     r.property.isActive,
    role:         r.role,
  }))
}

export async function selectProperty(propertyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await getAccessContext()
    if (!ctx) redirect('/login')

    // 슈퍼관리자 = 가입 여부와 무관하게 모든 영업장 진입 가능 (앱 전체 운영자 권한).
    // 일반 사용자 = UserPropertyRole 보유 시에만.
    if (!ctx.isSuperAdmin) {
      const hasAccess = await prisma.userPropertyRole.findFirst({
        where: { userId: ctx.userId, propertyId },
      })
      if (!hasAccess) return { ok: false, error: '접근 권한이 없습니다.' }
    }
    // 슈퍼관리자라도 존재하는 영업장이어야 함
    const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } })
    if (!exists) return { ok: false, error: '영업장을 찾을 수 없습니다.' }

    const cookieStore = await cookies()
    cookieStore.set('selected_property_id', propertyId, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   60 * 60 * 24 * 7,
    })

    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function createProperty(name: string): Promise<{ ok: true; propertyId: string } | { ok: false; error: string }> {
  try {
    // 베타 게이팅 — 승인된 사용자/운영자만 영업장 개설 가능
    const ctx = await getAccessContext()
    if (!ctx) return { ok: false, error: '로그인이 필요합니다.' }
    if (!ctx.isSuperAdmin && ctx.status !== 'APPROVED') {
      return { ok: false, error: '아직 승인 대기 중인 계정입니다. 운영자 승인 후 이용할 수 있어요.' }
    }

    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '영업장 이름을 입력해주세요.' }

    const property = await prisma.property.create({
      data: { name: trimmed, ownerId: ctx.userId },
    })

    await prisma.userPropertyRole.create({
      data: { userId: ctx.userId, propertyId: property.id, role: 'OWNER' },
    })

    const cookieStore = await cookies()
    cookieStore.set('selected_property_id', property.id, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   60 * 60 * 24 * 7,
    })

    return { ok: true, propertyId: property.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '개설 중 오류가 발생했습니다.' }
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const cookieStore = await cookies()
  cookieStore.delete('selected_property_id')
  redirect('/login')
}

// D — 사용자가 영업장 참여 코드를 입력해서 참여 요청을 보냄.
// 운영자가 settings에서 승인하면 UserPropertyRole 생성.
export async function requestJoinByCode(code: string, message?: string): Promise<
  | { ok: true; propertyName: string }
  | { ok: false; error: string }
> {
  try {
    const ctx = await getAccessContext()
    if (!ctx) return { ok: false, error: '로그인이 필요합니다.' }
    if (!ctx.isSuperAdmin && ctx.status !== 'APPROVED') {
      return { ok: false, error: '아직 승인 대기 중인 계정입니다. 운영자 승인 후 이용할 수 있어요.' }
    }

    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return { ok: false, error: '참여 코드를 입력해주세요.' }

    const property = await prisma.property.findUnique({
      where: { joinCode: trimmed },
      select: { id: true, name: true, ownerId: true },
    })
    if (!property) return { ok: false, error: '유효하지 않은 코드입니다.' }
    if (property.ownerId === ctx.userId) {
      return { ok: false, error: '본인이 소유한 영업장입니다.' }
    }

    const existingRole = await prisma.userPropertyRole.findUnique({
      where: { userId_propertyId: { userId: ctx.userId, propertyId: property.id } },
    })
    if (existingRole) return { ok: false, error: '이미 이 영업장의 구성원입니다.' }

    // 같은 (영업장, 사용자) 요청은 1개. PENDING 갱신 또는 신규 생성.
    await prisma.joinRequest.upsert({
      where: { propertyId_userId: { propertyId: property.id, userId: ctx.userId } },
      update: {
        status: 'PENDING',
        message: (message ?? '').trim() || null,
        decidedAt: null,
        decidedBy: null,
      },
      create: {
        propertyId: property.id,
        userId: ctx.userId,
        status: 'PENDING',
        message: (message ?? '').trim() || null,
      },
    })

    return { ok: true, propertyName: property.name }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}