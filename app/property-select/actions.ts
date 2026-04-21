'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'

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
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) redirect('/login')
    const user = session.user

    const hasAccess = await prisma.userPropertyRole.findFirst({
      where: { userId: user.id, propertyId },
    })
    if (!hasAccess) return { ok: false, error: '접근 권한이 없습니다.' }

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
    const { isRedirectError } = await import('next/dist/client/components/redirect')
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function createProperty(name: string): Promise<{ ok: true; propertyId: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: '로그인이 필요합니다.' }

    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '영업장 이름을 입력해주세요.' }

    const property = await prisma.property.create({
      data: { name: trimmed, ownerId: user.id },
    })

    await prisma.userPropertyRole.create({
      data: { userId: user.id, propertyId: property.id, role: 'OWNER' },
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