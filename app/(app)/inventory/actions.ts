'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry, type MergeDecision, type MergeRuleRow, type InventoryCategory, suggestInventoryAlias } from './constants'
import { getInventoryCategoryConfig, getTrackedCategories } from './categoryConfig'
import { computeInventoryOverview } from './overview'
import { applyLocationCheck, type LocCheckPatch } from '@/lib/stockCheckMerge'

async function getPropertyId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// ── 추적 품목 목록 + 계산된 지표 (compute 는 overview.ts 로 분리 — Cron 등 재사용)
export async function getInventoryOverview(): Promise<InventoryRow[]> {
  return computeInventoryOverview(await getPropertyId())
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
    prisma.stockAddition.findMany({
      where: { trackedItemId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { storageLocation: { select: { id: true, name: true } } },
    }),
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
      id: c.id, date: c.date, createdAt: c.createdAt, remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile,
      locationBreakdown: c.locationBreakdown.map(lb => ({
        locationId: lb.storageLocationId,
        locationName: lb.storageLocation.name,
        qty: lb.remainingQty,
        restockedQty: lb.restockedQty ?? undefined,
        fromHubQty: lb.fromHubQty ?? undefined,
        fromLocationId: lb.fromLocationId ?? undefined,
      })) satisfies LocationQtyEntry[],
    })),
    ...additions.map(a => ({
      type: 'addition' as const,
      id: a.id, date: a.date, createdAt: a.createdAt, addedQty: a.addedQty, source: a.source, memo: a.memo,
      storageLocationId: a.storageLocationId,
      storageLocationName: a.storageLocation?.name ?? null,
    })),
    ...purchases.filter(p => p.qtyValue != null).map(p => ({
      type: 'purchase' as const,
      id: p.id, date: p.date, createdAt: p.createdAt, qtyValue: p.qtyValue ?? 0, qtyUnit: p.qtyUnit,
      specValue: p.specValue, specUnit: p.specUnit,
      amount: p.amount, vendor: p.vendor, memo: p.memo, receivedAt: p.receivedAt,
      receivedLocationName: p.receivedLocation?.name ?? null,
    })),
  ].sort((a, b) => {
    // 모든 entry 를 '실제 발생 시각'(시:분 포함) 단일 기준으로 정렬한다.
    //   이전엔 점검은 date(자정), 구매는 receivedAt(시각 포함)으로 해상도가 달라
    //   같은 날 안에서 수령(15:11)이 그 뒤 점검(16:46)보다 위로 뜨는 등 순서가 어긋났음
    //   (2026-06-01 사용자 피드백 — 수령 확정 후 점검값이 나오는 흐름이 거꾸로 보임).
    //   · 구매 = receivedAt(실제 수령 시각) ?? date
    //   · 점검·입수 = 입력 당일(KST) 점검이면 createdAt(실제 점검 시각), 과거 보정 입력(백필)이면 date.
    //     createdAt 이 점검일과 다른 날이면 나중에 보정 입력한 것으로 보고 date 를 써서 백필이 순서를 안 깨게 함.
    const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10)
    const effTime = (e: TimelineEntry): Date =>
      e.type === 'purchase'
        ? (e.receivedAt ?? e.date)
        : (kstDay(e.createdAt) === kstDay(e.date) ? e.createdAt : e.date)
    const at = effTime(a).getTime(), bt = effTime(b).getTime()
    if (at !== bt) return bt - at
    // 같은 시각 동률 — 점검(수령 자동반영 결과)이 구매(수령) 위에 (수령→점검 순서의 결과를 먼저).
    const typeRank = (e: TimelineEntry) => e.type === 'check' ? 0 : e.type === 'addition' ? 1 : 2
    return typeRank(a) - typeRank(b)
  })

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
  purchaseUrl?: string | null
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
        purchaseUrl:        data.purchaseUrl        ?? it.purchaseUrl,
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

    // 3.5) 병합 규칙 기록 — source 라벨이 다시 들어오면 target 을 추천(LINK).
    //      source 를 가리키던 기존 규칙은 target 으로 이전(삭제 cascade 전에 보존).
    const cat = source.category
    const targetItemId = targetId
    const sourceRules = await prisma.trackedItemMergeRule.findMany({
      where: { propertyId, targetItemId: sourceId },
    })
    for (const r of sourceRules) {
      await prisma.trackedItemMergeRule.upsert({
        where: { propertyId_category_normLabel_targetItemId: { propertyId, category: r.category, normLabel: r.normLabel, targetItemId } },
        update: { kind: r.kind, sourceLabel: r.sourceLabel },
        create: { propertyId, category: r.category, sourceLabel: r.sourceLabel, normLabel: r.normLabel, targetItemId, kind: r.kind },
      })
      await prisma.trackedItemMergeRule.delete({ where: { id: r.id } }).catch(() => {})
    }
    await prisma.trackedItemMergeRule.upsert({
      where: { propertyId_category_normLabel_targetItemId: { propertyId, category: cat, normLabel: normalizeLabel(source.label), targetItemId } },
      update: { kind: 'LINK', sourceLabel: source.label },
      create: { propertyId, category: cat, sourceLabel: source.label, normLabel: normalizeLabel(source.label), targetItemId, kind: 'LINK' },
    })

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
// qty: "보충 후" 잔량 (보충했다면 보충 후, 안 했으면 실측 그대로)
// restockedQty: 이번 점검에서 이 위치에 보충한 양 (NULL 또는 0 = 보충 없음).
//               "보충 전" 잔량 = qty - restockedQty.
//               허브 자동 차감은 UI 단계에서 합계 restockedQty 만큼 허브 위치의 qty에서
//               빼서 보낸다(서버는 받은 값을 그대로 저장만 함 — 동시성 안전 + 운영자 보정 가능).
// fromHubQty/fromLocationId: 레거시 명시적 이동 — 신규 UI 미사용, 기존 점검 호환용.
type LocQty = {
  storageLocationId: string
  qty: number
  restockedQty?: number
  fromHubQty?: number
  fromLocationId?: string
}

// (레거시) 명시적 위치 간 이동 보정 — fromHubQty 선언이 있으면 같은 점검 안에서 출처 수량 차감.
// 신규 UI는 사용하지 않지만 기존 데이터·기존 화면 호환을 위해 유지.
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
  // #3 위치별 점검 — 서버가 직전 점검(carry-over) 기준으로 허브 차감·이월을 계산(stale 방지).
  locationPatch?: LocCheckPatch
  // #4 (2026-06-01): 품목별 점검 폼에서 위치 일부만 입력했을 때 나머지 위치의 잔량을
  // 직전 점검에서 자동 보존. 안 하면 입력 안 한 위치가 0 으로 처리되어 다음 점검과의
  // 차이가 큰 "소모"로 잘못 계산 (라면 187 / 쌀 159 / 주방세제 6330 등 사용량 왜곡).
  carryOverFromLastCheck?: boolean
  // 이 점검을 '전체 보정'으로 표시 — 직전 구간의 차이를 사용량으로 잡지 않음(분실·오차 흡수).
  isReconcile?: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    // #3: locationPatch가 오면 직전 점검의 위치별 잔량을 base로 서버에서 적용
    let patchedQtys: LocQty[] | null = null
    if (data.locationPatch) {
      const lastCheck = await prisma.stockCheck.findFirst({
        where: { trackedItemId: data.trackedItemId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { locationBreakdown: true },
      })
      const base = (lastCheck?.locationBreakdown ?? []).map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty }))
      patchedQtys = applyLocationCheck(base, data.locationPatch)
    }
    let effectiveLocationQtys = patchedQtys ?? data.locationQtys
    // #4 carryOver — locationQtys 가 일부 위치만 담고 있으면 나머지는 직전 점검에서 보존.
    if (data.carryOverFromLastCheck && effectiveLocationQtys && effectiveLocationQtys.length > 0) {
      const lastCheck = await prisma.stockCheck.findFirst({
        where: { trackedItemId: data.trackedItemId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { locationBreakdown: true },
      })
      if (lastCheck?.locationBreakdown && lastCheck.locationBreakdown.length > 0) {
        const inputLocIds = new Set(effectiveLocationQtys.map(lq => lq.storageLocationId))
        const carryOver = lastCheck.locationBreakdown
          .filter(lb => !inputLocIds.has(lb.storageLocationId))
          .map(lb => ({ storageLocationId: lb.storageLocationId, qty: lb.remainingQty }))
        effectiveLocationQtys = [...effectiveLocationQtys, ...carryOver]
      }
    }
    const adjusted = effectiveLocationQtys && effectiveLocationQtys.length > 0 ? applyTransfers(effectiveLocationQtys) : null
    const total = adjusted ? adjusted.reduce((s, l) => s + l.qty, 0) : data.remainingQty
    if (total < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }
    const r = await prisma.stockCheck.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        remainingQty: total,
        memo: data.memo || null,
        ...(data.isReconcile ? { isReconcile: true } : {}),
        ...(adjusted ? {
          locationBreakdown: {
            create: adjusted.map(lq => ({
              storageLocationId: lq.storageLocationId,
              remainingQty: lq.qty,
              restockedQty: lq.restockedQty ?? null,
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

// 전체 재고 보정(총점검) — 여러 품목의 실측을 한 번에 기준선으로 박는다.
// 보충(창고→방 이동)이 끝난 상태에서 실제 남은 수량을 세어 입력 → isReconcile 점검 생성.
// 사용량 계산은 이 점검 직전 구간의 차이(분실·오차)를 소모로 잡지 않는다(overview.ts).
// 차이가 0 인(실측=예상) 품목은 건너뛴다 — 불필요한 점검 레코드 방지.
export async function saveFullReconcile(data: {
  date: string
  items: {
    trackedItemId: string
    // 위치 있는 품목: 위치별 실측. 위치 없는 품목: remainingQty.
    locationQtys?: { storageLocationId: string; qty: number }[]
    remainingQty?: number
    memo?: string | null
  }[]
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!data.items.length) return { ok: true, count: 0 }
    const ids = data.items.map(i => i.trackedItemId)
    const owned = await prisma.trackedItem.findMany({ where: { id: { in: ids }, propertyId }, select: { id: true } })
    const ownedSet = new Set(owned.map(o => o.id))
    const date = new Date(data.date)
    let count = 0
    await prisma.$transaction(async tx => {
      for (const item of data.items) {
        if (!ownedSet.has(item.trackedItemId)) continue
        const hasLoc = item.locationQtys && item.locationQtys.length > 0
        const total = hasLoc
          ? item.locationQtys!.reduce((s, l) => s + l.qty, 0)
          : (item.remainingQty ?? 0)
        if (total < 0) continue
        await tx.stockCheck.create({
          data: {
            trackedItemId: item.trackedItemId,
            date,
            remainingQty: total,
            isReconcile: true,
            memo: item.memo ?? '전체 재고 보정',
            ...(hasLoc ? {
              locationBreakdown: {
                create: item.locationQtys!.map(l => ({
                  storageLocationId: l.storageLocationId,
                  remainingQty: l.qty,
                })),
              },
            } : {}),
          },
        })
        count++
      }
    })
    revalidatePath('/inventory')
    return { ok: true, count }
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
  // #3 위치별 점검 머지 — 서버가 이 점검의 현재 위치별 잔량을 base로 적용(stale 방지) + 시각 갱신.
  locationPatch?: LocCheckPatch
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const c = await prisma.stockCheck.findUnique({ where: { id }, include: { trackedItem: true, locationBreakdown: true } })
    if (!c || c.trackedItem.propertyId !== propertyId) return { ok: false, error: '점검 기록을 찾을 수 없습니다.' }

    // #3: locationPatch가 오면 이 점검의 현재 위치별 잔량을 base로 서버에서 적용(연속 위치점검 머지 정확)
    let patchedQtys: LocQty[] | null = null
    if (data.locationPatch) {
      const base = c.locationBreakdown.map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty }))
      patchedQtys = applyLocationCheck(base, data.locationPatch)
    }
    const effectiveLocationQtys = patchedQtys ?? data.locationQtys
    const adjusted = effectiveLocationQtys && effectiveLocationQtys.length > 0 ? applyTransfers(effectiveLocationQtys) : null
    const finalQty = adjusted ? adjusted.reduce((s, lq) => s + lq.qty, 0) : data.remainingQty

    if (finalQty !== undefined && finalQty < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }
    // #3 머지 시 점검 시각을 마지막 점검 시각(지금)으로 갱신 (locationPatch 사용 시)
    const bumpTime = !!data.locationPatch

    await prisma.$transaction(async (tx) => {
      await tx.stockCheck.update({
        where: { id },
        data: {
          ...(data.date ? { date: new Date(data.date) } : {}),
          ...(bumpTime ? { createdAt: new Date() } : {}),
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
            restockedQty: lq.restockedQty ?? null,
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

// ── 점검 임시저장(드래프트) ──────────────────────────────────────
// '보충 전'만 입력하고 나중에 이어서 마무리. StockCheck 와 별도 테이블이라 잔량 계산엔 영향 없음.
// 항목+위치당 1개 (아이템별 점검 = locationId null, 위치별 점검 = 그 위치).

export async function saveStockCheckDraft(input: {
  trackedItemId: string
  locationId?: string | null
  data: Record<string, unknown>
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: input.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const locationId = input.locationId ?? null
    await prisma.stockCheckDraft.deleteMany({ where: { trackedItemId: input.trackedItemId, locationId } })
    await prisma.stockCheckDraft.create({
      data: { trackedItemId: input.trackedItemId, locationId, data: input.data as any },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 드래프트에 실제 입력값이 남아있는지 (cross-clear 후 빈 껍데기면 삭제 판단용)
function draftHasContent(d: any): boolean {
  for (const m of [d?.beforeQtys, d?.afterQtys, d?.locationQtys]) {
    if (m && typeof m === 'object') {
      for (const k of Object.keys(m)) if (m[k] != null && m[k] !== '') return true
    }
  }
  return d?.qty != null && d.qty !== ''
}

export async function deleteStockCheckDraft(
  trackedItemId: string, locationId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const loc = locationId ?? null
    await prisma.stockCheckDraft.deleteMany({ where: { trackedItemId, locationId: loc } })
    // 위치별 드래프트를 지울 땐, 아이템별(null) 드래프트에 남은 그 위치 값도 정리
    // (cross-mode 공유 — 한쪽에서 점검 완료 시 다른 쪽 잔재가 다시 뜨지 않도록).
    if (loc) {
      const nullDraft = await prisma.stockCheckDraft.findFirst({ where: { trackedItemId, locationId: null } })
      if (nullDraft) {
        const d = (nullDraft.data ?? {}) as any
        const before = { ...(d.beforeQtys ?? {}) }; delete before[loc]
        const after  = { ...(d.afterQtys ?? {}) };  delete after[loc]
        const next = { ...d, beforeQtys: before, afterQtys: after }
        if (draftHasContent(next)) {
          await prisma.stockCheckDraft.update({ where: { id: nullDraft.id }, data: { data: next } })
        } else {
          await prisma.stockCheckDraft.delete({ where: { id: nullDraft.id } }).catch(() => {})
        }
      }
    }
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 한 품목의 모든 드래프트 삭제 (아이템별 + 모든 위치별) — 아이템별 점검 완료 시 전체 정리용
export async function deleteItemDrafts(trackedItemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    await prisma.stockCheckDraft.deleteMany({ where: { trackedItemId } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 한 항목의 드래프트들 (아이템별 = locationId null, 위치별 = 해당 위치) — 재개·표시용
export async function getItemDrafts(
  trackedItemId: string,
): Promise<{ locationId: string | null; data: any }[]> {
  const propertyId = await getPropertyId()
  const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
  if (!it) return []
  const rows = await prisma.stockCheckDraft.findMany({ where: { trackedItemId } })
  return rows.map(r => ({ locationId: r.locationId, data: r.data as any }))
}

// 특정 위치의 드래프트 — 위치별 일괄 점검 재개용 (품목 id → { before, after }).
// 위치별 드래프트(이 위치 행) + 아이템별 드래프트(locationId null)의 이 위치 값을 savedAt 기준
// 병합 → 두 모드(아이템별/위치별)에서 임시저장한 값이 서로 보이도록 cross-mode 공유.
export async function getLocationDrafts(
  locationId: string,
): Promise<{ trackedItemId: string; data: any }[]> {
  const propertyId = await getPropertyId()
  const [locRows, nullRows] = await Promise.all([
    prisma.stockCheckDraft.findMany({ where: { locationId, trackedItem: { propertyId } } }),
    prisma.stockCheckDraft.findMany({ where: { locationId: null, trackedItem: { propertyId } } }),
  ])
  const savedAtOf = (d: any) => (typeof d?.savedAt === 'number' ? d.savedAt : 0)
  const merged = new Map<string, { before?: string; after?: string; savedAt: number }>()
  for (const r of locRows) {
    const d = r.data as any
    merged.set(r.trackedItemId, { before: d?.before, after: d?.after, savedAt: savedAtOf(d) })
  }
  for (const r of nullRows) {
    const d = r.data as any
    const before = d?.beforeQtys?.[locationId]
    const after  = d?.afterQtys?.[locationId]
    if (before == null && after == null) continue
    const savedAt = savedAtOf(d)
    const cur = merged.get(r.trackedItemId)
    if (!cur || savedAt > cur.savedAt) merged.set(r.trackedItemId, { before, after, savedAt })
  }
  return Array.from(merged.entries()).map(([trackedItemId, v]) => ({
    trackedItemId, data: { before: v.before, after: v.after },
  }))
}

// 드래프트가 하나라도 있는 품목 ID 목록 — 목록 '점검 진행 중' 배지용
export async function getDraftItemIds(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.stockCheckDraft.findMany({
    where: { trackedItem: { propertyId } },
    select: { trackedItemId: true },
    distinct: ['trackedItemId'],
  })
  return rows.map(r => r.trackedItemId)
}

// ── StockAddition CRUD
export async function createStockAddition(data: {
  trackedItemId: string; date: string; addedQty: number; source?: string; memo?: string
  storageLocationId?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (data.addedQty <= 0) return { ok: false, error: '입수 수량은 0보다 커야 합니다.' }
    if (data.storageLocationId) {
      const loc = await prisma.storageLocation.findFirst({ where: { id: data.storageLocationId, propertyId } })
      if (!loc) return { ok: false, error: '보관 위치를 찾을 수 없습니다.' }
    }
    const r = await prisma.stockAddition.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        addedQty: data.addedQty,
        source: data.source || null,
        memo: data.memo || null,
        storageLocationId: data.storageLocationId || null,
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
  storageLocationId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const a = await prisma.stockAddition.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!a || a.trackedItem.propertyId !== propertyId) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
    if (data.addedQty !== undefined && data.addedQty <= 0) return { ok: false, error: '입수 수량은 0보다 커야 합니다.' }
    if (data.storageLocationId) {
      const loc = await prisma.storageLocation.findFirst({ where: { id: data.storageLocationId, propertyId } })
      if (!loc) return { ok: false, error: '보관 위치를 찾을 수 없습니다.' }
    }
    await prisma.stockAddition.update({
      where: { id },
      data: {
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.addedQty !== undefined ? { addedQty: data.addedQty } : {}),
        ...(data.source !== undefined ? { source: data.source || null } : {}),
        ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
        ...(data.storageLocationId !== undefined ? { storageLocationId: data.storageLocationId || null } : {}),
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
    const newReceivedAt = data.receivedAt !== undefined
      ? (data.receivedAt ? new Date(data.receivedAt) : null)
      : undefined
    await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.vendor !== undefined ? { vendor: data.vendor || null } : {}),
        ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
        ...(newReceivedAt !== undefined ? { receivedAt: newReceivedAt } : {}),
      },
    })

    // 수령일이 바뀌었으면 confirmReceipt가 만든 자동 점검의 date도 동기화 / null로 가면 삭제.
    if (newReceivedAt !== undefined) {
      if (newReceivedAt === null) {
        // 수령 대기로 되돌림 → 자동 점검 제거 (잔량 계산에서 이 수령분이 빠지도록)
        await prisma.stockCheck.deleteMany({ where: { sourceExpenseId: id } })
      } else {
        await prisma.stockCheck.updateMany({
          where: { sourceExpenseId: id },
          data: { date: newReceivedAt },
        })
      }
    }

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
// 라벨 정규화 — 병합 후보 매칭용. 소문자화 + 괄호내용·규격/수량 표기·공백·구분자 제거.
// "종량제쓰레기봉투 (20L)" / "종량제쓰레기봉투 50L" → 둘 다 "종량제쓰레기봉투"
function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                                                // 괄호와 내용
    .replace(/\d+(\.\d+)?\s*(l|ml|g|kg|m|매|개|롤|포|포대|팩|박스|개입|구|호)?/g, ' ') // 숫자(+단위)
    .replace(/[\s\-_.,/]+/g, '')                                               // 공백·구분자
    .trim()
}

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

export async function seedTrackedItemsFromExpenses(): Promise<{ ok: true; created: number; migrated: number; skippedArchived: number; decisions: MergeDecision[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const trackedCats = await getTrackedCategories(propertyId)
    const rows = await prisma.expense.findMany({
      where: {
        propertyId,
        category: { in: trackedCats },
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
    const pendingDecisions: MergeDecision[] = []

    // 병합 후보 매칭 준비 — 활성 카드(정규화 라벨별) + 병합 규칙(LINK 추천 / MUTE 거절)
    const activeItems = await prisma.trackedItem.findMany({
      where: { propertyId, isArchived: false, category: { in: trackedCats } },
      select: { id: true, label: true, category: true },
    })
    const itemById = new Map(activeItems.map(it => [it.id, it]))
    const norm2items = new Map<string, { id: string; label: string }[]>()   // key: `${cat}|${norm}`
    for (const it of activeItems) {
      const key = `${it.category}|${normalizeLabel(it.label)}`
      if (!norm2items.has(key)) norm2items.set(key, [])
      norm2items.get(key)!.push({ id: it.id, label: it.label })
    }
    const rules = await prisma.trackedItemMergeRule.findMany({ where: { propertyId } })
    const linkMap = new Map<string, string[]>()   // `${cat}|${norm}` -> targetItemIds
    const muteSet = new Set<string>()             // `${cat}|${norm}|${targetItemId}`
    for (const r of rules) {
      const key = `${r.category}|${r.normLabel}`
      if (r.kind === 'LINK') { if (!linkMap.has(key)) linkMap.set(key, []); linkMap.get(key)!.push(r.targetItemId) }
      else if (r.kind === 'MUTE') muteSet.add(`${key}|${r.targetItemId}`)
    }

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
        // 새 카드를 만들기 전, 병합 후보(별칭 LINK + 유사 라벨) 탐색.
        // 후보가 있으면 자동 생성하지 않고 사용자 확인 대기로 보류(이 그룹은 라벨 마이그레이션도 보류).
        const nrm = normalizeLabel(label)
        const key = `${g.category}|${nrm}`
        const cand = new Map<string, { itemId: string; label: string }>()
        for (const it of (norm2items.get(key) ?? [])) {
          if (it.label === label) continue
          if (muteSet.has(`${key}|${it.id}`)) continue
          cand.set(it.id, { itemId: it.id, label: it.label })
        }
        for (const tid of (linkMap.get(key) ?? [])) {
          if (muteSet.has(`${key}|${tid}`)) continue
          const it = itemById.get(tid)
          if (it) cand.set(tid, { itemId: tid, label: it.label })
        }
        if (cand.size > 0) {
          pendingDecisions.push({
            newLabel: label, category: g.category, expenseIds: g.expenseIds,
            specUnit: g.specUnit, qtyUnit: g.qtyUnit,
            candidates: Array.from(cand.values()),
          })
          continue   // 사용자 결정 전까지 생성·마이그레이션 보류
        }
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
    return { ok: true, created, migrated, skippedArchived, decisions: pendingDecisions }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 병합 결정·규칙 ──────────────────────────────────────────
// 자동등록 후 사용자가 선택한 병합 결정을 반영.
// choice.merge: 지출을 대상 카드로 귀속 + LINK 규칙 기록(다음에 추천).
// choice.new: 새 카드 생성 + 거절한 후보는 MUTE 규칙 기록(다시 추천 안 함).
export async function applyMergeDecision(input: {
  category: string
  newLabel: string
  expenseIds: string[]
  specUnit?: string | null
  qtyUnit?: string | null
  choice:
    | { kind: 'merge'; targetItemId: string }
    | { kind: 'new'; declinedItemIds?: string[] }
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { category, newLabel, expenseIds } = input
    const nrm = normalizeLabel(newLabel)

    if (input.choice.kind === 'merge') {
      const target = await prisma.trackedItem.findFirst({ where: { id: input.choice.targetItemId, propertyId } })
      if (!target) return { ok: false, error: '대상 품목을 찾을 수 없습니다.' }
      if (expenseIds.length > 0) {
        await prisma.expense.updateMany({ where: { id: { in: expenseIds }, propertyId }, data: { itemLabel: target.label } })
      }
      await prisma.trackedItemMergeRule.upsert({
        where: { propertyId_category_normLabel_targetItemId: { propertyId, category, normLabel: nrm, targetItemId: target.id } },
        update: { kind: 'LINK', sourceLabel: newLabel },
        create: { propertyId, category, sourceLabel: newLabel, normLabel: nrm, targetItemId: target.id, kind: 'LINK' },
      })
    } else {
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category, label: newLabel } },
        select: { id: true, isArchived: true },
      })
      if (existing?.isArchived) {
        await prisma.trackedItem.update({ where: { id: existing.id }, data: { isArchived: false } })
      } else if (!existing) {
        await prisma.trackedItem.create({
          data: {
            propertyId, category, label: newLabel,
            specUnit: input.specUnit ?? null, qtyUnit: input.qtyUnit ?? null,
            trackUnit: category === '폐기물 처리비' ? 'qty' : 'spec',
          },
        })
      }
      if (expenseIds.length > 0) {
        await prisma.expense.updateMany({ where: { id: { in: expenseIds }, propertyId, itemLabel: { not: newLabel } }, data: { itemLabel: newLabel } })
      }
      for (const tid of (input.choice.declinedItemIds ?? [])) {
        await prisma.trackedItemMergeRule.upsert({
          where: { propertyId_category_normLabel_targetItemId: { propertyId, category, normLabel: nrm, targetItemId: tid } },
          update: { kind: 'MUTE', sourceLabel: newLabel },
          create: { propertyId, category, sourceLabel: newLabel, normLabel: nrm, targetItemId: tid, kind: 'MUTE' },
        })
      }
    }
    revalidatePath('/inventory')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 병합 규칙 목록 — 관리 UI용 (LINK 연결 / MUTE 거절)
export async function getMergeRules(): Promise<MergeRuleRow[]> {
  const propertyId = await getPropertyId()
  const rules = await prisma.trackedItemMergeRule.findMany({
    where: { propertyId },
    orderBy: [{ category: 'asc' }, { sourceLabel: 'asc' }],
  })
  const targetIds = Array.from(new Set(rules.map(r => r.targetItemId)))
  const targets = targetIds.length > 0
    ? await prisma.trackedItem.findMany({ where: { id: { in: targetIds } }, select: { id: true, label: true } })
    : []
  const labelById = new Map(targets.map(t => [t.id, t.label]))
  return rules.map(r => ({
    id: r.id, category: r.category, sourceLabel: r.sourceLabel,
    kind: r.kind as 'LINK' | 'MUTE', targetItemId: r.targetItemId,
    targetLabel: labelById.get(r.targetItemId) ?? null,
  }))
}

// 병합 규칙 삭제 — 거절 되돌리기(MUTE 삭제 → 다시 추천) 또는 잘못된 연결(LINK) 제거
export async function deleteMergeRule(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.trackedItemMergeRule.deleteMany({ where: { id, propertyId } })
    revalidatePath('/inventory')
    return { ok: true }
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
// locationId가 지정되면, 그 위치의 잔량에 수령 수량을 더한 StockCheck를 자동 생성한다.
// 결과: 수령 확인 직후 재고 점검을 열면 해당 위치 잔량이 0이 아니라 수령된 만큼으로 prefill됨 (#3)
export async function confirmReceipt(expenseId: string, locationId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const expense = await prisma.expense.findFirst({ where: { id: expenseId, propertyId } })
    if (!expense) return { ok: false, error: '구매 내역을 찾을 수 없습니다.' }

    const receivedAt = new Date()
    await prisma.expense.update({
      where: { id: expenseId },
      data: { receivedAt, ...(locationId ? { receivedLocationId: locationId } : {}) },
    })

    // 위치 지정 + 수량 정보 있을 때만 자동 점검 생성
    if (locationId && expense.qtyValue && expense.qtyValue > 0 && expense.itemLabel) {
      const item = await prisma.trackedItem.findFirst({
        where: {
          propertyId, category: expense.category, label: expense.itemLabel,
          ...(expense.qtyUnit ? { qtyUnit: expense.qtyUnit } : {}),
          isArchived: false,
        },
        select: { id: true, trackUnit: true, specUnit: true, qtyUnit: true },
      })

      if (item) {
        const receivedQty = item.trackUnit === 'spec' && expense.specValue
          ? expense.qtyValue * expense.specValue
          : expense.qtyValue

        if (receivedQty > 0) {
          const lastCheck = await prisma.stockCheck.findFirst({
            where: { trackedItemId: item.id },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            include: { locationBreakdown: true },
          })
          const prevByLoc = new Map<string, number>(
            (lastCheck?.locationBreakdown ?? []).map(lb => [lb.storageLocationId, lb.remainingQty])
          )
          const prevAtTarget = prevByLoc.get(locationId) ?? 0
          const newAtTarget = prevAtTarget + receivedQty
          // 다른 위치는 이전 값 유지, 대상 위치만 +receivedQty
          const allLocs: { storageLocationId: string; qty: number }[] = []
          for (const [locId, qty] of prevByLoc) {
            if (locId !== locationId && qty > 0) allLocs.push({ storageLocationId: locId, qty })
          }
          allLocs.push({ storageLocationId: locationId, qty: newAtTarget })
          const totalQty = allLocs.reduce((s, l) => s + l.qty, 0)

          const unit = item.trackUnit === 'spec' ? (item.specUnit ?? '') : (item.qtyUnit ?? '')
          await prisma.stockCheck.create({
            data: {
              trackedItemId: item.id,
              // 자동 점검의 date는 receivedAt(=현재 시각) 기준 — 사용자가 나중에 수령일을 수정하면
              // updateExpenseFromInventory에서 sourceExpenseId로 찾아 동기화한다.
              date: receivedAt,
              remainingQty: totalQty,
              memo: `[수령 자동] +${receivedQty}${unit}`,
              sourceExpenseId: expenseId,
              locationBreakdown: {
                create: allLocs.filter(l => l.qty > 0).map(l => ({
                  storageLocationId: l.storageLocationId,
                  remainingQty: l.qty,
                })),
              },
            },
          })
        }
      }
    }

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

// ── 재고관리 카테고리 설정 (추적 대상 + 표시 별칭)
const DEFAULT_EXPENSE_CATEGORIES_INV = '부식비,소모품비,폐기물 처리비,수선유지비,공과금,마케팅/광고비,인건비,청소용역비,관리비,임대료,통신/렌탈/보험료,세금/수수료,보증금 반환'

// 설정 화면용 — 현재 재고 카테고리 + 선택 가능한 전체 지출 카테고리.
export async function getInventoryCategorySettings(): Promise<{
  categories: InventoryCategory[]
  allExpenseCategories: string[]
}> {
  const propertyId = await getPropertyId()
  const [categories, property] = await Promise.all([
    getInventoryCategoryConfig(propertyId),
    prisma.property.findUnique({ where: { id: propertyId }, select: { expenseCategories: true } }),
  ])
  const raw = property?.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES_INV
  const allExpenseCategories = raw.split(',').map(s => s.trim()).filter(Boolean)
  return { categories, allExpenseCategories }
}

// 재고 카테고리 저장 — entries 순서 = 표시 순서. cat 은 지출 카테고리 중, alias 빈 값이면 제안 별칭.
export async function setInventoryCategories(
  entries: { cat: string; alias: string }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    // 정규화 + 중복 cat 제거
    const seen = new Set<string>()
    const clean: InventoryCategory[] = []
    for (const e of entries) {
      const cat = (e.cat ?? '').trim()
      if (!cat || seen.has(cat)) continue
      seen.add(cat)
      const alias = (e.alias ?? '').trim() || suggestInventoryAlias(cat)
      clean.push({ cat, alias })
    }
    if (clean.length === 0) return { ok: false, error: '최소 1개 카테고리가 필요합니다.' }
    await prisma.property.update({
      where: { id: propertyId },
      data: { inventoryCategories: JSON.stringify(clean) },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
