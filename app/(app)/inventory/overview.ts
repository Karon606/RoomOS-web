// 재고 개요 계산 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
// getInventoryOverview(쿠키 기반)와 Cron(스케줄러) 양쪽에서 재사용.
import prisma from '@/lib/prisma'
import { type InventoryRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry } from './constants'
import { getTrackedCategories } from './categoryConfig'

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
  const trackedCats = await getTrackedCategories(propertyId)
  const items = await prisma.trackedItem.findMany({
    where: { propertyId, isArchived: false },
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
    include: {
      // 같은 날 여러 번 점검한 경우 dedup 을 위해 take 를 늘려 가져온다 (가장 늦은 점검만 유효).
      // dedup 후 last/prev 추출 — 라면 5/12 같이 같은 날 두 번 점검이 큰 사용량 jump 로
      // 잘못 인식되던 문제 fix (사용자 피드백 2026-06-01).
      stockChecks: {
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        include: {
          locationBreakdown: {
            include: { storageLocation: { select: { id: true, name: true } } },
            orderBy: { storageLocation: { sortOrder: 'asc' } },
          },
        },
      },
    },
  })

  // 같은 날 여러 점검 dedup — 가장 늦은 createdAt 만 유효한 점검으로 간주.
  // 사용자가 같은 날 임시 점검 후 확정 점검을 다시 하는 패턴 + 그 사이 큰 잔량 jump 가
  // 가짜 소모로 누적되던 문제 (라면 187 / 쌀 159) 해결.
  function dedupSameDay<T extends { date: Date; createdAt: Date }>(arr: T[]): T[] {
    const map = new Map<string, T>()
    for (const c of arr) {
      const day = `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}-${c.date.getUTCDate()}`
      const existing = map.get(day)
      if (!existing || c.createdAt > existing.createdAt) map.set(day, c)
    }
    return Array.from(map.values()).sort((a, b) =>
      a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
    )
  }

  // 점검의 '실제 발생 시각' — 입고/구매 구간 귀속 기준. 타임라인 정렬과 동일 규칙.
  //  · 입력 당일(KST) 점검이면 createdAt(실제 점검 시각), 과거 보정 입력(백필)이면 date.
  // 이유: 수령 즉시 자동 생성되는 점검(sourceExpenseId)은 그 구매를 이미 잔량에 반영한다.
  //  구매를 점검 date(자정) 기준으로 귀속하면, 같은 날 자동점검이 baseline 인데도 구매가
  //  '그 다음 구간'에 입고로 또 더해져 사용량이 부풀려졌음 (수세미: 사서 분산만 했는데 10 소모로 둔갑).
  //  effTime 기준으로 비교하면 수령 시각과 같은(또는 이전) 점검 baseline 에 흡수되어 중복 안 됨.
  const KST = 9 * 3600000
  const kstDay = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10)
  // 백필(나중 입력) 점검 — 그 날짜의 KST 자정 + 입력시각(createdAt)의 하루중 경과시간.
  //   타임라인 표시 정렬(actions.ts getInventoryItemDetail)과 동일 규칙으로 통일(2026-06-09).
  //   같은 날 입력 점검(자동수령 등)은 createdAt 그대로 → 기존 보호 로직(중복 입고 방지) 영향 없음.
  const kstMidnightMs = (d: Date) => Math.floor((d.getTime() + KST) / 86400000) * 86400000 - KST
  const kstTodMs = (d: Date) => (d.getTime() + KST) % 86400000
  const effTime = (c: { date: Date; createdAt: Date }): Date =>
    kstDay(c.createdAt) === kstDay(c.date)
      ? c.createdAt
      : new Date(kstMidnightMs(c.date) + kstTodMs(c.createdAt))

  // 월별 사용량 계산용 — 최근 7개월(현재 포함) 의 모든 점검 기록 일괄 fetch.
  // 연속 두 점검 사이의 소모량을 늦은 쪽 월에 귀속 (단순화).
  const monthsAgo7 = new Date()
  monthsAgo7.setMonth(monthsAgo7.getMonth() - 7)
  monthsAgo7.setDate(1); monthsAgo7.setHours(0, 0, 0, 0)
  const allChecksForUsage = await prisma.stockCheck.findMany({
    where: { trackedItemId: { in: items.map(i => i.id) }, date: { gte: monthsAgo7 } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, trackedItemId: true, date: true, createdAt: true, remainingQty: true, isReconcile: true },
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
      category: { in: trackedCats },
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
    // 같은 날 dedup 후 가장 최신 / 그 직전 점검 추출
    const dedupedRecentChecks = dedupSameDay([...it.stockChecks]).reverse()  // 최신 우선
    const last = dedupedRecentChecks[0] ?? null
    const prev = dedupedRecentChecks[1] ?? null
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
    if (last && prev && last.isReconcile) {
      // 최근 점검이 전체 보정이면 그 구간 차이는 소모가 아니므로 평균 소모율 추정 제외.
    } else if (last && prev) {
      // 소모량: 두 점검 사이(점검 날짜 기준)에 입고된 구매만 가산.
      // ⚠️ 입고 구간을 createdAt(입력 시각) 이 아닌 date(점검 실제 날짜) 로 잡는다.
      //   사용자가 과거 점검을 나중에 보정 입력하면 createdAt 이 며칠~몇 주 뒤로 밀려,
      //   createdAt 기준 구간이 인접 구간과 겹쳐 같은 구매를 두 번(또는 엉뚱한 달에) 세는
      //   버그가 있었음 (2026-06-01 사용자 보고). additions 와 동일하게 date 기준으로 통일.
      const purchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, effTime(prev), effTime(last), useSpec)
      const additions = await sumAdditions(it.id, effTime(prev), effTime(last))
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

    // 월별 사용량 — 최근 6개월. 연속 점검 사이 소모량을 늦은 쪽 월에 귀속.
    // 6개월 슬롯 미리 생성(0 으로) → 실제 데이터 있는 월만 덮어쓰기 → UI 가 막대 그릴 때 빈 월도 표시.
    const monthlyMap: Record<string, number> = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthlyMap[key] = 0
    }
    // 같은 날 dedup — 같은 날 두 점검 사이의 큰 잔량 jump 가 가짜 소모로 누적되던 문제 fix.
    const itemChecks = dedupSameDay(allChecksForUsage.filter(c => c.trackedItemId === it.id))
    // ⚠️ 구간별 consumed 를 '음수면 건너뛰기' 하지 않고 부호 그대로 월별 합산(telescoping).
    //   입고(구매 receivedAt / 무상입수)로 재고가 점프한 구간은 음수(−)가 되는데, 그 입고분이
    //   타이밍 차로 인접 구간에 +로 더해짐. 음수 구간을 건너뛰면 입고분이 상쇄되지 않아
    //   '입고 = 가짜 사용량' 으로 부풀려졌음 (예: 주방세제 5월 6270→9740, 라면 입고 160 이 165 소모로 둔갑).
    //   부호 그대로 합산하면 같은 입고의 +/− 가 같은 달 안에서 상쇄되어 물리적 정답(시작잔량+입고−월말잔량)에 수렴.
    //   부수효과: 백필된 잘못된 점검값도 인접 두 구간에서 +/− 로 상쇄되어 면역 (2026-06-01 사용자 보고).
    for (let i = 1; i < itemChecks.length; i++) {
      const prev = itemChecks[i - 1]
      const curr = itemChecks[i]
      // 전체 재고 보정 점검은 '실측 리셋' — 직전 구간의 차이(분실·오차)를 소모량으로 잡지 않는다.
      // curr 는 다음 구간의 기준선(prev)으로는 그대로 쓰임.
      if (curr.isReconcile) continue
      // 입고 구간은 effTime(실제 발생 시각) 기준 — 수령 즉시 생성된 자동점검이 baseline 일 때
      // 그 구매가 다음 구간에 중복 입고로 더해지는 것을 방지(수세미 케이스).
      const purchases = await sumPurchases(propertyId, it.category, it.label, it.qtyUnit, effTime(prev), effTime(curr), useSpec)
      const additions = await sumAdditions(it.id, effTime(prev), effTime(curr))
      const consumed = (prev.remainingQty + purchases + additions) - curr.remainingQty
      const key = `${curr.date.getFullYear()}-${String(curr.date.getMonth() + 1).padStart(2, '0')}`
      if (key in monthlyMap) monthlyMap[key] += consumed
    }
    // 월 단위 음수(그 달 입고가 사용량보다 많아 순증한 경우)는 사용량 0 으로 클램프 — '사용량' 은 음수일 수 없음.
    const monthlyConsumption = Object.entries(monthlyMap).map(([month, qty]) => ({ month, qty: qty > 0 ? qty : 0 }))

    // isHub 는 '이 품목의 허브' — hubLocationId 가 있으면 그 위치, 없으면 영업장 기본 허브(폴백).
    const locations: StorageLocationItem[] = allItemLocations
      .filter(l => l.trackedItemId === it.id)
      .map(l => ({ id: l.storageLocation.id, name: l.storageLocation.name, sortOrder: l.storageLocation.sortOrder, isHub: it.hubLocationId ? l.storageLocation.id === it.hubLocationId : l.storageLocation.isHub }))
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
      purchaseUrl: it.purchaseUrl,
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
      monthlyConsumption,
    })
  }
  return rows
}
