import { createClient } from './supabase/server'
import { cookies } from 'next/headers'
import prisma from './prisma'
import { redirect } from 'next/navigation'

export type { Role } from './role-types'
export { ROLE_LABEL } from './role-types'
import type { Role } from './role-types'

export async function getMyRole(): Promise<Role> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')

  const record = await prisma.userPropertyRole.findUnique({
    where: { userId_propertyId: { userId: user.id, propertyId } },
    select: { role: true },
  })

  if (!record) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { ownerId: true },
    })
    return property?.ownerId === user.id ? 'OWNER' : 'STAFF'
  }

  return record.role as Role
}

export function canEdit(role: Role): boolean {
  return role === 'OWNER' || role === 'MANAGER'
}

export function canManageMembers(role: Role): boolean {
  return role === 'OWNER'
}

export async function requireEdit(): Promise<Role> {
  const role = await getMyRole()
  if (!canEdit(role)) throw new Error('수정 권한이 없습니다.')
  return role
}

export async function requireOwner(): Promise<Role> {
  const role = await getMyRole()
  if (!canManageMembers(role)) throw new Error('소유자만 접근할 수 있습니다.')
  return role
}
