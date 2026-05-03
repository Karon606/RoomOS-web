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

export const TRACKED_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비'] as const

export type InventoryRow = {
  id: string
  category: string
  label: string
  specUnit: string | null
  qtyUnit: string | null
  isArchived: boolean
  lastCheckDate: Date | null
  lastRemainingQty: number | null
  currentStock: number | null              // lastCheck 시점 + 이후 입고 (구매 + 무상)
  avgDaily: number | null                  // 최근 90일 평균 소모/일
  daysUntilEmpty: number | null            // currentStock / avgDaily
  lastPeriodConsumption: number | null     // 가장 최근 두 점검 사이 소모량
  lastPeriodDays: number | null
}

// ── 카테고리·라벨 매칭으로 그 기간의 구매량 합계
async function sumPurchases(propertyId: string, category: string, label: string, qtyUnit: string | null, from: Date | null, to: Date | null): Promise<number> {
  const where: any = {
    propertyId,
    category,
    itemLabel: label,
    ...(qtyUnit ? { qtyUnit } : {}),
  }
  if (from || to) {
    where.date = {}
    if (from) where.date.gt = from   // exclusive: prevCheck.date 이후
    if (to)   where.date.lte = to    // inclusive: currCheck.date까지
  }
  const r = await prisma.expense.aggregate({
    where,
    _sum: { qtyValue: true },
  })
  return r._sum.qtyValue ?? 0
}

async function sumAdditions(trackedItemId: string, from: Date | null, to: Date | null): Promise<number> {
  const where: any = { trackedItemId }
  if (from || to) {
    where.date = {}
    if (from) where.date.gt = from
    if (to)   where.date.lte = to
  }
  const r = await prisma.stockAddition.aggregate({
    where,
    _sum: { addedQty: true },
  })
  return r._sum.addedQty ?? 0
}

// ── 추적 품목 목록 + 계산된 지표
export async function getInventoryOverview(): Promise<InventoryRow[]> {
  const propertyId = await getPropertyId()
  const items = await prisma.trackedItem.findMany({
    where: { propertyId, isArchived: false },
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
    include: {
      stockChecks: { orderBy: { date: 'desc' }, take: 2 },
    },
  })

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const rows: InventoryRow[] = []
  for (const it of items) {
    const last = it.stockChecks[0] ?? null
    const prev = it.stockChecks[1] ?? null

    let currentStock: number | null = null
    if (last) {
      const incomingPurchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, last.date, today)
      const incomingAdditions = await sumAdditions(it.id, last.date, today)
      currentStock = last.remainingQty + incomingPurchases + incomingAdditions
    }

    let lastPeriodConsumption: number | null = null
    let lastPeriodDays: number | null = null
    if (last && prev) {
      const purchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, prev.date, last.date)
      const additions = await sumAdditions(it.id, prev.date, last.date)
      lastPeriodConsumption = (prev.remainingQty + purchases + additions) - last.remainingQty
      lastPeriodDays = Math.max(1, Math.round((last.date.getTime() - prev.date.getTime()) / 86400000))
    }

    // 최근 90일 평균: 점검 두 개 이상이면 그 사이 소모량 / 일수
    let avgDaily: number | null = null
    if (lastPeriodConsumption != null && lastPeriodDays && lastPeriodDays > 0 && lastPeriodConsumption > 0) {
      avgDaily = lastPeriodConsumption / lastPeriodDays
    }

    const daysUntilEmpty = (currentStock != null && avgDaily && avgDaily > 0)
      ? Math.floor(currentStock / avgDaily)
      : null

    rows.push({
      id: it.id,
      category: it.category,
      label: it.label,
      specUnit: it.specUnit,
      qtyUnit: it.qtyUnit,
      isArchived: it.isArchived,
      lastCheckDate: last?.date ?? null,
      lastRemainingQty: last?.remainingQty ?? null,
      currentStock,
      avgDaily,
      daysUntilEmpty,
      lastPeriodConsumption,
      lastPeriodDays,
    })
  }
  return rows
}

// ── 단일 품목 상세 — 점검 + 구매 + 무상 입수 타임라인
export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; remainingQty: number; memo: string | null }
  | { type: 'purchase'; id: string; date: Date; qtyValue: number; qtyUnit: string | null; amount: number; vendor: string | null; memo: string | null }
  | { type: 'addition'; id: string; date: Date; addedQty: number; source: string | null; memo: string | null }

export async function getInventoryDetail(trackedItemId: string): Promise<{
  item: { id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null; memo: string | null }
  timeline: TimelineEntry[]
} | null> {
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({
    where: { id: trackedItemId, propertyId },
  })
  if (!item) return null

  const [checks, additions, purchases] = await Promise.all([
    prisma.stockCheck.findMany({ where: { trackedItemId }, orderBy: { date: 'desc' } }),
    prisma.stockAddition.findMany({ where: { trackedItemId }, orderBy: { date: 'desc' } }),
    prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
      },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, qtyValue: true, qtyUnit: true, amount: true, vendor: true, memo: true },
    }),
  ])

  const timeline: TimelineEntry[] = [
    ...checks.map(c => ({ type: 'check' as const, id: c.id, date: c.date, remainingQty: c.remainingQty, memo: c.memo })),
    ...additions.map(a => ({ type: 'addition' as const, id: a.id, date: a.date, addedQty: a.addedQty, source: a.source, memo: a.memo })),
    ...purchases.filter(p => p.qtyValue != null).map(p => ({
      type: 'purchase' as const,
      id: p.id, date: p.date, qtyValue: p.qtyValue ?? 0, qtyUnit: p.qtyUnit,
      amount: p.amount, vendor: p.vendor, memo: p.memo,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  return {
    item: { id: item.id, category: item.category, label: item.label, specUnit: item.specUnit, qtyUnit: item.qtyUnit, memo: item.memo },
    timeline,
  }
}

// ── TrackedItem CRUD
export async function createTrackedItem(data: {
  category: string; label: string; specUnit?: string | null; qtyUnit?: string | null; memo?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!data.category || !data.label.trim()) return { ok: false, error: '카테고리와 품목명은 필수입니다.' }

    const existing = await prisma.trackedItem.findUnique({
      where: { propertyId_category_label: { propertyId, category: data.category, label: data.label.trim() } },
    })
    if (existing) {
      if (existing.isArchived) {
        const r = await prisma.trackedItem.update({ where: { id: existing.id }, data: { isArchived: false } })
        revalidatePath('/inventory')
        return { ok: true, id: r.id }
      }
      return { ok: false, error: '이미 등록된 품목입니다.' }
    }

    const r = await prisma.trackedItem.create({
      data: {
        propertyId,
        category: data.category,
        label: data.label.trim(),
        specUnit: data.specUnit || null,
        qtyUnit: data.qtyUnit || null,
        memo: data.memo || null,
      },
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateTrackedItem(id: string, data: {
  specUnit?: string | null; qtyUnit?: string | null; memo?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    await prisma.trackedItem.update({
      where: { id },
      data: {
        specUnit: data.specUnit ?? it.specUnit,
        qtyUnit:  data.qtyUnit  ?? it.qtyUnit,
        memo:     data.memo     ?? it.memo,
      },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function archiveTrackedItem(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    await prisma.trackedItem.update({ where: { id }, data: { isArchived: true } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── StockCheck CRUD
export async function createStockCheck(data: {
  trackedItemId: string; date: string; remainingQty: number; memo?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (data.remainingQty < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }
    const r = await prisma.stockCheck.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        remainingQty: data.remainingQty,
        memo: data.memo || null,
      },
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteStockCheck(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const c = await prisma.stockCheck.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!c || c.trackedItem.propertyId !== propertyId) return { ok: false, error: '점검 기록을 찾을 수 없습니다.' }
    await prisma.stockCheck.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── StockAddition CRUD
export async function createStockAddition(data: {
  trackedItemId: string; date: string; addedQty: number; source?: string; memo?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (data.addedQty <= 0) return { ok: false, error: '입수 수량은 0보다 커야 합니다.' }
    const r = await prisma.stockAddition.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        addedQty: data.addedQty,
        source: data.source || null,
        memo: data.memo || null,
      },
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteStockAddition(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const a = await prisma.stockAddition.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!a || a.trackedItem.propertyId !== propertyId) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
    await prisma.stockAddition.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 기존 지출 내역에서 (category, itemLabel, qtyUnit) 자동 시드
export async function seedTrackedItemsFromExpenses(): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const rows = await prisma.expense.findMany({
      where: {
        propertyId,
        category: { in: TRACKED_CATEGORIES as unknown as string[] },
        itemLabel: { not: null },
      },
      select: { category: true, itemLabel: true, specUnit: true, qtyUnit: true },
    })
    const seen = new Set<string>()
    let created = 0
    for (const r of rows) {
      if (!r.itemLabel) continue
      const key = `${r.category}::${r.itemLabel}`
      if (seen.has(key)) continue
      seen.add(key)
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category: r.category, label: r.itemLabel } },
      })
      if (existing) continue
      await prisma.trackedItem.create({
        data: {
          propertyId,
          category: r.category,
          label: r.itemLabel,
          specUnit: r.specUnit,
          qtyUnit: r.qtyUnit,
        },
      })
      created++
    }
    revalidatePath('/inventory')
    return { ok: true, created }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
