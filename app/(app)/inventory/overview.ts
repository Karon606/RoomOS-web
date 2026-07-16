// 재고 개요 계산 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
// getInventoryOverview(쿠키 기반)와 Cron(스케줄러) 양쪽에서 재사용.
import prisma from '@/lib/prisma'
import { type InventoryRow, type PendingPurchase, type StorageLocationItem, type LocationQtyEntry } from './constants'
import { getTrackedCategories } from './categoryConfig'
import { convertSpecValue } from '@/lib/units'

// ── 카테고리·라벨 매칭으로 구매량 합계
// useSpecBase=true 면 qtyValue × specValue (kg, 매 같은 규격 단위) 로 환산
//   itemUnit(품목 규격 단위)이 주어지면, 각 영수증의 specUnit 을 품목 단위로 환산해서 합산한다.
//   (예: 품목 ml 인데 영수증이 L 이면 1L=1000ml. 단위 비었거나 호환 안 되면 원값 유지 → 회귀 0)
//
// 재고 반입 시점은 구매일(date)이 아닌 승인일(receivedAt)을 기준으로 한다.
// → 구매는 과거에 했어도 승인(수령 확인)한 날짜가 실질적 재고 증가 시점이기 때문.
// → afterReceivedAt: 이 시점 이후에 승인된 구매만 (gt). beforeReceivedAt: 이 시점 이전 (lte).
async function sumPurchases(
  propertyId: string, category: string, label: string, qtyUnit: string | null,
  afterReceivedAt: Date | null,
  beforeReceivedAt: Date | null,
  useSpecBase: boolean,
  itemUnit: string | null = null,
): Promise<number> {
  const conditions: any[] = [
    { propertyId },
    { category },
    { itemLabel: label },
    { receivedAt: { not: null } },
    { excludeFromInventory: false },
    // qtyUnit 은 품목 식별자가 아니다 — TrackedItem 은 (propertyId, category, label) 로 유일하다.
    // null 이거나 같으면 같은 품목으로 본다(수령확정 confirmAllPending·수령대기 표시와 동일한 느슨 매칭).
    // 단위 미입력(null) 수령분이 잔량에서 통째로 누락되던 버그(라면·물티슈·키친타월) 방지.
    ...(qtyUnit ? [{ OR: [{ qtyUnit: null }, { qtyUnit }] }] : []),
    ...(afterReceivedAt  ? [{ receivedAt: { gt:  afterReceivedAt  } }] : []),
    ...(beforeReceivedAt ? [{ receivedAt: { lte: beforeReceivedAt } }] : []),
  ]

  const where = { AND: conditions }

  if (!useSpecBase) {
    const r = await prisma.expense.aggregate({ where, _sum: { qtyValue: true } })
    return r._sum.qtyValue ?? 0
  }
  // 규격 환산: qtyValue × specValue. specValue 없으면 qtyValue 그대로.
  //   specUnit≠품목단위면 품목 단위로 환산(L→ml 등).
  const rows = await prisma.expense.findMany({ where, select: { qtyValue: true, specValue: true, specUnit: true } })
  return rows.reduce((s, r) => {
    const q = r.qtyValue ?? 0
    if (!(r.specValue && r.specValue > 0)) return s + q
    const spec = convertSpecValue(r.specValue, r.specUnit, itemUnit) ?? r.specValue
    return s + q * spec
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

// 폐기 합(유출) — sumAdditions와 동일한 date·createdAt 경계 규칙(오류신고 a1e048e8).
// 소모 = (기준잔량 + 유입 − 폐기) − 실측잔량 으로, 폐기가 소모·소진임박 예측에서 분리된다.
async function sumDisposals(
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
  const r = await prisma.stockDisposal.aggregate({ where: { AND: conditions }, _sum: { disposedQty: true } })
  return r._sum.disposedQty ?? 0
}

// ── 추적 품목 목록 + 계산된 지표
export async function computeInventoryOverview(propertyId: string): Promise<InventoryRow[]> {
  // 서로 독립 조회 — 동시 실행(계산·값 불변, 왕복 직렬만 제거)
  const [trackedCats, items] = await Promise.all([
    getTrackedCategories(propertyId),
    prisma.trackedItem.findMany({
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
    }),
  ])

  // 같은 날 여러 점검 dedup — 가장 늦은 createdAt 만 유효한 점검으로 간주.
  // 사용자가 같은 날 임시 점검 후 확정 점검을 다시 하는 패턴 + 그 사이 큰 잔량 jump 가
  // 가짜 소모로 누적되던 문제 (라면 187 / 쌀 159) 해결.
  function dedupSameDay<T extends { date: Date; createdAt: Date; isReconcile?: boolean }>(arr: T[]): T[] {
    const map = new Map<string, T>()
    for (const c of arr) {
      const day = `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}-${c.date.getUTCDate()}`
      const existing = map.get(day)
      if (!existing) { map.set(day, c); continue }
      const winner = c.createdAt > existing.createdAt ? c : existing
      // 같은 날에 '전체 보정'이 있었으면 살아남는 점검도 보정으로 취급 —
      // 보정 후 같은 날 일반/자동수령 점검이 생기면 보정이 통째로 무효화되어
      // 직전 구간의 분실·오차가 가짜 소모로 잡히던 문제 방지.
      const hadReconcile = !!existing.isReconcile || !!c.isReconcile
      map.set(day, hadReconcile && !winner.isReconcile ? { ...winner, isReconcile: true } : winner)
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
  const [allChecksForUsage, allItemLocations, allPending] = await Promise.all([
    prisma.stockCheck.findMany({
      where: { trackedItemId: { in: items.map(i => i.id) }, date: { gte: monthsAgo7 } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, trackedItemId: true, date: true, createdAt: true, remainingQty: true, isReconcile: true },
    }),
    // 위치 정보 일괄 조회 — 루프 내 N+1 방지
    prisma.trackedItemLocation.findMany({
      where: { trackedItemId: { in: items.map(i => i.id) } },
      include: { storageLocation: { select: { id: true, name: true, sortOrder: true, isHub: true } } },
    }),
    // 수령 대기 구매 일괄 조회 — 루프 내 N+1 방지.
    // qtyValue 조건 없음 — 수량 미입력 구매도 수령 대기로 노출(알림 쿼리와 동일 기준).
    // 수량은 소모량·단가 수학에만 필수, 수령 확인 자체엔 불필요 (세탁조크리너 케이스).
    prisma.expense.findMany({
      where: {
        propertyId,
        category: { in: trackedCats },
        itemLabel: { not: null },
        receivedAt: null,
        excludeFromInventory: false,
      },
      select: { id: true, date: true, qtyValue: true, specValue: true, specUnit: true, qtyUnit: true, itemLabel: true, category: true, amount: true, vendor: true, memo: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  // 규격 자동 반영(§4 — 비었을 때만, 덮어쓰지 않음): trackUnit≠'qty'인데 품목 규격(specUnit)이
  // 비어 있으면, 같은 품목의 '규격 있는 구매'에서 specUnit을 가져와 채운다. 라면 40개입×3박스가
  // 품목 규격 미설정으로 3(박스)으로 잡히던 문제 → 규격을 반영하면 qtyValue×specValue로 환산됨.
  await Promise.all(items.map(async it => {
    if (it.trackUnit === 'qty' || (it.specUnit && it.specUnit.trim())) return
    const withSpec = await prisma.expense.findFirst({
      where: { propertyId, category: it.category, itemLabel: it.label, specUnit: { not: null }, specValue: { not: null, gt: 0 }, excludeFromInventory: false },
      orderBy: { date: 'desc' },
      select: { specUnit: true },
    })
    if (withSpec?.specUnit) {
      await prisma.trackedItem.update({ where: { id: it.id }, data: { specUnit: withSpec.specUnit } })
      it.specUnit = withSpec.specUnit   // 이번 계산에도 즉시 반영
    }
  }))

  // 품목별 계산 병렬화 — 품목 간 공유 상태 없음(각자 자기 행만 만들어 반환), 순서는 map이 보존.
  const rows: InventoryRow[] = await Promise.all(items.map(async (it): Promise<InventoryRow> => {
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
      const [incomingPurchases, incomingAdditions, incomingDisposals] = await Promise.all([
        sumPurchases(propertyId, it.category, it.label, it.qtyUnit, last.createdAt, null, useSpec, it.specUnit),
        sumAdditions(it.id, last.date, today, last.createdAt),
        sumDisposals(it.id, last.date, today, last.createdAt),
      ])
      currentStock = last.remainingQty + incomingPurchases + incomingAdditions - incomingDisposals
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
      const [purchases, additions, disposals] = await Promise.all([
        sumPurchases(propertyId, it.category, it.label, it.qtyUnit, effTime(prev), effTime(last), useSpec, it.specUnit),
        sumAdditions(it.id, effTime(prev), effTime(last)),
        sumDisposals(it.id, effTime(prev), effTime(last)),
      ])
      lastPeriodConsumption = (prev.remainingQty + purchases + additions - disposals) - last.remainingQty
      lastPeriodDays = Math.max(1, Math.round((last.date.getTime() - prev.date.getTime()) / 86400000))
    } else if (last && !prev) {
      // 점검 1회만 있는 경우: 최초 승인 구매일을 기준점으로 소모량 추정
      const firstPurchase = await prisma.expense.findFirst({
        where: {
          propertyId, category: it.category, itemLabel: it.label,
          // 느슨 매칭 — qtyUnit null/일치 모두 같은 품목(잔량 계산 sumPurchases 와 동일 규칙).
          ...(it.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] } : {}),
          receivedAt: { not: null, lte: last.createdAt },
          excludeFromInventory: false, qtyValue: { gt: 0 },
        },
        orderBy: { receivedAt: 'asc' },
        select: { receivedAt: true },
      })
      if (firstPurchase?.receivedAt) {
        // 최초 구매 승인 ~ 실사 사이의 총 입수량
        const [totalPurchases, totalAdditions, totalDisposals] = await Promise.all([
          sumPurchases(propertyId, it.category, it.label, it.qtyUnit, null, last.createdAt, useSpec, it.specUnit),
          sumAdditions(it.id, null, last.date),
          sumDisposals(it.id, null, last.date),
        ])
        const consumed = totalPurchases + totalAdditions - totalDisposals - last.remainingQty
        const days = Math.max(1, Math.round((last.date.getTime() - firstPurchase.receivedAt.getTime()) / 86400000))
        // 최소 관측 7일 — 구매 직후 점검 1회로는 소모율 신뢰 불가(구매 당일 500ml 사용이
        // '하루 0.5L 소모'로 일반화돼 D-3 소진임박 오탐 나던 리클린 사례). 7일 전엔 추정 보류.
        if (consumed > 0 && days >= 7) {
          lastPeriodConsumption = consumed
          lastPeriodDays = days
        }
      }
    }

    // ── 구간 시리즈(최근 7개월) — 평균 소모율 추정과 월별 사용량이 공유한다(조회 1회).
    // 같은 날 dedup — 같은 날 두 점검 사이의 큰 잔량 jump 가 가짜 소모로 누적되던 문제 fix.
    const itemChecks = dedupSameDay(allChecksForUsage.filter(c => c.trackedItemId === it.id))
    // ⚠️ 구간별 consumed 를 '음수면 건너뛰기' 하지 않고 부호 그대로 쓴다(telescoping).
    //   입고(구매 receivedAt / 무상입수)로 재고가 점프한 구간은 음수(−)가 되는데, 그 입고분이
    //   타이밍 차로 인접 구간에 +로 더해짐. 음수 구간을 건너뛰면 입고분이 상쇄되지 않아
    //   '입고 = 가짜 사용량' 으로 부풀려졌음 (예: 주방세제 5월 6270→9740, 라면 입고 160 이 165 소모로 둔갑).
    //   부호 그대로 합산하면 같은 입고의 +/− 가 상쇄되어 물리적 정답(시작잔량+입고−끝잔량)에 수렴.
    //   부수효과: 백필된 잘못된 점검값도 인접 두 구간에서 +/− 로 상쇄되어 면역 (2026-06-01 사용자 보고).
    // 전체 재고 보정 점검은 '실측 리셋' — 직전 구간의 차이(분실·오차)를 소모량으로 잡지 않는다.
    // curr 는 다음 구간의 기준선(prev)으로는 그대로 쓰임.
    const intervalPairs: { prev: (typeof itemChecks)[number]; curr: (typeof itemChecks)[number] }[] = []
    for (let i = 1; i < itemChecks.length; i++) {
      if (itemChecks[i].isReconcile) continue
      intervalPairs.push({ prev: itemChecks[i - 1], curr: itemChecks[i] })
    }
    // 입고 구간은 effTime(실제 발생 시각) 기준 — 수령 즉시 생성된 자동점검이 baseline 일 때
    // 그 구매가 다음 구간에 중복 입고로 더해지는 것을 방지(수세미 케이스).
    // 구간 간 의존 없음 → 동시 조회, 합산은 원래 순서대로(결과 동일).
    const intervalConsumed = await Promise.all(intervalPairs.map(async ({ prev, curr }) => {
      const [purchases, additions, disposals] = await Promise.all([
        sumPurchases(propertyId, it.category, it.label, it.qtyUnit, effTime(prev), effTime(curr), useSpec, it.specUnit),
        sumAdditions(it.id, effTime(prev), effTime(curr)),
        sumDisposals(it.id, effTime(prev), effTime(curr)),
      ])
      return {
        curr,
        consumed: (prev.remainingQty + purchases + additions - disposals) - curr.remainingQty,
        // 구간 일수를 구간에 동봉 — 보정 구간을 소모에서 빼면 분모에서도 같이 빠져야 하므로.
        // date 는 @db.Date(그 날의 UTC 자정)라 이 나눗셈은 반올림 오차 없는 정수.
        days: Math.max(1, Math.round((curr.date.getTime() - prev.date.getTime()) / 86400000)),
      }
    }))

    // ── 평균 소모율 — 최근 30일 '합산' 기준 (단일 구간 추정 폐기, 2026-07-17).
    // 종전엔 마지막 두 점검 사이 한 구간만으로 냈다. 점검 간격이 1~3일이라 표본이 1개뿐이었고,
    // 그 구간이 우연히 크면 과대(라면 8/일, 실제 약 5 → 임박 오탐), 작으면 과소(쌀 0.5/일, 실제 약 3
    // → 소진 175일로 표시), 0이면 추정 자체가 사라져 무알림(김치·수세미·물티슈)이었다.
    // 즉 성실하게 자주 점검할수록 구간이 짧아져 알림이 나빠지는 구조였음.
    // 창 '합산'인 이유: 구간별 값을 개별 표본으로 다루는 방식(중앙값·EWMA)은 위 telescoping 상쇄가
    // 일어나지 않아 입고 타이밍 오차(+X 구간 / −X 구간)가 표본에 영구히 남는다.
    const WINDOW_DAYS = 30   // 14일은 느린 품목에서 여전히 0, 60일 이상은 입주 인원 변동 반영이 느림.
    const MIN_OBS_DAYS = 7   // 구매 직후 점검 1회로 D-3 오탐 나던 리클린 사례 방어(위 폴백 규칙과 동일 취지).
    // 컷오프는 KST 달력일 기준 — date 가 @db.Date(그 날의 UTC 자정)이므로 표현을 맞춘다.
    // 서버 로컬(new Date + setHours)로 잡으면 배포 TZ(Vercel=UTC)에 따라 창이 하루 흔들림.
    const windowCutoff = Date.parse(`${kstDay(new Date())}T00:00:00Z`) - WINDOW_DAYS * 86400000
    // 분모는 달력 span 이 아니라 '포함된 구간 일수의 합' — 보정 구간을 소모에서 빼면서 그 일수를
    // 분모에 남기면 소모율이 과소평가되어 알림이 사라진다. consumed 와 항상 같은 구간 집합 위에서 계산.
    // 창 경계를 걸친 구간은 통째로 포함(소모를 일별로 쪼개는 건 없는 정보를 지어내는 것) →
    // 실제 관측일수가 30을 넘을 수 있어 화면엔 명목 30이 아닌 avgDailyBasisDays 를 쓴다.
    const rateOver = (cutoffMs: number) => intervalConsumed
      .filter(iv => iv.curr.date.getTime() >= cutoffMs)
      .reduce((acc, iv) => ({
        observedDays: acc.observedDays + iv.days,
        consumed: acc.consumed + iv.consumed,   // 부호 그대로(telescoping)
      }), { observedDays: 0, consumed: 0 })
    // 창 확장 트리거는 '관측일수 부족' 뿐 — '소모량이 적어서' 넓히면 결과에 조건부인 정지규칙이라
    // 추정이 체계적으로 과대편향된다.
    let obs = rateOver(windowCutoff)
    if (obs.observedDays < MIN_OBS_DAYS) obs = rateOver(0)   // 조회 한계(최근 7개월)까지 확장

    let avgDaily: number | null = null
    let avgDailyBasisDays: number | null = null
    if (obs.observedDays >= MIN_OBS_DAYS) {
      // 창 총합이 음수면 장부 모순(입고 누락·위치별 보충 시 수량 손실 등, knowledge/domain-inventory.md).
      // 0 으로 누르면 '관측했는데 안 씀'과 구분이 안 되므로 추정 불가(null)로 남긴다.
      if (obs.consumed >= 0) {
        avgDaily = obs.consumed / obs.observedDays   // 0 = '관측 결과 안 씀' (알림 없음이 정상)
        avgDailyBasisDays = obs.observedDays
      }
    } else if (last && !prev && lastPeriodConsumption != null && lastPeriodDays) {
      // 점검이 1회뿐이라 구간이 아예 없는 경우만 최초구매 기준 폴백(위) 사용.
      // 점검 2회 이상이나 전부 7개월 이전인 품목은 avgDaily 소실 — 의도된 변경(낡은 데이터로 알림 금지).
      avgDaily = lastPeriodConsumption / lastPeriodDays
      avgDailyBasisDays = lastPeriodDays
    }

    // avgDaily 0(안 씀) / null(추정 불가) 은 여기서 걸러져 daysUntilEmpty 가 null → 알림 없음.
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
        // 느슨 매칭 — qtyUnit null/일치 모두 같은 품목(단가도 누락 없이 집계).
        ...(it.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: it.qtyUnit }] } : {}),
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
      // specUnit≠품목단위면 품목 단위로 환산해 단가 기준(base)을 통일(L→ml 등)
      const specBase = (p: { qtyValue: number | null; specValue: number | null; specUnit: string | null }) => {
        const qty = p.qtyValue ?? 0
        if (!(useSpec && p.specValue && p.specValue > 0)) return qty
        return qty * (convertSpecValue(p.specValue, p.specUnit, it.specUnit) ?? p.specValue)
      }
      let totalAmt = 0
      let totalBase = 0
      for (const p of recentPurchases) {
        const base = specBase(p)
        if (base > 0) {
          totalAmt  += p.amount
          totalBase += base
        }
      }
      avgUnitPrice = totalBase > 0 ? totalAmt / totalBase : null
      const last = recentPurchases[0]
      const lastBase = specBase(last)
      lastUnitPrice = lastBase > 0 ? last.amount / lastBase : null
    }

    // 월별 사용량 — 최근 6개월. 연속 점검 사이 소모량을 늦은 쪽 월에 귀속.
    // 6개월 슬롯을 null(미관측) 로 미리 생성 → 구간이 귀속된 월만 숫자로 승격.
    // ⚠️ null(그 달엔 점검 자체가 없음) 과 0(점검했는데 안 씀) 은 다른 상태다. 종전엔 둘 다 0 이라
    //   추적 시작 전 달이 '사용량 0' 으로 그려져 편차가 커 보였음 (2026-07-17 운영자 의문).
    //   avgDaily 의 0/null 관례(constants.ts)와 동일하게 맞춘다.
    const monthlyMap: Record<string, number | null> = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthlyMap[key] = null
    }
    // 구간 시리즈(itemChecks·intervalConsumed)는 위 평균 소모율 계산과 공유 — 여기선 월별 귀속만.
    for (const { curr, consumed } of intervalConsumed) {
      const key = `${curr.date.getFullYear()}-${String(curr.date.getMonth() + 1).padStart(2, '0')}`
      if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + consumed
    }
    // 월 단위 음수(그 달 입고가 사용량보다 많아 순증한 경우)는 사용량 0 으로 클램프 — '사용량' 은 음수일 수 없음.
    // 단 미관측(null)은 클램프 대상이 아니다 — 0 으로 내리면 '안 씀' 과 다시 뭉개진다.
    const monthlyConsumption = Object.entries(monthlyMap)
      .map(([month, qty]) => ({ month, qty: qty == null ? null : Math.max(0, qty) }))

    // isHub 는 '이 품목의 허브' — hubLocationId 가 있으면 그 위치, 없으면 영업장 기본 허브(폴백).
    const locations: StorageLocationItem[] = allItemLocations
      .filter(l => l.trackedItemId === it.id)
      .map(l => ({ id: l.storageLocation.id, name: l.storageLocation.name, sortOrder: l.storageLocation.sortOrder, isHub: it.hubLocationId ? l.storageLocation.id === it.hubLocationId : l.storageLocation.isHub }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

    const pendingPurchases: PendingPurchase[] = allPending
      .filter(p =>
        p.category === it.category &&
        p.itemLabel === it.label &&
        // 단위는 양쪽 다 있을 때만 비교 — 단위 미입력 구매가 배지에서 누락되지 않게
        (it.qtyUnit == null || p.qtyUnit == null || p.qtyUnit === it.qtyUnit),
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

    return {
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
      avgDailyBasisDays,
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
    }
  }))
  return rows
}
