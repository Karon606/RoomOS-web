'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getMyRole, requireEdit, requireOwner } from '@/lib/role'
import { parseShortStayPolicy, type ShortStayPolicy } from '@/lib/shortStay'
import { ROLE_LABEL, type Role } from '@/lib/role-types'
import {
  createDriveResumableSession, setDrivePublicReadable, deleteFromDrive, buildDriveThumbnailUrl,
} from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE,
} from '@/lib/contract'

export { getMyRole }

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

// ── 캘린더 구독(.ics) 토큰 ────────────────────────────────────────
const genCalToken = () => `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

// 구독 토큰 조회(없으면 생성). 구독 URL = {origin}/api/calendar/{token}
export async function getOrCreateCalendarToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { calendarToken: true } })
    if (p?.calendarToken) return { ok: true, token: p.calendarToken }
    const token = genCalToken()
    await prisma.property.update({ where: { id: propertyId }, data: { calendarToken: token } })
    return { ok: true, token }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 토큰 재발급 — 기존 구독 링크 무효화(유출 시).
export async function resetCalendarToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const token = genCalToken()
    await prisma.property.update({ where: { id: propertyId }, data: { calendarToken: token } })
    return { ok: true, token }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

async function getMyUserId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  return data.claims.sub
}

export const getPropertySettings = cache(async function getPropertySettings() {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
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
      defaultAreaM2: true,
      bankAccount: true,
      refundClauseInContract: true,
      disposalConsentTemplate: true,
      publicSlug: true,
      logoDriveFileId: true,
      appLogoDriveFileId: true,
    },
  })
  if (!property) return null
  // 로고는 화면 어디서든 즉시 표시할 수 있도록 thumbnail URL을 같이 반환
  const { logoDriveFileId, appLogoDriveFileId, ...rest } = property
  return {
    ...rest,
    logoDriveFileId,
    logoThumbnailUrl: logoDriveFileId ? buildDriveThumbnailUrl(logoDriveFileId, 300) : null,
    appLogoDriveFileId,
    appLogoThumbnailUrl: appLogoDriveFileId ? buildDriveThumbnailUrl(appLogoDriveFileId, 300) : null,
  }
})

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

// ── 호실 등급 관리 ─────────────────────────────────────────────────
// 방 타입(원룸/미니룸/복층)과 별개 차원의 등급(스탠다드/실속형/프리미엄 등) 관리.

export async function getRoomTierOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { roomTierOptions: true } as any,
  })
  const raw = (property as any)?.roomTierOptions ?? '스탠다드,실속형'
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addRoomTierOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomTierOptions()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { roomTierOptions: updated } as any,
  })
  revalidatePath('/room-manage')
}

export async function deleteRoomTierOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomTierOptions()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { roomTierOptions: updated } as any,
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

// ── 방향 관리 ──────────────────────────────────────────────────────

const DEFAULT_DIRECTION_OPTIONS = '북향,북동향,동향,남동향,남향,남서향,서향,북서향'

export async function getRoomDirectionOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { directionOptions: true } as any,
  })
  const raw = (property as any)?.directionOptions ?? DEFAULT_DIRECTION_OPTIONS
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
}

export async function addRoomDirectionOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomDirectionOptions()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { directionOptions: updated } as any,
  })
  revalidatePath('/room-manage')
  revalidatePath('/settings')
}

export async function deleteRoomDirectionOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRoomDirectionOptions()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { directionOptions: updated } as any,
  })
  revalidatePath('/room-manage')
  revalidatePath('/settings')
}

// ── 부가수익 카테고리 관리 ──────────────────────────────────────────

export const getIncomeCategories = cache(async function getIncomeCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { incomeCategories: true },
  })
  const raw = (property as any)?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
})

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

const DEFAULT_EXPENSE_CATEGORIES = '부식비,소모품비,폐기물 처리비,수선유지비,공과금,마케팅/광고비,인건비,청소용역비,관리비,임대료,통신/렌탈/보험료,세금/수수료,보증금 반환'

export const getExpenseCategories = cache(async function getExpenseCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { expenseCategories: true } as any,
  })
  const raw = (property as any)?.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
})

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

type ReorderableField = 'roomTypeOptions' | 'roomTierOptions' | 'windowTypeOptions' | 'directionOptions' | 'incomeCategories' | 'expenseCategories' | 'paymentMethods'

const FIELD_DEFAULTS: Record<ReorderableField, string> = {
  roomTypeOptions:   '원룸,미니룸',
  roomTierOptions:   '스탠다드,실속형',
  windowTypeOptions: 'OUTER,INNER',
  directionOptions:  '북향,북동향,동향,남동향,남향,남서향,서향,북서향',
  incomeCategories:  '건조기,세탁기,자판기,이자수익,기타',
  expenseCategories: '부식비,소모품비,폐기물 처리비,수선유지비,공과금,마케팅/광고비,인건비,청소용역비,관리비,임대료,통신/렌탈/보험료,세금/수수료,보증금 반환',
  paymentMethods:    '계좌이체,신용카드,체크카드,현금,네이버페이,카카오페이,토스,쿠팡캐시,서울페이,제로페이,페이코,SSG머니',
}

export async function resetOptionsToDefault(field: ReorderableField): Promise<string[]> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const defaultVal = FIELD_DEFAULTS[field]
  await prisma.property.update({
    where: { id: propertyId },
    data: { [field]: defaultVal } as any,
  })
  revalidatePath('/settings')
  if (['incomeCategories', 'expenseCategories', 'paymentMethods'].includes(field)) revalidatePath('/finance')
  if (['roomTypeOptions', 'roomTierOptions', 'windowTypeOptions', 'directionOptions'].includes(field)) revalidatePath('/room-manage')
  return defaultVal.split(',').map(s => s.trim()).filter(Boolean)
}

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
  if (field === 'roomTypeOptions' || field === 'roomTierOptions' || field === 'windowTypeOptions' || field === 'directionOptions') {
    revalidatePath('/room-manage')
  }
}

export async function renameOption(field: ReorderableField, oldValue: string, newValue: string): Promise<void> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { [field]: true } as any,
  })
  const current: string[] = ((property as any)?.[field] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
  const updated = current.map(v => v === oldValue ? newValue : v).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { [field]: updated } as any,
  })
  revalidatePath('/settings')
  if (field === 'incomeCategories' || field === 'expenseCategories' || field === 'paymentMethods') {
    revalidatePath('/finance')
  }
  if (field === 'roomTypeOptions' || field === 'roomTierOptions' || field === 'windowTypeOptions' || field === 'directionOptions') {
    revalidatePath('/room-manage')
  }
}

// ── 결제 수단 ─────────────────────────────────────────────────────

const DEFAULT_PAYMENT_METHODS = '계좌이체,신용카드,체크카드,현금'

export const getPaymentMethods = cache(async function getPaymentMethods(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { paymentMethods: true } as any,
  })
  const raw = (property as any)?.paymentMethods ?? DEFAULT_PAYMENT_METHODS
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
})

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
  const defaultAreaM2     = formData.get('defaultAreaM2')
  const bankAccount       = formData.get('bankAccount') as string
  // 퇴실 환불 규정의 위약금율·기간·1일당·청소비 차감은 법적으로 임의 설정 불가 → 입력 제거(컬럼은 보존, 미사용).
  const refundClauseInContract  = formData.get('refundClauseInContract') === '1'
  // 잔여 소지품 임의처분 동의서
  const disposalEnabled = formData.get('disposalEnabled') === '1'
  const disposalDaysRaw = formData.get('disposalDays')
  const disposalTitle   = (formData.get('disposalTitle') as string) ?? ''
  const disposalBody    = (formData.get('disposalBody') as string) ?? ''
  const publicSlugRaw     = formData.get('publicSlug') as string | null
  const publicSlug = publicSlugRaw
    ? publicSlugRaw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    : ''

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
      defaultAreaM2:    defaultAreaM2 && String(defaultAreaM2).trim() ? Number(String(defaultAreaM2).replace(/[^0-9.]/g, '')) || null : null,
      bankAccount:      bankAccount?.trim() || null,
      refundClauseInContract,
      disposalConsentTemplate: {
        enabled: disposalEnabled,
        days: disposalDaysRaw && String(disposalDaysRaw).trim() ? Number(String(disposalDaysRaw).replace(/[^0-9]/g, '')) || 7 : 7,
        title: disposalTitle.trim() || '잔여 소지품 임의처분 동의서',
        body: disposalBody,
      },
      publicSlug:       publicSlug || null,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/rooms')
  revalidatePath('/marketing')
}

// ── 계약서 (영업장별 템플릿 + 사업자 정보 + 도장) ─────────────────

export type ContractSettings = {
  template: ContractTemplate
  businessInfo: BusinessInfo
  stampDriveFileId: string | null
  stampThumbnailUrl: string | null
}

const EMPTY_BUSINESS_INFO: BusinessInfo = {
  name: '', registrationNo: '', ceoName: '', address: '',
}

export async function getContractSettings(): Promise<ContractSettings> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { contractTemplate: true, businessInfo: true, stampDriveFileId: true },
  })
  const template = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
  const businessInfo = (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO
  const stampDriveFileId = property?.stampDriveFileId ?? null
  return {
    template,
    businessInfo,
    stampDriveFileId,
    stampThumbnailUrl: stampDriveFileId ? buildDriveThumbnailUrl(stampDriveFileId, 200) : null,
  }
}

export async function saveContractTemplate(template: ContractTemplate): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!template.title?.trim()) return { ok: false, error: '계약서 제목을 입력하세요.' }
    if (!Array.isArray(template.sections)) return { ok: false, error: '섹션 형식이 올바르지 않습니다.' }
    await prisma.property.update({
      where: { id: propertyId },
      data: { contractTemplate: template as unknown as object },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

export async function saveBusinessInfo(info: BusinessInfo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.property.update({
      where: { id: propertyId },
      data: { businessInfo: info as unknown as object },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

const MAX_STAMP_BYTES = 5 * 1024 * 1024  // 5MB — 도장은 작은 PNG면 충분

export async function createStampUploadSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_STAMP_BYTES) return { ok: false, error: `파일 크기는 ${MAX_STAMP_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const propertyId = await getPropertyId()
    const ext = input.fileName.split('.').pop() ?? 'png'
    const uniqueName = `stamp_${propertyId}_${Date.now()}.${ext}`
    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeStamp(driveFileId: string): Promise<{ ok: true; thumbnailUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const propertyId = await getPropertyId()
    await setDrivePublicReadable(driveFileId)
    // 기존 도장이 있으면 Drive에서 정리
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { stampDriveFileId: true },
    })
    if (prev?.stampDriveFileId && prev.stampDriveFileId !== driveFileId) {
      try { await deleteFromDrive(prev.stampDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { stampDriveFileId: driveFileId },
    })
    revalidatePath('/settings')
    return { ok: true, thumbnailUrl: buildDriveThumbnailUrl(driveFileId, 200) }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (driveFileId) {
      try { await deleteFromDrive(driveFileId) } catch { /* 정리 실패 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deleteStamp(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { stampDriveFileId: true },
    })
    if (prev?.stampDriveFileId) {
      try { await deleteFromDrive(prev.stampDriveFileId) } catch { /* 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { stampDriveFileId: null },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// ── 영업장 로고 (도장과 동일한 업로드 패턴) ─────────────────────

const MAX_LOGO_BYTES = 5 * 1024 * 1024  // 5MB

export async function createLogoUploadSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_LOGO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_LOGO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const propertyId = await getPropertyId()
    const ext = input.fileName.split('.').pop() ?? 'png'
    const uniqueName = `logo_${propertyId}_${Date.now()}.${ext}`
    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeLogo(driveFileId: string): Promise<{ ok: true; thumbnailUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const propertyId = await getPropertyId()
    await setDrivePublicReadable(driveFileId)
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { logoDriveFileId: true },
    })
    if (prev?.logoDriveFileId && prev.logoDriveFileId !== driveFileId) {
      try { await deleteFromDrive(prev.logoDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { logoDriveFileId: driveFileId },
    })
    revalidatePath('/settings')
    return { ok: true, thumbnailUrl: buildDriveThumbnailUrl(driveFileId, 300) }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (driveFileId) {
      try { await deleteFromDrive(driveFileId) } catch { /* 정리 실패 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deleteLogo(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { logoDriveFileId: true },
    })
    if (prev?.logoDriveFileId) {
      try { await deleteFromDrive(prev.logoDriveFileId) } catch { /* 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { logoDriveFileId: null },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// ── 앱 로고 (헤더 원형 표시용 — 로고와 동일한 업로드 패턴, 별도 필드) ──────

export async function createAppLogoUploadSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_LOGO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_LOGO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const propertyId = await getPropertyId()
    const ext = input.fileName.split('.').pop() ?? 'png'
    const uniqueName = `applogo_${propertyId}_${Date.now()}.${ext}`
    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeAppLogo(driveFileId: string): Promise<{ ok: true; thumbnailUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const propertyId = await getPropertyId()
    await setDrivePublicReadable(driveFileId)
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { appLogoDriveFileId: true },
    })
    if (prev?.appLogoDriveFileId && prev.appLogoDriveFileId !== driveFileId) {
      try { await deleteFromDrive(prev.appLogoDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { appLogoDriveFileId: driveFileId },
    })
    revalidatePath('/settings')
    return { ok: true, thumbnailUrl: buildDriveThumbnailUrl(driveFileId, 300) }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (driveFileId) {
      try { await deleteFromDrive(driveFileId) } catch { /* 정리 실패 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deleteAppLogo(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { appLogoDriveFileId: true },
    })
    if (prev?.appLogoDriveFileId) {
      try { await deleteFromDrive(prev.appLogoDriveFileId) } catch { /* 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { appLogoDriveFileId: null },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// ── 고정 지출 ────────────────────────────────────────────────

export type RecurringExpenseRow = {
  id: string
  title: string
  amount: number
  category: string
  dueDay: number
  payMethod: string | null
  financialAccountId: string | null
  financialAccountName: string | null
  isAutoDebit: boolean
  isVariable: boolean
  alertDaysBefore: number
  isActive: boolean
  activeSince: string | null
  priorYearAmount: number | null
  memo: string | null
  // #1 관리비 묶음: 세부항목(있으면 부모). amount/isVariable은 이 항목들로부터 파생.
  items: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }[]
}

// #1 세부항목 입력 형태 (생성/수정 시)
export type RecurringItemInput = { name: string; amount: number; isVariable: boolean }

export async function getRecurringExpenses(): Promise<RecurringExpenseRow[]> {
  const propertyId = await getPropertyId()
  const list = await prisma.recurringExpense.findMany({
    where: { propertyId },
    orderBy: { dueDay: 'asc' },
    select: {
      id: true, title: true, amount: true, category: true, dueDay: true,
      payMethod: true, financialAccountId: true,
      financialAccount: { select: { brand: true, alias: true } },
      isAutoDebit: true, isVariable: true, alertDaysBefore: true,
      isActive: true, activeSince: true, priorYearAmount: true, memo: true,
      items: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, amount: true, isVariable: true, sortOrder: true } },
    },
  })
  return list.map(r => ({
    ...r,
    financialAccountName: r.financialAccount
      ? (r.financialAccount.alias || r.financialAccount.brand)
      : null,
    financialAccount: undefined,
    activeSince: r.activeSince ? new Date(r.activeSince).toISOString().slice(0, 10) : null,
  }))
}

// #1: 세부항목으로부터 부모의 합계·변동여부 파생
function deriveFromItems(items: RecurringItemInput[]): { amount: number; isVariable: boolean } {
  const amount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const isVariable = items.some(it => it.isVariable)
  return { amount, isVariable }
}

export async function addRecurringExpense(data: {
  title: string; amount: number; category: string; dueDay: number
  payMethod?: string; financialAccountId?: string | null; isAutoDebit?: boolean; isVariable?: boolean; alertDaysBefore?: number; activeSince?: string; priorYearAmount?: number; memo?: string
  // #1 관리비 묶음: 세부항목. 있으면 amount/isVariable은 세부에서 파생.
  items?: RecurringItemInput[]
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { activeSince, items, ...rest } = data
    const hasItems = Array.isArray(items) && items.length > 0
    const derived = hasItems ? deriveFromItems(items!) : null
    const rec = await prisma.recurringExpense.create({
      data: {
        propertyId, ...rest, isActive: true,
        ...(derived ? { amount: derived.amount, isVariable: derived.isVariable } : {}),
        activeSince: activeSince ? new Date(activeSince) : null,
        ...(hasItems ? {
          items: { create: items!.map((it, i) => ({ name: it.name, amount: Number(it.amount) || 0, isVariable: !!it.isVariable, sortOrder: i })) },
        } : {}),
      },
    })
    revalidatePath('/settings')
    return { ok: true, id: rec.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateRecurringExpense(id: string, data: Partial<{
  title: string; amount: number; category: string; dueDay: number
  payMethod: string | null; financialAccountId: string | null; isAutoDebit: boolean; isVariable: boolean; alertDaysBefore: number; isActive: boolean; activeSince: string | null; priorYearAmount: number | null; memo: string | null
  // #1 관리비 묶음: 세부항목 전체 교체(있으면 amount/isVariable 파생). undefined면 항목 미변경.
  items: RecurringItemInput[]
}>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { activeSince, items, ...rest } = data
    const updateData: Record<string, unknown> = { ...rest }
    if ('activeSince' in data) {
      updateData.activeSince = activeSince ? new Date(activeSince) : null
    }
    // #1: 세부항목이 전달되면 전체 교체 + 부모 합계·변동 파생
    if (items !== undefined) {
      const hasItems = Array.isArray(items) && items.length > 0
      if (hasItems) {
        const derived = deriveFromItems(items)
        updateData.amount = derived.amount
        updateData.isVariable = derived.isVariable
      }
      await prisma.$transaction([
        prisma.recurringExpenseItem.deleteMany({ where: { recurringExpenseId: id } }),
        ...(hasItems
          ? [prisma.recurringExpenseItem.createMany({
              data: items.map((it, i) => ({ recurringExpenseId: id, name: it.name, amount: Number(it.amount) || 0, isVariable: !!it.isVariable, sortOrder: i })),
            })]
          : []),
        prisma.recurringExpense.update({ where: { id }, data: updateData }),
      ])
    } else {
      await prisma.recurringExpense.update({ where: { id }, data: updateData })
    }
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// #1: 기존에 따로 등록된 고정지출들을 한 부모(관리비)로 묶기.
//  선택한 항목들을 부모의 세부항목으로 전환하고, 원본은 비활성(isActive=false)해 목록에서 숨김.
//  (원본의 과거 기록 Expense는 recurringExpenseId가 그대로라 보존됨 — 무손실)
export async function groupRecurringExpenses(data: {
  title: string; category: string; dueDay: number
  payMethod?: string | null; financialAccountId?: string | null; isAutoDebit?: boolean; alertDaysBefore?: number; memo?: string | null
  sourceIds: string[]
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!data.sourceIds || data.sourceIds.length === 0) return { ok: false, error: '묶을 항목을 선택하세요.' }
    // 선택 항목 조회 (이 영업장 소유 확인)
    const sources = await prisma.recurringExpense.findMany({
      where: { id: { in: data.sourceIds }, propertyId },
      select: { id: true, title: true, amount: true, isVariable: true },
    })
    if (sources.length === 0) return { ok: false, error: '선택한 항목을 찾을 수 없습니다.' }
    const items: RecurringItemInput[] = sources.map(s => ({ name: s.title, amount: s.amount, isVariable: s.isVariable }))
    const derived = deriveFromItems(items)
    const result = await prisma.$transaction(async (tx) => {
      const parent = await tx.recurringExpense.create({
        data: {
          propertyId,
          title: data.title,
          category: data.category,
          dueDay: data.dueDay,
          amount: derived.amount,
          isVariable: derived.isVariable,
          payMethod: data.payMethod ?? null,
          financialAccountId: data.financialAccountId ?? null,
          isAutoDebit: data.isAutoDebit ?? false,
          alertDaysBefore: data.alertDaysBefore ?? 7,
          memo: data.memo ?? null,
          isActive: true,
          items: { create: items.map((it, i) => ({ name: it.name, amount: it.amount, isVariable: it.isVariable, sortOrder: i })) },
        },
      })
      // 원본은 비활성 (기록 보존, 목록에서만 숨김)
      await tx.recurringExpense.updateMany({
        where: { id: { in: sources.map(s => s.id) }, propertyId },
        data: { isActive: false },
      })
      return parent
    })
    revalidatePath('/settings')
    revalidatePath('/finance')
    return { ok: true, id: result.id }
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
// 전체 데이터 JSON 백업 — owner만
export async function exportAllData(): Promise<string> {
  await requireOwner()
  const propertyId = await getPropertyId()

  const [property, rooms, tenants, leaseTerms, paymentRecords, expenses, extraIncomes, financialAccounts, recurringExpenses, tenantContacts, tenantStatusLogs, tenantRequests] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId } }),
    prisma.room.findMany({ where: { propertyId }, include: { photos: true } }),
    prisma.tenant.findMany({ where: { propertyId } }),
    prisma.leaseTerm.findMany({ where: { propertyId } }),
    prisma.paymentRecord.findMany({ where: { propertyId } }),
    prisma.expense.findMany({ where: { propertyId } }),
    prisma.extraIncome.findMany({ where: { propertyId } }),
    prisma.financialAccount.findMany({ where: { propertyId } }),
    prisma.recurringExpense.findMany({ where: { propertyId } }),
    prisma.tenantContact.findMany({ where: { tenant: { propertyId } } }),
    prisma.tenantStatusLog.findMany({ where: { propertyId } }),
    prisma.tenantRequest.findMany({ where: { propertyId } }),
  ])

  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    propertyId,
    property,
    rooms,
    tenants,
    tenantContacts,
    leaseTerms,
    paymentRecords,
    expenses,
    extraIncomes,
    financialAccounts,
    recurringExpenses,
    tenantStatusLogs,
    tenantRequests,
  }, null, 2)
}


// ── 단기 입실 정책 (운영자 기준 2026-07-06, §4) ─────────────────────────────
// 영업장별 수치 템플릿 — 시뮬레이션(고객 관리 > 요금 계산)이 이 값으로 계산한다.
export async function getShortStayPolicy(): Promise<ShortStayPolicy> {
  const propertyId = await getPropertyId()
  const prop = await prisma.property.findUnique({ where: { id: propertyId }, select: { shortStayPolicy: true } })
  return parseShortStayPolicy(prop?.shortStayPolicy)
}

export async function updateShortStayPolicy(input: ShortStayPolicy): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner()   // 요금 기준 변경은 소유자만
    const propertyId = await getPropertyId()
    const policy = parseShortStayPolicy(input)   // 서버측 정규화(범위 밖 값은 기본값으로)
    await prisma.property.update({ where: { id: propertyId }, data: { shortStayPolicy: policy } })
    revalidatePath('/settings')
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// ── 품목 세부스펙 사전 관리 (신고 ba9feb6b) ─────────────────────────────────
// 지출 저장 시 자동 적립된 색상·사이즈·치수 옵션 — 여기서 수정·삭제.
export type ItemSpecGroup = { itemLabel: string; options: { id: string; label: string }[] }

export async function listItemSpecOptions(): Promise<ItemSpecGroup[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.itemSpecOption.findMany({
    where: { propertyId },
    orderBy: [{ itemLabel: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, itemLabel: true, label: true },
  })
  const map = new Map<string, { id: string; label: string }[]>()
  for (const r of rows) {
    const g = map.get(r.itemLabel) ?? []
    g.push({ id: r.id, label: r.label })
    map.set(r.itemLabel, g)
  }
  return [...map.entries()].map(([itemLabel, options]) => ({ itemLabel, options }))
}

export async function renameItemSpecOption(id: string, label: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const next = label.trim()
    if (!next) return { ok: false, error: '세부스펙을 입력하세요.' }
    await prisma.itemSpecOption.update({ where: { id, propertyId }, data: { label: next } })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteItemSpecOption(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.itemSpecOption.delete({ where: { id, propertyId } })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
