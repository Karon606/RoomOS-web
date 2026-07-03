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
// ── 영업장 오너 가드 — 이 사용자가 이 영업장의 OWNER 인지 확인(슈퍼관리자도 허용). ──
async function requirePropertyOwner(propertyId: string): Promise<{ userId: string }> {
  const ctx = await getAccessContext()
  if (!ctx) redirect('/login')
  if (ctx.isSuperAdmin) return { userId: ctx.userId }
  const role = await prisma.userPropertyRole.findUnique({
    where: { userId_propertyId: { userId: ctx.userId, propertyId } },
    select: { role: true },
  })
  const owner = role?.role === 'OWNER'
    || (await prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } }))?.ownerId === ctx.userId
  if (!owner) throw new Error('영업장 오너만 할 수 있습니다.')
  return { userId: ctx.userId }
}

// 영업장 삭제 전 영향 집계 — 사용자에게 "무엇이 지워지는지" 고지용(§9.3 임팩트 고지).
export async function getPropertyDeletionImpact(propertyId: string): Promise<
  { ok: true; name: string; counts: { rooms: number; tenants: number; payments: number; expenses: number } } | { ok: false; error: string }
> {
  try {
    await requirePropertyOwner(propertyId)
    const [property, rooms, tenants, payments, expenses] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }),
      prisma.room.count({ where: { propertyId } }),
      prisma.tenant.count({ where: { propertyId } }),
      prisma.paymentRecord.count({ where: { propertyId } }),
      prisma.expense.count({ where: { propertyId } }),
    ])
    if (!property) return { ok: false, error: '영업장을 찾을 수 없습니다.' }
    return { ok: true, name: property.name, counts: { rooms, tenants, payments, expenses } }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 운영 종료 — 되돌릴 수 있는 폐쇄(isActive=false). 데이터 유지, 목록에서 비활성 표시.
export async function deactivateProperty(propertyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePropertyOwner(propertyId)
    await prisma.property.update({ where: { id: propertyId }, data: { isActive: false } })
    // 종료한 영업장을 보고 있었다면 컨텍스트 정리 — 선택 화면으로.
    const cookieStore = await cookies()
    if (cookieStore.get('selected_property_id')?.value === propertyId) cookieStore.delete('selected_property_id')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 운영 재개 — 종료했던 영업장 다시 활성화.
export async function reactivateProperty(propertyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePropertyOwner(propertyId)
    await prisma.property.update({ where: { id: propertyId }, data: { isActive: true } })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 영구 삭제 — 되돌릴 수 없음. 이름 정확 입력 확인 필수. 연쇄(cascade)로 하위 데이터 전부 삭제.
export async function deletePropertyPermanently(
  propertyId: string,
  confirmName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePropertyOwner(propertyId)
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } })
    if (!property) return { ok: false, error: '영업장을 찾을 수 없습니다.' }
    // 오입력 방지 — 이름을 정확히 입력해야만 삭제(§9.3 파괴적 확인)
    if (confirmName.trim() !== property.name.trim()) return { ok: false, error: '영업장 이름이 일치하지 않습니다.' }
    // 모든 propertyId 관계는 onDelete: Cascade → 하위 데이터 연쇄 삭제.
    await prisma.property.delete({ where: { id: propertyId } })
    const cookieStore = await cookies()
    if (cookieStore.get('selected_property_id')?.value === propertyId) cookieStore.delete('selected_property_id')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
