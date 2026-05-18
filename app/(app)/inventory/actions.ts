'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { TRACKED_CATEGORIES, type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry } from './constants'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// ── 카테고리·라벨 매칭으로 구매량 합계
// useSpecBase=true 면 qtyValue × specValue (kg, 매 같은 규격 단위) 로 환산
//
// 재고 반입 시점은 구매일(date)이 아닌 승인일(receivedAt)을 기준으로 한다.
// → 구매는 과거에 했어도 승인(수령 확인)한 날짜가 실질적 재고 증가 시점이기 때문.
// → afterReceivedAt: 이 시점 이후에 승인된 구매만 (gt). beforeReceivedAt: 이 시점 이전 (lte).
async function sumPurchases(
  propertyId: string, category: string, label: string, qtyUnit: string | null,
  afterReceivedAt: Date | null,
  beforeReceivedAt: Date | null,
  useSpecBase: boolean,
): Promise<number> {
  const conditions: any[] = [
    { propertyId },
    { category },
    { itemLabel: label },
    { receivedAt: { not: null } },
    { excludeFromInventory: false },
    ...(qtyUnit ? [{ qtyUnit }] : []),
    ...(afterReceivedAt  ? [{ receivedAt: { gt:  afterReceivedAt  } }] : []),
    ...(beforeReceivedAt ? [{ receivedAt: { lte: beforeReceivedAt } }] : []),
  ]

  const where = { AND: conditions }

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

async function sumAdditions(
  trackedItemId: string, from: Date | null, to: Date | null,
  fromCreatedAt?: Date | null,
): Promise<number> {
  const conditions: any[] = [
    { trackedItemId },
    ...(to ? [{ date: { lte: to } }] : []),
  ]

  if (from != null) {
    if (fromCreatedAt != null) {
      conditions.push({
        OR: [
          { date: { gt: from } },
          { AND: [{ date: { equals: from } }, { createdAt: { gt: fromCreatedAt } }] },
        ],
      })
    } else {
      conditions.push({ date: { gt: from } })
    }
  }

  const where = { AND: conditions }
  const r = await prisma.stockAddition.aggregate({ where, _sum: { addedQty: true } })
  return r._sum.addedQty ?? 0
}

// ── 추적 품목 목록 + 계산된 지표
export async function getInventoryOverview(): Promise<InventoryRow[]> {
  const propertyId = await getPropertyId()
  const items = await prisma.trackedItem.findMany({
    where: { propertyId, isArchived: false },
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
    include: {
      stockChecks: {
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2,
        include: {
          locationBreakdown: {
            include: { storageLocation: { select: { id: true, name: true } } },
            orderBy: { storageLocation: { sortOrder: 'asc' } },
          },
        },
      },
    },
  })

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  // 위치 정보 일괄 조회 — 루프 내 N+1 방지
  const allItemLocations = await prisma.trackedItemLocation.findMany({
    where: { trackedItemId: { in: items.map(i => i.id) } },
    include: { storageLocation: { select: { id: true, name: true, sortOrder: true, isHub: true } } },
  })

  // 수령 대기 구매 일괄 조회 — 루프 내 N+1 방지
  const allPending = await prisma.expense.findMany({
    where: {
      propertyId,
      category: { in: TRACKED_CATEGORIES as unknown as string[] },
      itemLabel: { not: null },
      receivedAt: null,
      excludeFromInventory: false,
      qtyValue: { gt: 0 },
    },
    select: { id: true, date: true, qtyValue: true, specValue: true, specUnit: true, qtyUnit: true, itemLabel: true, category: true, amount: true, vendor: true, memo: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  const rows: InventoryRow[] = []
  for (const it of items) {
    const last = it.stockChecks[0] ?? null
    const prev = it.stockChecks[1] ?? null
    // trackUnit='spec' (default): 규격 환산 (qtyValue × specValue, unit=specUnit)
    // trackUnit='qty':            수량 그대로 (qtyValue, unit=qtyUnit) — 폐기물 봉투 등
    const useSpec = it.trackUnit !== 'qty' && !!(it.specUnit && it.specUnit.trim())

    let currentStock: number | null = null
    if (last) {
      // 승인일(receivedAt) 기준: 점검 기록이 생성된 이후 승인된 구매만 반영
      // → 구매일이 과거여도 승인 전에 실사한 재고 수량이 currentStock에 포함되지 않도록 방지
      const incomingPurchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, last.createdAt, null, useSpec)
      const incomingAdditions = await sumAdditions(it.id, last.date, today, last.createdAt)
      currentStock = last.remainingQty + incomingPurchases + incomingAdditions
    }

    let lastPeriodConsumption: number | null = null
    let lastPeriodDays: number | null = null
    if (last && prev) {
      // 소모량: prevCheck 기록 후~lastCheck 기록 시점 사이에 승인된 구매만
      // → 이 구간 밖에서 승인된 구매가 소모량 계산을 왜곡하지 않도록
      const purchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, prev.createdAt, last.createdAt, useSpec)
      const additions = await sumAdditions(it.id, prev.date, last.date)
      lastPeriodConsumption = (prev.remainingQty + purchases + additions) - last.remainingQty
      lastPeriodDays = Math.max(1, Math.round((last.date.getTime() - prev.date.getTime()) / 86400000))
    } else if (last && !prev) {
      // 점검 1회만 있는 경우: 최초 승인 구매일을 기준점으로 소모량 추정
      const firstPurchase = await prisma.expense.findFirst({
        where: {
          propertyId, category: it.category, itemLabel: it.label,
          ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}),
          receivedAt: { not: null, lte: last.createdAt },
          excludeFromInventory: false, qtyValue: { gt: 0 },
        },
        orderBy: { receivedAt: 'asc' },
        select: { receivedAt: true },
      })
      if (firstPurchase?.receivedAt) {
        // 최초 구매 승인 ~ 실사 사이의 총 입수량
        const totalPurchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, null, last.createdAt, useSpec)
        const totalAdditions = await sumAdditions(it.id, null, last.date)
        const consumed = totalPurchases + totalAdditions - last.remainingQty
        const days = Math.max(1, Math.round((last.date.getTime() - firstPurchase.receivedAt.getTime()) / 86400000))
        if (consumed > 0) {
          lastPeriodConsumption = consumed
          lastPeriodDays = days
        }
      }
    }

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
        receivedAt: { not: null },
        excludeFromInventory: false,
      },
      select: { date: true, amount: true, qtyValue: true, specValue: true, specUnit: true },
      orderBy: { date: 'desc' },
    })
    let avgUnitPrice: number | null = null
    let lastUnitPrice: number | null = null
    if (recentPurchases.length > 0) {
      // useSpec=true (쌀): base = qtyValue × specValue → 원/kg
      // useSpec=false (폐기물 봉투): base = qtyValue → 원/매
      let totalAmt = 0
      let totalBase = 0
      for (const p of recentPurchases) {
        const qty = p.qtyValue ?? 0
        const base = useSpec && p.specValue && p.specValue > 0 ? qty * p.specValue : qty
        if (base > 0) {
          totalAmt  += p.amount
          totalBase += base
        }
      }
      avgUnitPrice = totalBase > 0 ? totalAmt / totalBase : null
      const last = recentPurchases[0]
      const lastQty = last.qtyValue ?? 0
      const lastBase = useSpec && last.specValue && last.specValue > 0 ? lastQty * last.specValue : lastQty
      lastUnitPrice = lastBase > 0 ? last.amount / lastBase : null
    }

    const locations: StorageLocationItem[] = allItemLocations
      .filter(l => l.trackedItemId === it.id)
      .map(l => ({ id: l.storageLocation.id, name: l.storageLocation.name, sortOrder: l.storageLocation.sortOrder, isHub: l.storageLocation.isHub }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

    const pendingPurchases: PendingPurchase[] = allPending
      .filter(p =>
        p.category === it.category &&
        p.itemLabel === it.label &&
        (it.qtyUnit == null || p.qtyUnit === it.qtyUnit),
      )
      .map(p => ({
        id: p.id,
        date: p.date,
        qtyValue: p.qtyValue ?? 0,
        specValue: p.specValue,
        specUnit: p.specUnit,
        qtyUnit: p.qtyUnit,
        amount: p.amount,
        vendor: p.vendor,
        memo: p.memo,
      }))

    rows.push({
      id: it.id,
      category: it.category,
      label: it.label,
      specUnit: it.specUnit,
      qtyUnit: it.qtyUnit,
      alertThresholdDays: it.alertThresholdDays,
      reorderMemo: it.reorderMemo,
      memo: it.memo,
      trackUnit: (it.trackUnit === 'qty' ? 'qty' : 'spec') as 'spec' | 'qty',
      isArchived: it.isArchived,
      lastCheckId: last?.id ?? null,
      lastCheckDate: last?.date ?? null,
      lastCheckCreatedAt: last?.createdAt ?? null,
      lastRemainingQty: last?.remainingQty ?? null,
      currentStock,
      avgDaily,
      daysUntilEmpty,
      lastPeriodConsumption,
      lastPeriodDays,
      avgUnitPrice,
      lastUnitPrice,
      pendingPurchases,
      locations,
      lastCheckLocationBreakdown: (last?.locationBreakdown ?? []).map(lb => ({
        locationId: lb.storageLocationId,
        locationName: lb.storageLocation.name,
        qty: lb.remainingQty,
      })) satisfies LocationQtyEntry[],
    })
  }
  return rows
}

// ── 월별 입수량 (구매 + 무상수령 합산, qtyValue 기준)
export async function getMonthlyInflow(trackedItemId: string): Promise<MonthlyInflowRow[]> {
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
  if (!item) return []
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())

  const [purchases, additions] = await Promise.all([
    prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
        qtyValue: { gt: 0 },
        receivedAt: { not: null },
        excludeFromInventory: false,
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
      receivedAt: { not: null },
      excludeFromInventory: false,
    },
    select: { date: true, amount: true, qtyValue: true, specValue: true },
    orderBy: { date: 'asc' },
  })
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
  return rows
    .filter(r => r.qtyValue && r.qtyValue > 0)
    .map(r => {
      const qty = r.qtyValue ?? 0
      const base = useSpec && r.specValue && r.specValue > 0 ? qty * r.specValue : qty
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
  item: { id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null; memo: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  timeline: TimelineEntry[]
} | null> {
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({
    where: { id: trackedItemId, propertyId },
    include: {
      locations: {
        include: { storageLocation: { select: { id: true, name: true, sortOrder: true, isHub: true } } },
        orderBy: { storageLocation: { sortOrder: 'asc' } },
      },
    },
  })
  if (!item) return null

  const [checks, additions, purchases] = await Promise.all([
    prisma.stockCheck.findMany({
      where: { trackedItemId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        locationBreakdown: {
          include: { storageLocation: { select: { id: true, name: true } } },
          orderBy: { storageLocation: { sortOrder: 'asc' } },
        },
      },
    }),
    prisma.stockAddition.findMany({ where: { trackedItemId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
        excludeFromInventory: false,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, date: true, createdAt: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, amount: true, vendor: true, memo: true, receivedAt: true, receivedLocation: { select: { name: true } } },
    }),
  ])

  const timeline: TimelineEntry[] = [
    ...checks.map(c => ({
      type: 'check' as const,
      id: c.id, date: c.date, createdAt: c.createdAt, remainingQty: c.remainingQty, memo: c.memo,
      locationBreakdown: c.locationBreakdown.map(lb => ({
        locationId: lb.storageLocationId,
        locationName: lb.storageLocation.name,
        qty: lb.remainingQty,
        fromHubQty: lb.fromHubQty ?? undefined,
      })) satisfies LocationQtyEntry[],
    })),
    ...additions.map(a => ({ type: 'addition' as const, id: a.id, date: a.date, createdAt: a.createdAt, addedQty: a.addedQty, source: a.source, memo: a.memo })),
    ...purchases.filter(p => p.qtyValue != null).map(p => ({
      type: 'purchase' as const,
      id: p.id, date: p.date, createdAt: p.createdAt, qtyValue: p.qtyValue ?? 0, qtyUnit: p.qtyUnit,
      specValue: p.specValue, specUnit: p.specUnit,
      amount: p.amount, vendor: p.vendor, memo: p.memo, receivedAt: p.receivedAt,
      receivedLocationName: p.receivedLocation?.name ?? null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())

  return {
    item: {
      id: item.id, category: item.category, label: item.label,
      specUnit: item.specUnit, qtyUnit: item.qtyUnit, memo: item.memo,
      trackUnit: (item.trackUnit === 'qty' ? 'qty' : 'spec') as 'spec' | 'qty',
      locations: item.locations.map(l => ({ id: l.storageLocation.id, name: l.storageLocation.name, sortOrder: l.storageLocation.sortOrder, isHub: l.storageLocation.isHub })),
    },
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

    // 폐기물 처리비는 기본 trackUnit='qty' (50L 봉투 30매를 1500L 아닌 30매로 트래킹)
    const defaultTrackUnit = data.category === '폐기물 처리비' ? 'qty' : 'spec'
    const r = await prisma.trackedItem.create({
      data: {
        propertyId,
        category: data.category,
        label: data.label.trim(),
        specUnit: data.specUnit || null,
        qtyUnit: data.qtyUnit || null,
        memo: data.memo || null,
        trackUnit: defaultTrackUnit,
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
  label?: string
  specUnit?: string | null; qtyUnit?: string | null; memo?: string | null
  alertThresholdDays?: number; reorderMemo?: string | null
  trackUnit?: 'spec' | 'qty'
}): Promise<{ ok: true; renamedExpenses: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }

    // 라벨 변경 처리
    const newLabel = data.label?.trim()
    let renamedExpenses = 0
    if (newLabel && newLabel !== it.label) {
      // 동일 (propertyId, category, label) 충돌 검사
      const dup = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category: it.category, label: newLabel } },
      })
      if (dup && dup.id !== id) return { ok: false, error: `이미 같은 라벨의 품목이 있습니다: ${newLabel}` }

      // 같은 (category, oldLabel, qtyUnit) 매칭되는 expense들의 itemLabel도 함께 변경
      const r = await prisma.expense.updateMany({
        where: {
          propertyId,
          category: it.category,
          itemLabel: it.label,
          ...(it.qtyUnit ? { qtyUnit: it.qtyUnit } : {}),
        },
        data: { itemLabel: newLabel },
      })
      renamedExpenses = r.count
    }

    await prisma.trackedItem.update({
      where: { id },
      data: {
        label:              newLabel ?? it.label,
        specUnit:           data.specUnit           ?? it.specUnit,
        qtyUnit:            data.qtyUnit            ?? it.qtyUnit,
        memo:               data.memo               ?? it.memo,
        alertThresholdDays: data.alertThresholdDays ?? it.alertThresholdDays,
        reorderMemo:        data.reorderMemo        ?? it.reorderMemo,
        trackUnit:          data.trackUnit          ?? it.trackUnit,
      },
    })
    revalidatePath('/inventory')
    revalidatePath('/finance')
    return { ok: true, renamedExpenses }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 같은 카테고리 안의 다른 활성 품목들 — 병합 대상 후보
export async function getSameCategoryItems(excludeId: string): Promise<{ id: string; label: string }[]> {
  const propertyId = await getPropertyId()
  const it = await prisma.trackedItem.findFirst({ where: { id: excludeId, propertyId } })
  if (!it) return []
  const list = await prisma.trackedItem.findMany({
    where: {
      propertyId,
      category: it.category,
      isArchived: false,
      id: { not: excludeId },
    },
    select: { id: true, label: true },
    orderBy: { label: 'asc' },
  })
  return list
}

// 두 추적 품목을 병합. source의 expense·stockCheck·stockAddition을 target으로 이전.
// 라면처럼 사이즈가 다양해도 전체 합산하고 싶을 때 사용.
// looseMatch=true 면 target.qtyUnit 을 null로 만들어 sumPurchases가 qtyUnit 무시하고 매칭.
export async function mergeTrackedItems(
  sourceId: string, targetId: string, looseMatch = true,
): Promise<{ ok: true; movedExpenses: number; movedChecks: number; movedAdditions: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (sourceId === targetId) return { ok: false, error: '같은 품목을 병합할 수 없습니다.' }
    const [source, target] = await Promise.all([
      prisma.trackedItem.findFirst({ where: { id: sourceId, propertyId } }),
      prisma.trackedItem.findFirst({ where: { id: targetId, propertyId } }),
    ])
    if (!source || !target) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (source.category !== target.category) return { ok: false, error: '같은 카테고리 안에서만 병합할 수 있습니다.' }

    // 1) source 매칭 expense들의 itemLabel을 target.label로 변경
    //    (qtyUnit/specUnit은 expense 그대로 유지 — 사이즈 정보 보존)
    const matchSourceExpenses: any = {
      propertyId, category: source.category, itemLabel: source.label,
    }
    if (source.qtyUnit) matchSourceExpenses.qtyUnit = source.qtyUnit
    const expRes = await prisma.expense.updateMany({
      where: matchSourceExpenses,
      data: { itemLabel: target.label },
    })

    // 2) stockCheck / stockAddition trackedItemId를 target으로 이전
    const [checkRes, addRes] = await Promise.all([
      prisma.stockCheck.updateMany({
        where: { trackedItemId: sourceId },
        data: { trackedItemId: targetId },
      }),
      prisma.stockAddition.updateMany({
        where: { trackedItemId: sourceId },
        data: { trackedItemId: targetId },
      }),
    ])

    // 3) target 옵션 보정 — looseMatch면 qtyUnit null로 (다양한 포장 합산용)
    if (looseMatch && target.qtyUnit) {
      await prisma.trackedItem.update({
        where: { id: targetId },
        data: { qtyUnit: null },
      })
    }

    // 4) source 삭제
    await prisma.trackedItem.delete({ where: { id: sourceId } })

    revalidatePath('/inventory')
    revalidatePath('/finance')
    return {
      ok: true,
      movedExpenses: expRes.count,
      movedChecks: checkRes.count,
      movedAdditions: addRes.count,
    }
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

// ── 보관처리된 품목 목록 (복구 대상)
export async function getArchivedTrackedItems(): Promise<{
  id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null; expenseCount: number
}[]> {
  const propertyId = await getPropertyId()
  const items = await prisma.trackedItem.findMany({
    where: { propertyId, isArchived: true },
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
    select: { id: true, category: true, label: true, specUnit: true, qtyUnit: true },
  })
  return Promise.all(items.map(async it => {
    const expenseCount = await prisma.expense.count({
      where: { propertyId, category: it.category, itemLabel: it.label, excludeFromInventory: false },
    })
    return { ...it, expenseCount }
  }))
}

// ── 보관 해제 (복구)
export async function unarchiveTrackedItem(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId, isArchived: true } })
    if (!it) return { ok: false, error: '보관된 품목을 찾을 수 없습니다.' }
    await prisma.trackedItem.update({ where: { id }, data: { isArchived: false } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── StockCheck CRUD
// 위치별 잔량 입력 1건
type LocQty = { storageLocationId: string; qty: number; fromHubQty?: number; fromLocationId?: string }

// 재고 이동 보정 — "B에서 A로 N 이동" 선언이 있으면 같은 점검 안에서 출처(B) 수량을 N 차감.
// → 출처를 다시 점검하지 않아도 총량·소모량이 맞는다.
function applyTransfers(lqs: LocQty[]): LocQty[] {
  const adj = lqs.map(l => ({ ...l }))
  for (const lq of adj) {
    if (lq.fromLocationId && lq.fromHubQty && lq.fromHubQty > 0) {
      const src = adj.find(x => x.storageLocationId === lq.fromLocationId)
      if (src) src.qty = Math.max(0, src.qty - lq.fromHubQty)
    }
  }
  return adj
}

export async function createStockCheck(data: {
  trackedItemId: string; date: string; remainingQty: number; memo?: string
  locationQtys?: LocQty[]
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const adjusted = data.locationQtys && data.locationQtys.length > 0 ? applyTransfers(data.locationQtys) : null
    const total = adjusted ? adjusted.reduce((s, l) => s + l.qty, 0) : data.remainingQty
    if (total < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }
    const r = await prisma.stockCheck.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        remainingQty: total,
        memo: data.memo || null,
        ...(adjusted ? {
          locationBreakdown: {
            create: adjusted.map(lq => ({
              storageLocationId: lq.storageLocationId,
              remainingQty: lq.qty,
              fromHubQty: lq.fromHubQty ?? null,
              fromLocationId: lq.fromLocationId ?? null,
            })),
          },
        } : {}),
      },
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateStockCheck(id: string, data: {
  date?: string
  memo?: string | null
  remainingQty?: number
  locationQtys?: LocQty[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const c = await prisma.stockCheck.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!c || c.trackedItem.propertyId !== propertyId) return { ok: false, error: '점검 기록을 찾을 수 없습니다.' }

    const adjusted = data.locationQtys && data.locationQtys.length > 0 ? applyTransfers(data.locationQtys) : null
    const finalQty = adjusted ? adjusted.reduce((s, lq) => s + lq.qty, 0) : data.remainingQty

    if (finalQty !== undefined && finalQty < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }

    await prisma.$transaction(async (tx) => {
      await tx.stockCheck.update({
        where: { id },
        data: {
          ...(data.date ? { date: new Date(data.date) } : {}),
          ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
          ...(finalQty !== undefined ? { remainingQty: finalQty } : {}),
        },
      })
      if (adjusted) {
        await tx.stockCheckLocation.deleteMany({ where: { stockCheckId: id } })
        await tx.stockCheckLocation.createMany({
          data: adjusted.map(lq => ({
            stockCheckId: id,
            storageLocationId: lq.storageLocationId,
            remainingQty: lq.qty,
            fromHubQty: lq.fromHubQty ?? null,
            fromLocationId: lq.fromLocationId ?? null,
          })),
        })
      }
    })
    revalidatePath('/inventory')
    return { ok: true }
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

export async function updateStockAddition(id: string, data: {
  date?: string; addedQty?: number; source?: string | null; memo?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const a = await prisma.stockAddition.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!a || a.trackedItem.propertyId !== propertyId) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
    if (data.addedQty !== undefined && data.addedQty <= 0) return { ok: false, error: '입수 수량은 0보다 커야 합니다.' }
    await prisma.stockAddition.update({
      where: { id },
      data: {
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.addedQty !== undefined ? { addedQty: data.addedQty } : {}),
        ...(data.source !== undefined ? { source: data.source || null } : {}),
        ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
      },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExpenseFromInventory(id: string, data: {
  date?: string; amount?: number; vendor?: string | null; memo?: string | null
  receivedAt?: string | null  // ISO 문자열 or null(수령 대기로 되돌리기)
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const e = await prisma.expense.findUnique({ where: { id } })
    if (!e || e.propertyId !== propertyId) return { ok: false, error: '구매 기록을 찾을 수 없습니다.' }
    await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.vendor !== undefined ? { vendor: data.vendor || null } : {}),
        ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
        ...(data.receivedAt !== undefined ? { receivedAt: data.receivedAt ? new Date(data.receivedAt) : null } : {}),
      },
    })
    revalidatePath('/inventory')
    revalidatePath('/expenses')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function excludeExpenseFromInventory(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const e = await prisma.expense.findUnique({ where: { id } })
    if (!e || e.propertyId !== propertyId) return { ok: false, error: '구매 기록을 찾을 수 없습니다.' }
    await prisma.expense.update({ where: { id }, data: { excludeFromInventory: true } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 기존 지출 내역에서 (category, itemLabel, qtyUnit) 자동 시드
// 같은 (category, label) 안에서 spec/qtyUnit 변형이 여럿이면 sub-label을 붙여 별도 카드로 추적.
// 예) 음식물쓰레기봉투 5L vs 10L → 별도 카드 / 키친타월 (롤) vs (팩) → 별도 카드
function deriveSubLabel(base: string, specValue: number | null, specUnit: string | null, qtyUnit: string | null): string {
  // 이미 라벨에 사이즈/타입이 있으면 그대로
  if (/\d+\s*(L|ml|g|kg|매|개|m)\b/.test(base) || /\([^)]+\)/.test(base)) return base
  const parts: string[] = []
  if (specValue && specValue > 0 && specUnit) {
    parts.push(`${specValue}${specUnit}`)
  }
  if (qtyUnit) {
    parts.push(`(${qtyUnit})`)
  }
  return parts.length > 0 ? `${base} ${parts.join(' ')}` : base
}

export async function seedTrackedItemsFromExpenses(): Promise<{ ok: true; created: number; migrated: number; skippedArchived: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const rows = await prisma.expense.findMany({
      where: {
        propertyId,
        category: { in: TRACKED_CATEGORIES as unknown as string[] },
        itemLabel: { not: null },
      },
      select: { id: true, category: true, itemLabel: true, specValue: true, specUnit: true, qtyUnit: true },
    })

    // 1) 5-tuple로 그룹: (category, itemLabel, specValue, specUnit, qtyUnit)
    type GroupKey = string
    type Group = {
      category: string; baseLabel: string
      specValue: number | null; specUnit: string | null; qtyUnit: string | null
      expenseIds: string[]
    }
    const groups = new Map<GroupKey, Group>()
    for (const r of rows) {
      if (!r.itemLabel) continue
      const key = `${r.category}|${r.itemLabel}|${r.specValue ?? ''}|${r.specUnit ?? ''}|${r.qtyUnit ?? ''}`
      let g = groups.get(key)
      if (!g) {
        g = {
          category: r.category, baseLabel: r.itemLabel,
          specValue: r.specValue ?? null, specUnit: r.specUnit ?? null, qtyUnit: r.qtyUnit ?? null,
          expenseIds: [],
        }
        groups.set(key, g)
      }
      g.expenseIds.push(r.id)
    }

    // 2) 같은 (category, baseLabel) 안에 그룹이 여럿이면 sub-label 부여
    //    단, 이미 looseMatch(=qtyUnit null) TrackedItem이 존재하면 — 사용자가 병합한
    //    '다양한 포장 합산' 카드 — sub-label 만들지 않고 그 카드로 모두 흡수.
    const byBase = new Map<string, Group[]>()
    for (const g of groups.values()) {
      const k = `${g.category}|${g.baseLabel}`
      if (!byBase.has(k)) byBase.set(k, [])
      byBase.get(k)!.push(g)
    }

    // looseMatch 카드 사전 조회 — 같은 (category, baseLabel)이 이미 병합용 카드인지
    // 사용자가 삭제(archive)한 카드는 재생성/재흡수 대상에서 제외
    const looseMatchKeys = new Set<string>()
    const archivedBaseKeys = new Set<string>()  // baseLabel 카드가 archived인 경우
    await Promise.all(
      Array.from(byBase.keys()).map(async k => {
        const [cat, lbl] = k.split('|')
        const found = await prisma.trackedItem.findUnique({
          where: { propertyId_category_label: { propertyId, category: cat, label: lbl } },
          select: { qtyUnit: true, isArchived: true },
        })
        if (found?.isArchived) archivedBaseKeys.add(k)
        else if (found && found.qtyUnit === null) looseMatchKeys.add(k)
      }),
    )

    const finalLabel = new Map<Group, string>()
    for (const [k, list] of byBase) {
      if (looseMatchKeys.has(k)) {
        // 병합된 카드가 이미 존재 → 모든 그룹을 baseLabel로 흡수
        for (const g of list) finalLabel.set(g, g.baseLabel)
        continue
      }
      if (list.length === 1) {
        finalLabel.set(list[0], list[0].baseLabel)
        continue
      }
      for (const g of list) {
        finalLabel.set(g, deriveSubLabel(g.baseLabel, g.specValue, g.specUnit, g.qtyUnit))
      }
    }

    // 3) TrackedItem 생성/조회 + expense itemLabel 마이그레이션
    //    - 같은 라벨의 archived 카드가 있으면 재생성하지 않고 스킵 (사용자가 의도적으로 삭제한 것)
    let created = 0
    let migrated = 0
    let skippedArchived = 0
    for (const g of groups.values()) {
      const label = finalLabel.get(g) ?? g.baseLabel
      const baseKey = `${g.category}|${g.baseLabel}`
      // baseLabel 카드가 archived → 모든 sub-label 그룹 스킵 (사용자가 삭제한 묶음)
      if (archivedBaseKeys.has(baseKey)) {
        skippedArchived += g.expenseIds.length
        continue
      }
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category: g.category, label } },
        select: { id: true, isArchived: true },
      })
      // 같은 sub-label의 archived 카드가 이미 있으면 스킵
      if (existing?.isArchived) {
        skippedArchived += g.expenseIds.length
        continue
      }
      if (!existing) {
        await prisma.trackedItem.create({
          data: {
            propertyId,
            category: g.category,
            label,
            specUnit: g.specUnit,
            qtyUnit: g.qtyUnit,
            trackUnit: g.category === '폐기물 처리비' ? 'qty' : 'spec',
          },
        })
        created++
      }
      // 라벨이 변경된 그룹의 expense rows의 itemLabel을 새 라벨로 업데이트
      if (label !== g.baseLabel && g.expenseIds.length > 0) {
        const r = await prisma.expense.updateMany({
          where: { id: { in: g.expenseIds } },
          data: { itemLabel: label },
        })
        migrated += r.count
      }
    }
    revalidatePath('/inventory')
    revalidatePath('/finance')
    return { ok: true, created, migrated, skippedArchived }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 보관 위치 CRUD
export async function getStorageLocations(): Promise<StorageLocationItem[]> {
  const propertyId = await getPropertyId()
  const locs = await prisma.storageLocation.findMany({
    where: { propertyId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sortOrder: true, isHub: true },
  })
  return locs
}

export async function toggleStorageLocationHub(id: string, isHub: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const loc = await prisma.storageLocation.findFirst({ where: { id, propertyId } })
    if (!loc) return { ok: false, error: '위치를 찾을 수 없습니다.' }
    await prisma.storageLocation.update({ where: { id }, data: { isHub } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function createStorageLocation(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '위치 이름을 입력해주세요.' }
    const existing = await prisma.storageLocation.findUnique({
      where: { propertyId_name: { propertyId, name: trimmed } },
    })
    if (existing) return { ok: false, error: '이미 같은 이름의 위치가 있습니다.' }
    const maxOrder = await prisma.storageLocation.aggregate({ where: { propertyId }, _max: { sortOrder: true } })
    const r = await prisma.storageLocation.create({
      data: { propertyId, name: trimmed, sortOrder: (maxOrder._max.sortOrder ?? 0) + 1 },
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateStorageLocation(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '위치 이름을 입력해주세요.' }
    const loc = await prisma.storageLocation.findFirst({ where: { id, propertyId } })
    if (!loc) return { ok: false, error: '위치를 찾을 수 없습니다.' }
    await prisma.storageLocation.update({ where: { id }, data: { name: trimmed } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteStorageLocation(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const loc = await prisma.storageLocation.findFirst({ where: { id, propertyId } })
    if (!loc) return { ok: false, error: '위치를 찾을 수 없습니다.' }
    await prisma.storageLocation.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 품목에 위치 할당 (전체 교체)
export async function setItemLocations(trackedItemId: string, locationIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    // 전체 교체: 기존 삭제 후 재생성
    await prisma.trackedItemLocation.deleteMany({ where: { trackedItemId } })
    if (locationIds.length > 0) {
      await prisma.trackedItemLocation.createMany({
        data: locationIds.map(storageLocationId => ({ trackedItemId, storageLocationId })),
        skipDuplicates: true,
      })
    }
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 여러 품목에 동일 위치 일괄 할당 (교체)
export async function batchSetItemLocations(trackedItemIds: string[], locationIds: string[]): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (trackedItemIds.length === 0) return { ok: false, error: '선택된 품목이 없습니다.' }
    // 권한 확인
    const count = await prisma.trackedItem.count({ where: { id: { in: trackedItemIds }, propertyId } })
    if (count !== trackedItemIds.length) return { ok: false, error: '일부 품목을 찾을 수 없습니다.' }

    await prisma.trackedItemLocation.deleteMany({ where: { trackedItemId: { in: trackedItemIds } } })
    if (locationIds.length > 0) {
      await prisma.trackedItemLocation.createMany({
        data: trackedItemIds.flatMap(trackedItemId =>
          locationIds.map(storageLocationId => ({ trackedItemId, storageLocationId }))
        ),
        skipDuplicates: true,
      })
    }
    revalidatePath('/inventory')
    return { ok: true, count: trackedItemIds.length }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 수령 확인
export async function confirmReceipt(expenseId: string, locationId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const expense = await prisma.expense.findFirst({ where: { id: expenseId, propertyId } })
    if (!expense) return { ok: false, error: '구매 내역을 찾을 수 없습니다.' }
    await prisma.expense.update({
      where: { id: expenseId },
      data: { receivedAt: new Date(), ...(locationId ? { receivedLocationId: locationId } : {}) },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 품목에 속한 수령 대기 구매 전체 확인
export async function confirmAllPending(trackedItemId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
    if (!item) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const r = await prisma.expense.updateMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { qtyUnit: item.qtyUnit } : {}),
        receivedAt: null,
      },
      data: { receivedAt: new Date() },
    })
    revalidatePath('/inventory')
    return { ok: true, count: r.count }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
