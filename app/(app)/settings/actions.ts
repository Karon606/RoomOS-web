'use server'

import { randomBytes } from 'crypto'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { normalizeBizNo } from '@/lib/bizNo'
import { FREE_MONTHLY_AI_LIMIT } from '@/lib/geminiKey'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getMyRole, requireEdit, requireOwner } from '@/lib/role'
import { parseShortStayPolicy, type ShortStayPolicy } from '@/lib/shortStay'
import { RECURRING_INTERVAL_CHOICES } from '@/lib/recurringDueDate'
import { isReservedMailLocal } from '@/lib/mailFrom'
import { DEFAULT_SPEC_UNITS, DEFAULT_QTY_UNITS, parseUnitOptions, resolveUnitForSave } from '@/lib/unitOptions'
import { canonicalUnit, isConvertibleUnit } from '@/lib/units'
import { Prisma } from '@prisma/client'
import {
  parseDocMailTemplate, findUnknownVars, sanitizeDocMailHtml, renderDocMail,
  DOC_MAIL_LIMITS, DOC_MAIL_DEFAULT_SUBJECT, DOC_MAIL_DEFAULT_BODY, type DocMailTemplate,
} from '@/lib/docMail'
import { ROLE_LABEL, type Role } from '@/lib/role-types'
import { REQUEST_CATEGORIES, parseRequestCategories } from '@/lib/requestCategories'
import { kstMonthStr } from '@/lib/kstDate'
import {
  createDriveResumableSession, setDrivePublicReadable, deleteFromDrive, trashInDrive, buildDriveThumbnailUrl, driveImageDataUrl,
  ownedDriveFileMime,
} from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE,
} from '@/lib/contract'
import { buildPropertySettingsPatch, normalizePublicSlug } from '@/lib/propertySettingsPatch'

export { getMyRole }

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

async function getPropertyIdWithUser() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId }
}

// ── 캘린더 구독(.ics) 토큰 ────────────────────────────────────────
// 이 토큰 하나가 /api/calendar/[token] 을 **무인증으로** 연다. 전 입주자 실명·호실·월 이용료·
// 퇴실 예정일·투어 일정·잠재고객 연락처가 ICS 로 나가고 만료도 없다. 사실상 영업장 명부 열쇠다.
// Math.random 은 암호학적으로 안전하지 않고 Date.now 부분은 공개값이나 다름없었다(D페이즈 2026-08-03).
// 같은 저장소의 서명 토큰(contractShare)은 처음부터 randomBytes(32) 다. 여기만 달랐다.
const genCalToken = () => randomBytes(32).toString('base64url')

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
      replyToEmail: true,   // 서류 메일 답장 주소(2026-08-25)
      mailFromLocal: true,  // 서류 메일 발신 주소 앞부분(2026-08-26)
      mailCopyToSelf: true, // 보낸 메일 사본 받기(2026-08-26)
      acquisitionDate: true,
      prevOwnerCutoffDate: true,
      defaultDeposit: true,
      defaultCleaningFee: true,
      refundPenaltyPct: true,   // 중도퇴실 위약금 기본값(%) — 공정위 10% 캡(운영자 결정 2026-07-20)
      defaultAreaM2: true,
      reservationDepositMode: true,
      bankAccount: true,
      contactLeadDays: true,
      checkoutLeadShortDays: true,
      checkoutLeadMonths: true,
      refundClauseInContract: true,
      cleaningFeeInDeposit: true,   // 청소비를 보증금 안의 몫으로 받는 영업장인지(2026-08-10)
      multiContractVersions: true,  // 여러 판본 계약서를 만들 수 있는 영업장인지(2026-08-20)
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

// ── 작업 종류 관리 ────────────────────────────────────────────────
// 청소가 아닌 방 작업(도배·장판 등)의 종류 목록. 값은 RoomWork.kind 에 **문자열로 복사돼**
// 저장되므로, 목록에서 지워도 지나간 기록은 그 이름으로 남는다(방타입·지출 카테고리와 같은 계약).
// 그래서 이름 변경은 아래 RENAME_CASCADE 가 기록까지 따라가야 한다 — 안 걸면 목록에 없는
// 이름이 캘린더에 계속 선다.
//
// **청소는 이 목록에 없다.** 청소는 사유 4종·받은 청소비 부담 표식·예정 담당자를 더 받는
// 제 폼과 제 표(RoomCleaning)를 갖고 있다. 한 목록에 넣으면 "고르면 같은 일이 일어난다"는
// 약속이 깨진다(디자인 패널 판정 2026-08-25).

export async function getWorkKindOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { workKindOptions: true },
  })
  // 형제 여덟은 `as any` 를 쓴다 — 그 칸들이 생기기 전에 쓰인 코드라 그렇다. 이 칸은 스키마에
  // 이미 있으므로 그럴 이유가 없다(신규 eslint 지적을 만들지 않는다).
  const raw = property?.workKindOptions ?? '도배,장판'
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}

export async function addWorkKindOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getWorkKindOptions()
  if (current.includes(name)) return
  const updated = [...current, name].join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { workKindOptions: updated },
  })
  revalidatePath('/room-manage')
}

export async function deleteWorkKindOption(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getWorkKindOptions()
  const updated = current.filter((t: string) => t !== name).join(',')
  await prisma.property.update({
    where: { id: propertyId },
    data: { workKindOptions: updated },
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

/**
 * 영업장 단위 목록 — 비면 코드 기본값(lib/unitOptions). getExpenseCategories 와 같은 문법이다.
 *
 * 값이 Property 행 안에 있으므로 다른 영업장으로 샐 경로가 구조적으로 없다. 전역인 것은
 * 코드 기본값뿐이고, 그건 칼럼이 비었을 때의 폴백이지 다른 영업장 목록에 합쳐지지 않는다
 * (운영자가 가장 걱정한 지점 — "한군데서 추가되었다고 앱 전체 추가되면 대참사").
 */
export const getSpecUnitOptions = cache(async function getSpecUnitOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId }, select: { specUnitOptions: true },
  })
  return parseUnitOptions(property?.specUnitOptions, DEFAULT_SPEC_UNITS)
})

export const getQtyUnitOptions = cache(async function getQtyUnitOptions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId }, select: { qtyUnitOptions: true },
  })
  return parseUnitOptions(property?.qtyUnitOptions, DEFAULT_QTY_UNITS)
})

/**
 * 저장 흐름 안에서 새 단위를 적립한다 — 목록에 없으면 끝에 붙이고, 있으면 아무것도 안 한다.
 *
 * **저장을 실제로 누른 시점에만 부른다.** 영수증 인식 시점에 적립하면 인식이 잘못 뽑은 말이
 * 목록에 올라앉는다(실측 데이터의 '포인트' 가 그 경로로 들어올 뻔한 값이다).
 * resolveCategoryForSave 를 쓰는 지출·요청 카테고리와 같은 계약이다.
 */
export async function noteUnitsUsed(kind: 'spec' | 'qty', units: (string | null | undefined)[]) {
  const propertyId = await getPropertyId()
  const current = kind === 'spec' ? await getSpecUnitOptions() : await getQtyUnitOptions()
  let next = current
  for (const u of units) {
    const r = resolveUnitForSave(next, u)
    if (r.nextList) next = r.nextList
  }
  if (next === current) return
  await prisma.property.update({
    where: { id: propertyId },
    data: kind === 'spec' ? { specUnitOptions: next.join(',') } : { qtyUnitOptions: next.join(',') },
  })
}

/** 목록에 단위를 손으로 더한다 — 저장 흐름의 자동 적립과 같은 목록을 본다. */
export async function addUnitOption(kind: 'spec' | 'qty', name: string) {
  await requireEdit()
  await noteUnitsUsed(kind, [name])
  revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/settings')
}

/**
 * 목록에서 단위를 뺀다 — **저장된 기록은 그대로 둔다.**
 *
 * 지출 카테고리 삭제와 같은 계약이다. 드롭다운에서만 사라진다. 지운 단위로 저장된 옛 지출이
 * 갑자기 단위 없는 값이 되면 재고 매칭이 그 자리에서 깨진다.
 */
export async function deleteUnitOption(kind: 'spec' | 'qty', name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = kind === 'spec' ? await getSpecUnitOptions() : await getQtyUnitOptions()
  const next = current.filter(u => u !== name)
  if (next.length === current.length) return
  await prisma.property.update({
    where: { id: propertyId },
    data: kind === 'spec' ? { specUnitOptions: next.join(',') } : { qtyUnitOptions: next.join(',') },
  })
  revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/settings')
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

// ── 요청·컴플레인 카테고리 ────────────────────────────────────────

export const getRequestCategories = cache(async function getRequestCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { requestCategories: true } as any,
  })
  return parseRequestCategories((property as any)?.requestCategories)
})

export async function addRequestCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRequestCategories()
  if (current.includes(name)) return
  await prisma.property.update({
    where: { id: propertyId },
    data: { requestCategories: [...current, name].join(',') } as any,
  })
  revalidatePath('/requests')
  revalidatePath('/settings')
}

export async function deleteRequestCategory(name: string) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const current = await getRequestCategories()
  await prisma.property.update({
    where: { id: propertyId },
    data: { requestCategories: current.filter(t => t !== name).join(',') } as any,
  })
  revalidatePath('/requests')
  revalidatePath('/settings')
}

// ── 순서 변경 ─────────────────────────────────────────────────────

type ReorderableField = 'roomTypeOptions' | 'roomTierOptions' | 'windowTypeOptions' | 'directionOptions' | 'incomeCategories' | 'expenseCategories' | 'paymentMethods' | 'requestCategories' | 'workKindOptions' | 'specUnitOptions' | 'qtyUnitOptions'

const FIELD_DEFAULTS: Record<ReorderableField, string> = {
  roomTypeOptions:   '원룸,미니룸',
  roomTierOptions:   '스탠다드,실속형',
  windowTypeOptions: 'OUTER,INNER',
  directionOptions:  '북향,북동향,동향,남동향,남향,남서향,서향,북서향',
  incomeCategories:  '건조기,세탁기,자판기,이자수익,기타',
  expenseCategories: '부식비,소모품비,폐기물 처리비,수선유지비,공과금,마케팅/광고비,인건비,청소용역비,관리비,임대료,통신/렌탈/보험료,세금/수수료,보증금 반환',
  paymentMethods:    '계좌이체,신용카드,체크카드,현금,네이버페이,카카오페이,토스,쿠팡캐시,서울페이,제로페이,페이코,SSG머니',
  requestCategories: REQUEST_CATEGORIES.join(','),
  workKindOptions:   '도배,장판',
  specUnitOptions:   DEFAULT_SPEC_UNITS.join(','),
  qtyUnitOptions:    DEFAULT_QTY_UNITS.join(','),
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
  if (['roomTypeOptions', 'roomTierOptions', 'windowTypeOptions', 'directionOptions', 'workKindOptions'].includes(field)) revalidatePath('/room-manage')
  if (field === 'requestCategories') revalidatePath('/requests')
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
  if (field === 'roomTypeOptions' || field === 'roomTierOptions' || field === 'windowTypeOptions' || field === 'directionOptions' || field === 'workKindOptions') {
    revalidatePath('/room-manage')
  }
  if (field === 'requestCategories') revalidatePath('/requests')
}

// ── 옵션 이름 변경 ────────────────────────────────────────────────
// 옵션 값은 데이터 행에 문자열 그대로 박혀 있다. 목록만 고치면 기존 행은 옛 이름으로 남아 고아가 되므로,
// 이름을 바꾸면 그 값을 쓰는 행도 함께 갱신한다(운영자 오더 2026-07-27).
// 여기엔 updateMany 가능한 평면 컬럼만 — JSON 문자열(wishConditions·inventoryCategories)은 아래에서 따로 처리.
const RENAME_CASCADE: Record<ReorderableField, { model: string; column: string }[]> = {
  requestCategories: [
    { model: 'tenantRequest', column: 'category' },
  ],
  expenseCategories: [
    { model: 'expense', column: 'category' },
    { model: 'recurringExpense', column: 'category' },
    { model: 'trackedItem', column: 'category' },
    { model: 'trackedItemMergeRule', column: 'category' },
    { model: 'assetItemOrder', column: 'category' },
  ],
  incomeCategories: [
    { model: 'extraIncome', column: 'category' },
  ],
  // 단위 이름 변경은 **표기를 고치는 도구**다('봉지'를 '봉'으로 한 번에 정리하는 자리).
  // 저장된 숫자는 그대로 두고 글자만 바꾸므로, 뜻이 바뀌는 변경은 아래 renameOption 이 막는다
  // ('g' 를 'kg' 로 바꾸면 값은 그대로인 채 단위만 커져 재고가 천 배로 틀린다).
  specUnitOptions: [
    { model: 'expense', column: 'specUnit' },
    { model: 'trackedItem', column: 'specUnit' },
  ],
  qtyUnitOptions: [
    { model: 'expense', column: 'qtyUnit' },
    { model: 'trackedItem', column: 'qtyUnit' },
  ],
  paymentMethods: [
    { model: 'expense', column: 'payMethod' },
    { model: 'extraIncome', column: 'payMethod' },
    { model: 'paymentRecord', column: 'payMethod' },
    { model: 'recurringExpense', column: 'payMethod' },
    { model: 'leaseTerm', column: 'payMethod' },
  ],
  roomTypeOptions:   [{ model: 'room', column: 'type' }],
  roomTierOptions:   [{ model: 'room', column: 'tier' }],
  windowTypeOptions: [{ model: 'room', column: 'windowType' }],
  directionOptions:  [{ model: 'room', column: 'direction' }],
  // 지나간 작업 기록이 옛 이름으로 남으면 목록에 없는 이름이 캘린더에 계속 선다.
  // RoomWork 는 소프트삭제 익스텐션 대상이 아니라(lib/prisma SOFT_DELETE_MODELS 는 둘뿐)
  // count 와 updateMany 가 둘 다 삭제분을 포함한다 — RENAME_SOFT_DELETE_MODELS 에 넣으면
  // 오히려 두 숫자가 갈린다(디자인 패널 지적 2026-08-25).
  workKindOptions:   [{ model: 'roomWork', column: 'kind' }],
}

// LeaseTerm.wishConditions(JSON) 안에서 이 옵션이 대응하는 키 — 예약자의 희망 조건도 같은 라벨을 쓴다.
const RENAME_WISH_KEY: Partial<Record<ReorderableField, 'type' | 'windowType' | 'direction'>> = {
  roomTypeOptions:   'type',
  windowTypeOptions: 'windowType',
  directionOptions:  'direction',
}

// 소프트삭제 모델 — 삭제된 행의 payMethod 도 과거 표기라 함께 갱신한다.
// updateMany 는 익스텐션 필터 대상이 아니라 삭제분까지 바꾸므로, count 에도 deletedAt 을 명시해 필터를 끈다(건수 일치).
const RENAME_SOFT_DELETE_MODELS = new Set(['paymentRecord', 'extraIncome'])

function renameWhere(model: string, column: string, propertyId: string, oldValue: string) {
  const where: Record<string, unknown> = { propertyId, [column]: oldValue }
  if (RENAME_SOFT_DELETE_MODELS.has(model)) where.deletedAt = undefined
  return where
}

// contains 로 1차로 걸러온 행 중, 해당 키 값이 정확히 oldValue 인 행만.
function pickWishRows(rows: { id: string; wishConditions: string | null }[], key: string, oldValue: string) {
  return rows.filter(r => {
    try { return (JSON.parse(r.wishConditions ?? '{}') as Record<string, unknown>)[key] === oldValue } catch { return false }
  })
}

// inventoryCategories(JSON [{cat, alias}]) 의 cat 만 교체 — 바꿀 게 없으면 null(표시명 alias 는 사용자 설정이라 그대로).
function renameInventoryCategories(raw: string | null, oldValue: string, newValue: string): string | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    if (!arr.some((e: any) => e?.cat === oldValue)) return null
    return JSON.stringify(arr.map((e: any) => (e?.cat === oldValue ? { ...e, cat: newValue } : e)))
  } catch { return null }
}

// 이름 변경 시 함께 바뀔 데이터 건수 — 사전 고지용(읽기 전용).
export async function countRenameTargets(field: ReorderableField, oldValue: string): Promise<number> {
  const propertyId = await getPropertyId()
  let total = 0
  for (const t of RENAME_CASCADE[field]) {
    total += await (prisma as any)[t.model].count({ where: renameWhere(t.model, t.column, propertyId, oldValue) })
  }
  const wishKey = RENAME_WISH_KEY[field]
  if (wishKey) {
    const rows = await prisma.leaseTerm.findMany({
      where: { propertyId, wishConditions: { contains: oldValue } },
      select: { id: true, wishConditions: true },
    })
    total += pickWishRows(rows, wishKey, oldValue).length
  }
  if (field === 'expenseCategories') {
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { inventoryCategories: true } })
    // 존재 여부만 확인 — 같은 값으로 교체를 시도해 매칭되면 non-null.
    if (renameInventoryCategories(p?.inventoryCategories ?? null, oldValue, oldValue)) total += 1
  }
  return total
}

export type RenameOptionResult = { ok: true; updated: number } | { ok: false; error: string }

export async function renameOption(field: ReorderableField, oldValue: string, newValue: string): Promise<RenameOptionResult> {
  await requireEdit()
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { [field]: true } as any,
  })
  // 요청 카테고리는 미저장(빈 값)이 곧 기본 5종 — 그대로 split 하면 첫 이름변경에서 목록이 통째로 날아간다.
  const stored = (property as any)?.[field]
  const current: string[] = field === 'requestCategories'
    ? parseRequestCategories(stored)
    : (stored ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (newValue === oldValue) return { ok: true, updated: 0 }
  if (!current.includes(oldValue)) return { ok: true, updated: 0 }
  if (current.includes(newValue)) return { ok: false, error: '이미 있는 이름입니다.' }
  // 단위는 **표기만** 고치는 자리다. 뜻이 바뀌는 변경은 막는다 — 저장된 숫자는 그대로인 채
  // 단위만 커지면 재고가 조용히 천 배로 틀린다. 값까지 환산하는 길은 재고 관리에 따로 있다.
  if (field === 'specUnitOptions' || field === 'qtyUnitOptions') {
    const a = canonicalUnit(oldValue), b = canonicalUnit(newValue)
    if ((isConvertibleUnit(oldValue) || isConvertibleUnit(newValue)) && a !== b) {
      return { ok: false, error: `'${oldValue}' 과 '${newValue}' 은 크기가 다른 단위라 이름만 바꾸면 저장된 수량이 틀어집니다. 재고 관리에서 품목별 단위 변환을 쓰면 값까지 함께 환산됩니다.` }
    }
  }

  const updated = current.map(v => v === oldValue ? newValue : v).join(',')
  const wishKey = RENAME_WISH_KEY[field]
  // 목록 갱신과 데이터 갱신은 한 트랜잭션 — 중간에 끊기면 라벨이 갈린다.
  const changed = await prisma.$transaction(async (tx) => {
    let n = 0
    await tx.property.update({
      where: { id: propertyId },
      data: { [field]: updated } as any,
    })
    for (const t of RENAME_CASCADE[field]) {
      const res = await (tx as any)[t.model].updateMany({
        where: renameWhere(t.model, t.column, propertyId, oldValue),
        data: { [t.column]: newValue },
      })
      n += res.count
    }
    if (wishKey) {
      const rows = await tx.leaseTerm.findMany({
        where: { propertyId, wishConditions: { contains: oldValue } },
        select: { id: true, wishConditions: true },
      })
      for (const r of pickWishRows(rows, wishKey, oldValue)) {
        const cond = JSON.parse(r.wishConditions ?? '{}') as Record<string, unknown>
        cond[wishKey] = newValue
        await tx.leaseTerm.update({ where: { id: r.id }, data: { wishConditions: JSON.stringify(cond) } })
        n += 1
      }
    }
    if (field === 'expenseCategories') {
      const p = await tx.property.findUnique({ where: { id: propertyId }, select: { inventoryCategories: true } })
      const nextInv = renameInventoryCategories(p?.inventoryCategories ?? null, oldValue, newValue)
      if (nextInv) {
        await tx.property.update({ where: { id: propertyId }, data: { inventoryCategories: nextInv } })
        n += 1
      }
    }
    return n
  })

  revalidatePath('/settings')
  if (field === 'incomeCategories' || field === 'expenseCategories' || field === 'paymentMethods') {
    revalidatePath('/finance')
  }
  if (field === 'roomTypeOptions' || field === 'roomTierOptions' || field === 'windowTypeOptions' || field === 'directionOptions') {
    revalidatePath('/room-manage')
  }
  if (field === 'requestCategories') revalidatePath('/requests')
  // 데이터까지 바뀌었으니 그 값을 보여주는 화면도 함께 무효화.
  if (field === 'expenseCategories') revalidatePath('/inventory')
  if (field === 'paymentMethods') revalidatePath('/tenants')
  if (RENAME_CASCADE[field].some(t => t.model === 'room')) revalidatePath('/rooms')
  return { ok: true, updated: changed }
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

// ── 영업장 설정 저장 ───────────────────────────────────────────────

// 환경설정의 영업장 칼럼 저장 출구는 여기 하나다. 다만 **폼은 탭마다 다르다** —
// 기본정보(영업장명·주소·연락처·날짜·연락 알림), 요금·정책(보증금·청소비·예약금·위약금·환불 규정),
// 계약서·서류(전용면적·계좌번호·임의처분 동의서)가 각각 제 필드만 실어 보낸다(2026-08-19 IA 2단계).
// 그래서 이 함수는 값을 직접 읽지 않고 lib/propertySettingsPatch 에 맡긴다 — 그 정본이
// "실려 온 필드만 쓴다"는 규칙을 필드 단위로 쥐고 있다. 여기서 formData.get 을 다시 꺼내 쓰면
// 그 규칙 밖의 두 번째 저장 경로가 생겨 옆 탭 값을 null 로 덮는다(감지망 축 ⓕ 가 막는다).
export async function updatePropertySettings(formData: FormData) {
  await requireEdit()
  const propertyId = await getPropertyId()
  const isOwner = (await getMyRole()) === 'OWNER'

  // 패치를 먼저 만들고 그것을 검사한다 — formData 를 여기서 다시 읽으면 "실려 온 필드만 쓴다"
  // 규칙 밖의 두 번째 저장 경로가 생긴다(감지망 축 ⓕ).
  const patch = buildPropertySettingsPatch(formData, { isOwner })
  if (patch.mailFromLocal && isReservedMailLocal(patch.mailFromLocal)) {
    throw new Error('시스템이 쓰는 이름이라 보내는 주소로 쓸 수 없습니다. 다른 이름을 넣어 주세요.')
  }
  try {
    await prisma.property.update({ where: { id: propertyId }, data: patch })
  } catch (err) {
    // 발신 주소는 @unique 다. raw 메시지가 토스트에 그대로 찍히지 않게 사람 말로 옮긴다.
    if ((err as { code?: string })?.code === 'P2002') {
      throw new Error('이미 다른 영업장이 쓰고 있는 보내는 주소입니다. 다른 이름을 넣어 주세요.')
    }
    throw err
  }

  revalidatePath('/settings')
  revalidatePath('/rooms')
  revalidatePath('/marketing')
}

// 웹사이트 탭의 슬러그 저장 — 이 칼럼 하나만 쓴다(기본정보 통짜 저장과 분리).
// publicSlug 는 @unique 라 다른 영업장이 쓰는 값이면 P2002 가 난다. 통짜 저장 시절엔 그 raw 예외가
// 그대로 토스트에 찍혔다 — 여기서는 사람 말로 돌려준다.
export async function updatePublicSlug(raw: string): Promise<ActionResult> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const slug = normalizePublicSlug(raw)
    await prisma.property.update({
      where: { id: propertyId },
      data: { publicSlug: slug || null },
    })
    revalidatePath('/settings')
    revalidatePath('/rooms')
    revalidatePath('/marketing')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if ((err as { code?: string })?.code === 'P2002') {
      return { ok: false, error: '이미 다른 영업장이 쓰고 있는 주소입니다. 다른 주소를 넣어 주세요.' }
    }
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 계약서 (영업장별 템플릿 + 사업자 정보 + 도장) ─────────────────

export type ContractSettings = {
  template: ContractTemplate
  businessInfo: BusinessInfo
  stampDriveFileId: string | null
  stampThumbnailUrl: string | null
  /** 사업자등록증 사본 — null 이면 미등록. mimeType 으로 화면이 이미지·PDF 를 가른다. */
  bizCert: { driveFileId: string; mimeType: string } | null
}

const EMPTY_BUSINESS_INFO: BusinessInfo = {
  name: '', registrationNo: '', ceoName: '', address: '',
}

export async function getContractSettings(): Promise<ContractSettings> {
  const propertyId = await getPropertyId()
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      contractTemplate: true, businessInfo: true, stampDriveFileId: true,
      bizCertDriveFileId: true, bizCertMimeType: true,
    },
  })
  const template = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
  const businessInfo = (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO
  const stampDriveFileId = property?.stampDriveFileId ?? null
  return {
    template,
    businessInfo,
    stampDriveFileId,
    stampThumbnailUrl: stampDriveFileId ? await driveImageDataUrl(stampDriveFileId) : null,
    // 도장과 달리 바이트를 내려받지 않는다 — PDF 도 받는 자리라 최대 4MB 를 화면 열 때마다
    // 서버가 통째로 읽게 된다. 미리보기는 <img> 가 /api/biz-cert 프록시를 직접 물면 된다.
    bizCert: property?.bizCertDriveFileId
      ? { driveFileId: property.bizCertDriveFileId, mimeType: property.bizCertMimeType ?? '' }
      : null,
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
    // 사업자등록번호를 정규화한다 — 이 값은 계약서 헤더·푸터, 영수증 브랜드 줄,
    // 실거주확인서의 임대인 식별번호에 전부 찍힌다. 거래처 번호에는 이미 쓰는 규칙인데
    // 정작 우리 번호에는 안 쓰고 있었다(E페이즈 2026-08-03).
    const raw = (info.registrationNo ?? '').trim()
    const normalized = normalizeBizNo(raw)
    if (raw && !normalized) return { ok: false, error: '사업자등록번호는 숫자 10자리여야 합니다.' }
    await prisma.property.update({
      where: { id: propertyId },
      data: { businessInfo: { ...info, registrationNo: normalized ?? '' } as unknown as object },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

// ── 사업자등록증 사본 (도장과 같은 업로드 축, 이미지·PDF 둘 다 받음) ──────
//
// 상담 중 문자·메일 첨부로 그대로 나가는 원본이라 변환하지 않고 올린 형식 그대로 둔다.
// 도장처럼 공개 읽기 권한을 붙이지 않는다 — 사업자등록증은 상호·대표자·소재지가 한 장에 모인
// 서류라 링크만 알면 열리는 상태로 두면 안 된다. 화면도 전송도 /api/biz-cert 인증 프록시를 쓴다.
//
// 4MB 상한의 사정: 이 파일은 서버리스 함수가 바이트를 통째로 실어 응답한다(그 경로의 실질 한도가
// 4.5MB). 도장·로고의 5MB 를 그대로 쓰면 경계 부근 파일이 업로드는 되고 전송에서만 터진다.
const MAX_BIZ_CERT_BYTES = 4 * 1024 * 1024
const BIZ_CERT_MIME_OK = (m: string) => m.startsWith('image/') || m === 'application/pdf'

export async function createBizCertUploadSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!BIZ_CERT_MIME_OK(input.mimeType)) return { ok: false, error: '이미지 또는 PDF 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_BIZ_CERT_BYTES) return { ok: false, error: `파일 크기는 ${MAX_BIZ_CERT_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const propertyId = await getPropertyId()
    const ext = input.fileName.split('.').pop() ?? 'pdf'
    const uniqueName = `bizcert_${propertyId}_${Date.now()}.${ext}`
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

export async function finalizeBizCert(driveFileId: string): Promise<{ ok: true; mimeType: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const propertyId = await getPropertyId()
    // mime 은 클라이언트가 부르는 대로 믿지 않는다 — 저장된 값이 곧 전송 Content-Type 이 된다.
    // 같은 호출이 소유 검증도 겸한다(임의 Drive ID 를 우리 영업장 레코드로 편입하는 것을 막는 정본).
    const mimeType = await ownedDriveFileMime(driveFileId)
    if (!mimeType) return { ok: false, error: '업로드된 파일을 확인하지 못했습니다.' }
    if (!BIZ_CERT_MIME_OK(mimeType)) {
      try { await deleteFromDrive(driveFileId) } catch { /* 정리 실패 무시 */ }
      return { ok: false, error: '이미지 또는 PDF 파일만 업로드 가능합니다.' }
    }
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { bizCertDriveFileId: true },
    })
    // 교체된 원본은 영구 삭제가 아니라 휴지통으로 — 도장과 같은 규칙(30일 유예).
    if (prev?.bizCertDriveFileId && prev.bizCertDriveFileId !== driveFileId) {
      try { await trashInDrive(prev.bizCertDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { bizCertDriveFileId: driveFileId, bizCertMimeType: mimeType },
    })
    revalidatePath('/settings')
    return { ok: true, mimeType }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (driveFileId) {
      try { await deleteFromDrive(driveFileId) } catch { /* 정리 실패 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deleteBizCert(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { bizCertDriveFileId: true },
    })
    if (prev?.bizCertDriveFileId) {
      try { await trashInDrive(prev.bizCertDriveFileId) } catch { /* 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { bizCertDriveFileId: null, bizCertMimeType: null },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
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
    // 도장에는 공개 읽기 권한을 붙이지 않는다(D페이즈 2026-08-03).
    // 서류 PDF 는 잠갔는데 그 위에 찍히는 도장 원본이 공개라 아무나 받아 위조 서류에 얹을 수 있었다.
    // 대신 driveImageDataUrl 로 바이트를 직접 심는다 — 비로그인 서명 페이지와 헤드리스 PDF 렌더까지 덮는다.
    // 기존 도장이 있으면 Drive에서 정리
    const prev = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { stampDriveFileId: true },
    })
    if (prev?.stampDriveFileId && prev.stampDriveFileId !== driveFileId) {
      // 영구 삭제가 아니라 휴지통으로 — 도장 원본은 사용자가 만든 유일본일 수 있는데 되돌릴 방법이 없었다.
      // Drive 휴지통은 30일 유예를 준다(E페이즈 2026-08-03).
      try { await trashInDrive(prev.stampDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
    }
    await prisma.property.update({
      where: { id: propertyId },
      data: { stampDriveFileId: driveFileId },
    })
    revalidatePath('/settings')
    return { ok: true, thumbnailUrl: (await driveImageDataUrl(driveFileId)) ?? '' }
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
      try { await trashInDrive(prev.stampDriveFileId) } catch { /* 무시 */ }
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
      try { await trashInDrive(prev.logoDriveFileId) } catch { /* 이전 파일 정리 실패 무시 */ }
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
      try { await trashInDrive(prev.logoDriveFileId) } catch { /* 무시 */ }
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
  vendor: string | null
  financialAccountId: string | null
  financialAccountName: string | null
  isAutoDebit: boolean
  isVariable: boolean
  alertDaysBefore: number
  isActive: boolean
  activeSince: string | null
  // 주기(신고 7e7da5c4) — 1=매월 · 2=격월 · 3=분기 · 6=반기 · 12=연1회. anchorMonth null 이면
  // activeSince(없으면 createdAt)의 달이 기준이다(판정 정본 lib/recurringDueDate).
  intervalMonths: number
  anchorMonth: number | null
  createdAt: string
  priorYearAmount: number | null   // 운영자가 손으로 적어 둔 전년 동월 실적(추정 사다리에서 3개월 평균보다 우선)
  memo: string | null
  isGroup: boolean   // 묶기로 만든 부모 — '묶기 해제' 노출용
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
      payMethod: true, vendor: true, financialAccountId: true,
      financialAccount: { select: { brand: true, alias: true } },
      isAutoDebit: true, isVariable: true, alertDaysBefore: true,
      isActive: true, activeSince: true, priorYearAmount: true, memo: true, groupSourceIds: true,
      intervalMonths: true, anchorMonth: true, createdAt: true,
      items: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, amount: true, isVariable: true, sortOrder: true } },
    },
  })
  return list.map(r => ({
    ...r,
    isGroup: Array.isArray(r.groupSourceIds) && (r.groupSourceIds as unknown[]).length > 0,
    groupSourceIds: undefined,
    financialAccountName: r.financialAccount
      ? (r.financialAccount.alias || r.financialAccount.brand)
      : null,
    financialAccount: undefined,
    activeSince: r.activeSince ? new Date(r.activeSince).toISOString().slice(0, 10) : null,
    createdAt: new Date(r.createdAt).toISOString(),
  }))
}

/** 주기 입력 정규화 — 화이트리스트 밖 값은 매월로, 매월이면 기준 달은 없다. */
function normalizeCycle(
  intervalMonths: number | undefined, anchorMonth: number | null | undefined,
): { intervalMonths: number; anchorMonth: number | null } {
  const iv = RECURRING_INTERVAL_CHOICES.some(c => c.value === intervalMonths) ? intervalMonths! : 1
  if (iv <= 1) return { intervalMonths: 1, anchorMonth: null }
  const am = anchorMonth != null && anchorMonth >= 1 && anchorMonth <= 12 ? anchorMonth : null
  return { intervalMonths: iv, anchorMonth: am }
}

// #1: 세부항목으로부터 부모의 합계·변동여부 파생
function deriveFromItems(items: RecurringItemInput[]): { amount: number; isVariable: boolean } {
  const amount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const isVariable = items.some(it => it.isVariable)
  return { amount, isVariable }
}

export async function addRecurringExpense(data: {
  title: string; amount: number; category: string; dueDay: number
  payMethod?: string; vendor?: string; financialAccountId?: string | null; isAutoDebit?: boolean; isVariable?: boolean; alertDaysBefore?: number; activeSince?: string; priorYearAmount?: number | null; memo?: string
  intervalMonths?: number; anchorMonth?: number | null
  // #1 관리비 묶음: 세부항목. 있으면 amount/isVariable은 세부에서 파생.
  items?: RecurringItemInput[]
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { activeSince, items, intervalMonths, anchorMonth, ...rest } = data
    const hasItems = Array.isArray(items) && items.length > 0
    const derived = hasItems ? deriveFromItems(items!) : null
    const cycle = normalizeCycle(intervalMonths, anchorMonth)
    const rec = await prisma.recurringExpense.create({
      data: {
        propertyId, ...rest, isActive: true, ...cycle,
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
  payMethod: string | null; vendor: string | null; financialAccountId: string | null; isAutoDebit: boolean; isVariable: boolean; alertDaysBefore: number; isActive: boolean; activeSince: string | null; priorYearAmount: number | null; memo: string | null
  intervalMonths: number; anchorMonth: number | null
  // #1 관리비 묶음: 세부항목 전체 교체(있으면 amount/isVariable 파생). undefined면 항목 미변경.
  items: RecurringItemInput[]
}>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { activeSince, items, intervalMonths, anchorMonth, ...rest } = data
    const updateData: Record<string, unknown> = { ...rest }
    // 주기는 둘이 한 벌이다 — 매월로 되돌리면 기준 달을 null 로 정규화해 낡은 값이 유령으로
    // 남지 않게 한다(다시 격월로 바꿨을 때 옛 기준 달이 살아나면 도래 달이 제멋대로다).
    if ('intervalMonths' in data || 'anchorMonth' in data) {
      Object.assign(updateData, normalizeCycle(intervalMonths, anchorMonth))
    }
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
          groupSourceIds: sources.map(s => s.id),   // 묶기 해제 시 원본 복구용
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

  const [property, rooms, tenants, leaseTerms, paymentRecords, expenses, extraIncomes, financialAccounts, recurringExpenses, tenantContacts, tenantStatusLogs, tenantRequests, storageLocations, trackedItems, trackedItemLocations, stockChecks, stockAdditions, stockDisposals] = await Promise.all([
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
    // 무효 처리분 제외 — 백업은 복원 시 deletedAt 을 안 되살리므로 포함하면 무효 행이 유효로 살아난다
    // (tenantRequest 와 같은 규약, knowledge/soft-delete-pattern '백업 export').
    prisma.tenantStatusLog.findMany({ where: { propertyId, deletedAt: null } }),
    prisma.tenantRequest.findMany({ where: { propertyId, deletedAt: null } }),
    // 재고 도메인 — 백업에 통째로 빠져 있던 공백 보완(복원 시 재고 데이터 전손 방지, 2026-07-13)
    prisma.storageLocation.findMany({ where: { propertyId } }),
    prisma.trackedItem.findMany({ where: { propertyId } }),
    // 품목-위치 링크 — closedAt(위치 숨김)이 이 테이블에만 저장되므로 빠지면 복원 불가 데이터가 된다(2026-07-18 보완)
    prisma.trackedItemLocation.findMany({ where: { trackedItem: { propertyId } } }),
    prisma.stockCheck.findMany({ where: { trackedItem: { propertyId } }, include: { locationBreakdown: true } }),
    prisma.stockAddition.findMany({ where: { trackedItem: { propertyId } } }),
    prisma.stockDisposal.findMany({ where: { trackedItem: { propertyId } } }),
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
    storageLocations,
    trackedItems,
    trackedItemLocations,
    stockChecks,
    stockAdditions,
    stockDisposals,
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

// ============================================================
// AI(제미나이) 설정 — 본인 API 키(BYOK) + 모델. 공지 AI 다듬기는 키 등록 시 사용 가능.
// 키는 서버 전용 — 클라이언트에는 마스킹(앞 6자)만 내려준다.
// ============================================================
export type AiSettings = { keyMasked: string | null; model: string | null; usedThisMonth: number; limit: number; isOwner: boolean }

// 공용 키 무료 사용 현황 — AI 실행 직후 UI가 잔여를 토스트로 보여줄 때 사용(본인 키면 own: true)
export async function getAiQuotaStatus(): Promise<{ own: boolean; used: number; remaining: number; limit: number }> {
  const propertyId = await getPropertyId()
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { owner: { select: { geminiApiKey: true } } } })
  if (p?.owner?.geminiApiKey?.trim()) return { own: true, used: 0, remaining: 0, limit: FREE_MONTHLY_AI_LIMIT }
  const month = kstMonthStr()   // 소모 쪽(lib/geminiKey)과 같은 KST 월 버킷이어야 잔여 표시가 어긋나지 않는다
  const row = await prisma.aiUsage.findUnique({ where: { propertyId_month: { propertyId, month } }, select: { count: true } })
  const used = Math.min(row?.count ?? 0, FREE_MONTHLY_AI_LIMIT)
  return { own: false, used, remaining: FREE_MONTHLY_AI_LIMIT - used, limit: FREE_MONTHLY_AI_LIMIT }
}

export async function getAiSettings(): Promise<AiSettings> {
  const { user, propertyId } = await getPropertyIdWithUser()
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { ownerId: true, owner: { select: { geminiApiKey: true, geminiModel: true } } },
  })
  const key = p?.owner?.geminiApiKey?.trim() || null
  const month = kstMonthStr()   // 소모 쪽(lib/geminiKey)과 같은 KST 월 버킷이어야 잔여 표시가 어긋나지 않는다
  const row = await prisma.aiUsage.findUnique({ where: { propertyId_month: { propertyId, month } }, select: { count: true } }).catch(() => null)
  return {
    keyMasked: key ? `${key.slice(0, 6)}${'*'.repeat(Math.max(4, key.length - 6))}` : null,
    model: p?.owner?.geminiModel ?? null,
    usedThisMonth: Math.min(row?.count ?? 0, FREE_MONTHLY_AI_LIMIT),
    limit: FREE_MONTHLY_AI_LIMIT,
    isOwner: p?.ownerId === user.sub,
  }
}

export async function saveAiSettings(input: { apiKey?: string | null; model?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { user, propertyId } = await getPropertyIdWithUser()
    // 키는 소유 관리자 계정에 저장(그 관리자의 모든 영업장 공유) — 소유자 본인만 변경 가능
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } })
    if (!p || p.ownerId !== user.sub) return { ok: false, error: 'AI 설정은 영업장 소유 관리자 계정에서만 변경할 수 있습니다.' }
    const data: { geminiApiKey?: string | null; geminiModel?: string | null } = {}
    if (input.apiKey !== undefined) {
      const k = (input.apiKey ?? '').trim()
      if (k && !/^[A-Za-z0-9_-]{20,}$/.test(k)) return { ok: false, error: 'API 키 형식이 올바르지 않습니다. 복사한 키를 그대로 붙여넣어 주세요.' }
      data.geminiApiKey = k || null
    }
    if (input.model !== undefined) data.geminiModel = (input.model ?? '').trim() || null
    await prisma.user.update({ where: { id: user.sub }, data })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

// ============================================================
// 미납 안내 문자 템플릿 (/docs/stayeum_payment_spec.md Phase 1)
//   지원 변수: {이름} {호수} {미납금액} {납기일} {경과일수} {계좌번호}
// ============================================================
export type SmsTemplateRow = { id: string; name: string; body: string; sortOrder: number }

export async function getSmsTemplates(kind: 'unpaid' | 'notice' | 'personal' = 'unpaid'): Promise<SmsTemplateRow[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.smsTemplate.findMany({
    where: { propertyId, kind }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, body: true, sortOrder: true },
  })
  return rows
}

export async function saveSmsTemplate(input: { id?: string; name: string; body: string; kind?: 'unpaid' | 'notice' | 'personal' }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const name = input.name.trim()
    const body = input.body.trim()
    if (!name) return { ok: false, error: '템플릿 이름을 입력하세요.' }
    if (!body) return { ok: false, error: '문자 내용을 입력하세요.' }
    if (input.id) {
      const r = await prisma.smsTemplate.updateMany({ where: { id: input.id, propertyId }, data: { name, body } })
      if (r.count === 0) return { ok: false, error: '템플릿을 찾을 수 없습니다.' }
      revalidatePath('/settings')
      return { ok: true, id: input.id }
    }
    const kind = input.kind ?? 'unpaid'
    const last = await prisma.smsTemplate.findFirst({ where: { propertyId, kind }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const row = await prisma.smsTemplate.create({ data: { propertyId, name, body, kind, sortOrder: (last?.sortOrder ?? -1) + 1 } })
    revalidatePath('/settings')
    return { ok: true, id: row.id }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

export async function deleteSmsTemplate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.smsTemplate.deleteMany({ where: { id, propertyId } })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}


// ============================================================
// 서류 메일 문안 (2026-08-25 운영자 승인) — Property.docMailTemplate
//   프레임(헤더·첨부 상자·푸터)은 공유, 본문 영역만 영업장이 바꾼다(lib/docMail 정본).
//   지원 변수: {영업장명} {이름} {서류목록} (제목은 {영업장명}만 — 잠금화면 원칙)
// ============================================================

export async function getDocMailSettings(): Promise<{
  template: DocMailTemplate
  customized: boolean
  /** 내장 기본 문안 — 카드의 placeholder 가 이걸 그대로 쓴다(사본 금지: lib/docMail 이 정본). */
  defaults: { subject: string; body: string }
}> {
  const propertyId = await getPropertyId()
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { docMailTemplate: true } })
  return {
    template: parseDocMailTemplate(p?.docMailTemplate),
    customized: p?.docMailTemplate != null,
    defaults: { subject: DOC_MAIL_DEFAULT_SUBJECT, body: DOC_MAIL_DEFAULT_BODY },
  }
}

/**
 * 문안 저장 — null 이면 기본으로(칼럼 null). 오타 변수·상한 초과는 인라인 에러로 저장을 막는다
 * (§27.2 검증=인라인). HTML 은 여기서 새니타이즈해 저장하고, 렌더가 한 번 더 통과시킨다.
 */
export async function updateDocMailTemplate(
  input: DocMailTemplate | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()

    if (input !== null) {
      const checks: [string | null, 'subject' | 'body', string][] = [
        [input.subject, 'subject', '제목'],
        [input.bodyText, 'body', '본문'],
        [input.closingText, 'body', '맺음말'],
        [input.bodyHtml, 'body', 'HTML 본문'],
      ]
      for (const [text, scope, label] of checks) {
        if (!text) continue
        const unknown = findUnknownVars(text, scope)
        if (unknown.length > 0) {
          const allowed = scope === 'subject' ? '{영업장명}' : '{영업장명} {이름} {서류목록}'
          return { ok: false, error: `${label}에 알 수 없는 변수 ${unknown.join(' ')} 이(가) 있습니다. 사용 가능: ${allowed}` }
        }
      }
      if ((input.subject?.length ?? 0) > DOC_MAIL_LIMITS.subject) return { ok: false, error: `제목은 ${DOC_MAIL_LIMITS.subject}자까지입니다.` }
      if ((input.bodyText?.length ?? 0) > DOC_MAIL_LIMITS.bodyText) return { ok: false, error: `본문은 ${DOC_MAIL_LIMITS.bodyText}자까지입니다.` }
      if ((input.closingText?.length ?? 0) > DOC_MAIL_LIMITS.closingText) return { ok: false, error: `맺음말은 ${DOC_MAIL_LIMITS.closingText}자까지입니다.` }
      if ((input.bodyHtml?.length ?? 0) > DOC_MAIL_LIMITS.bodyHtml) return { ok: false, error: `HTML 본문은 ${DOC_MAIL_LIMITS.bodyHtml}자까지입니다.` }
      if (input.mode === 'html' && !input.bodyHtml?.trim()) return { ok: false, error: '직접 HTML 본문을 입력해 주세요.' }
      // 새니타이즈가 전부 걷어낸 HTML(예: script 뿐)은 소리 없이 기본으로 강등되지 않게 여기서 막는다.
      if (input.mode === 'html' && input.bodyHtml?.trim() && !sanitizeDocMailHtml(input.bodyHtml).trim()) {
        return { ok: false, error: '저장할 수 있는 내용이 없습니다. script·외부 이미지 등은 제거됩니다. 표와 문단 위주로 작성해 주세요.' }
      }
    }

    // 전부 비운 기본 문안 저장은 칼럼 null 과 같다 — '기본 문안으로 복원' 후 저장이 이 길이다.
    const normalized: DocMailTemplate | null = input && (
      input.mode === 'html' || input.subject?.trim() || input.bodyText?.trim()
      || input.closingText?.trim() || input.bodyHtml?.trim()
    ) ? {
        mode: input.mode,
        subject: input.subject?.trim() || null,
        bodyText: input.bodyText?.trim() ? input.bodyText : null,
        closingText: input.closingText?.trim() ? input.closingText : null,
        bodyHtml: input.bodyHtml?.trim() ? sanitizeDocMailHtml(input.bodyHtml) : null,
      } : null

    await prisma.property.update({
      where: { id: propertyId },
      data: { docMailTemplate: normalized === null ? Prisma.DbNull : normalized },
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

/**
 * 저장 전 미리보기 — 폼 값 그대로 받아 발송과 같은 renderDocMail 로 그린다(거짓말 불가 원칙).
 * 예시 값(입주자 이름·서류 2종)으로 채우고, 영업장명·전화는 실제 값을 쓴다. 받은 HTML 은
 * 새니타이즈를 지나 sandbox iframe 에만 들어간다 — 메일로 나가는 길이 아니다.
 */
export async function renderDocMailSample(
  input: DocMailTemplate,
): Promise<{ ok: true; subject: string; html: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, phone: true } })
    const rendered = renderDocMail(parseDocMailTemplate(input), {
      propertyName: p?.name ?? '스테이음',
      propertyPhone: p?.phone ?? null,
      tenantName: '홍길동',
      docTitles: ['계약서', '입실료 납부 확인서'],
      attachmentNames: ['홍길동 계약서 2026.01.15.pdf', '홍길동 입실료 납부 확인서 2026.01.15.pdf'],
    })
    return { ok: true, subject: rendered.subject, html: rendered.html }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '미리보기를 만들지 못했습니다.' }
  }
}


// 정기지출 묶기 해제 — 원본들을 다시 활성화하고 부모(묶음)를 삭제. 부모로 기록된 지출(Expense)은 보존.
export async function ungroupRecurringExpense(parentId: string): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const parent = await prisma.recurringExpense.findFirst({ where: { id: parentId, propertyId }, select: { groupSourceIds: true } })
    if (!parent) return { ok: false, error: '항목을 찾을 수 없습니다.' }
    const ids = Array.isArray(parent.groupSourceIds) ? (parent.groupSourceIds as string[]) : []
    if (ids.length === 0) return { ok: false, error: '묶기로 만든 항목이 아니거나 원본 정보가 없습니다.' }
    const restored = await prisma.$transaction(async (tx) => {
      const r = await tx.recurringExpense.updateMany({ where: { id: { in: ids }, propertyId }, data: { isActive: true } })
      await tx.recurringExpense.delete({ where: { id: parentId } })
      return r.count
    })
    revalidatePath('/settings'); revalidatePath('/finance')
    return { ok: true, restored }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
