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

export async function selectProperty(propertyId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const hasAccess = await prisma.userPropertyRole.findFirst({
    where: { userId: user.id, propertyId },
  })

  if (!hasAccess) throw new Error('접근 권한이 없습니다.')

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

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const cookieStore = await cookies()
  cookieStore.delete('selected_property_id')
  redirect('/login')
}