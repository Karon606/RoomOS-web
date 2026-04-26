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
      prevOwnerCutoffDate: true,
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
  const raw = (property as any)?.windowTypeOptions ?? 'OUTER,INNER'
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

// ── 지출 카테고리 ─────────────────────────────────────────────────

const DEFAULT_EXPENSE_CATEGORIES = '관리비,수선유지,세금,인건비,소모품,보증금 반환,기타'

export async function getExpenseCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { expenseCategories: true } as any,
  })
  const raw = (property as any)?.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addExpenseCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getExpenseCategories()
  if (current.includes(name)) return
  await prisma.property.update({
    where: { id: propertyId },
    data: { expenseCategories: [...current, name].join(',') } as any,
  })
  revalidatePath('/finance')
  revalidatePath('/settings')
}

export async function deleteExpenseCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getExpenseCategories()
  await prisma.property.update({
    where: { id: propertyId },
    data: { expenseCategories: current.filter(t => t !== name).join(',') } as any,
  })
  revalidatePath('/finance')
  revalidatePath('/settings')
}

// ── 순서 변경 ─────────────────────────────────────────────────────

type ReorderableField = 'roomTypeOptions' | 'windowTypeOptions' | 'incomeCategories' | 'expenseCategories' | 'paymentMethods'

export async function reorderOptions(field: ReorderableField, items: string[]): Promise<void> {
  await requireEdit()
  const propertyId = await getPropertyId()
  await prisma.property.update({
    where: { id: propertyId },
    data: { [field]: items.join(',') } as any,
  })
  revalidatePath('/settings')
  if (field === 'incomeCategories' || field === 'expenseCategories' || field === 'paymentMethods') {
    revalidatePath('/finance')
  }
}

// ── 결제 수단 ─────────────────────────────────────────────────────

const DEFAULT_PAYMENT_METHODS = '계좌이체,신용카드,체크카드,현금'

export async function getPaymentMethods(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { paymentMethods: true } as any,
  })
  const raw = (property as any)?.paymentMethods ?? DEFAULT_PAYMENT_METHODS
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addPaymentMethod(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getPaymentMethods()
  if (current.includes(name)) return
  await prisma.property.update({
    where: { id: propertyId },
    data: { paymentMethods: [...current, name].join(',') } as any,
  })
  revalidatePath('/settings')
}

export async function deletePaymentMethod(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getPaymentMethods()
  await prisma.property.update({
    where: { id: propertyId },
    data: { paymentMethods: current.filter(t => t !== name).join(',') } as any,
  })
  revalidatePath('/settings')
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

type ActionResult = { ok: true } | { ok: false; error: string }

export async function inviteMember(email: string, role: Role): Promise<ActionResult> {
  try {
    const myRole = await getMyRole()
    if (myRole !== 'OWNER') return { ok: false, error: '소유자만 초대할 수 있습니다.' }
    const propertyId = await getPropertyId()

    const targetUser = await prisma.user.findUnique({ where: { email } })
    if (!targetUser) return { ok: false, error: '해당 이메일로 가입된 계정이 없습니다.' }

    const myId = await getMyUserId()
    if (targetUser.id === myId) return { ok: false, error: '자기 자신은 초대할 수 없습니다.' }

    await prisma.userPropertyRole.upsert({
      where: { userId_propertyId: { userId: targetUser.id, propertyId } },
      create: { userId: targetUser.id, propertyId, role },
      update: { role },
    })
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '초대 중 오류가 발생했습니다.' }
  }
}

export async function updateMemberRole(userId: string, role: Role): Promise<ActionResult> {
  try {
    const myRole = await getMyRole()
    if (myRole !== 'OWNER') return { ok: false, error: '소유자만 역할을 변경할 수 있습니다.' }
    const propertyId = await getPropertyId()
    const myId = await getMyUserId()
    if (userId === myId) return { ok: false, error: '본인의 역할은 변경할 수 없습니다.' }
    await prisma.userPropertyRole.update({
      where: { userId_propertyId: { userId, propertyId } },
      data: { role },
    })
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function removeMember(userId: string): Promise<ActionResult> {
  try {
    const myRole = await getMyRole()
    if (myRole !== 'OWNER') return { ok: false, error: '소유자만 멤버를 제거할 수 있습니다.' }
    const propertyId = await getPropertyId()
    const myId = await getMyUserId()
    if (userId === myId) return { ok: false, error: '본인은 제거할 수 없습니다.' }
    await prisma.userPropertyRole.delete({
      where: { userId_propertyId: { userId, propertyId } },
    })
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 기본 정보 ──────────────────────────────────────────────────────

export async function updatePropertySettings(formData: FormData) {
  await requireEdit()
  const propertyId = await getPropertyId()

  const name              = formData.get('name') as string
  const address           = formData.get('address') as string
  const phone             = formData.get('phone') as string
  const acquisitionDate   = formData.get('acquisitionDate') as string
  const prevOwnerCutoffDate = formData.get('prevOwnerCutoffDate') as string
  const defaultDeposit    = formData.get('defaultDeposit')
  const defaultCleaningFee = formData.get('defaultCleaningFee')

  await prisma.property.update({
    where: { id: propertyId },
    data: {
      name:             name || undefined,
      address:          address || null,
      phone:            phone || null,
      acquisitionDate:  acquisitionDate ? new Date(acquisitionDate) : null,
      prevOwnerCutoffDate: prevOwnerCutoffDate ? new Date(prevOwnerCutoffDate) : null,
      defaultDeposit:   defaultDeposit   ? Number(String(defaultDeposit).replace(/[^0-9]/g, ''))   : null,
      defaultCleaningFee: defaultCleaningFee ? Number(String(defaultCleaningFee).replace(/[^0-9]/g, '')) : null,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/rooms')
}

// ── 고정 지출 ────────────────────────────────────────────────

export type RecurringExpenseRow = {
  id: string
  title: string
  amount: number
  category: string
  dueDay: number
  payMethod: string | null
  isAutoDebit: boolean
  alertDaysBefore: number
  isActive: boolean
  memo: string | null
}

export async function getRecurringExpenses(): Promise<RecurringExpenseRow[]> {
  const propertyId = await getPropertyId()
  return prisma.recurringExpense.findMany({
    where: { propertyId },
    orderBy: { dueDay: 'asc' },
    select: { id: true, title: true, amount: true, category: true, dueDay: true, payMethod: true, isAutoDebit: true, alertDaysBefore: true, isActive: true, memo: true },
  })
}

export async function addRecurringExpense(data: {
  title: string; amount: number; category: string; dueDay: number
  payMethod?: string; isAutoDebit?: boolean; alertDaysBefore?: number; memo?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const rec = await prisma.recurringExpense.create({
      data: { propertyId, ...data, isActive: true },
    })
    revalidatePath('/settings')
    return { ok: true, id: rec.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateRecurringExpense(id: string, data: Partial<{
  title: string; amount: number; category: string; dueDay: number
  payMethod: string | null; isAutoDebit: boolean; alertDaysBefore: number; isActive: boolean; memo: string | null
}>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await prisma.recurringExpense.update({ where: { id }, data })
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteRecurringExpense(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await prisma.recurringExpense.delete({ where: { id } })
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}