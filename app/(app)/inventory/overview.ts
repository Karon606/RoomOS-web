// 재고 개요 계산 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
// getInventoryOverview(쿠키 기반)와 Cron(스케줄러) 양쪽에서 재사용.
import prisma from '@/lib/prisma'
import { TRACKED_CATEGORIES, type InventoryRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry } from './constants'

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
export async function computeInventoryOverview(propertyId: string): Promise<InventoryRow[]> {
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
