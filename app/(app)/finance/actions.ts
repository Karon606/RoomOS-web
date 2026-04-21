'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { isRedirectError } from 'next/dist/client/components/redirect'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

function parseAmount(raw: FormDataEntryValue | null): number {
  return Number(String(raw ?? '').replace(/[^0-9]/g, '')) || 0
}

// ── 지출 ────────────────────────────────────────────────────────

export async function getExpenses(targetMonth: string) {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  return prisma.expense.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    orderBy: { date: 'desc' },
    include: { financialAccount: { select: { brand: true, alias: true } } },
  })
}

export async function getUnsettledExpenses() {
  const propertyId = await getPropertyId()
  return prisma.expense.findMany({
    where: { propertyId, settleStatus: 'UNSETTLED' },
    orderBy: { date: 'asc' },
    include: {
      financialAccount: {
        select: {
          id: true, brand: true, alias: true,
          cutOffDay: true, payDay: true,
          linkedAccount: { select: { brand: true, alias: true } },
        },
      },
    },
  })
}

export async function getSettledCardExpenses(targetMonth?: string) {
  const propertyId = await getPropertyId()
  // targetMonth가 있으면 해당 월 ±2달 범위, 없으면 최근 4달
  const since = new Date()
  if (targetMonth) {
    const [y, m] = targetMonth.split('-').map(Number)
    since.setFullYear(y, m - 3, 1)
  } else {
    since.setMonth(since.getMonth() - 4)
  }
  return prisma.expense.findMany({
    where: {
      propertyId,
      settleStatus: 'SETTLED',
      payMethod: { in: ['신용카드', '체크카드'] },
      date: { gte: since },
    },
    orderBy: { date: 'asc' },
    include: {
      financialAccount: {
        select: {
          id: true, brand: true, alias: true,
          cutOffDay: true, payDay: true,
          linkedAccount: { select: { brand: true, alias: true } },
        },
      },
    },
  })
}

export async function addExpense(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    const financeName        = formData.get('financeName') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.expense.create({
      data: {
        propertyId,
        date:               new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        financeName:        financeName || null,
        settleStatus:       payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED',
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExpense(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    const financeName        = formData.get('financeName') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.expense.update({
      where: { id },
      data: {
        date:               new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        financeName:        financeName || null,
        settleStatus:       payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED',
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteExpense(id: string) {
  await requireEdit()
  await prisma.expense.delete({ where: { id } })
  revalidatePath('/finance')
}

export async function settleCardExpenses(ids: string[]) {
  await requireEdit()
  await prisma.expense.updateMany({
    where: { id: { in: ids }, settleStatus: 'UNSETTLED' },
    data: { settleStatus: 'SETTLED' },
  })
  revalidatePath('/finance')
}

export async function unsettleExpenses(ids: string[]) {
  await requireEdit()
  await prisma.expense.updateMany({
    where: { id: { in: ids } },
    data: { settleStatus: 'UNSETTLED' },
  })
  revalidatePath('/finance')
}

// ── 부가 수익 ────────────────────────────────────────────────────

export async function getExtraIncomes(targetMonth: string) {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  return prisma.extraIncome.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    orderBy: { date: 'desc' },
    include: { financialAccount: { select: { brand: true, alias: true } } },
  })
}

export async function addExtraIncome(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.extraIncome.create({
      data: {
        propertyId,
        date: new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExtraIncome(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.extraIncome.update({
      where: { id },
      data: {
        date: new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteExtraIncome(id: string) {
  await requireEdit()
  await prisma.extraIncome.delete({ where: { id } })
  revalidatePath('/finance')
}

// ── 자산 ─────────────────────────────────────────────────────────

export async function getFinancialAccounts() {
  const propertyId = await getPropertyId()
  return prisma.financialAccount.findMany({
    where: { propertyId, isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      linkedAccount: { select: { id: true, brand: true, alias: true } },
    },
  })
}

export async function saveFinancialAccount(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const id   = formData.get('id') as string
    const type = formData.get('type') as string
    const brand = formData.get('brand') as string
    const alias      = formData.get('alias') as string
    const identifier = formData.get('identifier') as string
    const owner      = formData.get('owner') as string
    const payDayRaw    = formData.get('payDay') as string
    const cutOffDayRaw = formData.get('cutOffDay') as string
    const linkedAccountId = formData.get('linkedAccountId') as string

    if (!brand) return { ok: false, error: '금융사명은 필수입니다.' }

    const parseDay = (raw: string) => {
      if (!raw) return null
      if (raw.includes('말')) return 31
      const n = parseInt(raw.replace(/[^0-9]/g, ''))
      return isNaN(n) ? null : n
    }

    const data = {
      type:             type as any,
      brand,
      alias:            alias || null,
      identifier:       identifier || null,
      owner:            owner || null,
      payDay:           parseDay(payDayRaw),
      cutOffDay:        parseDay(cutOffDayRaw),
      linkedAccountId:  linkedAccountId || null,
    }

    if (id) {
      await prisma.financialAccount.update({ where: { id }, data })
    } else {
      await prisma.financialAccount.create({ data: { ...data, propertyId } })
    }
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if (isRedirectError(err)) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteFinancialAccount(id: string) {
  await requireEdit()
  await prisma.financialAccount.delete({ where: { id } })
  revalidatePath('/finance')
}
