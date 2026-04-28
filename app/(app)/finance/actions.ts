'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'

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

export async function getRoomList() {
  const propertyId = await getPropertyId()
  return prisma.room.findMany({
    where: { propertyId },
    select: { id: true, roomNo: true },
    orderBy: { roomNo: 'asc' },
  })
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
    include: {
      financialAccount: { select: { brand: true, alias: true } },
      room: { select: { id: true, roomNo: true } },
      recurringExpense: { select: { isVariable: true } },
    },
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
    const roomId             = formData.get('roomId') as string

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
        roomId:             roomId || null,
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
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
    const roomId             = formData.get('roomId') as string

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
        roomId:             roomId || null,
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
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
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
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
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
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
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteFinancialAccount(id: string) {
  await requireEdit()
  await prisma.financialAccount.delete({ where: { id } })
  revalidatePath('/finance')
}

export async function deactivateFinancialAccount(id: string) {
  await requireEdit()
  await prisma.financialAccount.update({ where: { id }, data: { isActive: false } })
  revalidatePath('/finance')
}

// ── 고정 지출 현황 ───────────────────────────────────────────────

export type RecurringExpenseWithStatus = {
  id: string
  title: string
  amount: number
  category: string
  dueDay: number
  payMethod: string | null
  isAutoDebit: boolean
  isVariable: boolean
  alertDaysBefore: number
  activeSince: string | null
  isPending: boolean        // activeSince가 이번 달 이후 → 아직 활성화 전
  memo: string | null
  // 이번 달 기록 여부
  recordedExpenseId: string | null
  recordedAmount: number | null
  recordedDate: string | null
  // 변동 항목 과거 평균
  historicalAvg: number | null
}

export async function getRecurringExpensesWithStatus(month: string): Promise<RecurringExpenseWithStatus[]> {
  const propertyId = await getPropertyId()
  const [year, m] = month.split('-').map(Number)
  const startDate = new Date(year, m - 1, 1)
  const endDate   = new Date(year, m, 0)

  const [allRecurring, recordedThisMonth] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { propertyId, isActive: true },
      orderBy: { dueDay: 'asc' },
    }),
    prisma.expense.findMany({
      where: { propertyId, recurringExpenseId: { not: null }, date: { gte: startDate, lte: endDate } },
      select: { id: true, recurringExpenseId: true, amount: true, date: true },
    }),
  ])

  // activeSince: 이번 달 마지막 날보다 미래면 isPending=true (목록엔 표시하되 기록 불가)
  const recurringList = allRecurring

  const recordedMap = new Map(recordedThisMonth.map(e => [e.recurringExpenseId!, e]))

  // 변동 항목 최근 3개월 평균 + 전년동월 수치 (isPending 항목 제외)
  const variableIds = recurringList.filter(re => (re as any).isVariable && !(new Date((re as any).activeSince ?? 0) > endDate)).map(re => re.id)
  const threeMonthsAgo = new Date(year, m - 4, 1) // 3개월 전 1일
  const pastExpenses = variableIds.length > 0
    ? await prisma.expense.findMany({
        where: { propertyId, recurringExpenseId: { in: variableIds }, date: { gte: threeMonthsAgo, lt: startDate } },
        select: { recurringExpenseId: true, amount: true },
      })
    : []

  const varSum: Record<string, number> = {}
  const varCnt: Record<string, number> = {}
  for (const e of pastExpenses) {
    const id = e.recurringExpenseId!
    varSum[id] = (varSum[id] ?? 0) + e.amount
    varCnt[id] = (varCnt[id] ?? 0) + 1
  }

  return recurringList.map(re => {
    const recorded = recordedMap.get(re.id)
    const isVar = (re as any).isVariable as boolean
    const priorYearAmt = (re as any).priorYearAmount as number | null
    const recentCnt = varCnt[re.id] ?? 0
    const recentSum = varSum[re.id] ?? 0
    let historicalAvgVal: number | null = null
    if (isVar) {
      const dataPoints: number[] = []
      if (recentCnt >= 1) dataPoints.push(Math.round(recentSum / recentCnt))
      if (priorYearAmt) dataPoints.push(priorYearAmt)
      if (dataPoints.length >= 1) {
        historicalAvgVal = Math.round(dataPoints.reduce((s, v) => s + v, 0) / dataPoints.length)
      }
    }
    const as = (re as any).activeSince as Date | null
    const isPending = !!(as && new Date(as) > endDate)
    return {
      id:                re.id,
      title:             re.title,
      amount:            re.amount,
      category:          re.category,
      dueDay:            re.dueDay,
      payMethod:         re.payMethod,
      isAutoDebit:       re.isAutoDebit,
      isVariable:        isVar,
      alertDaysBefore:   re.alertDaysBefore,
      activeSince:       as ? new Date(as).toISOString().slice(0, 10) : null,
      isPending,
      memo:              re.memo,
      recordedExpenseId: isPending ? null : (recorded?.id ?? null),
      recordedAmount:    isPending ? null : (recorded?.amount ?? null),
      recordedDate:      isPending ? null : (recorded ? new Date(recorded.date).toISOString().slice(0, 10) : null),
      historicalAvg:     historicalAvgVal,
    }
  })
}

// ── 고정 지출 기록 ───────────────────────────────────────────────

export async function recordRecurringExpense(data: {
  recurringExpenseId: string
  amount: number
  date: string
  payMethod?: string
  memo?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const recurring = await prisma.recurringExpense.findUnique({
      where: { id: data.recurringExpenseId },
      select: { category: true, title: true, payMethod: true },
    })
    if (!recurring) return { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' }

    await prisma.expense.create({
      data: {
        propertyId,
        date:                new Date(data.date),
        amount:              data.amount,
        category:            recurring.category,
        detail:              recurring.title,
        payMethod:           data.payMethod ?? recurring.payMethod ?? '계좌이체',
        memo:                data.memo ?? null,
        settleStatus:        (data.payMethod ?? recurring.payMethod) === '신용카드' ? 'UNSETTLED' : 'SETTLED',
        recurringExpenseId:  data.recurringExpenseId,
      },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}
