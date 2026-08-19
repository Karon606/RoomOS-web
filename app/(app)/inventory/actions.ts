'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { getMyRole } from '@/lib/role'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
// 이 파일의 모든 쓰기 게이트는 재고 스코프로 판정한다(전역 requireEdit 아님) — 제한 스태프 재고 쓰기 허용(65992b0a).
import { requireScopeEdit } from '@/lib/role'
const requireEdit = () => requireScopeEdit('inventory')
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry, type MergeDecision, type MergeRuleRow, type MergeUndoRow, type InventoryCategory, type DiffAttribution, suggestInventoryAlias, resolveDiffAttribution } from './constants'
import { getInventoryCategoryConfig, getTrackedCategories, defaultTrackUnitForCategory } from './categoryConfig'
import { computeInventoryOverview, sumPurchases, sumAdditions, sumDisposals, resolveUnitHint } from './overview'
import { applyLocationCheck, detectHubShort, type LocCheckPatch } from '@/lib/stockCheckMerge'
import { type ShiftRow } from '@/lib/stockLedger'
// 원장 조정 공용층 — 계산 정본은 lib/stockLedger, 조회·적용·되돌리기는 ledgerShift(서버 전용).
import { buildAdditionShiftPlan, buildPurchaseShiftPlan, convertedPurchaseQty, matchedTrackedItemForExpense, applyShiftRows, revertShiftRows, resolveItemHubLocationId, type LedgerShiftUndo } from './ledgerShift'
import { specMultiplier, unitFactor, canonicalUnit, isConvertibleUnit } from '@/lib/units'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

// 금액 읽기 권한 — 재고 축 전체에 이 검사가 한 군데도 없었다(C페이즈 조사 2026-08-03).
// LIMITED_STAFF 는 설계상 '재고 쓰기 허용, 금액 읽기 차단'인데 /inventory 가 라우트 화이트리스트에
// 있어서 평균 단가·최근 단가·수령 대기 금액·월별 구매금액·단가 추이를 전부 봤다.
// UI 만 가리면 서버 액션 호출로 뚫리므로 **서버에서 지운다**(운영자 지시 2026-08-03 — 모두 가림).
export async function canSeeMoney(): Promise<boolean> {
  return canReadScope(await getMyRole(), 'money')
}

// ── 추적 품목 목록 + 계산된 지표 (compute 는 overview.ts 로 분리 — Cron 등 재사용)
export async function getInventoryOverview(): Promise<InventoryRow[]> {
  const rows = await computeInventoryOverview(await getPropertyId())
  if (await canSeeMoney()) return rows
  // 금액 읽기 차단 역할에게는 **서버에서 지운다.** UI 만 가리면 액션 호출로 뚫린다.
  // 잔량·소진 예측은 재고 업무에 필요하므로 남긴다 — 금액만 없앤다.
  return rows.map(r => ({
    ...r,
    avgUnitPrice: null,
    lastUnitPrice: null,
    pendingPurchases: r.pendingPurchases.map(p => ({ ...p, amount: null })),
  }))
}

// ── 월별 입수량 (구매 + 무상수령 합산, qtyValue 기준)
export async function getMonthlyInflow(trackedItemId: string): Promise<MonthlyInflowRow[]> {
  if (!(await canSeeMoney())) return []
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
        // 느슨 매칭 — qtyUnit null/일치 모두 같은 품목(잔량 계산과 동일 규칙). 단위 미입력 입수 누락 방지.
        ...(item.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: item.qtyUnit }] } : {}),
        qtyValue: { gt: 0 },
        receivedAt: { not: null },
        excludeFromInventory: false,
      },
      select: { date: true, qtyValue: true, specValue: true, specUnit: true, amount: true },
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
    const spec = useSpec ? specMultiplier(p.specValue, p.specUnit, item.specUnit) : null
    const contrib = spec != null ? q * spec : q
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
  if (!(await canSeeMoney())) return []
  const propertyId = await getPropertyId()
  const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
  if (!item) return []
  const rows = await prisma.expense.findMany({
    where: {
      propertyId,
      category: item.category,
      itemLabel: item.label,
      // 느슨 매칭 — qtyUnit null/일치 모두 같은 품목(잔량 계산과 동일 규칙).
      ...(item.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: item.qtyUnit }] } : {}),
      qtyValue: { gt: 0 },
      amount: { gt: 0 },
      receivedAt: { not: null },
      excludeFromInventory: false,
    },
    select: { date: true, amount: true, qtyValue: true, specValue: true, specUnit: true },
    orderBy: { date: 'asc' },
  })
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
  return rows
    .filter(r => r.qtyValue && r.qtyValue > 0)
    .map(r => {
      const qty = r.qtyValue ?? 0
      const spec = useSpec ? specMultiplier(r.specValue, r.specUnit, item.specUnit) : null
      const base = spec != null ? qty * spec : qty
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
  // unitHint = 표시 전용 단위 폴백(overview.resolveUnitHint 정본) — 카드 qtyUnit 이 비었을 때만 쓰인다.
  item: { id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null; unitHint: string | null; memo: string | null; trackUnit: 'spec' | 'qty'; hubLocationId: string | null; locations: StorageLocationItem[] }
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

  const [checks, additions, disposals, purchases, unitHint] = await Promise.all([
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
    prisma.stockDisposal.findMany({
      where: { trackedItemId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { storageLocation: { select: { id: true, name: true } } },
    }),
    prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        // 단위 미입력(null) 구매도 포함 — 수량 없이 기록된 구매가 타임라인·수령 확인에서 누락되지 않게
        ...(item.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: item.qtyUnit }] } : {}),
        excludeFromInventory: false,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, date: true, createdAt: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, amount: true, vendor: true, memo: true, receivedAt: true, receivedLocation: { select: { name: true } } },
    }),
    // 목록(overview)과 같은 헬퍼 한 벌 — 카드와 상세의 단위 표시가 갈라지지 않게.
    resolveUnitHint(propertyId, item.category, item.label, item.qtyUnit),
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
    ...disposals.map(d => ({
      type: 'disposal' as const,
      id: d.id, date: d.date, createdAt: d.createdAt, disposedQty: d.disposedQty, reason: d.reason, memo: d.memo,
      storageLocationId: d.storageLocationId,
      storageLocationName: d.storageLocation?.name ?? null,
    })),
    // 수량 미입력 구매도 타임라인에 포함(qtyValue 0 으로) — 입고 수학엔 0 기여라 무해, 수령 확인 진입점은 보존
    ...purchases.map(p => ({
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
    const KST = 9 * 3600000
    const kstDay = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10)
    // 백필(나중 입력) 항목 — 그 날짜(date)의 KST 자정 + 입력시각(createdAt)의 KST 하루중 경과시간.
    //   이러면 화면에 보이는 시각(createdAt 의 시:분)과 정렬 위치가 일치해, 같은 날 안에서
    //   백필 보정이 자정으로 밀려 맨 아래 깔리던 문제 해소(2026-06-09 사용자 보고).
    const kstMidnightMs = (d: Date) => Math.floor((d.getTime() + KST) / 86400000) * 86400000 - KST
    const kstTodMs = (d: Date) => (d.getTime() + KST) % 86400000
    const effTime = (e: TimelineEntry): Date =>
      e.type === 'purchase'
        ? (e.receivedAt ?? e.date)
        : (kstDay(e.createdAt) === kstDay(e.date)
            ? e.createdAt
            : new Date(kstMidnightMs(e.date) + kstTodMs(e.createdAt)))
    const at = effTime(a).getTime(), bt = effTime(b).getTime()
    if (at !== bt) return bt - at
    // 같은 시각 동률 — 점검(수령 자동반영 결과)이 구매(수령) 위에 (수령→점검 순서의 결과를 먼저).
    const typeRank = (e: TimelineEntry) => e.type === 'check' ? 0 : e.type === 'addition' ? 1 : e.type === 'disposal' ? 2 : 3
    return typeRank(a) - typeRank(b)
  })

  return {
    item: {
      id: item.id, category: item.category, label: item.label,
      specUnit: item.specUnit, qtyUnit: item.qtyUnit, unitHint, memo: item.memo,
      trackUnit: (item.trackUnit === 'qty' ? 'qty' : 'spec') as 'spec' | 'qty',
      hubLocationId: item.hubLocationId,
      locations: item.locations.map(l => ({ id: l.storageLocation.id, name: l.storageLocation.name, sortOrder: l.storageLocation.sortOrder, isHub: item.hubLocationId ? l.storageLocation.id === item.hubLocationId : l.storageLocation.isHub })),
    },
    timeline,
  }
}

// ── TrackedItem CRUD
export async function createTrackedItem(data: {
  category: string; label: string; specUnit?: string | null; qtyUnit?: string | null; memo?: string | null
  // 시작 수량(선택) — 지금 갖고 있는 재고를 오늘 날짜의 첫 점검(절대값 앵커)으로 함께 기록한다.
  // 정식 자리가 없어 운영자가 임의 점검으로 대신하던 관행(점보롤 사건 배경, 백로그 2번)의 승격.
  // 0 도 유효(재고 없이 시작함을 명시). 미지정이면 종전과 동일(점검 없음, 잔량 미점검 상태).
  startQty?: number | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!data.category || !data.label.trim()) return { ok: false, error: '카테고리와 품목명은 필수입니다.' }
    const startQty = data.startQty ?? null
    if (startQty != null && (!Number.isFinite(startQty) || startQty < 0)) {
      return { ok: false, error: '시작 수량은 0 이상이어야 합니다.' }
    }
    // 시작 점검 데이터 — 날짜는 오늘(KST)의 @db.Date 표현(lib/kstDate 정본).
    // isReconcile: 시작 선언은 실측 리셋과 같은 앵커다. 뒤늦게 과거 날짜 입수를 등록해도
    // 이 앵커 이후 전파가 여기서 멈추고(planStockShift), 통계도 이 앞 구간을 소모로 잡지 않는다.
    const startCheck = startQty != null
      ? { date: ymdToDbDate(kstYmdStr()), remainingQty: startQty, memo: '[시작 재고]', isReconcile: true }
      : null

    const existing = await prisma.trackedItem.findUnique({
      where: { propertyId_category_label: { propertyId, category: data.category, label: data.label.trim() } },
    })
    if (existing) {
      if (existing.isArchived) {
        // 숨김 해제 부활 — 시작 수량을 넣었으면 같은 앵커를 만든다("N 으로 다시 시작" 선언).
        // 과거 이력이 있어도 isReconcile 앵커라 이전 구간을 소모로 잡지 않는다.
        const r = await prisma.$transaction(async tx => {
          const it = await tx.trackedItem.update({ where: { id: existing.id }, data: { isArchived: false } })
          if (startCheck) await tx.stockCheck.create({ data: { trackedItemId: it.id, ...startCheck } })
          return it
        })
        revalidatePath('/inventory')
        return { ok: true, id: r.id }
      }
      return { ok: false, error: '이미 등록된 품목입니다.' }
    }

    // 폐기물 처리비는 기본 trackUnit='qty' (50L 봉투 30매를 1500L 아닌 30매로 트래킹)
    const defaultTrackUnit = defaultTrackUnitForCategory(data.category)
    const r = await prisma.$transaction(async tx => {
      const it = await tx.trackedItem.create({
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
      // 같은 트랜잭션 — 품목만 생기고 시작 점검이 빠진 반쪽 상태 방지. 위치 링크가 아직 없으므로
      // 위치 내역 없는 단일 버킷 점검(정식 상태, 신고 408b4396 선례)으로 만든다.
      if (startCheck) await tx.stockCheck.create({ data: { trackedItemId: it.id, ...startCheck } })
      return it
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
          // 느슨 매칭 — 단위 미입력(null) 구매도 같은 품목이므로 함께 라벨 변경(안 그러면 옛 라벨로
          // 남아 새 라벨 품목의 잔량에서 누락됨). (category,label) 유니크라 안전.
          ...(it.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] } : {}),
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

// 품목의 규격 단위를 같은 차원의 다른 단위로 변경(L→ml 등).
//  저장된 점검 잔량·위치별 잔량·무상입수량을 배율로 환산하고 specUnit 을 갱신한다.
//  구매 영수증(Expense)은 각자 단위 유지 — 계산 시점에 새 단위로 자동 환산되므로 건드리지 않는다.
export async function changeTrackedItemUnit(id: string, newUnit: string): Promise<
  { ok: true; factor: number; convertedChecks: number; unitlessReceipts: number } | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }

    const target = newUnit.trim()
    if (!target) return { ok: false, error: '바꿀 단위를 입력해주세요.' }
    if (it.trackUnit === 'qty') return { ok: false, error: '수량(개·매) 추적 품목은 단위 변환 대상이 아닙니다.' }
    if (!it.specUnit?.trim()) return { ok: false, error: '규격 단위가 없는 품목입니다. 품목 편집에서 단위를 먼저 지정해주세요.' }
    if (canonicalUnit(it.specUnit) === canonicalUnit(target)) {
      return { ok: false, error: '현재 단위와 같습니다.' }
    }
    if (!isConvertibleUnit(it.specUnit) || !isConvertibleUnit(target)) {
      return { ok: false, error: '자동 변환을 지원하는 단위가 아닙니다 (부피·무게·길이만 가능).' }
    }
    const factor = unitFactor(it.specUnit, target)
    if (factor == null) {
      return { ok: false, error: `단위 차원이 달라 변환할 수 없습니다 (${it.specUnit} ↔ ${target}).` }
    }

    const checkIds = (await prisma.stockCheck.findMany({ where: { trackedItemId: id }, select: { id: true } })).map(c => c.id)
    const additionIds = (await prisma.stockAddition.findMany({ where: { trackedItemId: id }, select: { id: true } })).map(a => a.id)
    const disposalIds = (await prisma.stockDisposal.findMany({ where: { trackedItemId: id }, select: { id: true } })).map(d => d.id)
    await scaleStockValues(checkIds, additionIds, disposalIds, factor)
    await prisma.trackedItem.update({ where: { id }, data: { specUnit: canonicalUnit(target) ?? target } })

    // 규격 단위가 비어 있는 과거 영수증 — 계산 시점 자동 환산이 불가능해(어느 단위인지 모름)
    // 원값 그대로 합산된다. 개수를 알려 사용자가 해당 영수증의 단위를 채우도록 안내.
    const unitlessReceipts = await prisma.expense.count({
      where: {
        propertyId, category: it.category, itemLabel: it.label,
        specValue: { not: null },
        // qtyUnit 느슨 매칭(null/일치)과 specUnit 빈값 조건을 AND 로 묶는다 — 둘 다 OR 라 키 충돌 방지.
        AND: [
          ...(it.qtyUnit ? [{ OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] }] : []),
          { OR: [{ specUnit: null }, { specUnit: '' }] },
        ],
      },
    })

    revalidatePath('/inventory')
    revalidatePath('/finance')
    return { ok: true, factor, convertedChecks: checkIds.length, unitlessReceipts }
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

// 저장된 점검 잔량·위치별 잔량·무상입수량에 배율(factor)을 곱한다.
//  단위 변경(L→ml) 또는 단위 다른 품목 병합 시, 품목 단위로 통일하기 위해 사용.
//  checkIds/additionIds 로 범위를 한정(병합 시 '이전된 것만' 환산, target 기존값 보호).
async function scaleStockValues(checkIds: string[], additionIds: string[], disposalIds: string[], factor: number): Promise<void> {
  if (factor === 1 || !isFinite(factor) || factor <= 0) return
  for (const id of checkIds) {
    const c = await prisma.stockCheck.findUnique({ where: { id }, select: { remainingQty: true } })
    if (c) await prisma.stockCheck.update({ where: { id }, data: { remainingQty: c.remainingQty * factor } })
  }
  if (checkIds.length > 0) {
    const locs = await prisma.stockCheckLocation.findMany({
      where: { stockCheckId: { in: checkIds } },
      select: { id: true, remainingQty: true, restockedQty: true, fromHubQty: true },
    })
    for (const l of locs) {
      await prisma.stockCheckLocation.update({
        where: { id: l.id },
        data: {
          remainingQty: l.remainingQty * factor,
          ...(l.restockedQty != null ? { restockedQty: l.restockedQty * factor } : {}),
          ...(l.fromHubQty != null ? { fromHubQty: l.fromHubQty * factor } : {}),
        },
      })
    }
  }
  for (const id of additionIds) {
    const a = await prisma.stockAddition.findUnique({ where: { id }, select: { addedQty: true } })
    if (a) await prisma.stockAddition.update({ where: { id }, data: { addedQty: a.addedQty * factor } })
  }
  for (const id of disposalIds) {
    const d = await prisma.stockDisposal.findUnique({ where: { id }, select: { disposedQty: true } })
    if (d) await prisma.stockDisposal.update({ where: { id }, data: { disposedQty: d.disposedQty * factor } })
  }
}

// 두 추적 품목을 병합. source의 expense·stockCheck·stockAddition을 target으로 이전.
// 라면처럼 사이즈가 다양해도 전체 합산하고 싶을 때 사용.
// looseMatch=true 면 target.qtyUnit 을 null로 만들어 sumPurchases가 qtyUnit 무시하고 매칭.
// 단위 자동 환산: source·target 둘 다 규격 추적 + 호환 단위면(L↔ml 등) 이전된 점검·입수값을
//   target 단위로 환산. 차원이 다르면(kg↔L) 병합 차단.
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

    // 0) 단위 환산 배율 — source·target 둘 다 규격 추적 + 단위 둘 다 환산 가능할 때만.
    //    같은 차원의 다른 단위(L↔ml)면 factor 로 환산. 다른 차원(kg↔L)이면 차단.
    //    한쪽이라도 비물리 단위('개' 등)거나 규격 추적 아니면 환산 없이 기존대로 합산.
    let mergeFactor = 1
    const bothSpec = source.trackUnit !== 'qty' && target.trackUnit !== 'qty'
      && !!source.specUnit?.trim() && !!target.specUnit?.trim()
    if (bothSpec && canonicalUnit(source.specUnit) !== canonicalUnit(target.specUnit)
      && isConvertibleUnit(source.specUnit) && isConvertibleUnit(target.specUnit)) {
      const f = unitFactor(source.specUnit, target.specUnit)
      if (f == null) {
        return { ok: false, error: `단위가 호환되지 않아 병합할 수 없습니다 (${source.specUnit} ↔ ${target.specUnit}). 단위를 먼저 맞춰주세요.` }
      }
      mergeFactor = f
    }

    // 1) source 매칭 expense들의 itemLabel을 target.label로 변경
    //    (qtyUnit/specUnit은 expense 그대로 유지 — 사이즈 정보 보존)
    const matchSourceExpenses: any = {
      propertyId, category: source.category, itemLabel: source.label,
    }
    if (source.qtyUnit) matchSourceExpenses.qtyUnit = source.qtyUnit
    // 되돌리기용 — 이전 대상이 될 id들을 변경 전에 캡처
    const movedExpenseIds = (await prisma.expense.findMany({ where: matchSourceExpenses, select: { id: true } })).map(e => e.id)
    const movedCheckIds   = (await prisma.stockCheck.findMany({ where: { trackedItemId: sourceId }, select: { id: true } })).map(c => c.id)
    const movedAdditionIds = (await prisma.stockAddition.findMany({ where: { trackedItemId: sourceId }, select: { id: true } })).map(a => a.id)
    const movedDisposalIds = (await prisma.stockDisposal.findMany({ where: { trackedItemId: sourceId }, select: { id: true } })).map(d => d.id)
    const targetQtyUnitBefore = target.qtyUnit
    // 위치 링크 — source 것을 target 에 합쳐야 한다(아래 2.6). source 는 마지막에 delete 되고
    // 링크는 cascade 로 사라지므로, 안 옮기면 이전된 점검의 breakdown 이 통째로 orphan 이 된다.
    // targetLocationIdsBefore = 합집합이 '새로 더한' 링크만 정확히 되돌리기 위한 기준선(undo).
    // closedAt 도 옮긴다 — source 에서 숨긴 위치가 target 에서 열림으로 부활하면 0kg 칩이 다시 뜬다(2단계 F5).
    const sourceLocations = (await prisma.trackedItemLocation.findMany({
      where: { trackedItemId: sourceId }, select: { storageLocationId: true, closedAt: true },
    })).map(l => ({ storageLocationId: l.storageLocationId, closedAt: l.closedAt ? l.closedAt.toISOString() : null }))
    const targetLocationIdsBefore = (await prisma.trackedItemLocation.findMany({
      where: { trackedItemId: targetId }, select: { storageLocationId: true },
    })).map(l => l.storageLocationId)

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
      prisma.stockDisposal.updateMany({
        where: { trackedItemId: sourceId },
        data: { trackedItemId: targetId },
      }),
    ])

    // 2.6) 위치 링크 합집합 — 두 카드의 재고가 한 카드가 됐으니 소재도 합집합이 맞다.
    //   source 우선이면 target 자기 재고가 숨고, target 우선이면 옮겨온 breakdown 이 통째로 orphan 이 된다.
    //   반드시 source delete(아래) 전에. cascade 로 링크가 사라지면 복구 근거가 없다.
    //   양쪽에 있는 링크는 target 값 유지(skipDuplicates) — 병합은 target 카드로 합치는 것이라 target 의사 우선.
    if (sourceLocations.length > 0) {
      await prisma.trackedItemLocation.createMany({
        data: sourceLocations.map(l => ({ trackedItemId: targetId, storageLocationId: l.storageLocationId, closedAt: l.closedAt ? new Date(l.closedAt) : null })),
        skipDuplicates: true,
      })
    }

    // 2.5) 단위가 다른 품목 병합이면 이전된 점검·입수값을 target 단위로 환산(L→ml 등)
    if (mergeFactor !== 1) {
      await scaleStockValues(movedCheckIds, movedAdditionIds, movedDisposalIds, mergeFactor)
    }

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

    // 3.6) 되돌리기(병합 해제) 복원 정보 기록 — source 카드 스냅샷 + 이전된 id들
    //      (테이블 미생성 등으로 실패해도 병합 자체는 진행 — SQL 미적용 환경 방어)
    try {
      await prisma.trackedItemMergeUndo.create({
        data: {
          propertyId, targetItemId: targetId,
          label: `${source.label} → ${target.label}`,
          payload: {
            kind: 'CARD',
            source: {
              label: source.label, category: source.category, specUnit: source.specUnit,
              qtyUnit: source.qtyUnit, trackUnit: source.trackUnit, hubLocationId: source.hubLocationId,
              alertThresholdDays: source.alertThresholdDays, reorderMemo: source.reorderMemo,
              purchaseUrl: source.purchaseUrl, memo: source.memo,
            },
            movedExpenseIds, movedCheckIds, movedAdditionIds, movedDisposalIds, targetQtyUnitBefore,
            sourceLocations, targetLocationIdsBefore,
            unitFactor: mergeFactor,
          },
        },
      })
    } catch { /* 복원정보 테이블 미적용 — 병합은 계속 */ }

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

// 허브 부족 감지 응답 — 보충량이 허브(창고) 잔량을 넘으면 저장하지 않고 이 값을 돌려준다.
// 클라는 code 로 분기해 이동 유도 팝업을 띄운다. error 는 팝업을 모르는 호출부용 폴백 문구.
export type HubShortResponse = {
  ok: false
  code: 'HUB_SHORT'
  trackedItemId: string
  hubLocationId: string
  hubQty: number
  shortfall: number
  others: { locationId: string; name: string; qty: number }[]
  error: string
}

// detectHubShort 의 others(id·qty)에 위치 이름을 채워 팝업 목록에 쓰게 한다.
async function withOtherNames(propertyId: string, others: { locationId: string; qty: number }[]): Promise<{ locationId: string; name: string; qty: number }[]> {
  if (others.length === 0) return []
  const locs = await prisma.storageLocation.findMany({
    where: { propertyId, id: { in: others.map(o => o.locationId) } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(locs.map(l => [l.id, l.name]))
  return others.map(o => ({ locationId: o.locationId, name: nameOf.get(o.locationId) ?? '알 수 없는 위치', qty: o.qty }))
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

// 직전 점검 이후 들어온 입수(StockAddition, 무상 입수 등)를 위치별로 합산.
// 위치별/부분 점검의 carry-over 가 직전 점검 값을 그대로 복사하면 그 사이 입수분이
// 새 기준선에서 증발하고 사용량 계산에선 가짜 소모로 둔갑한다(2026-06-11 쌀 +30kg 사례).
// 품목 허브 해석 정본은 ledgerShift.resolveItemHubLocationId — 여기서는 import 로 쓴다.

// 경계는 overview 현재고 계산(sumAdditions(last.date,…,last.createdAt))과 동일 —
// 화면 잔량과 점검 base 가 같은 입수를 본다. 위치 미지정 입수는 품목 허브(반드시 링크된 위치)로.
async function additionsSinceCheckByLocation(
  trackedItemId: string,
  last: { date: Date; createdAt: Date } | null,
  hubLocationId: string | null,
  propertyId: string,
): Promise<Map<string, number>> {
  if (!last) return new Map()
  const boundary = {
    OR: [
      { date: { gt: last.date } },
      { AND: [{ date: { equals: last.date } }, { createdAt: { gt: last.createdAt } }] },
    ],
  }
  // 폐기(StockDisposal)는 음수 순유입 — 입수와 동일 경계·허브 폴백(오류신고 a1e048e8).
  const [adds, disposals] = await Promise.all([
    prisma.stockAddition.findMany({
      where: { trackedItemId, ...boundary },
      select: { addedQty: true, storageLocationId: true },
    }),
    prisma.stockDisposal.findMany({
      where: { trackedItemId, ...boundary },
      select: { disposedQty: true, storageLocationId: true },
    }),
  ])
  if (adds.length === 0 && disposals.length === 0) return new Map()
  // 위치 미지정 입수·폐기가 하나도 없으면 허브 해석 자체가 불필요 — 쿼리 0 유지
  const needsHub = adds.some(a => !a.storageLocationId) || disposals.some(d => !d.storageLocationId)
  const hub = needsHub ? await resolveItemHubLocationId(trackedItemId, hubLocationId, propertyId) : null
  const map = new Map<string, number>()
  for (const a of adds) {
    const loc = a.storageLocationId ?? hub
    if (!loc) continue
    map.set(loc, (map.get(loc) ?? 0) + a.addedQty)
  }
  for (const d of disposals) {
    const loc = d.storageLocationId ?? hub
    if (!loc) continue
    map.set(loc, (map.get(loc) ?? 0) - d.disposedQty)
  }
  return map
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
  // 보충량이 허브 잔량을 넘을 때: 기본(false)은 HUB_SHORT 로 막아 팝업 유도, true 는 기존 0 클램프 허용('그냥 진행').
  allowHubClamp?: boolean
  // 경로 B — 클라(CheckForm)가 실제로 차감한 허브 위치 id. 검출 허브와 차감 허브를 일치시켜 오탐/미탐 방지.
  restockHubLocationId?: string
  // sameDayNotice — 같은 날 맨 절대값 점검이 이미 있음(안내 전용, 저장은 정상 진행. 백로그 3번).
}): Promise<{ ok: true; id: string; sameDayNotice?: boolean } | { ok: false; error: string } | HubShortResponse> {
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
      // 멱등 — 직전 점검이 '같은 patch'(같은 위치=보충후·같은 보충량)를 방금(20초 내) 반영했다면
      // 중복 제출(더블클릭·다중 탭·재시도)로 보고 새 점검을 만들지 않는다. 안 그러면 그 점검을 base로
      // 보충이 또 적용돼 허브가 2배 차감됨.
      if (lastCheck && (Date.now() - lastCheck.createdAt.getTime()) < 20_000) {
        const lb = lastCheck.locationBreakdown.find(b => b.storageLocationId === data.locationPatch!.checkedLocationId)
        if (lb && lb.remainingQty === data.locationPatch.afterQty && (lb.restockedQty ?? 0) === data.locationPatch.restockedQty) {
          return { ok: true, id: lastCheck.id }
        }
      }
      const base = (lastCheck?.locationBreakdown ?? []).map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty }))
      // 직전 점검 이후 입수분을 base 에 반영 — 실측한 위치(checkedLocationId)는
      // applyLocationCheck 가 실측값으로 덮어쓰므로 영향 없음(실측 우선)
      const addMap = await additionsSinceCheckByLocation(data.trackedItemId, lastCheck, it.hubLocationId, propertyId)
      for (const [loc, q] of addMap) {
        const row = base.find(b => b.locationId === loc)
        // 폐기 반영으로 순변동이 음수일 수 있음 — 0 클램프(생성 시 잔량 초과 폐기는 이미 거부됨)
        if (row) row.qty = Math.max(0, row.qty + q)
        else if (q > 0) base.push({ locationId: loc, qty: q })
      }
      // 허브 부족 게이트 — 조용한 0 클램프 대신 팝업 유도(allowHubClamp 면 통과).
      const short = detectHubShort(base, data.locationPatch, data.allowHubClamp)
      if (short) {
        return {
          ok: false, code: 'HUB_SHORT', trackedItemId: data.trackedItemId,
          hubLocationId: short.hubLocationId, hubQty: short.hubQty, shortfall: short.shortfall,
          others: await withOtherNames(propertyId, short.others),
          error: '창고(허브) 재고가 보충량보다 부족합니다.',
        }
      }
      patchedQtys = applyLocationCheck(base, data.locationPatch)
    }
    // 경로 B — 품목 점검 폼(CheckForm)이 보낸 절대 위치수량. restockedQty 마커 합을 서버가 구한 허브 잔량과 대조.
    // (클라가 이미 허브를 차감해 보냈으므로 그 값을 믿지 않고, 경로 A 와 같은 base 규칙으로 서버가 다시 판정.)
    if (!data.locationPatch && !data.allowHubClamp && data.locationQtys && data.locationQtys.length > 0) {
      // 보충 마커가 하나라도 있을 때만 허브 해석(비보충 점검은 추가 쿼리 0)
      const markerSum = data.locationQtys.reduce((s, lq) => s + (lq.restockedQty ?? 0), 0)
      // 클라가 실제 차감한 허브를 우선 사용(검출·차감 일치). 없으면 품목 허브로 폴백.
      const hubLocationId = markerSum > 0 ? (data.restockHubLocationId ?? await resolveItemHubLocationId(data.trackedItemId, it.hubLocationId, propertyId)) : null
      if (hubLocationId) {
        const restockSum = data.locationQtys
          .filter(lq => lq.storageLocationId !== hubLocationId)
          .reduce((s, lq) => s + (lq.restockedQty ?? 0), 0)
        if (restockSum > 0) {
          const lastCheck = await prisma.stockCheck.findFirst({
            where: { trackedItemId: data.trackedItemId },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            include: { locationBreakdown: true },
          })
          const addMap = await additionsSinceCheckByLocation(data.trackedItemId, lastCheck, it.hubLocationId, propertyId)
          const hubQty = Math.max(0, (lastCheck?.locationBreakdown.find(b => b.storageLocationId === hubLocationId)?.remainingQty ?? 0) + (addMap.get(hubLocationId) ?? 0))
          if (restockSum > hubQty + 1e-6) {
            // 이동 출처 후보 — 현재 위치별 잔량에서 허브·보충 대상 위치 제외.
            const restockedIds = new Set(data.locationQtys.filter(lq => (lq.restockedQty ?? 0) > 0).map(lq => lq.storageLocationId))
            const cur = await currentLocationBreakdown(data.trackedItemId, propertyId, it.hubLocationId)
            const others = [...cur.entries()]
              .filter(([id, q]) => id !== hubLocationId && !restockedIds.has(id) && q > 0)
              .map(([id, q]) => ({ locationId: id, qty: q }))
            return {
              ok: false, code: 'HUB_SHORT', trackedItemId: data.trackedItemId,
              hubLocationId, hubQty, shortfall: restockSum - hubQty,
              others: await withOtherNames(propertyId, others),
              error: '창고(허브) 재고가 보충량보다 부족합니다.',
            }
          }
        }
      }
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
        // 직전 점검 이후 입수분을 이월값에 반영 — 사용자가 실측한 위치는 제외(실측 우선)
        const addMap = await additionsSinceCheckByLocation(data.trackedItemId, lastCheck, it.hubLocationId, propertyId)
        const carryOver = lastCheck.locationBreakdown
          .filter(lb => !inputLocIds.has(lb.storageLocationId))
          .map(lb => ({ storageLocationId: lb.storageLocationId, qty: Math.max(0, lb.remainingQty + (addMap.get(lb.storageLocationId) ?? 0)) }))
        // 직전 점검에 없던 위치로 입수가 들어온 경우 — 실측에도 없으면 이월 항목으로 추가
        for (const [loc, q] of addMap) {
          if (q > 0 && !inputLocIds.has(loc) && !carryOver.some(co => co.storageLocationId === loc)) {
            carryOver.push({ storageLocationId: loc, qty: q })
          }
        }
        effectiveLocationQtys = [...effectiveLocationQtys, ...carryOver]
      }
    }
    const adjusted = effectiveLocationQtys && effectiveLocationQtys.length > 0 ? applyTransfers(effectiveLocationQtys) : null
    const total = adjusted ? adjusted.reduce((s, l) => s + l.qty, 0) : data.remainingQty
    if (total < 0) return { ok: false, error: '잔량은 0 이상이어야 합니다.' }
    // 같은 날 중복 앵커 안내(백로그 3번) — 감지·안내만 하고 저장은 그대로 진행한다.
    // 자동 삭제는 절대 하지 않는다(2026-08-19 점보롤 앵커 오판 삭제 교훈 — 값이 같아도
    // 보충 마커 등 사건 기록이 실린 앵커는 중복이 아니다). 그래서 수령 자동 점검(sourceExpenseId)·
    // 보정(isReconcile)·보충 마커가 실린 같은 날 점검은 세지 않고, 맨 절대값 점검만 안내 대상.
    // 위치 병합 저장(locationPatch)은 같은 날 연속 점검이 설계된 흐름이라 제외.
    let sameDayNotice = false
    if (!data.locationPatch) {
      const sameDay = await prisma.stockCheck.findMany({
        where: { trackedItemId: data.trackedItemId, date: ymdToDbDate(data.date), sourceExpenseId: null, isReconcile: false },
        select: { locationBreakdown: { select: { restockedQty: true } } },
      })
      sameDayNotice = sameDay.some(c => !c.locationBreakdown.some(lb => (lb.restockedQty ?? 0) > 0))
    }
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
    return { ok: true, id: r.id, ...(sameDayNotice ? { sameDayNotice: true } : {}) }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 전체 재고 보정(총점검) — 여러 품목의 실측을 한 번에 기준선으로 박는다.
// 보충(창고→방 이동)이 끝난 상태에서 실제 남은 수량을 세어 입력 → 점검 생성.
// 기본은 isReconcile 점검이라 직전 구간의 차이(분실·오차)를 소모로 잡지 않는다(overview.ts).
// 차이가 0 인(실측=예상) 품목은 건너뛴다 — 불필요한 점검 레코드 방지.
export async function saveFullReconcile(data: {
  date: string
  // 줄어든 차이의 귀속 — 화면 단위 선택 1개(행별 아님). 없으면 'exclude'(현행 보정).
  // 늘어난 품목은 선택과 무관하게 항상 보정 — 판정 정본은 constants.resolveDiffAttribution.
  attribution?: DiffAttribution
  items: {
    trackedItemId: string
    // 위치 있는 품목: 위치별 실측. 위치 없는 품목: remainingQty.
    locationQtys?: { storageLocationId: string; qty: number }[]
    remainingQty?: number
    memo?: string | null
    // 그 화면이 보여준 '이 시점 예상 재고' — 차이의 부호 판정에만 쓴다(저장값에는 안 들어간다).
    // 없으면 부호를 알 수 없으므로 현행(보정)으로 저장된다.
    expectedQty?: number
  }[]
  // createdIds — 적용취소용. 전체 보정은 여러 품목의 기준선을 한 번에 박는 가장 위험한 액션인데
  // 되돌릴 방법이 없었다(C페이즈 조사 2026-08-03). 만든 점검 id 를 돌려주면 토스트에서 지울 수 있다.
}): Promise<{ ok: true; count: number; createdIds: string[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!data.items.length) return { ok: true, count: 0, createdIds: [] }
    const ids = data.items.map(i => i.trackedItemId)
    const owned = await prisma.trackedItem.findMany({ where: { id: { in: ids }, propertyId }, select: { id: true } })
    const ownedSet = new Set(owned.map(o => o.id))
    const date = new Date(data.date)
    let count = 0
    const createdIds: string[] = []
    await prisma.$transaction(async tx => {
      for (const item of data.items) {
        if (!ownedSet.has(item.trackedItemId)) continue
        const hasLoc = item.locationQtys && item.locationQtys.length > 0
        const total = hasLoc
          ? item.locationQtys!.reduce((s, l) => s + l.qty, 0)
          : (item.remainingQty ?? 0)
        if (total < 0) continue
        const { isReconcile, defaultMemo } = resolveDiffAttribution(
          data.attribution,
          item.expectedQty == null ? null : total - item.expectedQty,
        )
        const made = await tx.stockCheck.create({
          select: { id: true },
          data: {
            trackedItemId: item.trackedItemId,
            date,
            remainingQty: total,
            isReconcile,
            memo: item.memo ?? defaultMemo,
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
        createdIds.push(made.id)
        count++
      }
    })
    revalidatePath('/inventory')
    return { ok: true, count, createdIds }
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
  // 보충량이 허브 잔량을 넘을 때: 기본(false)은 HUB_SHORT 로 막고, true 는 기존 0 클램프 허용('그냥 진행').
  allowHubClamp?: boolean
  // 경로 B — 클라(CheckEditForm)가 실제로 차감한 허브 위치 id. 검출·차감 허브 일치용.
  restockHubLocationId?: string
}): Promise<{ ok: true } | { ok: false; error: string } | HubShortResponse> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const c = await prisma.stockCheck.findUnique({ where: { id }, include: { trackedItem: true, locationBreakdown: true } })
    if (!c || c.trackedItem.propertyId !== propertyId) return { ok: false, error: '점검 기록을 찾을 수 없습니다.' }

    // #3: locationPatch가 오면 이 점검의 현재 위치별 잔량을 base로 서버에서 적용(연속 위치점검 머지 정확)
    let patchedQtys: LocQty[] | null = null
    if (data.locationPatch) {
      // 멱등 — 이 점검이 '같은 patch'(점검위치=보충후·같은 보충량)를 이미 반영 중이면 재적용하지 않는다.
      // 더블클릭/재시도로 같은 머지가 두 번 오면 허브가 보충량만큼 또 차감되던(2배) 버그 방지.
      const cur = c.locationBreakdown.find(b => b.storageLocationId === data.locationPatch!.checkedLocationId)
      if (cur && cur.remainingQty === data.locationPatch.afterQty && (cur.restockedQty ?? 0) === data.locationPatch.restockedQty) {
        return { ok: true }
      }
      // restockedQty 포함 — 같은 날 연속 위치 점검 머지가 앞 위치의 보충 +N 마커를 지우던 버그(신고 8319ba10)
      const base = c.locationBreakdown.map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty, restockedQty: lb.restockedQty }))
      // 이 점검 생성 이후 들어온 입수분을 base 에 반영 (createStockCheck 와 동일 규칙)
      const addMap = await additionsSinceCheckByLocation(c.trackedItemId, c, c.trackedItem.hubLocationId, propertyId)
      for (const [loc, q] of addMap) {
        const row = base.find(b => b.locationId === loc)
        if (row) row.qty += q
        else base.push({ locationId: loc, qty: q, restockedQty: null })
      }
      // 허브 부족 게이트 — createStockCheck 와 동일(allowHubClamp 면 통과).
      const short = detectHubShort(base, data.locationPatch, data.allowHubClamp)
      if (short) {
        return {
          ok: false, code: 'HUB_SHORT', trackedItemId: c.trackedItemId,
          hubLocationId: short.hubLocationId, hubQty: short.hubQty, shortfall: short.shortfall,
          others: await withOtherNames(propertyId, short.others),
          error: '창고(허브) 재고가 보충량보다 부족합니다.',
        }
      }
      patchedQtys = applyLocationCheck(base, data.locationPatch)
    }
    // 경로 B — 기존 점검 수정(CheckEditForm)이 보낸 절대 위치수량. 조용한 0 클램프만 명확한 에러로 차단.
    // 이 흐름엔 이동 유도 팝업을 붙이지 않는다(과거 점검 수정에 부자연).
    if (!data.locationPatch && !data.allowHubClamp && data.locationQtys && data.locationQtys.length > 0) {
      const markerSum = data.locationQtys.reduce((s, lq) => s + (lq.restockedQty ?? 0), 0)
      const hubLocationId = markerSum > 0 ? (data.restockHubLocationId ?? await resolveItemHubLocationId(c.trackedItemId, c.trackedItem.hubLocationId, propertyId)) : null
      if (hubLocationId) {
        const restockSum = data.locationQtys
          .filter(lq => lq.storageLocationId !== hubLocationId)
          .reduce((s, lq) => s + (lq.restockedQty ?? 0), 0)
        if (restockSum > 0) {
          // 판정 base = 보충 전 허브 = 저장 허브 잔량 + 이 점검의 원래 보충합(클라 CheckEditForm 의 hubBefore 와 동일).
          // 저장값(보충 후)만 쓰면 정상 보충을 다시 저장할 때 거짓 부족이 난다(원래 보충분 이중 차감).
          const originalRestockSum = c.locationBreakdown.reduce((s, lb) => s + (lb.restockedQty ?? 0), 0)
          const hubStored = c.locationBreakdown.find(b => b.storageLocationId === hubLocationId)?.remainingQty ?? 0
          const hubQty = hubStored + originalRestockSum
          if (restockSum > hubQty + 1e-6) {
            const restockedIds = new Set(data.locationQtys.filter(lq => (lq.restockedQty ?? 0) > 0).map(lq => lq.storageLocationId))
            const others = c.locationBreakdown
              .filter(lb => lb.storageLocationId !== hubLocationId && !restockedIds.has(lb.storageLocationId) && lb.remainingQty > 0)
              .map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty }))
            return {
              ok: false, code: 'HUB_SHORT', trackedItemId: c.trackedItemId,
              hubLocationId, hubQty, shortfall: restockSum - hubQty,
              others: await withOtherNames(propertyId, others),
              error: '보충량이 창고(허브) 재고를 초과합니다. 창고를 먼저 채우거나 실측해 주세요.',
            }
          }
        }
      }
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

// v2.0 §27 — 삭제 스냅샷(적용취소용). 같은 id로 복원해 타 참조가 살아난다.
export type StockCheckUndo = {
  id: string; trackedItemId: string; date: string; remainingQty: number
  memo: string | null; isReconcile: boolean; sourceExpenseId: string | null
  locations: { storageLocationId: string; remainingQty: number; restockedQty: number | null; fromHubQty: number | null; fromLocationId: string | null }[]
}

export async function deleteStockCheck(id: string): Promise<{ ok: true; undo: StockCheckUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const c = await prisma.stockCheck.findUnique({ where: { id }, include: { trackedItem: true, locationBreakdown: true } })
    if (!c || c.trackedItem.propertyId !== propertyId) return { ok: false, error: '점검 기록을 찾을 수 없습니다.' }
    const undo: StockCheckUndo = {
      id: c.id, trackedItemId: c.trackedItemId, date: c.date.toISOString(), remainingQty: c.remainingQty,
      memo: c.memo, isReconcile: c.isReconcile, sourceExpenseId: c.sourceExpenseId,
      locations: c.locationBreakdown.map(lb => ({
        storageLocationId: lb.storageLocationId, remainingQty: lb.remainingQty,
        restockedQty: lb.restockedQty, fromHubQty: lb.fromHubQty, fromLocationId: lb.fromLocationId,
      })),
    }
    await prisma.stockCheck.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 점검 삭제 적용취소 — 스냅샷 그대로 재생성
export async function undoDeleteStockCheck(undo: StockCheckUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: undo.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const exists = await prisma.stockCheck.findUnique({ where: { id: undo.id }, select: { id: true } })
    if (exists) return { ok: true }   // 중복 클릭 멱등
    await prisma.stockCheck.create({
      data: {
        id: undo.id, trackedItemId: undo.trackedItemId, date: new Date(undo.date),
        remainingQty: undo.remainingQty, memo: undo.memo, isReconcile: undo.isReconcile,
        sourceExpenseId: undo.sourceExpenseId,
        locationBreakdown: { create: undo.locations },
      },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
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

// 임시저장이 있는 위치 요약 — 위치 선택 전에 어느 위치에 임시저장이 있는지 안내(오류신고 93f5d103).
// 위치별 드래프트 + 아이템별 드래프트(locationId null)의 위치별 값을 함께 센다(getLocationDrafts와 동일 기준).
export async function getDraftLocationSummary(): Promise<{ locationId: string; itemCount: number; latestSavedAt: number | null }[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.stockCheckDraft.findMany({
    where: { trackedItem: { propertyId } },
    select: { trackedItemId: true, locationId: true, data: true },
  })
  const byLoc = new Map<string, { items: Set<string>; latest: number }>()
  const add = (locId: string, itemId: string, savedAt: number) => {
    const cur = byLoc.get(locId) ?? { items: new Set<string>(), latest: 0 }
    cur.items.add(itemId)
    if (savedAt > cur.latest) cur.latest = savedAt
    byLoc.set(locId, cur)
  }
  for (const r of rows) {
    const d = r.data as { savedAt?: number; beforeQtys?: Record<string, string>; afterQtys?: Record<string, string> } | null
    const savedAt = typeof d?.savedAt === 'number' ? d.savedAt : 0
    if (r.locationId) { add(r.locationId, r.trackedItemId, savedAt); continue }
    for (const locId of new Set([...Object.keys(d?.beforeQtys ?? {}), ...Object.keys(d?.afterQtys ?? {})])) {
      if ((d?.beforeQtys?.[locId] ?? '') === '' && (d?.afterQtys?.[locId] ?? '') === '') continue
      add(locId, r.trackedItemId, savedAt)
    }
  }
  return [...byLoc.entries()].map(([locationId, v]) => ({ locationId, itemCount: v.items.size, latestSavedAt: v.latest || null }))
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

// ── 원장 리플레이 조정 — 무상 입수의 날짜·수량·위치를 나중에 고치면 그 뒤 점검의 저장 잔량을 함께 옮긴다.
//
// 왜 필요한가(운영자 신고 2026-08-19, 쌀 40kg). StockCheck.remainingQty 는 절대값이라
// 8/18 로 잘못 넣은 입고를 8/10 으로 정정하면 그 사이 점검(8/12·8/14)의 저장값이 그대로인 채
// 입고만 그 앞으로 가버려 잔량에서 40kg 이 통째로 증발했다. 즉 **날짜를 정직하게 고치는 행위가
// 처벌받는** 구조였고, 운영자는 결국 전 기록을 지우고 다시 입력해야 했다.
//
// 조정은 자동이 아니다. 서버는 계획만 만들고(previewStockAdditionShift) 클라가 영향받는 점검을
// 숫자로 보여준 뒤 운영자가 고른 경우에만 적용한다. 적용분은 스냅샷으로 되돌린다(§16).
// 계산 규칙 정본은 lib/stockLedger, 조회·적용·되돌리기 공용층은 ./ledgerShift(무상 입수·지출 공용).

export type StockShiftPreview =
  | { ok: true; rows: { date: string; storedTotal: number; nextTotal: number }[]; hasAutoCheck?: boolean }
  | { ok: false; error: string }

// 조정 미리보기 — 클라가 확인 다이얼로그에 실제 숫자를 띄우는 데 쓴다. 쓰기 없음.
// additionId 없음 = 신규 등록, next 없음 = 삭제.
export async function previewStockAdditionShift(input: {
  trackedItemId: string
  additionId?: string | null
  next?: { date: string; addedQty: number; storageLocationId: string | null } | null
}): Promise<StockShiftPreview> {
  try {
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({
      where: { id: input.trackedItemId, propertyId }, select: { id: true, hubLocationId: true },
    })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }

    let before: Parameters<typeof buildAdditionShiftPlan>[2] = null
    if (input.additionId) {
      const a = await prisma.stockAddition.findFirst({
        where: { id: input.additionId, trackedItemId: it.id },
        select: { date: true, createdAt: true, addedQty: true, storageLocationId: true },
      })
      if (!a) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
      before = { dateMs: a.date.getTime(), createdAtMs: a.createdAt.getTime(), qty: a.addedQty, storageLocationId: a.storageLocationId }
    }
    // 새 기록의 입력 시각은 지금 — 같은 날 경계(날짜가 같으면 입력 시각으로 앞뒤를 가른다)에 쓰인다.
    const createdAtMs = before?.createdAtMs ?? Date.now()
    const after = input.next
      ? { dateMs: new Date(input.next.date).getTime(), createdAtMs, qty: input.next.addedQty, storageLocationId: input.next.storageLocationId }
      : null

    const plan = await buildAdditionShiftPlan(it, propertyId, before, after)
    if (!plan.ok) return { ok: false, error: plan.error }
    return {
      ok: true,
      rows: plan.rows.map(r => ({
        date: new Date(r.dateMs).toISOString().slice(0, 10),
        storedTotal: Math.round(r.storedTotal * 100) / 100,
        nextTotal: Math.round(r.nextTotal * 100) / 100,
      })),
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 지출(구매 수령) 델타의 조정 미리보기 — 지출 수량 정정·삭제·수령 취소·재고 제외가
// 뒤 점검의 저장 잔량을 얼마나 옮기는지 계산만 한다(쓰기 없음). 점보롤 백로그 1번.
// 반영 경계는 구매 정본(receivedAt > 점검.createdAt, lib/stockLedger purchaseAfterCheck).
// 매칭·환산 정본은 ledgerShift(matchedTrackedItemForExpense·convertedPurchaseQty).

export async function previewExpenseStockShift(input: {
  expenseId: string
  // next 미지정(null) = 델타 제거(삭제·수령 취소·재고 제외). 지정 = 수량·규격 정정.
  next?: { qtyValue: number | null; specValue: number | null; specUnit: string | null } | null
  // 수령 취소 미리보기 — 이 지출의 자동 점검은 함께 삭제되므로 계획에서 뺀다.
  forReceiptCancel?: boolean
  // 재고 다시 포함 미리보기 — 지금 제외 상태인 델타를 되살리는 방향(계획 null 에서 델타로).
  forInclude?: boolean
}): Promise<StockShiftPreview> {
  try {
    const propertyId = await getPropertyId()
    const e = await prisma.expense.findFirst({
      where: { id: input.expenseId, propertyId },
      select: {
        id: true, category: true, itemLabel: true, qtyUnit: true, qtyValue: true,
        specValue: true, specUnit: true, receivedAt: true, receivedLocationId: true,
        excludeFromInventory: true,
      },
    })
    if (!e) return { ok: false, error: '지출을 찾을 수 없습니다.' }
    if (!e.receivedAt || (e.excludeFromInventory && !input.forInclude)) return { ok: true, rows: [] }
    const it = await matchedTrackedItemForExpense(propertyId, e)
    if (!it) return { ok: true, rows: [] }

    const qty = convertedPurchaseQty(it, e)
    const receivedAtMs = e.receivedAt.getTime()
    const delta = qty > 0
      ? { receivedAtMs, qty, storageLocationId: e.receivedLocationId }
      : null
    // 방향 결정 — 포함은 (null, 델타), 정정은 (델타, 새 델타), 제거는 (델타, null).
    const before = input.forInclude ? null : delta
    let after: typeof delta = null
    if (input.forInclude) {
      after = delta
    } else if (input.next) {
      const qtyAfter = convertedPurchaseQty(it, input.next)
      after = qtyAfter > 0 ? { receivedAtMs, qty: qtyAfter, storageLocationId: e.receivedLocationId } : null
    }
    // 자동 점검 존재 여부 — 삭제 물음의 사전 분기용(자동 점검 있는 구매의 삭제는 서버가
    // 수령 취소 경로로 안내하므로, 클라가 조정 물음을 띄우지 않게 한다).
    const own = await prisma.stockCheck.findMany({ where: { sourceExpenseId: e.id }, select: { id: true } })
    const excludeCheckIds = input.forReceiptCancel ? own.map(c => c.id) : undefined
    const plan = await buildPurchaseShiftPlan(it, propertyId, before, after, excludeCheckIds)
    if (!plan.ok) return { ok: false, error: plan.error }
    return {
      ok: true,
      rows: plan.rows.map(r => ({
        date: new Date(r.dateMs).toISOString().slice(0, 10),
        storedTotal: Math.round(r.storedTotal * 100) / 100,
        nextTotal: Math.round(r.nextTotal * 100) / 100,
      })),
      ...(own.length > 0 ? { hasAutoCheck: true } : {}),
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── StockAddition CRUD
export async function createStockAddition(data: {
  trackedItemId: string; date: string; addedQty: number; source?: string; memo?: string
  storageLocationId?: string | null
  // 소급 등록(이미 점검이 지나간 날짜)일 때 그 뒤 점검의 저장 잔량도 함께 옮길지.
  // 미지정 = 기존 동작(기록만 남김). 클라가 previewStockAdditionShift 로 물어본 뒤에만 켠다.
  adjustFollowing?: boolean
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
    const createdAt = new Date()
    let rows: ShiftRow[] = []
    if (data.adjustFollowing) {
      const plan = await buildAdditionShiftPlan(it, propertyId, null, {
        dateMs: new Date(data.date).getTime(), createdAtMs: createdAt.getTime(),
        qty: data.addedQty, storageLocationId: data.storageLocationId || null,
      })
      if (!plan.ok) return { ok: false, error: plan.error }
      rows = plan.rows
    }
    const r = await prisma.$transaction(async tx => {
      const created = await tx.stockAddition.create({
        data: {
          trackedItemId: data.trackedItemId,
          date: new Date(data.date),
          addedQty: data.addedQty,
          source: data.source || null,
          memo: data.memo || null,
          storageLocationId: data.storageLocationId || null,
          createdAt,
        },
      })
      if (rows.length > 0) await applyShiftRows(tx, it.id, rows)
      return created
    })
    revalidatePath('/inventory')
    return { ok: true, id: r.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export type StockAdditionUndo = {
  id: string; trackedItemId: string; date: string; addedQty: number
  source: string | null; memo: string | null; storageLocationId: string | null
  // 삭제와 함께 되돌린 점검 조정(적용했을 때만). 없으면 종전과 동일하게 기록만 복원한다.
  shift?: LedgerShiftUndo | null
}

export async function deleteStockAddition(id: string, opts?: { adjustFollowing?: boolean }): Promise<{ ok: true; undo: StockAdditionUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const a = await prisma.stockAddition.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!a || a.trackedItem.propertyId !== propertyId) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
    let rows: ShiftRow[] = []
    if (opts?.adjustFollowing) {
      const plan = await buildAdditionShiftPlan(a.trackedItem, propertyId, {
        dateMs: a.date.getTime(), createdAtMs: a.createdAt.getTime(), qty: a.addedQty, storageLocationId: a.storageLocationId,
      }, null)
      if (!plan.ok) return { ok: false, error: plan.error }
      rows = plan.rows
    }
    const undo: StockAdditionUndo = {
      id: a.id, trackedItemId: a.trackedItemId, date: a.date.toISOString(),
      addedQty: a.addedQty, source: a.source, memo: a.memo, storageLocationId: a.storageLocationId,
      shift: null,
    }
    await prisma.$transaction(async tx => {
      if (rows.length > 0) undo.shift = await applyShiftRows(tx, a.trackedItemId, rows)
      await tx.stockAddition.delete({ where: { id } })
    })
    revalidatePath('/inventory')
    return { ok: true, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입수 삭제 적용취소 — 스냅샷 재생성
export async function undoDeleteStockAddition(undo: StockAdditionUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: undo.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const exists = await prisma.stockAddition.findUnique({ where: { id: undo.id }, select: { id: true } })
    if (exists) return { ok: true }
    await prisma.$transaction(async tx => {
      await tx.stockAddition.create({
        data: {
          id: undo.id, trackedItemId: undo.trackedItemId, date: new Date(undo.date),
          addedQty: undo.addedQty, source: undo.source, memo: undo.memo, storageLocationId: undo.storageLocationId,
        },
      })
      if (undo.shift) await revertShiftRows(tx, { ...undo.shift, trackedItemId: undo.trackedItemId })
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}

// 수정 적용취소 스냅샷 — 날짜 수정은 종전에 되돌릴 수 없었다(§16 미충족).
export type StockAdditionEditUndo = {
  id: string; trackedItemId: string
  before: { date: string; addedQty: number; source: string | null; memo: string | null; storageLocationId: string | null }
  shift: LedgerShiftUndo | null
}

export async function updateStockAddition(id: string, data: {
  date?: string; addedQty?: number; source?: string | null; memo?: string | null
  storageLocationId?: string | null
  // 그 뒤 점검의 저장 잔량도 함께 옮길지. 미지정 = 기존 동작(기록만 수정).
  adjustFollowing?: boolean
}): Promise<{ ok: true; undo: StockAdditionEditUndo } | { ok: false; error: string }> {
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
    const nextDateMs = data.date ? new Date(data.date).getTime() : a.date.getTime()
    const nextQty = data.addedQty !== undefined ? data.addedQty : a.addedQty
    const nextLoc = data.storageLocationId !== undefined ? (data.storageLocationId || null) : a.storageLocationId
    let rows: ShiftRow[] = []
    if (data.adjustFollowing) {
      const plan = await buildAdditionShiftPlan(a.trackedItem, propertyId,
        { dateMs: a.date.getTime(), createdAtMs: a.createdAt.getTime(), qty: a.addedQty, storageLocationId: a.storageLocationId },
        { dateMs: nextDateMs, createdAtMs: a.createdAt.getTime(), qty: nextQty, storageLocationId: nextLoc },
      )
      if (!plan.ok) return { ok: false, error: plan.error }
      rows = plan.rows
    }
    const undo: StockAdditionEditUndo = {
      id: a.id, trackedItemId: a.trackedItemId,
      before: {
        date: a.date.toISOString(), addedQty: a.addedQty,
        source: a.source, memo: a.memo, storageLocationId: a.storageLocationId,
      },
      shift: null,
    }
    await prisma.$transaction(async tx => {
      await tx.stockAddition.update({
        where: { id },
        data: {
          ...(data.date ? { date: new Date(data.date) } : {}),
          ...(data.addedQty !== undefined ? { addedQty: data.addedQty } : {}),
          ...(data.source !== undefined ? { source: data.source || null } : {}),
          ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
          ...(data.storageLocationId !== undefined ? { storageLocationId: data.storageLocationId || null } : {}),
        },
      })
      if (rows.length > 0) undo.shift = await applyShiftRows(tx, a.trackedItemId, rows)
    })
    revalidatePath('/inventory')
    return { ok: true, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입수 수정 적용취소 — 기록을 이전 값으로 되돌리고, 함께 옮겼던 점검 잔량도 스냅샷으로 복원한다.
export async function undoUpdateStockAddition(undo: StockAdditionEditUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const a = await prisma.stockAddition.findUnique({ where: { id: undo.id }, include: { trackedItem: true } })
    if (!a || a.trackedItem.propertyId !== propertyId) return { ok: false, error: '입수 기록을 찾을 수 없습니다.' }
    await prisma.$transaction(async tx => {
      await tx.stockAddition.update({
        where: { id: undo.id },
        data: {
          date: new Date(undo.before.date), addedQty: undo.before.addedQty,
          source: undo.before.source, memo: undo.before.memo, storageLocationId: undo.before.storageLocationId,
        },
      })
      if (undo.shift) await revertShiftRows(tx, { ...undo.shift, trackedItemId: a.trackedItemId })
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// ── StockDisposal CRUD — 폐기 이벤트(유출), StockAddition 미러 (오류신고 a1e048e8)
export async function createStockDisposal(data: {
  trackedItemId: string; date: string; disposedQty: number; reason?: string; memo?: string
  storageLocationId?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (data.disposedQty <= 0) return { ok: false, error: '폐기 수량은 0보다 커야 합니다.' }
    if (data.storageLocationId) {
      const loc = await prisma.storageLocation.findFirst({ where: { id: data.storageLocationId, propertyId } })
      if (!loc) return { ok: false, error: '보관 위치를 찾을 수 없습니다.' }
    }
    // 이중 차감 방어 — 폐기 후 잔량을 이미 반영한 점검이 있으면 별도 기록 시 두 번 빠진다.
    //
    // 종전 조건은 '폐기일 당일 포함 이후 점검이 하나라도 있으면 거부' 였다. 점검이 사실상 매일 있는
    // 운영에서는 **오늘 폐기가 거의 항상 막힌다.** 실측 점검 533건 대비 폐기 기록 0건 — 기능이
    // 사용 불능이었다(C페이즈 조사 2026-08-03). 게다가 화면 안내가 '폐기일을 점검 이후로 입력하세요'
    // 라고 해서 미래 날짜 폐기를 권했는데 그건 회계적으로 틀린 안내다.
    //
    // 완화 — **폐기일 다음 날 이후**에 점검이 있을 때만 막는다. 그 점검은 폐기를 이미 반영했다고
    // 봐야 한다. 같은 날 점검은 폐기 전에 셌을 수도 있어 운영자 판단에 맡긴다(순서 강제 대신).
    const [y, m, d] = data.date.split('-').map(Number)
    const dayAfter = new Date(Date.UTC(y, m - 1, d + 1))
    const laterCheck = await prisma.stockCheck.findFirst({
      where: { trackedItemId: data.trackedItemId, date: { gte: dayAfter } },
      orderBy: { date: 'asc' },
      select: { date: true },
    })
    if (laterCheck) {
      return { ok: false, error: `폐기일 다음 날 이후(${laterCheck.date.toISOString().slice(0, 10)})에 점검이 있습니다. 그 점검이 폐기 후 잔량을 이미 반영했다면 두 번 빠지므로, 그 점검을 수정하거나 폐기일을 다시 확인해 주세요.` }
    }
    // 잔량 초과 거부(영향검증 필수3 — 음수 클램프 도달 자체를 차단)
    const asOf = await getStockAsOf(data.trackedItemId, data.date)
    if (asOf) {
      if (data.disposedQty > asOf.total + 0.001) {
        return { ok: false, error: `폐기 수량이 현재 잔량(${Math.round(asOf.total * 100) / 100})을 초과합니다.` }
      }
      if (data.storageLocationId) {
        const locQty = asOf.byLoc.find(l => l.locationId === data.storageLocationId)?.qty ?? 0
        if (data.disposedQty > locQty + 0.001) {
          return { ok: false, error: `폐기 수량이 해당 위치 잔량(${Math.round(locQty * 100) / 100})을 초과합니다. 위치를 확인하거나 위치 없이 기록하세요.` }
        }
      }
    }
    const r = await prisma.stockDisposal.create({
      data: {
        trackedItemId: data.trackedItemId,
        date: new Date(data.date),
        disposedQty: data.disposedQty,
        reason: data.reason || null,
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

export type StockDisposalUndo = {
  id: string; trackedItemId: string; date: string; disposedQty: number
  reason: string | null; memo: string | null; storageLocationId: string | null
}

export async function deleteStockDisposal(id: string): Promise<{ ok: true; undo: StockDisposalUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const d = await prisma.stockDisposal.findUnique({ where: { id }, include: { trackedItem: true } })
    if (!d || d.trackedItem.propertyId !== propertyId) return { ok: false, error: '폐기 기록을 찾을 수 없습니다.' }
    const undo: StockDisposalUndo = {
      id: d.id, trackedItemId: d.trackedItemId, date: d.date.toISOString(),
      disposedQty: d.disposedQty, reason: d.reason, memo: d.memo, storageLocationId: d.storageLocationId,
    }
    await prisma.stockDisposal.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 폐기 삭제 적용취소 — 스냅샷 재생성 (입수 undo 패턴 미러)
export async function undoDeleteStockDisposal(undo: StockDisposalUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: undo.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const exists = await prisma.stockDisposal.findUnique({ where: { id: undo.id }, select: { id: true } })
    if (exists) return { ok: true }
    await prisma.stockDisposal.create({
      data: {
        id: undo.id, trackedItemId: undo.trackedItemId, date: new Date(undo.date),
        disposedQty: undo.disposedQty, reason: undo.reason, memo: undo.memo, storageLocationId: undo.storageLocationId,
      },
    })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}

export async function updateExpenseFromInventory(id: string, data: {
  date?: string; amount?: number; vendor?: string | null; memo?: string | null
  receivedAt?: string | null  // ISO 문자열 or null(수령 대기로 되돌리기)
  // 수령 대기로 되돌릴 때, 이 수령분을 삼킨 뒤 점검이 있으면 함께 조정할지(cancelReceiptCore 게이트).
  adjustFollowing?: boolean
}): Promise<{ ok: true; cancelUndo?: ReceiptCancelUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const e = await prisma.expense.findUnique({ where: { id } })
    if (!e || e.propertyId !== propertyId) return { ok: false, error: '구매 기록을 찾을 수 없습니다.' }
    const newReceivedAt = data.receivedAt !== undefined
      ? (data.receivedAt ? new Date(data.receivedAt) : null)
      : undefined
    // 수령 대기(null)였던 행에 수령일을 다시 넣는 경우 — 자동 점검이 없으므로 단순 날짜 저장이 아니라
    // 정본 수령 경로(confirmReceipt)로 재생성해야 잔량·위치 배치에 반영된다(감사 잔여: 미재생성 → 재고 과소, 2026-07-22)
    const resurrect = e.receivedAt === null && newReceivedAt != null
    // 수령 대기로 되돌리기(null) — 수령 취소와 같은 사건이므로 같은 정본(cancelReceiptCore)을 탄다.
    // 종전에는 여기서 receivedAt 만 지우고 자동 점검을 무가드로 삭제해, 실측 머지·이후 점검 반영
    // 가드가 통째로 우회되는 뒷문이었다(수령 취소 클래스의 반쪽).
    const cancel = e.receivedAt !== null && newReceivedAt === null
    let cancelUndo: ReceiptCancelUndo | undefined
    if (cancel) {
      const r = await cancelReceiptCore(id, propertyId, { adjustFollowing: data.adjustFollowing })
      if (!r.ok) return r
      cancelUndo = r.undo
    }
    await prisma.expense.update({
      where: { id },
      data: {
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.vendor !== undefined ? { vendor: data.vendor || null } : {}),
        ...(data.memo !== undefined ? { memo: data.memo || null } : {}),
        ...(newReceivedAt !== undefined && !resurrect && !cancel ? { receivedAt: newReceivedAt } : {}),
      },
    })

    // 수령일이 바뀌었으면 confirmReceipt가 만든 자동 점검의 date도 동기화.
    if (resurrect) {
      const rc = await confirmReceipt(id)
      if (!rc.ok) return rc
      // confirmReceipt는 수령 시각을 지금으로 찍으므로 사용자가 고른 날짜로 동기화
      await prisma.expense.update({ where: { id }, data: { receivedAt: newReceivedAt } })
      await prisma.stockCheck.updateMany({ where: { sourceExpenseId: id }, data: { date: newReceivedAt } })
    } else if (newReceivedAt != null) {
      await prisma.stockCheck.updateMany({
        where: { sourceExpenseId: id },
        data: { date: newReceivedAt },
      })
    }

    revalidatePath('/inventory')
    revalidatePath('/finance')   // 지출 페이지 경로는 /finance ('/expenses' 는 존재하지 않는 경로였음)
    return { ok: true, ...(cancelUndo ? { cancelUndo } : {}) }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function excludeExpenseFromInventory(id: string, opts?: { adjustFollowing?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  return setExpenseInventoryExclusion(id, true, opts)
}

// 재고 제외 적용취소(다시 포함) — 제외가 일방향이라 실수 시 되돌릴 수 없던 문제의 역방향 액션.
// adjustFollowing 은 제외가 조정한 점검을 대칭 계획(planStockShift 삭제 대칭)으로 되살린다.
export async function includeExpenseInInventory(id: string, opts?: { adjustFollowing?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  return setExpenseInventoryExclusion(id, false, opts)
}

async function setExpenseInventoryExclusion(id: string, exclude: boolean, opts?: { adjustFollowing?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const e = await prisma.expense.findUnique({ where: { id } })
    if (!e || e.propertyId !== propertyId) return { ok: false, error: '구매 기록을 찾을 수 없습니다.' }
    if (e.excludeFromInventory === exclude) return { ok: true }   // 멱등 — 조정 이중 적용 방지
    // 수령완료 구매의 제외는 원장에서 델타 제거와 같다(포함은 그 대칭) — 뒤 점검이 이 수령분을
    // 절대값에 삼켰다면 함께 옮길지 물어서만 조정한다(점보롤 백로그 1번과 같은 클래스).
    let rows: ShiftRow[] = []
    let itemId: string | null = null
    if (opts?.adjustFollowing && e.receivedAt) {
      const it = await matchedTrackedItemForExpense(propertyId, e)
      const qty = it ? convertedPurchaseQty(it, e) : 0
      if (it && qty > 0) {
        const delta = { receivedAtMs: e.receivedAt.getTime(), qty, storageLocationId: e.receivedLocationId }
        const plan = await buildPurchaseShiftPlan(it, propertyId,
          exclude ? delta : null, exclude ? null : delta)
        if (!plan.ok) return { ok: false, error: plan.error }
        rows = plan.rows
        itemId = it.id
      }
    }
    await prisma.$transaction(async tx => {
      await tx.expense.update({ where: { id }, data: { excludeFromInventory: exclude } })
      if (rows.length > 0 && itemId) await applyShiftRows(tx, itemId, rows)
    })
    revalidatePath('/inventory')
    revalidatePath('/finance')
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

// 이름에 박힌 크기 표시. 봉투처럼 **크기가 곧 다른 물건**인 품목에서 이것이 다르면 같은 것이 아니다.
// normalizeLabel 은 병합 후보를 넓게 찾으려고 숫자·단위를 지우는데, 그 공격성 때문에
// "종량제쓰레기봉투 (50L)" 과 "종량제쓰레기봉투 (20L)" 이 같은 키가 됐고 앱이 둘 중 어디에 넣을지
// 물었다. 물을 일이 아니다 — 이름에 50L 이라고 적혀 있다(운영자 지적 2026-08-05).
// normalizeLabel 자체는 안 건드린다. 그 값이 병합 규칙(LINK·MUTE)의 키라 바꾸면 기존 규칙이 끊긴다.
// 아래 단위 집합은 lib/units.ts 의 splitSizeLabel(표시용 크기 캡션 분리)과 동일하다 — 바꾸면 양쪽을 함께.
function sizeSignature(s: string): string {
  const m = s.toLowerCase().match(/\d+(\.\d+)?\s*(l|ml|g|kg|cm|mm|m|인치)\b/g)
  return m ? m.map(x => x.replace(/\s+/g, '')).sort().join(',') : ''
}

/** 크기가 둘 다 적혀 있고 서로 다르면 병합 후보가 아니다. 한쪽만 적혀 있으면 판단하지 않는다. */
function sizeConflicts(a: string, b: string): boolean {
  const sa = sizeSignature(a), sb = sizeSignature(b)
  return !!sa && !!sb && sa !== sb
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

// onlyLabels: 지출 저장 직후 그 품목들만 증분 시드(자동 카드 생성, 신고 269baf9f).
// 미지정 = 전체 스캔(재고 화면의 '과거 지출 일괄 불러오기' 버튼). 병합 규칙(LINK/MUTE)·중복 판정은 동일 경로.
// opts.dryRun 이면 아무것도 쓰지 않고 **결정 대기 목록만** 돌려준다. 판정 규칙을 복제하지 않으려고
// 같은 함수를 읽기 전용으로 돌린다 — 규칙이 두 벌이 되면 화면과 실제 동작이 갈린다.
export async function seedTrackedItemsFromExpenses(onlyLabels?: string[], opts?: { dryRun?: boolean }): Promise<{ ok: true; created: number; migrated: number; skippedArchived: number; decisions: MergeDecision[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const trackedCats = await getTrackedCategories(propertyId)
    const rows = await prisma.expense.findMany({
      where: {
        propertyId,
        category: { in: trackedCats },
        itemLabel: onlyLabels && onlyLabels.length ? { in: onlyLabels } : { not: null },
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
          if (sizeConflicts(label, it.label)) continue   // 50L 과 20L 은 다른 물건이다
          cand.set(it.id, { itemId: it.id, label: it.label })
        }
        for (const tid of (linkMap.get(key) ?? [])) {
          if (muteSet.has(`${key}|${tid}`)) continue
          const it = itemById.get(tid)
          // 운영자가 직접 맺은 LINK 규칙은 크기가 달라도 존중한다. 사람이 정한 것을 코드가 뒤집지 않는다.
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
        if (!opts?.dryRun) {
          await prisma.trackedItem.create({
            data: {
              propertyId,
              category: g.category,
              label,
              specUnit: g.specUnit,
              qtyUnit: g.qtyUnit,
              trackUnit: defaultTrackUnitForCategory(g.category),
            },
          })
        }
        created++
      }
      // 라벨이 변경된 그룹의 expense rows의 itemLabel을 새 라벨로 업데이트
      if (label !== g.baseLabel && g.expenseIds.length > 0) {
        if (opts?.dryRun) { migrated += g.expenseIds.length }
        else {
          const r = await prisma.expense.updateMany({
            where: { id: { in: g.expenseIds } },
            data: { itemLabel: label },
          })
          migrated += r.count
        }
      }
    }
    if (!opts?.dryRun) {
      revalidatePath('/inventory')
      revalidatePath('/finance')
    }
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
      // 되돌리기(병합 해제) 복원 정보 — 지출을 원래 라벨로 분리할 수 있게 기록
      if (expenseIds.length > 0) {
        try {
          await prisma.trackedItemMergeUndo.create({
            data: {
              propertyId, targetItemId: target.id,
              label: `${newLabel} → ${target.label}`,
              payload: {
                kind: 'IMPORT', origLabel: newLabel, category,
                specUnit: input.specUnit ?? null, qtyUnit: input.qtyUnit ?? null,
                expenseIds,
              },
            },
          })
        } catch { /* 복원정보 테이블 미적용 — 병합은 계속 */ }
      }
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

// ── 병합 해제(되돌리기) ──────────────────────────────────────
// 되돌릴 수 있는 병합 목록 — 최근 것부터.
export async function getMergeUndos(): Promise<MergeUndoRow[]> {
  const propertyId = await getPropertyId()
  let undos: Awaited<ReturnType<typeof prisma.trackedItemMergeUndo.findMany>> = []
  try {
    undos = await prisma.trackedItemMergeUndo.findMany({
      where: { propertyId }, orderBy: { createdAt: 'desc' },
    })
  } catch { return [] }  // 복원정보 테이블 미적용 환경 방어
  const targetIds = Array.from(new Set(undos.map(u => u.targetItemId)))
  const targets = targetIds.length > 0
    ? await prisma.trackedItem.findMany({ where: { id: { in: targetIds } }, select: { id: true, label: true } })
    : []
  const labelById = new Map(targets.map(t => [t.id, t.label]))
  return undos.map(u => ({
    id: u.id,
    label: u.label,
    targetLabel: labelById.get(u.targetItemId) ?? null,
    kind: ((u.payload as any)?.kind === 'CARD' ? 'CARD' : 'IMPORT') as 'IMPORT' | 'CARD',
    createdAt: u.createdAt.toISOString(),
  }))
}

// 병합 해제 — payload 로 지출·점검·카드를 원상복구하고 LINK 규칙·복원정보를 제거.
export async function unmergeTrackedItem(undoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const undo = await prisma.trackedItemMergeUndo.findFirst({ where: { id: undoId, propertyId } })
    if (!undo) return { ok: false, error: '되돌릴 병합 정보를 찾을 수 없습니다.' }
    const p = undo.payload as any

    if (p?.kind === 'IMPORT') {
      const { origLabel, category, specUnit, qtyUnit, expenseIds } = p
      // 1) 원래 라벨 카드 보장 (없으면 생성, 숨김이면 복구)
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category, label: origLabel } },
        select: { id: true, isArchived: true },
      })
      if (!existing) {
        await prisma.trackedItem.create({
          data: { propertyId, category, label: origLabel, specUnit: specUnit ?? null, qtyUnit: qtyUnit ?? null,
                  trackUnit: category === '폐기물 처리비' ? 'qty' : 'spec' },
        })
      } else if (existing.isArchived) {
        await prisma.trackedItem.update({ where: { id: existing.id }, data: { isArchived: false } })
      }
      // 2) 지출 라벨 원복
      if (Array.isArray(expenseIds) && expenseIds.length > 0) {
        await prisma.expense.updateMany({ where: { id: { in: expenseIds }, propertyId }, data: { itemLabel: origLabel } })
      }
      // 3) LINK 규칙 제거 (다시 자동 흡수 안 되게)
      await prisma.trackedItemMergeRule.deleteMany({
        where: { propertyId, category, normLabel: normalizeLabel(origLabel), targetItemId: undo.targetItemId, kind: 'LINK' },
      })
    } else {
      // kind === 'CARD'
      const s = p.source ?? {}
      // 1) source 카드 재생성(또는 숨김 복구)
      let sourceId: string
      const existing = await prisma.trackedItem.findUnique({
        where: { propertyId_category_label: { propertyId, category: s.category, label: s.label } },
        select: { id: true, isArchived: true },
      })
      if (existing) {
        sourceId = existing.id
        if (existing.isArchived) await prisma.trackedItem.update({ where: { id: existing.id }, data: { isArchived: false } })
      } else {
        const created = await prisma.trackedItem.create({
          data: {
            propertyId, category: s.category, label: s.label, specUnit: s.specUnit ?? null, qtyUnit: s.qtyUnit ?? null,
            trackUnit: s.trackUnit ?? 'spec', hubLocationId: s.hubLocationId ?? null,
            alertThresholdDays: s.alertThresholdDays ?? 7, reorderMemo: s.reorderMemo ?? null,
            purchaseUrl: s.purchaseUrl ?? null, memo: s.memo ?? null,
          },
          select: { id: true },
        })
        sourceId = created.id
      }
      // 1.5) source 카드 위치 링크 복원 — 병합 때 source delete 로 cascade 소멸했던 것.
      //   안 하면 되살아난 카드의 점검 breakdown 이 전부 orphan(위치별 화면에서 증발)이 된다.
      //   3세대 하위호환: gen-2 sourceLocations{id,closedAt} / gen-1 sourceLocationIds[] / gen-0 없음(조용히 건너뜀).
      const srcLocs: { storageLocationId: string; closedAt: string | null }[] =
        Array.isArray(p.sourceLocations) ? (p.sourceLocations as { storageLocationId: string; closedAt: string | null }[])
        : Array.isArray(p.sourceLocationIds) ? (p.sourceLocationIds as string[]).map(id => ({ storageLocationId: id, closedAt: null }))
        : []
      if (srcLocs.length > 0) {
        await prisma.trackedItemLocation.createMany({
          data: srcLocs.map(l => ({ trackedItemId: sourceId, storageLocationId: l.storageLocationId, closedAt: l.closedAt ? new Date(l.closedAt) : null })),
          skipDuplicates: true,
        })
      }
      // 2) 지출 라벨 원복 + 점검·입수 이전 원복
      if (Array.isArray(p.movedExpenseIds) && p.movedExpenseIds.length > 0) {
        await prisma.expense.updateMany({ where: { id: { in: p.movedExpenseIds }, propertyId }, data: { itemLabel: s.label } })
      }
      // 병합 때 단위 환산했으면(unitFactor≠1) 원복하며 역배율로 되돌림
      const mf = typeof p.unitFactor === 'number' && p.unitFactor > 0 ? p.unitFactor : 1
      if (mf !== 1) {
        await scaleStockValues(
          Array.isArray(p.movedCheckIds) ? p.movedCheckIds : [],
          Array.isArray(p.movedAdditionIds) ? p.movedAdditionIds : [],
          Array.isArray(p.movedDisposalIds) ? p.movedDisposalIds : [],
          1 / mf,
        )
      }
      if (Array.isArray(p.movedCheckIds) && p.movedCheckIds.length > 0) {
        await prisma.stockCheck.updateMany({ where: { id: { in: p.movedCheckIds } }, data: { trackedItemId: sourceId } })
      }
      if (Array.isArray(p.movedAdditionIds) && p.movedAdditionIds.length > 0) {
        await prisma.stockAddition.updateMany({ where: { id: { in: p.movedAdditionIds } }, data: { trackedItemId: sourceId } })
      }
      if (Array.isArray(p.movedDisposalIds) && p.movedDisposalIds.length > 0) {
        await prisma.stockDisposal.updateMany({ where: { id: { in: p.movedDisposalIds } }, data: { trackedItemId: sourceId } })
      }
      // 3) 대상 카드 qtyUnit 원복 (looseMatch 로 null 됐던 경우)
      if (p.targetQtyUnitBefore != null) {
        await prisma.trackedItem.updateMany({ where: { id: undo.targetItemId, propertyId }, data: { qtyUnit: p.targetQtyUnitBefore } })
      }
      // 3.5) 합집합이 target 에 '새로 더한' 링크만 제거 — 원래 target 것이었던 링크는 보존.
      //   targetLocationIdsBefore 없이 sourceLocations 만으로 지우면 target 원래 링크까지 날아간다.
      if (srcLocs.length > 0 && Array.isArray(p.targetLocationIdsBefore)) {
        const before = new Set<string>(p.targetLocationIdsBefore as string[])
        const added = srcLocs.map(l => l.storageLocationId).filter(id => !before.has(id))
        if (added.length > 0) {
          await prisma.trackedItemLocation.deleteMany({
            where: { trackedItemId: undo.targetItemId, storageLocationId: { in: added } },
          })
        }
      }
      // 4) LINK 규칙 제거
      await prisma.trackedItemMergeRule.deleteMany({
        where: { propertyId, normLabel: normalizeLabel(s.label), targetItemId: undo.targetItemId, kind: 'LINK' },
      })
    }

    await prisma.trackedItemMergeUndo.delete({ where: { id: undo.id } }).catch(() => {})
    revalidatePath('/inventory')
    revalidatePath('/finance')
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

// 보관위치 순서 재정렬 — 드래그 정렬(운영자 요청 a5e258c3). 전체 id 배열을 받아 인덱스대로 sortOrder 를 다시 쓴다.
// 전체 배열 방식 = 설정의 reorderOptions 와 동일 문법. 부분 배열이면 빠진 위치의 상대 순서가 흔들리므로 거부.
export async function reorderStorageLocations(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (ids.length === 0) return { ok: false, error: '정렬할 위치가 없습니다.' }
    if (new Set(ids).size !== ids.length) return { ok: false, error: '중복된 위치가 있습니다.' }
    // 소유 검증 + 전체성 검증 — 이 영업장의 위치 전부가 정확히 한 번씩 와야 한다
    const total = await prisma.storageLocation.count({ where: { propertyId } })
    const owned = await prisma.storageLocation.count({ where: { id: { in: ids }, propertyId } })
    if (owned !== ids.length || total !== ids.length) return { ok: false, error: '위치 목록이 최신이 아닙니다. 새로고침 후 다시 시도해주세요.' }
    await prisma.$transaction(ids.map((id, i) =>
      prisma.storageLocation.update({ where: { id }, data: { sortOrder: i } })
    ))
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '순서 저장에 실패했습니다.' }
  }
}

// 품목 순서 재정렬(카테고리 내) — 드래그(운영자 요청 a5e258c3 2단계). 그 카테고리의 전체 id 배열을
// 받아 인덱스대로 sortOrder 기록. 부분 배열이면 미포함 품목과의 상대 순서가 흔들리므로 전체성 검증.
export async function reorderTrackedItems(category: string, ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (ids.length === 0) return { ok: false, error: '정렬할 품목이 없습니다.' }
    if (new Set(ids).size !== ids.length) return { ok: false, error: '중복된 품목이 있습니다.' }
    const total = await prisma.trackedItem.count({ where: { propertyId, category, isArchived: false } })
    const owned = await prisma.trackedItem.count({ where: { id: { in: ids }, propertyId, category, isArchived: false } })
    if (owned !== ids.length || total !== ids.length) return { ok: false, error: '품목 목록이 최신이 아닙니다. 새로고침 후 다시 시도해주세요.' }
    await prisma.$transaction(ids.map((id, i) => prisma.trackedItem.update({ where: { id }, data: { sortOrder: i } })))
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '순서 저장에 실패했습니다.' }
  }
}

// 허브(창고) 단일 전환 — 선택한 위치를 허브로, 나머지는 모두 해제 (한 영업장 1개 허브 보장).
export async function setStorageHub(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const loc = await prisma.storageLocation.findFirst({ where: { id, propertyId } })
    if (!loc) return { ok: false, error: '위치를 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.storageLocation.updateMany({ where: { propertyId, isHub: true, NOT: { id } }, data: { isHub: false } }),
      prisma.storageLocation.update({ where: { id }, data: { isHub: true } }),
    ])
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
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

// 삭제 정책(운영자 확정 2026-07-18): 이력·연결이 전혀 없는 위치(실수 생성)는 바로 삭제.
// 데이터가 있으면 구체적 결과를 경고하고, 그래도 원하면 강제 삭제 허용.
// ⚠️ 강제 삭제의 실제 결과: 위치별 점검 이력(StockCheckLocation)이 cascade 로 지워지고,
//   총량(StockCheck.remainingQty)은 저장값이라 당장은 안 변하지만 다음 위치별 점검이
//   살아남은 내역의 합으로 총량을 재계산하면서 그때 수량이 깎인다(지연 발화).
//   일상적 정리는 삭제가 아니라 품목별 '숨김'을 쓴다.
export type LocationDeleteImpact = { checkRows: number; linkedItems: number; addRows: number; dispRows: number }
export async function deleteStorageLocation(id: string, force = false): Promise<
  { ok: true } | { ok: false; error: string; impact?: LocationDeleteImpact }
> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const loc = await prisma.storageLocation.findFirst({ where: { id, propertyId } })
    if (!loc) return { ok: false, error: '위치를 찾을 수 없습니다.' }
    const [checkRows, linkedItems, addRows, dispRows] = await Promise.all([
      prisma.stockCheckLocation.count({ where: { storageLocationId: id } }),
      prisma.trackedItemLocation.count({ where: { storageLocationId: id } }),
      prisma.stockAddition.count({ where: { storageLocationId: id } }),
      prisma.stockDisposal.count({ where: { storageLocationId: id } }),
    ])
    const hasData = checkRows + linkedItems + addRows + dispRows > 0
    if (hasData && !force) {
      return { ok: false, error: '이 위치에는 기록이 있습니다.', impact: { checkRows, linkedItems, addRows, dispRows } }
    }
    // 삭제 **직후 헤더를 재계산한다**(C페이즈 조사 2026-08-03).
    //
    // 종전에는 StockCheckLocation 만 cascade 로 지우고 StockCheck.remainingQty(헤더)는 그대로 뒀다.
    // 헤더와 내역 합의 불변식이 깨진 채 남아 있다가, 다음 위치별 점검이 살아남은 내역 합으로
    // 총량을 다시 쓰면서 **그때 수량이 깎인다.** 지연 발화라 원인을 찾기 어렵다.
    // 지금 맞추면 어긋난 순간이 화면에 바로 드러난다.
    const affected = await prisma.stockCheckLocation.findMany({
      where: { storageLocationId: id }, select: { stockCheckId: true },
    })
    const checkIds = [...new Set(affected.map(a => a.stockCheckId))]
    await prisma.$transaction(async tx => {
      await tx.storageLocation.delete({ where: { id } })
      for (const cid of checkIds) {
        const rest = await tx.stockCheckLocation.findMany({ where: { stockCheckId: cid }, select: { remainingQty: true } })
        // 내역이 하나도 안 남으면 헤더를 손대지 않는다 — 위치 없이 총량만 센 점검과 구분이 안 된다.
        if (rest.length === 0) continue
        const sum = rest.reduce((s2, r) => s2 + r.remainingQty, 0)
        await tx.stockCheck.update({ where: { id: cid }, data: { remainingQty: Math.round(sum * 1000) / 1000 } })
      }
    })
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
    // 3-way diff — deleteMany 전체교체는 (a) closedAt 소실 (b) 재고 든 위치 링크 무단 제거의 2중 orphan 생성기였다(2단계 F1).
    // 빠진 id: 재고 있으면 거부 / 비었고 이력 없으면 삭제 / 비었고 이력 있으면 숨김(closedAt).
    // 선택 id: 미링크면 생성 / 숨김이면 다시 표시(closedAt=null) / 열림이면 무변경.
    const selected = locationIds.length > 0
      ? await prisma.storageLocation.findMany({ where: { id: { in: locationIds }, propertyId }, select: { id: true } })
      : []
    const selectedIds = new Set(selected.map(l => l.id))
    if (selectedIds.size !== locationIds.length) return { ok: false, error: '일부 위치를 찾을 수 없습니다.' }

    const links = await prisma.trackedItemLocation.findMany({ where: { trackedItemId }, select: { storageLocationId: true, closedAt: true } })
    const missing = links.filter(l => !selectedIds.has(l.storageLocationId))

    // 실효 허브가 빠진 id 에 있으면 거부 — 허브 승격은 숨김(closeItemLocation)의 책임이다.
    const openIds = new Set(links.filter(l => l.closedAt == null).map(l => l.storageLocationId))
    const effHub = await resolveItemHubLocationId(trackedItemId, it.hubLocationId, propertyId, openIds)
    const breakdown = await currentLocationBreakdown(trackedItemId, propertyId, it.hubLocationId)
    const locName = async (id: string) => (await prisma.storageLocation.findUnique({ where: { id }, select: { name: true } }))?.name ?? '해당 위치'

    // 이력 있는 빠진 위치 판별(숨김 대상). 이력 없으면 삭제.
    const histRows = missing.length > 0
      ? await prisma.stockCheckLocation.findMany({
          where: { stockCheck: { trackedItemId }, storageLocationId: { in: missing.map(m => m.storageLocationId) } },
          select: { storageLocationId: true }, distinct: ['storageLocationId'],
        })
      : []
    const hasHistory = new Set(histRows.map(r => r.storageLocationId))

    const toClose: string[] = [], toDelete: string[] = []
    for (const m of missing) {
      const qty = Math.max(0, breakdown.get(m.storageLocationId) ?? 0)
      if (qty >= 0.001) return { ok: false, error: `${await locName(m.storageLocationId)}에 재고가 남아 있어 뗄 수 없습니다. 먼저 위치 이동으로 재고를 옮겨 비워주세요.` }
      if (m.storageLocationId === effHub) return { ok: false, error: `${await locName(m.storageLocationId)}은 이 품목의 창고입니다. 먼저 다른 위치를 창고로 지정해주세요.` }
      if (hasHistory.has(m.storageLocationId)) toClose.push(m.storageLocationId)
      else toDelete.push(m.storageLocationId)
    }

    // 사후조건 P — 결과 링크가 있으면 열린 링크가 최소 1개.
    // 선택된 id 는 전부 열림으로 끝나므로(생성·다시표시·유지), selected 가 비었는데 숨김으로 남는 링크가 있으면 위반.
    // (링크 0 은 허용 — '위치 안 쓰는 품목'으로 돌아갈 수 있다.)
    if (selectedIds.size === 0 && (links.length - toDelete.length) > 0) {
      return { ok: false, error: '마지막 남은 보관 위치는 뗄 수 없습니다.' }
    }

    const newIds = [...selectedIds].filter(id => !links.some(l => l.storageLocationId === id))
    const reopenIds = links.filter(l => l.closedAt != null && selectedIds.has(l.storageLocationId)).map(l => l.storageLocationId)
    const ops: Prisma.PrismaPromise<unknown>[] = []
    if (newIds.length > 0) ops.push(prisma.trackedItemLocation.createMany({ data: newIds.map(storageLocationId => ({ trackedItemId, storageLocationId })), skipDuplicates: true }))
    if (reopenIds.length > 0) ops.push(prisma.trackedItemLocation.updateMany({ where: { trackedItemId, storageLocationId: { in: reopenIds } }, data: { closedAt: null } }))
    if (toClose.length > 0) ops.push(prisma.trackedItemLocation.updateMany({ where: { trackedItemId, storageLocationId: { in: toClose } }, data: { closedAt: new Date() } }))
    if (toDelete.length > 0) ops.push(prisma.trackedItemLocation.deleteMany({ where: { trackedItemId, storageLocationId: { in: toDelete } } }))
    if (ops.length > 0) await prisma.$transaction(ops)
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
    if (locationIds.length === 0) return { ok: false, error: '추가할 위치를 선택하세요.' }
    // 위치 소유 검증
    const locCount = await prisma.storageLocation.count({ where: { id: { in: locationIds }, propertyId } })
    if (locCount !== locationIds.length) return { ok: false, error: '일부 위치를 찾을 수 없습니다.' }

    // 가산 전용(union) — 종전 deleteMany 전체교체는 빈 선택 적용 시 전 품목 링크·closedAt 을 통째로 날렸다(2단계 F7).
    // BatchLocationModal 은 현재 상태를 안 읽고 빈 Set 으로 시작하므로 '교체' 개념이 성립하지 않는다.
    // skipDuplicates 가 기존 링크의 closedAt 을 보존한다 — 배치 추가가 숨긴 위치를 조용히 되살리지 않는다. 제거는 품목별 숨김으로.
    await prisma.trackedItemLocation.createMany({
      data: trackedItemIds.flatMap(trackedItemId =>
        locationIds.map(storageLocationId => ({ trackedItemId, storageLocationId }))
      ),
      skipDuplicates: true,
    })
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
// receiveQty — 부분 수령(분할 배송): 전체 중 일부만 도착 시 그 수량만 수령 처리.
// 지출 행을 [수령분]+[대기 잔여]로 분할(금액 비례, allocationGroupId로 지출목록 한 줄 유지 — 배정 분할과 동일 선례).
export async function confirmReceipt(expenseId: string, locationId?: string, receiveQty?: number): Promise<{ ok: true; undo?: PartialReceiptUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    let expense = await prisma.expense.findFirst({ where: { id: expenseId, propertyId } })
    if (!expense) return { ok: false, error: '구매 내역을 찾을 수 없습니다.' }
    // 멱등 — 이미 수령 확인된 지출이면 그대로 성공 반환. 응답 유실 후 재클릭·스테일 탭의
    // 재호출이 자동 점검을 또 만들어 입고량이 이중 가산되는 것을 막는다(createStockCheck의
    // 중복 제출 가드와 같은 취지). 수령 취소(undo)는 receivedAt을 null로 되돌리므로 재수령은 정상 동작.
    if (expense.receivedAt) return { ok: true }

    // 품목 조회 — 위치 미지정으로 수령해도 허브(기본 창고)에 자동 배치해 잔량에서 누락되지 않게 한다.
    // (위치별 점검이 '어느 위치에도 배치 안 된 입고분'을 못 세어 통째로 증발하던 버그 방지 —
    //  라면 120개 케이스. 쌀은 수령 시 창고를 지정해 자동 배치돼 정상이었음.)
    // (propertyId,category,label) 유니크 — 라벨로 유일 품목을 찾는다.
    // ⚠️ 아래 부분수령 분할보다 먼저 한다 — 위치 검증이 거부될 때 쪼개진 지출 행만 남으면 안 된다.
    //   분할은 category·itemLabel 을 보존하고 qtyValue 도 >0 로 남으므로 조회 결과는 분할 전후 동일.
    type RcvItem = { id: string; trackUnit: string; specUnit: string | null; qtyUnit: string | null; hubLocationId: string | null; locations: { storageLocationId: string }[] }
    let item: RcvItem | null = null
    if (expense.qtyValue && expense.qtyValue > 0 && expense.itemLabel) {
      item = await prisma.trackedItem.findFirst({
        where: { propertyId, category: expense.category, label: expense.itemLabel, isArchived: false },
        select: {
          id: true, trackUnit: true, specUnit: true, qtyUnit: true, hubLocationId: true,
          // sortOrder 정렬 — '첫 위치' 폴백을 결정화(getStockAsOf 와 동일 기준)
          // 열린 링크만 — 숨긴 위치는 자동 배치·지정 위치 후보가 될 수 없다(2단계 F3)
          locations: { where: { closedAt: null }, select: { storageLocationId: true }, orderBy: { storageLocation: { sortOrder: 'asc' } } },
        },
      })
    }
    const linkedIds = new Set(item?.locations.map(l => l.storageLocationId) ?? [])
    // 지정 위치가 이 품목 것이 아니면 거부 — 스테일 화면이 방금 해제된 위치를 찍는 경우.
    // 링크 없는 위치에 넣으면 그 수량이 위치별 화면·보정 폼에서 안 보인다(orphan, 601303c5 김치와 같은 클래스).
    // (item 이 null 이면 링크 개념이 없고 자동 점검도 안 만들므로 종전 동작 유지)
    if (locationId && item && !linkedIds.has(locationId)) {
      return { ok: false, error: '이 품목의 보관 위치가 아닙니다. 화면을 새로고침한 뒤 다시 선택해 주세요.' }
    }

    // 부분 수령 — 요청 수량이 전체 미만이면 행 분할 후, 수령 분할행에 대해 아래 기존 흐름을 그대로 태운다
    // (자동 점검·허브 배치가 수령 수량만 반영됨). 잔여 행은 수령 대기 유지.
    let partialUndo: PartialReceiptUndo | null = null
    if (receiveQty != null && expense.qtyValue && receiveQty > 0 && receiveQty < expense.qtyValue) {
      const eq = expense.qtyValue
      const recvAmount = Math.round(expense.amount * (receiveQty / eq))
      const remainQty = Math.round((eq - receiveQty) * 1000) / 1000
      const groupId = expense.allocationGroupId ?? randomUUID()
      // 적용취소용 분할 직전 스냅샷 — 복원은 산술 재합산이 아니라 이 값 그대로(반올림 잔차·detail 재구성 방지)
      const prevSnap = { qtyValue: eq, amount: expense.amount, detail: expense.detail, allocationGroupId: expense.allocationGroupId }
      const qtyPart = (q: number) => expense!.specValue != null
        ? `[${expense!.itemLabel}] ${expense!.specValue}${expense!.specUnit ?? ''} x ${q}${expense!.qtyUnit ?? '개'}`
        : `[${expense!.itemLabel}] x ${q}${expense!.qtyUnit ?? '개'}`
      const [, created] = await prisma.$transaction([
        prisma.expense.update({
          where: { id: expense.id },
          data: { qtyValue: remainQty, amount: expense.amount - recvAmount, allocationGroupId: groupId, detail: qtyPart(remainQty) },
        }),
        prisma.expense.create({ data: {
          date: expense.date, amount: recvAmount, category: expense.category, detail: qtyPart(receiveQty),
          vendor: expense.vendor, memo: expense.memo, payMethod: expense.payMethod, settleStatus: expense.settleStatus,
          receiptUrl: expense.receiptUrl, receiptUrls: expense.receiptUrls, financeName: expense.financeName,
          itemLabel: expense.itemLabel, specValue: expense.specValue, specUnit: expense.specUnit,
          qtyValue: receiveQty, qtyUnit: expense.qtyUnit,
          excludeFromInventory: expense.excludeFromInventory,
          allocationGroupId: groupId, orderId: expense.orderId, isShipping: expense.isShipping,
          propertyId, roomId: expense.roomId, assignedLocationId: expense.assignedLocationId,
          financialAccountId: expense.financialAccountId, recurringExpenseId: expense.recurringExpenseId,
        } }),
      ])
      expense = created
      partialUndo = {
        receivedId: created.id,
        remainderId: expenseId,
        trackedItemId: null,
        receivedAtMs: 0,
        prev: prevSnap,
        expect: {
          remainQty, remainAmount: prevSnap.amount - recvAmount,
          recvQty: receiveQty, recvAmount, groupId,
          roomId: created.roomId, assignedLocationId: created.assignedLocationId, isCommonAsset: created.isCommonAsset,
        },
      }
    }

    const receivedAt = new Date()

    // 배치 위치 결정: 지정 위치 → 품목 허브 → 영업장 기본 허브 → 첫 배치 위치.
    // 단 어느 단계든 '이 품목에 링크된 위치'여야 한다(resolveItemHubLocationId 가 보장) —
    // 종전 폴백은 영업장 기본 허브(isHub)를 무검사로 썼는데, isHub 는 영업장 기본값이지 품목별 선언이 아니다.
    // 위치를 쓰는 품목인데 미지정으로 받으면 '허브(창고)에 들어간 것'으로 본다(현실: 받으면 일단 창고).
    let effectiveLocationId: string | null = locationId ?? null
    if (!effectiveLocationId && item && item.locations.length > 0) {
      effectiveLocationId = await resolveItemHubLocationId(item.id, item.hubLocationId, propertyId, linkedIds)
    }

    // 배치 위치 + 수량이 있으면 자동 점검 생성(해당 위치 잔량에 수령량 가산).
    // receivedAt 갱신과 점검 생성은 아래에서 한 트랜잭션으로 커밋 — 중간 실패 시 '수령 확인은 됐는데
    // 잔량에는 안 잡힌' 상태(장부 과소)가 되던 문제 방지.
    //
    // **위치 없는 단일 버킷 품목(locations 0개)도 점검을 만든다(신고 408b4396).**
    // 종전 주석은 "점검 시 총량을 직접 세므로 누락 없음" 이라 했지만, 점검을 한 번도 안 한 품목은
    // 잔량이 영원히 null 이라 특수마대 5개를 수령 확인해도 화면에 아무것도 안 잡혔다.
    // 실측으로 위치 0 카드 9장 중 8장이 "지출 1건·수령 완료·점검 0" 그 상태였다.
    // 위치 내역 없이 총량만 가진 점검을 만든다 — 단일 버킷은 이미 정식 상태이고, 나중에 위치가 생기면
    // 기존 전환 코드가 총량을 허브로 보존한다. 산식은 overview 의 정본 헬퍼를 그대로 쓴다(복제 금지).
    let autoCheck: Parameters<typeof prisma.stockCheck.create>[0]['data'] | null = null
    if (!effectiveLocationId && item && item.locations.length === 0 && expense.qtyValue && expense.qtyValue > 0) {
      const spec = item.trackUnit === 'spec'
        ? specMultiplier(expense.specValue, expense.specUnit, item.specUnit)
        : null
      const receivedQty = spec != null ? expense.qtyValue * spec : expense.qtyValue
      if (receivedQty > 0) {
        const lastCheck = await prisma.stockCheck.findFirst({
          where: { trackedItemId: item.id },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: { remainingQty: true, date: true, createdAt: true },
        })
        const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
        // 직전 점검이 있으면 그 값 + 이후 순변동. 없으면 **이전에 수령된 구매까지 포함**한다 —
        // 안 하면 과거 수령분이 계속 유령으로 남는다. 이 시점 이 지출의 receivedAt 은 아직 null 이라
        // 합산에 안 들어가고, 아래에서 receivedQty 로 한 번만 더해진다(이중 계상 없음).
        // 소모 미반영으로 과대일 수 있으나 그건 수령 후 미점검 품목 전체가 공유하는 통상 가정이고
        // 점검이 정정 수단이다. null 보다 정직하다.
        const [purch, adds, disp] = await Promise.all([
          sumPurchases(propertyId, expense.category, expense.itemLabel!, item.qtyUnit,
            lastCheck?.createdAt ?? null, null, useSpec, item.specUnit),
          sumAdditions(item.id, lastCheck?.date ?? null, null, lastCheck?.createdAt ?? null),
          sumDisposals(item.id, lastCheck?.date ?? null, null, lastCheck?.createdAt ?? null),
        ])
        const totalQty = Math.max(0, (lastCheck?.remainingQty ?? 0) + purch + adds - disp) + receivedQty
        const unit = item.trackUnit === 'spec' ? (item.specUnit ?? '') : (item.qtyUnit ?? '')
        autoCheck = {
          trackedItemId: item.id,
          date: receivedAt,
          remainingQty: totalQty,
          memo: `[수령 자동] +${receivedQty}${unit}`,
          sourceExpenseId: expense.id,   // 수령 취소가 이 점검을 함께 지운다(기존 undo 계약 그대로)
        }
      }
    }
    if (effectiveLocationId && item && expense.qtyValue && expense.qtyValue > 0) {
      // 규격 추적이면 영수증 규격값을 품목 단위로 환산(L→ml 등) 후 입수량 산출.
      // 차원 불일치(120g x 100개 등)면 specMultiplier 가 null → qtyValue 그대로(오류신고 0d6242f0).
      const spec = item.trackUnit === 'spec'
        ? specMultiplier(expense.specValue, expense.specUnit, item.specUnit)
        : null
      const receivedQty = spec != null ? expense.qtyValue * spec : expense.qtyValue

      if (receivedQty > 0) {
        const lastCheck = await prisma.stockCheck.findFirst({
          where: { trackedItemId: item.id },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { locationBreakdown: true },
        })
        const prevByLoc = new Map<string, number>(
          (lastCheck?.locationBreakdown ?? []).map(lb => [lb.storageLocationId, lb.remainingQty])
        )
        // 직전 점검이 위치 내역 없이 총량만 있던 경우(단일 버킷→위치 전환 등) 총량을 허브에 보존.
        if (prevByLoc.size === 0 && lastCheck && lastCheck.remainingQty > 0) {
          prevByLoc.set(effectiveLocationId, lastCheck.remainingQty)
        }
        // 직전 점검 이후 입수·폐기 순변동을 baseline에 반영 — baseline 복사가 폐기를 되살리고
        // 그 사이 입수를 가짜 소모로 만들던 결함 보완(영향검증 필수1, 쌀 사건 계열).
        const netMap = await additionsSinceCheckByLocation(item.id, lastCheck, item.hubLocationId, propertyId)
        for (const [locId, q] of netMap) {
          prevByLoc.set(locId, Math.max(0, (prevByLoc.get(locId) ?? 0) + q))
        }
        const prevAtTarget = prevByLoc.get(effectiveLocationId) ?? 0
        const newAtTarget = prevAtTarget + receivedQty
        // 다른 위치는 이전 값 유지, 대상 위치만 +receivedQty
        const allLocs: { storageLocationId: string; qty: number }[] = []
        for (const [locId, qty] of prevByLoc) {
          if (locId !== effectiveLocationId && qty > 0) allLocs.push({ storageLocationId: locId, qty })
        }
        allLocs.push({ storageLocationId: effectiveLocationId, qty: newAtTarget })
        const totalQty = allLocs.reduce((s, l) => s + l.qty, 0)

        const unit = item.trackUnit === 'spec' ? (item.specUnit ?? '') : (item.qtyUnit ?? '')
        autoCheck = {
          trackedItemId: item.id,
          // 자동 점검의 date는 receivedAt(=현재 시각) 기준 — 사용자가 나중에 수령일을 수정하면
          // updateExpenseFromInventory에서 sourceExpenseId로 찾아 동기화한다.
          date: receivedAt,
          remainingQty: totalQty,
          memo: `[수령 자동] +${receivedQty}${unit}`,
          // 부분 수령 분할 시 expense는 수령 분할행으로 재대입됨 — 원본(잔여) 행 id(expenseId)를 쓰면
          // 잔여 행 수령 취소가 이 점검까지 지워 장부가 조용히 준다(P0, §4 적대검증 2026-07-14 확인).
          sourceExpenseId: expense.id,
          locationBreakdown: {
            create: allLocs.filter(l => l.qty > 0).map(l => ({
              storageLocationId: l.storageLocationId,
              remainingQty: l.qty,
            })),
          },
        }
      }
    }

    await prisma.$transaction([
      prisma.expense.update({
        where: { id: expense.id },
        data: { receivedAt, ...(effectiveLocationId ? { receivedLocationId: effectiveLocationId } : {}) },
      }),
      ...(autoCheck ? [prisma.stockCheck.create({ data: autoCheck })] : []),
    ])

    if (partialUndo) {
      partialUndo.receivedAtMs = receivedAt.getTime()
      partialUndo.trackedItemId = item?.id ?? null
    }

    revalidatePath('/inventory')
    return partialUndo ? { ok: true, undo: partialUndo } : { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 부분 수령 적용취소 토큰 — 분할 직전 원본 스냅샷(prev)과 분할 직후 기대 상태(expect).
// 클라이언트가 토스트 수명 동안만 보유(StockCheckUndo·AssetAssignUndo 선례).
export type PartialReceiptUndo = {
  receivedId: string      // 수령 분할행(삭제 대상)
  remainderId: string     // 원본(잔여) 행(복원 대상)
  trackedItemId: string | null
  receivedAtMs: number
  prev: { qtyValue: number; amount: number; detail: string | null; allocationGroupId: string | null }
  expect: {
    remainQty: number; remainAmount: number
    recvQty: number; recvAmount: number
    groupId: string
    roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean
  }
}

// 부분 수령 적용취소 — 수령 분할행과 자동 점검을 지우고 원본 행을 분할 직전 상태로 복원.
// 그 사이 후속 기록(점검·재수령·자산 배정·행 수정)이 끼면 장부 왜곡을 막기 위해 거부한다(§4 설계+적대검증 2026-07-14).
export async function undoPartialReceipt(undo: PartialReceiptUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const [recv, remain] = await Promise.all([
      prisma.expense.findFirst({ where: { id: undo.receivedId, propertyId } }),
      prisma.expense.findFirst({ where: { id: undo.remainderId, propertyId } }),
    ])
    if (!remain) return { ok: false, error: '원본 지출을 찾을 수 없습니다.' }
    if (!recv) {
      // 수령 행이 이미 없는 경우: 원본이 분할 전 상태면 이미 되돌려진 것(멱등 ok),
      // 분할 상태 그대로면 다른 경로로 삭제된 것 — 조용한 '복원됨' 거짓 신호를 막는다(적대검증 권고 3).
      const restored = !remain.receivedAt && remain.qtyValue === undo.prev.qtyValue && remain.amount === undo.prev.amount
      return restored ? { ok: true } : { ok: false, error: '수령 분할행이 이미 삭제되어 되돌릴 수 없습니다. 지출 내역을 확인해 주세요.' }
    }
    // 가드 1 — 수령 행이 그 사이 변형(자산 배정·이동·분할·수정)됐으면 거부(적대검증 필수 1)
    if (!recv.receivedAt || recv.qtyValue !== undo.expect.recvQty || recv.amount !== undo.expect.recvAmount
      || recv.allocationGroupId !== undo.expect.groupId || recv.roomId !== undo.expect.roomId
      || recv.assignedLocationId !== undo.expect.assignedLocationId || recv.isCommonAsset !== undo.expect.isCommonAsset) {
      return { ok: false, error: '수령 이후 이 지출이 수정되어 되돌릴 수 없습니다.' }
    }
    // 가드 2 — 잔여 행이 그 사이 재수령·재분할·수정됐으면 거부
    if (remain.receivedAt || remain.qtyValue !== undo.expect.remainQty || remain.amount !== undo.expect.remainAmount
      || remain.allocationGroupId !== undo.expect.groupId) {
      return { ok: false, error: '잔여 수량이 이미 수령되었거나 수정되어 되돌릴 수 없습니다.' }
    }
    // 가드 3 — 수령 이후 다른 점검(수동·타 수령 자동)이 있으면 거부. 이후 점검은 수령분을 실측에
    // 이미 반영했으므로 여기서 빼면 이중 계상된다. StockCheck.date는 @db.Date 절삭이라 같은 날
    // 우회가 가능해 createdAt(실시각) 기준으로 판정한다(적대검증 필수 2).
    if (undo.trackedItemId) {
      const later = await prisma.stockCheck.findFirst({
        where: {
          trackedItemId: undo.trackedItemId,
          createdAt: { gt: new Date(undo.receivedAtMs) },
          OR: [{ sourceExpenseId: null }, { sourceExpenseId: { not: undo.receivedId } }],
        },
        select: { id: true },
      })
      if (later) return { ok: false, error: '수령 이후 재고 점검이 기록되어 되돌릴 수 없습니다. 잘못 수령했다면 재고 점검으로 잔량을 바로잡아 주세요.' }
    }
    await prisma.$transaction(async tx => {
      await tx.stockCheck.deleteMany({ where: { sourceExpenseId: undo.receivedId } })
      await tx.expense.delete({ where: { id: undo.receivedId } })
      // 기대값 포함 조건부 복원(CAS) — 가드 조회와 커밋 사이의 경합 봉합(적대검증 권고 4)
      const r = await tx.expense.updateMany({
        where: { id: undo.remainderId, propertyId, receivedAt: null, qtyValue: undo.expect.remainQty, amount: undo.expect.remainAmount },
        data: { qtyValue: undo.prev.qtyValue, amount: undo.prev.amount, detail: undo.prev.detail, allocationGroupId: undo.prev.allocationGroupId },
      })
      if (r.count !== 1) throw new Error('되돌리는 사이 잔여 지출이 변경되었습니다. 새로고침 후 다시 확인해 주세요.')
    })
    revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// 품목에 속한 수령 대기 구매 전체 확인 — **정본 confirmReceipt 를 건별로 태운다.**
//
// 종전에는 updateMany 로 receivedAt 만 찍었다. 자동 점검도, 배치 위치도, 재고 제외 필터도,
// 용량 누락 게이트도 없었다. 그 경로로 들어온 수령분은 다음 위치별 점검의 carryOver 에서 증발한다.
// 재고 제외 지출까지 수령 처리했다. UI 호출부는 없지만 서버 액션 엔드포인트는 살아 있었다
// (C페이즈 조사 2026-08-03). 지우는 대신 정본 경로로 재구현한다 — 죽은 코드로 두면 다음에 누가 쓴다.
export async function confirmAllPending(trackedItemId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId } })
    if (!item) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const pending = await prisma.expense.findMany({
      where: {
        propertyId,
        category: item.category,
        itemLabel: item.label,
        ...(item.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: item.qtyUnit }] } : {}),
        receivedAt: null,
        excludeFromInventory: false,   // 재고 제외 지출을 수령 처리하던 구멍
      },
      orderBy: { date: 'asc' },
      select: { id: true },
    })
    let count = 0
    for (const e of pending) {
      const r = await confirmReceipt(e.id)
      if (!r.ok) return { ok: false, error: `${count}건 처리 후 중단됐습니다. ${r.error}` }
      count++
    }
    revalidatePath('/inventory')
    return { ok: true, count }
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

// ── 타임라인 보정 끼워넣기용 — 특정 날짜 시점의 예상 재고(위치별) 계산.
//    직전(<=date) 점검 잔량 + 그 사이 입고(구매 receivedAt·무상)를 합쳐 추정. 허브에 증감 귀속.
export async function getStockAsOf(trackedItemId: string, dateStr: string): Promise<{
  total: number
  byLoc: { locationId: string; locationName: string; isHub: boolean; qty: number }[]
} | null> {
  const propertyId = await getPropertyId()
  const it = await prisma.trackedItem.findFirst({
    where: { id: trackedItemId, propertyId },
    select: { id: true, category: true, label: true, qtyUnit: true, specUnit: true, trackUnit: true, hubLocationId: true },
  })
  if (!it) return null
  const locs = await prisma.trackedItemLocation.findMany({
    where: { trackedItemId },
    include: { storageLocation: { select: { id: true, name: true, sortOrder: true, isHub: true } } },
    orderBy: { storageLocation: { sortOrder: 'asc' } },
  })
  const asOf = new Date(dateStr); asOf.setHours(23, 59, 59, 999)
  const useSpec = it.trackUnit !== 'qty' && !!(it.specUnit && it.specUnit.trim())

  const baseline = await prisma.stockCheck.findFirst({
    where: { trackedItemId, date: { lte: asOf } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { locationBreakdown: { select: { storageLocationId: true, remainingQty: true } } },
  })
  // 구매 경계는 **점검이 만들어진 시각**(createdAt)이다. 점검 날짜(자정)를 쓰면 그 점검이
  // 이미 반영한 같은 날 수령을 한 번 더 더한다. 정본은 overview.ts 의 currentStock 계산이고
  // 거기는 처음부터 createdAt 을 쓴다 — 이 함수만 규칙이 달랐다(C페이즈 조사 2026-08-03).
  //
  // 실측 — 종량제쓰레기봉투 50L 실제 21매인데 보정 폼이 31매를 미리 채웠고, 리클린 1.5L 가 3.5L 였다.
  // 그대로 저장하면 그 값이 새 기준선으로 박히고 차이가 소모로도 안 잡혀 오차가 장부에 영구 편입된다.
  //
  // 입수·폐기는 날짜(date)가 1차 기준이고 같은 날이면 입력 시각으로 가른다 — 아래에서 정본 함수로 넘긴다.
  const baseDate = baseline?.date ?? null
  const basePurchaseCutoff = baseline?.createdAt ?? null
  const baseTotal = baseline?.remainingQty ?? 0

  const purchases = await prisma.expense.findMany({
    where: {
      propertyId, category: it.category, itemLabel: it.label,
      // 느슨 매칭 — qtyUnit null/일치 모두 같은 품목(잔량 계산과 동일 규칙).
      ...(it.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] } : {}),
      receivedAt: { not: null, ...(basePurchaseCutoff ? { gt: basePurchaseCutoff } : {}), lte: asOf },
      excludeFromInventory: false,
    },
    select: { qtyValue: true, specValue: true, specUnit: true },
  })
  const purchaseTotal = purchases.reduce((s, p) => {
    const q = p.qtyValue ?? 0
    if (!useSpec) return s + q
    const spec = specMultiplier(p.specValue, p.specUnit, it.specUnit)
    return spec != null ? s + q * spec : s + q
  }, 0)
  // 입수·폐기 경계도 정본(overview.sumAdditions/sumDisposals)을 그대로 쓴다 — 규칙을 사본으로 적지 않는다.
  //
  // 종전에는 여기만 `date > baseDate` 라 **같은 날 점검보다 늦게 입력된 입수가 통째로 빠졌다.**
  // 정본은 날짜가 같으면 입력 시각(createdAt)으로 앞뒤를 가른다. 그래서 카드 잔량에는 있는 수량이
  // 보정 폼 프리필에는 없었고, 그 프리필을 그대로 저장하면 그 수량이 새 기준선에서 영구히 사라진다
  // (화면이 거짓을 보여주고 그 거짓을 고치면 데이터가 깨지는 구조 — knowledge/domain-inventory.md).
  // 폐기 등록의 잔량 초과 게이트도 같은 함수를 쓰므로 정당한 폐기를 거부하던 경계가 함께 풀린다.
  const [additionTotal, disposalTotal] = await Promise.all([
    sumAdditions(trackedItemId, baseDate, asOf, basePurchaseCutoff),
    sumDisposals(trackedItemId, baseDate, asOf, basePurchaseCutoff),
  ])
  const expectedTotal = baseTotal + purchaseTotal + additionTotal - disposalTotal

  const baseByLoc = new Map((baseline?.locationBreakdown ?? []).map(lb => [lb.storageLocationId, lb.remainingQty]))
  // 품목별 허브 — hubLocationId 가 있으면 그 위치, 없으면 영업장 기본 허브(폴백).
  const isItemHub = (locId: string, globalHub: boolean) => it.hubLocationId ? locId === it.hubLocationId : globalHub
  const hub = locs.find(l => isItemHub(l.storageLocation.id, l.storageLocation.isHub)) ?? locs[0]
  const sinceDelta = expectedTotal - baseTotal
  const byLoc = locs.map(l => {
    let qty = baseByLoc.get(l.storageLocation.id) ?? 0
    if (hub && l.storageLocation.id === hub.storageLocation.id) qty = Math.max(0, qty + sinceDelta)
    return { locationId: l.storageLocation.id, locationName: l.storageLocation.name, isHub: isItemHub(l.storageLocation.id, l.storageLocation.isHub), qty: Math.round(qty * 100) / 100 }
  })
  return { total: Math.round(expectedTotal * 100) / 100, byLoc }
}

// ── 품목별 창고(허브) 지정 — locationId=null 이면 영업장 기본 허브로 폴백.
export async function setItemHub(trackedItemId: string, locationId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId }, select: { id: true } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (locationId) {
      // 이 품목에 연결된 '열린' 위치만 허브로 지정 가능 — 숨긴 위치를 허브로 두면 보충 차감이
      // 잔량 0 인 숨긴 허브에서 0 클램프되어 총량이 부풀어난다(숨김 뒷문, Fable 검증 B2).
      const link = await prisma.trackedItemLocation.findFirst({ where: { trackedItemId, storageLocationId: locationId, closedAt: null } })
      if (!link) return { ok: false, error: '이 품목의 표시 중인 보관 위치에서만 창고를 지정할 수 있습니다.' }
    }
    await prisma.trackedItem.update({ where: { id: trackedItemId }, data: { hubLocationId: locationId } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// ── 위치 간 재고 이동·맞바꿈 (운영자 요청 2026-07-08) ─────────────────────────
// 허브 자동 차감(점검 폼)과 별개의 명시적 이동. 총량 불변 점검을 만들어 기록하므로
// 소모량 통계에 영향이 없다(§4 — 이동은 소모가 아님). 기존 점검·허브 UX 는 불변.

export type ItemLocationStock = { id: string; name: string; isHub: boolean; qty: number; closed: boolean }

// 품목의 위치별 현재 수량 — 직전 점검 breakdown + 이후 입수분(점검 base 계산과 동일 규칙)
async function currentLocationBreakdown(trackedItemId: string, propertyId: string, hubLocationId: string | null) {
  const lastCheck = await prisma.stockCheck.findFirst({
    where: { trackedItemId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { locationBreakdown: true },
  })
  const base = new Map<string, number>()
  for (const lb of lastCheck?.locationBreakdown ?? []) base.set(lb.storageLocationId, lb.remainingQty)
  const addMap = await additionsSinceCheckByLocation(trackedItemId, lastCheck, hubLocationId, propertyId)
  for (const [loc, q] of addMap) base.set(loc, (base.get(loc) ?? 0) + q)
  return base
}

// 이동/숨김 이관 점검의 StockCheck.create data — breakdown 전체(0 포함)를 담아 새 baseline 을 만든다.
// ⚠️ 부분 breakdown 을 만들면 total != byLoc 합 불변식이 깨진다. transferLocationStock·closeItemLocation 공유.
function transferCheckCreateData(trackedItemId: string, breakdown: Map<string, number>, memo: string) {
  const entries = [...breakdown.entries()]
  const total = entries.reduce((s, [, q]) => s + Math.max(0, q), 0)
  return {
    trackedItemId,
    date: new Date(),
    remainingQty: total,   // 총량 불변 — 소모량 계산에 이동이 잡히지 않음
    memo,
    locationBreakdown: { create: entries.map(([storageLocationId, q]) => ({ storageLocationId, remainingQty: Math.max(0, q) })) },
  }
}

export async function getItemLocationStock(trackedItemId: string): Promise<{ ok: true; locations: ItemLocationStock[] } | { ok: false; error: string }> {
  try {
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId }, select: { hubLocationId: true } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const [allLocs, breakdown, links] = await Promise.all([
      prisma.storageLocation.findMany({ where: { propertyId }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, isHub: true } }),
      currentLocationBreakdown(trackedItemId, propertyId, it.hubLocationId),
      prisma.trackedItemLocation.findMany({ where: { trackedItemId }, select: { storageLocationId: true, closedAt: true } }),
    ])
    // closed = 이 품목에서 숨긴 위치. 이동 모달에서 목적지 후보 제외에 쓴다(출발지는 재고 있으면 보여야 함).
    const closedIds = new Set(links.filter(l => l.closedAt != null).map(l => l.storageLocationId))
    return { ok: true, locations: allLocs.map(l => ({ ...l, qty: Math.max(0, breakdown.get(l.id) ?? 0), closed: closedIds.has(l.id) })) }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function transferLocationStock(data: {
  trackedItemId: string
  fromLocationId: string
  toLocationId: string
  qty?: number        // 미지정 = 전량 이동
  swap?: boolean      // true = 두 위치 수량을 통째로 맞바꿈(qty 무시)
}): Promise<{ ok: true; checkId: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    if (data.fromLocationId === data.toLocationId) return { ok: false, error: '같은 위치로는 옮길 수 없습니다.' }
    const locs = await prisma.storageLocation.findMany({ where: { propertyId, id: { in: [data.fromLocationId, data.toLocationId] } }, select: { id: true, name: true } })
    const fromLoc = locs.find(l => l.id === data.fromLocationId)
    const toLoc = locs.find(l => l.id === data.toLocationId)
    if (!fromLoc || !toLoc) return { ok: false, error: '위치를 찾을 수 없습니다.' }

    const breakdown = await currentLocationBreakdown(data.trackedItemId, propertyId, it.hubLocationId)
    const fromQty = Math.max(0, breakdown.get(data.fromLocationId) ?? 0)
    const toQty = Math.max(0, breakdown.get(data.toLocationId) ?? 0)

    let memo: string
    if (data.swap) {
      if (fromQty === 0 && toQty === 0) return { ok: false, error: '두 위치 모두 재고가 없습니다.' }
      breakdown.set(data.fromLocationId, toQty)
      breakdown.set(data.toLocationId, fromQty)
      memo = `맞바꿈: ${fromLoc.name} ↔ ${toLoc.name}`
    } else {
      const move = data.qty != null ? data.qty : fromQty
      if (!(move > 0)) return { ok: false, error: '옮길 수량을 입력해주세요.' }
      if (move > fromQty) return { ok: false, error: `${fromLoc.name}의 재고(${fromQty})보다 많이 옮길 수 없습니다.` }
      breakdown.set(data.fromLocationId, fromQty - move)
      breakdown.set(data.toLocationId, toQty + move)
      memo = `이동: ${fromLoc.name} → ${toLoc.name} ${move}`
    }

    // 이 이동이 재고를 넣는 위치는 전부 같은 트랜잭션에서 링크를 보장한다 — 종전엔 점검만 만들어,
    // 링크 없는 위치로 옮기면 그 수량이 위치별 화면(row.locations 필터)·보정 폼에서 통째로 안 보였다
    // (오류신고 601303c5, 김치 15kg). 이동 대상은 영업장 전체 위치(getItemLocationStock)라 미링크 선택이 정상 경로다.
    // ⚠️ 양쪽 모두 링크한다. 맞바꿈은 재고를 양쪽에 넣으므로 도착지만 링크하면
    //   '잔량 0 인 미링크 위치와 맞바꾸기'가 출발지에 새 orphan 을 만든다(fromQty 0 + toQty>0 이면 from 이 toQty 를 받음).
    //   일반 이동은 fromQty>0 이 강제되어 불변식상 출발지가 이미 링크돼 있으므로 no-op 이다.
    //   출발지 링크는 잔량 0 이 돼도 유지한다 — 0 도 breakdown 에 남겨 '어디서 빠졌는지'를 보존한다.
    //   비워진 위치를 떼는 것은 위치 닫기(2단계)의 일.
    // createMany+skipDuplicates = 단일 INSERT ON CONFLICT DO NOTHING — 동시 호출에도 안전(upsert 는 P2002 경합).
    const [, created] = await prisma.$transaction([
      prisma.trackedItemLocation.createMany({
        data: [
          { trackedItemId: data.trackedItemId, storageLocationId: data.toLocationId },
          { trackedItemId: data.trackedItemId, storageLocationId: data.fromLocationId },
        ],
        skipDuplicates: true,
      }),
      prisma.stockCheck.create({ data: transferCheckCreateData(data.trackedItemId, breakdown, memo) }),
    ])
    revalidatePath('/inventory')
    return { ok: true, checkId: created.id }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '이동에 실패했습니다.' }
  }
}

// ── 보관위치 숨김(2단계) ─────────────────────────────────────────────
// 품목별로 특정 위치를 화면에서 가린다. StorageLocation 은 영업장 공용이라 안 지운다 — closedAt 만 세운다.
// 표시 술어는 overview: closedAt != null 이고 현재 잔량 < 0.001. 재고가 들어오면 자동으로 다시 보인다.
export type CloseLocationUndo = {
  trackedItemId: string
  storageLocationId: string
  transferCheckId: string | null      // 이관 점검 id(잔량 0이면 null). 적용취소 시 이 점검을 지운다
  hubLocationIdBefore: string | null  // 승격 전 hubLocationId
  hubChanged: boolean
}

export async function closeItemLocation(data: {
  trackedItemId: string
  storageLocationId: string
  moveToLocationId?: string
}): Promise<{ ok: true; undo: CloseLocationUndo | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const item = await prisma.trackedItem.findFirst({ where: { id: data.trackedItemId, propertyId }, select: { id: true, hubLocationId: true } })
    if (!item) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const links = await prisma.trackedItemLocation.findMany({
      where: { trackedItemId: data.trackedItemId },
      include: { storageLocation: { select: { id: true, name: true, sortOrder: true, isHub: true } } },
      orderBy: { storageLocation: { sortOrder: 'asc' } },
    })
    const target = links.find(l => l.storageLocationId === data.storageLocationId)
    if (!target) return { ok: false, error: '이 품목의 보관 위치가 아닙니다.' }
    if (target.closedAt != null) return { ok: true, undo: null }   // 멱등 — 이미 숨김
    const openLinks = links.filter(l => l.closedAt == null)
    if (openLinks.length <= 1) return { ok: false, error: '마지막 남은 보관 위치는 숨길 수 없습니다.' }

    // 잔량 — (B) 계열. 잔량 있으면 옮길 위치 필수(증발 금지).
    const breakdown = await currentLocationBreakdown(data.trackedItemId, propertyId, item.hubLocationId)
    const qty = Math.max(0, breakdown.get(data.storageLocationId) ?? 0)
    let dest: (typeof links)[number] | undefined
    if (qty >= 0.001) {
      if (!data.moveToLocationId) return { ok: false, error: `${target.storageLocation.name}에 남은 재고가 있습니다. 옮길 위치를 선택해주세요.` }
      if (data.moveToLocationId === data.storageLocationId) return { ok: false, error: '같은 위치로는 옮길 수 없습니다.' }
      dest = links.find(l => l.storageLocationId === data.moveToLocationId && l.closedAt == null)
      if (!dest) return { ok: false, error: '옮길 위치를 찾을 수 없습니다.' }
    }

    // 실효 허브를 숨기면 승격 — hubLocationId 를 실제로 갱신(폴백에 기대지 않음, 3정의 일치 보장).
    const openIds = new Set(openLinks.map(l => l.storageLocationId))
    const effHub = await resolveItemHubLocationId(data.trackedItemId, item.hubLocationId, propertyId, openIds)
    const promote = effHub === data.storageLocationId
    let newHub: string | null = null
    if (promote) {
      const remainOpen = new Set(openLinks.filter(l => l.storageLocationId !== data.storageLocationId).map(l => l.storageLocationId))
      newHub = data.moveToLocationId ?? await resolveItemHubLocationId(data.trackedItemId, null, propertyId, remainOpen)
      if (!newHub) return { ok: false, error: '창고로 쓸 다른 위치가 없습니다.' }
    }

    // 이관 점검 — 잔량 있을 때만. breakdown 전체를 담아 새 baseline(from=0, to+=qty).
    let transferCheckId: string | null = null
    const ops: Prisma.PrismaPromise<unknown>[] = []
    if (qty >= 0.001 && dest) {
      breakdown.set(data.storageLocationId, 0)
      breakdown.set(data.moveToLocationId!, (breakdown.get(data.moveToLocationId!) ?? 0) + qty)
      const memo = `위치 숨김: ${target.storageLocation.name}에서 ${dest.storageLocation.name}로 ${qty} 이관`
      const check = await prisma.stockCheck.create({ data: transferCheckCreateData(data.trackedItemId, breakdown, memo), select: { id: true } })
      transferCheckId = check.id
    }
    ops.push(prisma.trackedItemLocation.update({
      where: { trackedItemId_storageLocationId: { trackedItemId: data.trackedItemId, storageLocationId: data.storageLocationId } },
      data: { closedAt: new Date() },
    }))
    if (promote && newHub) ops.push(prisma.trackedItem.update({ where: { id: data.trackedItemId }, data: { hubLocationId: newHub } }))
    await prisma.$transaction(ops)
    revalidatePath('/inventory')
    return { ok: true, undo: { trackedItemId: data.trackedItemId, storageLocationId: data.storageLocationId, transferCheckId, hubLocationIdBefore: item.hubLocationId, hubChanged: promote } }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '위치 숨김에 실패했습니다.' }
  }
}

// 다시 표시 — 나중에 이 위치를 다시 쓴다. 이관 점검은 유지(재고는 실제로 옮겨졌고 그게 사실).
export async function reopenItemLocation(trackedItemId: string, storageLocationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const item = await prisma.trackedItem.findFirst({ where: { id: trackedItemId, propertyId }, select: { id: true } })
    if (!item) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    await prisma.trackedItemLocation.updateMany({ where: { trackedItemId, storageLocationId }, data: { closedAt: null } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '다시 표시에 실패했습니다.' }
  }
}

// 숨김 적용취소 — 방금 한 숨김이 실수였다. 이관 점검을 지우고 허브를 원복한다(다시 표시와 다르다).
export async function undoCloseItemLocation(undo: CloseLocationUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const item = await prisma.trackedItem.findFirst({ where: { id: undo.trackedItemId, propertyId }, select: { id: true } })
    if (!item) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    // undo 페이로드는 클라이언트가 보내는 값 — 각 필드를 이 품목 스코프로 검증한다(Fable 검증 B1).
    // hubLocationIdBefore 는 null 이거나 이 품목의 링크여야 한다(조작 호출로 타 영업장 위치를 허브로 박는 것 방지).
    if (undo.hubChanged && undo.hubLocationIdBefore) {
      const link = await prisma.trackedItemLocation.findFirst({ where: { trackedItemId: undo.trackedItemId, storageLocationId: undo.hubLocationIdBefore } })
      if (!link) return { ok: false, error: '적용취소 정보가 유효하지 않습니다.' }
    }
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.trackedItemLocation.updateMany({ where: { trackedItemId: undo.trackedItemId, storageLocationId: undo.storageLocationId }, data: { closedAt: null } }),
    ]
    // deleteMany — 운영자가 그 사이 타임라인에서 이관 점검을 직접 지웠어도 통과(delete 는 P2025 로 전체 롤백).
    // trackedItemId 조건 = 소유 검증(위에서 품목이 이 영업장 것임을 확인했으므로 임의 점검 id 삭제 불가).
    if (undo.transferCheckId) ops.push(prisma.stockCheck.deleteMany({ where: { id: undo.transferCheckId, trackedItemId: undo.trackedItemId } }))
    if (undo.hubChanged) ops.push(prisma.trackedItem.update({ where: { id: undo.trackedItemId }, data: { hubLocationId: undo.hubLocationIdBefore } }))
    await prisma.$transaction(ops)
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '적용취소에 실패했습니다.' }
  }
}

// ── 기록 없는 품목 진짜 삭제 — 카테고리 착오 등으로 자동 생성된 품목의 되돌리기(신고 f3454e4c).
//    지출·점검·입수 기록이 하나라도 있으면 거부(그 경우 '숨기기'). v2.0 §16 되돌리기 원칙.
export async function deleteTrackedItemIfEmpty(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const it = await prisma.trackedItem.findFirst({ where: { id, propertyId } })
    if (!it) return { ok: false, error: '품목을 찾을 수 없습니다.' }
    const [expCount, checkCount, addCount, dispCount] = await Promise.all([
      prisma.expense.count({ where: { propertyId, category: it.category, itemLabel: it.label } }),
      prisma.stockCheck.count({ where: { trackedItemId: id } }),
      prisma.stockAddition.count({ where: { trackedItemId: id } }),
      prisma.stockDisposal.count({ where: { trackedItemId: id } }),
    ])
    if (expCount + checkCount + addCount + dispCount > 0) {
      return { ok: false, error: `기록이 있어 삭제할 수 없습니다 (지출 ${expCount}·점검 ${checkCount}·입수 ${addCount}·폐기 ${dispCount}건). 대신 '숨김'을 사용하세요.` }
    }
    await prisma.trackedItem.delete({ where: { id } })
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// ── 지출 카테고리 수정 → 재고 품목 카테고리 동기화(운영자 확인 후 호출, 2026-07-10)
//    같은 라벨 품목이 대상 카테고리에 이미 있으면 꼬임 방지를 위해 거부(병합은 재고 관리에서).
//    대상이 비추적 카테고리(수선유지비 등)면 카드를 옮기지 않는다 — 옮기면 소모품 화면에 좀비 카드로 남고
//    비품·자재 화면과 이중 표시된다(서빙집게·집게보관통·의자 사건, 운영자 승인 2026-07-22).
//    이 경우 재고 기록 없으면 카드 삭제, 있으면 숨김(isArchived) 처리하고 결과를 알린다.
export async function syncTrackedItemCategory(label: string, fromCategory: string, toCategory: string): Promise<{ ok: true; moved: boolean; retired?: 'deleted' | 'archived' } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!label.trim() || fromCategory === toCategory) return { ok: true, moved: false }
    const item = await prisma.trackedItem.findFirst({ where: { propertyId, label, category: fromCategory } })
    if (!item) return { ok: true, moved: false }

    const trackedCats = await getTrackedCategories(propertyId)
    if (!trackedCats.includes(toCategory)) {
      // 비추적행 — 재고 카드는 정리하고, 물건 자체는 비품·자재 화면(지출 기반)이 이어받는다.
      const [checkCount, addCount, dispCount] = await Promise.all([
        prisma.stockCheck.count({ where: { trackedItemId: item.id } }),
        prisma.stockAddition.count({ where: { trackedItemId: item.id } }),
        prisma.stockDisposal.count({ where: { trackedItemId: item.id } }),
      ])
      if (checkCount + addCount + dispCount === 0) {
        await prisma.trackedItem.delete({ where: { id: item.id } })
        revalidatePath('/inventory'); revalidatePath('/finance')
        return { ok: true, moved: false, retired: 'deleted' }
      }
      await prisma.trackedItem.update({ where: { id: item.id }, data: { isArchived: true } })
      revalidatePath('/inventory'); revalidatePath('/finance')
      return { ok: true, moved: false, retired: 'archived' }
    }

    const clash = await prisma.trackedItem.findFirst({ where: { propertyId, label, category: toCategory }, select: { id: true } })
    if (clash) return { ok: false, error: `'${toCategory}'에 같은 이름의 품목이 이미 있습니다. 재고 관리에서 병합해 주세요.` }
    await prisma.trackedItem.update({ where: { id: item.id }, data: { category: toCategory } })
    revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true, moved: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '동기화에 실패했습니다.' }
  }
}


// 수령 확인 적용취소 — 이 지출로 생성된 자동 점검을 지우고 수령 대기로 복귀(감사 백로그 2026-07-10)
// 수령 취소 적용취소 토큰 — 취소가 지운 자동 점검 스냅샷 + 함께 옮긴 조정. §16.
export type ReceiptCancelUndo = {
  expenseId: string
  receivedAtMs: number
  receivedLocationId: string | null
  autoChecks: {
    id: string; trackedItemId: string; dateMs: number; createdAtMs: number
    remainingQty: number; memo: string | null; isReconcile: boolean
    locations: { storageLocationId: string; remainingQty: number; restockedQty: number | null }[]
  }[]
  shift: LedgerShiftUndo | null
}

// 수령 취소 핵심 — undoConfirmReceipt(수령 취소 버튼)와 updateExpenseFromInventory(수령일 비움)가
// 같은 가드·같은 조정을 타야 한다. 한쪽만 막으면 다른 쪽이 뒷문이 된다(클래스 봉합).
//
// adjustFollowing — 수령 이후 점검이 이 수령분을 절대값에 삼킨 경우(구식 수령 288건 포함),
// 그 점검들에서 수령분을 함께 빼고 취소한다. 미지정이면 종전 가드 그대로 거부.
async function cancelReceiptCore(
  expenseId: string, propertyId: string, opts?: { adjustFollowing?: boolean },
): Promise<{ ok: true; undo?: ReceiptCancelUndo } | { ok: false; error: string }> {
  const exp = await prisma.expense.findFirst({
    where: { id: expenseId, propertyId },
    select: {
      id: true, category: true, itemLabel: true, qtyUnit: true, qtyValue: true,
      specValue: true, specUnit: true, receivedAt: true, receivedLocationId: true,
      excludeFromInventory: true,
    },
  })
  if (!exp) return { ok: false, error: '지출을 찾을 수 없습니다.' }
  if (!exp.receivedAt) return { ok: true }
  // 자동 점검 이후 다른 점검이 있으면 거부 — 이후 점검이 수령분을 실측에 이미 반영했으므로
  // 자동 점검만 지우면 이중 계상된다. date는 @db.Date 절삭이라 createdAt 기준(undoPartialReceipt와 동일 규칙).
  const autoChecks = await prisma.stockCheck.findMany({
    where: { sourceExpenseId: expenseId },
    include: { locationBreakdown: { select: { storageLocationId: true, remainingQty: true, restockedQty: true } } },
  })
  // 자동 점검 안에 **운영자 실측이 머지된** 경우를 먼저 막는다(C페이즈 조사 2026-08-03).
  //
  // 위치별 점검 패널은 6시간 안 같은 날이면 마지막 점검에 합친다. 그 마지막 점검이 자동 수령 점검이면
  // 운영자가 직접 센 값이 그 행 안으로 들어간다. 그 상태에서 수령 취소를 누르면 아래 deleteMany 가
  // 행을 통째로 지워 **실측이 함께 사라진다.** '이후 점검' 가드는 같은 행이라 트립하지 않는다.
  // 실측 2건이 이미 그 상태다(주방세제·김치 2026-07-14).
  // 판정 신호는 보충 실측(restockedQty)이다. StockCheck 에는 updatedAt 이 없어 수정 시각으로는 못 가른다.
  const merged = autoChecks.find(c => c.locationBreakdown.some(lb => (lb.restockedQty ?? 0) > 0))
  if (merged) {
    return { ok: false, error: '이 수령 기록에 직접 센 재고 점검이 함께 저장되어 있습니다. 되돌리면 그 실측까지 사라지므로 막았습니다. 재고 점검으로 잔량을 바로잡아 주세요.' }
  }
  const it = exp.excludeFromInventory ? null : await matchedTrackedItemForExpense(propertyId, exp)
  let rows: ShiftRow[] = []
  if (opts?.adjustFollowing) {
    // 함께 조정 — 이 수령분을 절대값에 담고 있는 점검(자동 점검 제외)에서 수령분을 뺀다.
    if (it) {
      const qty = convertedPurchaseQty(it, exp)
      const plan = qty > 0
        ? await buildPurchaseShiftPlan(it, propertyId,
            { receivedAtMs: exp.receivedAt.getTime(), qty, storageLocationId: exp.receivedLocationId },
            null, autoChecks.map(c => c.id))
        : { ok: true as const, rows: [] as ShiftRow[] }
      if (!plan.ok) return { ok: false, error: plan.error }
      rows = plan.rows
    }
  } else if (autoChecks.length > 0) {
    const later = await prisma.stockCheck.findFirst({
      where: {
        trackedItemId: { in: [...new Set(autoChecks.map(c => c.trackedItemId))] },
        createdAt: { gt: new Date(Math.max(...autoChecks.map(c => c.createdAt.getTime()))) },
        OR: [{ sourceExpenseId: null }, { sourceExpenseId: { not: expenseId } }],
      },
      select: { id: true },
    })
    if (later) return { ok: false, error: '수령 이후 재고 점검이 기록되어 되돌릴 수 없습니다. 잘못 수령했다면 재고 점검으로 잔량을 바로잡아 주세요.' }
  } else if (it) {
    // 자동 점검이 없는 구식 수령(2026-06 이전 경로 등) — 이 수령분을 삼킨 점검이 있으면
    // 종전에는 아무 가드 없이 receivedAt 만 지워져, 재수령 시 그 수량이 이중 가산됐다(뒷문 봉합).
    // 계획 실패(음수·귀속 불가)도 반영 점검이 있다는 뜻이므로 같이 거부한다.
    const qty = convertedPurchaseQty(it, exp)
    if (qty > 0) {
      const plan = await buildPurchaseShiftPlan(it, propertyId,
        { receivedAtMs: exp.receivedAt.getTime(), qty, storageLocationId: exp.receivedLocationId }, null)
      if (!plan.ok || plan.rows.length > 0) {
        return { ok: false, error: '수령 이후 재고 점검이 이 수령분을 이미 반영했습니다. 함께 조정해 취소하거나, 재고 점검으로 잔량을 바로잡아 주세요.' }
      }
    }
  }
  const undo: ReceiptCancelUndo = {
    expenseId,
    receivedAtMs: exp.receivedAt.getTime(),
    receivedLocationId: exp.receivedLocationId,
    autoChecks: autoChecks.map(c => ({
      id: c.id, trackedItemId: c.trackedItemId, dateMs: c.date.getTime(), createdAtMs: c.createdAt.getTime(),
      remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile,
      locations: c.locationBreakdown.map(lb => ({
        storageLocationId: lb.storageLocationId, remainingQty: lb.remainingQty, restockedQty: lb.restockedQty,
      })),
    })),
    shift: null,
  }
  await prisma.$transaction(async tx => {
    if (rows.length > 0 && it) undo.shift = await applyShiftRows(tx, it.id, rows)
    await tx.stockCheck.deleteMany({ where: { sourceExpenseId: expenseId } })
    await tx.expense.update({ where: { id: expenseId }, data: { receivedAt: null, receivedLocationId: null } })
  })
  return { ok: true, undo }
}

export async function undoConfirmReceipt(
  expenseId: string, opts?: { adjustFollowing?: boolean },
): Promise<{ ok: true; undo?: ReceiptCancelUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const r = await cancelReceiptCore(expenseId, propertyId, opts)
    if (!r.ok) return r
    revalidatePath('/inventory'); revalidatePath('/finance')
    return r
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// 수령 취소 적용취소 — 자동 점검을 원형(입력 시각 포함)으로 재생성하고 조정을 스냅샷으로 되돌린다.
// createdAt 을 살리지 않으면 구매 반영 경계(receivedAt > 점검.createdAt)가 조용히 달라진다.
export async function undoCancelReceipt(undo: ReceiptCancelUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const exp = await prisma.expense.findFirst({ where: { id: undo.expenseId, propertyId }, select: { id: true, receivedAt: true } })
    if (!exp) return { ok: false, error: '지출을 찾을 수 없습니다.' }
    if (exp.receivedAt) return { ok: true }   // 멱등 — 이미 복원됨(또는 재수령됨)
    // 페이로드는 클라이언트발 — 점검 스냅샷의 품목이 이 영업장 소속인지 검증(B1 선례).
    const itemIds = [...new Set(undo.autoChecks.map(c => c.trackedItemId))]
    if (itemIds.length > 0) {
      const owned = await prisma.trackedItem.count({ where: { id: { in: itemIds }, propertyId } })
      if (owned !== itemIds.length) return { ok: false, error: '다른 영업장의 기록입니다.' }
    }
    await prisma.$transaction(async tx => {
      await tx.expense.update({
        where: { id: undo.expenseId },
        data: { receivedAt: new Date(undo.receivedAtMs), receivedLocationId: undo.receivedLocationId },
      })
      for (const c of undo.autoChecks) {
        const exists = await tx.stockCheck.findUnique({ where: { id: c.id }, select: { id: true } })
        if (exists) continue
        await tx.stockCheck.create({
          data: {
            id: c.id, trackedItemId: c.trackedItemId, date: new Date(c.dateMs), createdAt: new Date(c.createdAtMs),
            remainingQty: c.remainingQty, memo: c.memo, isReconcile: c.isReconcile, sourceExpenseId: undo.expenseId,
            ...(c.locations.length > 0 ? {
              locationBreakdown: {
                create: c.locations.map(lb => ({
                  storageLocationId: lb.storageLocationId, remainingQty: lb.remainingQty, restockedQty: lb.restockedQty,
                })),
              },
            } : {}),
          },
        })
      }
      if (undo.shift) await revertShiftRows(tx, undo.shift)
    })
    revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}

// 추적 카테고리 목록(설정 기반) — 클라이언트 하드코딩 대체용(상용화 감사 A2, 2026-07-10)
export async function getTrackedCategoriesForClient(): Promise<string[]> {
  const propertyId = await getPropertyId()
  return getTrackedCategories(propertyId)
}


// 재고 카드에 못 붙은 채 대기 중인 구매 — 읽기 전용.
//
// 지출 저장은 새 품명이면 재고 카드를 자동 생성하는데, 비슷한 이름의 카드가 이미 있으면
// **사용자 확인 대기로 보류**한다. 그런데 그 보류 결정을 받아 보여주는 화면이 2026-07-09 커밋
// c8fa34a 이후로 하나도 없었다. 그 커밋이 '과거 지출 일괄 불러오기' 버튼을 걷으면서
// setMergeDecisions 호출을 같이 지웠고, 대체된 자동 경로는 반환값을 통째로 버린다.
//
// 그 결과 종량제쓰레기봉투 20매 25,000원 구매가 저장은 됐는데 재고 축에는 존재하지 않는 상태로
// 떨어졌고, 운영자가 어떤 화면에서도 되살릴 수 없었다(신고 78ff0e64).
// 봉투류는 정규화가 크기 표기를 지워서 구조적으로 100% 이 함정에 걸린다.
export async function getPendingMergeDecisions(): Promise<MergeDecision[]> {
  const res = await seedTrackedItemsFromExpenses(undefined, { dryRun: true })
  return res.ok ? res.decisions : []
}
