'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { TRACKED_CATEGORIES, type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow } from './constants'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// ── 카테고리·라벨 매칭으로 그 기간의 구매량 합계
// useSpecBase=true 면 qtyValue × specValue (kg, 매 같은 규격 단위) 로 환산
async function sumPurchases(propertyId: string, category: string, label: string, qtyUnit: string | null, from: Date | null, to: Date | null, useSpecBase: boolean): Promise<number> {
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
  if (!useSpecBase) {
    const r = await prisma.expense.aggregate({ where, _sum: { qtyValue: true } })
    return r._sum.qtyValue ?? 0
  }
  // 규격 환산: qtyValue × specValue. specValue 없으면 qtyValue 그대로
  const rows = await prisma.expense.findMany({ where, select: { qtyValue: true, specValue: true } })
  return rows.reduce((s, r) => {
    const q = r.qtyValue ?? 0
    return s + (r.specValue && r.specValue > 0 ? q * r.specValue : q)
  }, 0)
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
    // 규격 단위(specUnit)가 설정된 품목은 모든 수량 계산을 규격 기준(kg, 매 등)으로 통일
    const useSpec = !!(it.specUnit && it.specUnit.trim())

    let currentStock: number | null = null
    if (last) {
      const incomingPurchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, last.date, today, useSpec)
      const incomingAdditions = await sumAdditions(it.id, last.date, today)
      currentStock = last.remainingQty + incomingPurchases + incomingAdditions
    }

    let lastPeriodConsumption: number | null = null
    let lastPeriodDays: number | null = null
    if (last && prev) {
      const purchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, prev.date, last.date, useSpec)
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

    // 최근 12개월 구매 단가 — 규격(specValue) 기준 우선, 없으면 수량(qtyValue) 기준
    // 예: 쌀 20kg × 1포대 60,000원 → 60,000 / (1 × 20) = 3,000원/kg
    //     물티슈 100매 × 2팩 10,000원 → 10,000 / (2 × 100) = 50원/매
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const recentPurchases = await prisma.expense.findMany({
      where: {
        propertyId,
        category: it.category,
        itemLabel: it.label,
        ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}),
        date: { gte: oneYearAgo },
        qtyValue: { gt: 0 },
        amount: { gt: 0 },
      },
      select: { date: true, amount: true, qtyValue: true, specValue: true, specUnit: true },
      orderBy: { date: 'desc' },
    })
    let avgUnitPrice: number | null = null
    let lastUnitPrice: number | null = null
    if (recentPurchases.length > 0) {
      // 각 row의 base_units = qtyValue × specValue (specValue 있으면) else qtyValue
      let totalAmt = 0
      let totalBase = 0
      for (const p of recentPurchases) {
        const qty = p.qtyValue ?? 0
        const base = (p.specValue && p.specValue > 0) ? qty * p.specValue : qty
        if (base > 0) {
          totalAmt  += p.amount
          totalBase += base
        }
      }
      avgUnitPrice = totalBase > 0 ? totalAmt / totalBase : null
      const last = recentPurchases[0]
      const lastBase = (last.specValue && last.specValue > 0) ? (last.qtyValue ?? 0) * last.specValue : (last.qtyValue ?? 0)
      lastUnitPrice = lastBase > 0 ? last.amount / lastBase : null
    }

    rows.push({
      id: it.id,
      category: it.category,
      label: it.label,
      specUnit: it.specUnit,
      qtyUnit: it.qtyUnit,
      alertThresholdDays: it.alertThresholdDays,
      reorderMemo: it.reorderMemo,
      isArchived: it.isArchived,
      lastCheckDate: last?.date ?? null,
      lastRemainingQty: last?.remainingQty ?? null,
      currentStock,
      avgDaily,
      daysUntilEmpty,
      lastPeriodConsumption,
      lastPeriodDays,
      avgUnitPrice,
      lastUnitPrice,
    })
  }
  return rows
}

// ── 월별 입수량 (구매 + 무상수령 합산, qtyValue 기준)
export async function getMonthlyInflow(trackedItemId: string): Promise<MonthlyInflowRow[]> {
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
  if (!item) return []
  const useSpec = !!(item.specUnit && item.specUnit.trim())

  const [purchases, additions] = await Promise.all([
    prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
        qtyValue: { gt: 0 },
      },
      select: { date: true, qtyValue: true, specValue: true, amount: true },
    }),
    prisma.stockAddition.findMany({
      where: { trackedItemId },
      select: { date: true, addedQty: true },
    }),
  ])

  const map = new Map<string, MonthlyInflowRow>()
  const upsert = (m: string) => {
    if (!map.has(m)) map.set(m, { month: m, purchaseQty: 0, additionQty: 0, totalQty: 0, purchaseAmount: 0 })
    return map.get(m)!
  }
  for (const p of purchases) {
    const d = new Date(p.date)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const r = upsert(m)
    const q = p.qtyValue ?? 0
    const contrib = useSpec && p.specValue && p.specValue > 0 ? q * p.specValue : q
    r.purchaseQty    += contrib
    r.purchaseAmount += p.amount
  }
  for (const a of additions) {
    const d = new Date(a.date)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    upsert(m).additionQty += a.addedQty
  }
  for (const r of map.values()) r.totalQty = r.purchaseQty + r.additionQty

  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month))
}

// ── 단가 추이 (구매 시점별 unit price) — 규격 기준 우선
export async function getPriceHistory(trackedItemId: string): Promise<PricePoint[]> {
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
  if (!item) return []
  const rows = await prisma.expense.findMany({
    where: {
      propertyId,
      category: item.category,
      itemLabel: item.label,
      ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
      qtyValue: { gt: 0 },
      amount: { gt: 0 },
    },
    select: { date: true, amount: true, qtyValue: true, specValue: true },
    orderBy: { date: 'asc' },
  })
  return rows
    .filter(r => r.qtyValue && r.qtyValue > 0)
    .map(r => {
      const qty = r.qtyValue ?? 0
      const base = (r.specValue && r.specValue > 0) ? qty * r.specValue : qty
      return {
        date: r.date,
        qty,
        amount: r.amount,
        unitPrice: base > 0 ? r.amount / base : 0,
      }
    })
}

// ── 단일 품목 상세 — 점검 + 구매 + 무상 입수 타임라인
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
  alertThresholdDays?: number; reorderMemo?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    await prisma.trackedItem.update({
      where: { id },
      data: {
        specUnit:           data.specUnit           ?? it.specUnit,
        qtyUnit:            data.qtyUnit            ?? it.qtyUnit,
        memo:               data.memo               ?? it.memo,
        alertThresholdDays: data.alertThresholdDays ?? it.alertThresholdDays,
        reorderMemo:        data.reorderMemo        ?? it.reorderMemo,
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
