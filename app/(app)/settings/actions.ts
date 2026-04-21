'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getMyRole, requireEdit, requireOwner } from '@/lib/role'
import { ROLE_LABEL, type Role } from '@/lib/role-types'

export { getMyRole }

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

async function getMyUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user.id
}

export async function getPropertySettings() {
  const propertyId = await getPropertyId()
  return prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      acquisitionDate: true,
      defaultDeposit: true,
      defaultCleaningFee: true,
    },
  })
}

export async function getRoomTypeOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { roomTypeOptions: true },
  })
  const raw = (property as any)?.roomTypeOptions ?? '원룸,미니룸'
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addRoomTypeOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomTypeOptions()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { roomTypeOptions: updated } as any,
  })
  revalidatePath('/room-manage')
}

export async function deleteRoomTypeOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomTypeOptions()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { roomTypeOptions: updated } as any,
  })
  revalidatePath('/room-manage')
}

// ── 창문 유형 관리 ─────────────────────────────────────────────────

export async function getWindowTypeOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { windowTypeOptions: true },
  })
  const raw = (property as any)?.windowTypeOptions ?? 'WINDOW,NO_WINDOW'
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addWindowTypeOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getWindowTypeOptions()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { windowTypeOptions: updated } as any,
  })
  revalidatePath('/room-manage')
}

export async function deleteWindowTypeOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getWindowTypeOptions()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { windowTypeOptions: updated } as any,
  })
  revalidatePath('/room-manage')
}

// ── 부가수익 카테고리 관리 ──────────────────────────────────────────

export async function getIncomeCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { incomeCategories: true },
  })
  const raw = (property as any)?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addIncomeCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getIncomeCategories()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { incomeCategories: updated } as any,
  })
  revalidatePath('/finance')
}

export async function deleteIncomeCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getIncomeCategories()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { incomeCategories: updated } as any,
  })
  revalidatePath('/finance')
}

// ── 멤버 관리 ─────────────────────────────────────────────────────

export type MemberWithUser = {
  userId: string
  role: Role
  roleLabel: string
  email: string
  name: string | null
  avatarUrl: string | null
}

export async function getMembers(): Promise<MemberWithUser[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.userPropertyRole.findMany({
    where: { propertyId },
    include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(r => ({
    userId: r.userId,
    role: r.role as Role,
    roleLabel: ROLE_LABEL[r.role as Role],
    email: r.user.email,
    name: r.user.name,
    avatarUrl: r.user.avatarUrl,
  }))
}

export async function inviteMember(email: string, role: Role) {
  await requireOwner()
  const propertyId = await getPropertyId()

  const targetUser = await prisma.user.findUnique({ where: { email } })
  if (!targetUser) throw new Error('해당 이메일로 가입된 계정이 없습니다.')

  const myId = await getMyUserId()
  if (targetUser.id === myId) throw new Error('자기 자신은 초대할 수 없습니다.')

  await prisma.userPropertyRole.upsert({
    where: { userId_propertyId: { userId: targetUser.id, propertyId } },
    create: { userId: targetUser.id, propertyId, role },
    update: { role },
  })
}

export async function updateMemberRole(userId: string, role: Role) {
  await requireOwner()
  const propertyId = await getPropertyId()
  const myId = await getMyUserId()
  if (userId === myId) throw new Error('본인의 역할은 변경할 수 없습니다.')
  await prisma.userPropertyRole.update({
    where: { userId_propertyId: { userId, propertyId } },
    data: { role },
  })
}

export async function removeMember(userId: string) {
  await requireOwner()
  const propertyId = await getPropertyId()
  const myId = await getMyUserId()
  if (userId === myId) throw new Error('본인은 제거할 수 없습니다.')
  await prisma.userPropertyRole.delete({
    where: { userId_propertyId: { userId, propertyId } },
  })
}

// ── 기본 정보 ──────────────────────────────────────────────────────

export async function updatePropertySettings(formData: FormData) {
  await requireEdit()
  const propertyId = await getPropertyId()

  const name              = formData.get('name') as string
  const address           = formData.get('address') as string
  const phone             = formData.get('phone') as string
  const acquisitionDate   = formData.get('acquisitionDate') as string
  const defaultDeposit    = formData.get('defaultDeposit')
  const defaultCleaningFee = formData.get('defaultCleaningFee')

  await prisma.property.update({
    where: { id: propertyId },
    data: {
      name:             name || undefined,
      address:          address || null,
      phone:            phone || null,
      acquisitionDate:  acquisitionDate ? new Date(acquisitionDate) : null,
      defaultDeposit:   defaultDeposit   ? Number(String(defaultDeposit).replace(/[^0-9]/g, ''))   : null,
      defaultCleaningFee: defaultCleaningFee ? Number(String(defaultCleaningFee).replace(/[^0-9]/g, '')) : null,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/rooms')
}