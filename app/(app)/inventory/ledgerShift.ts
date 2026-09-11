// 재고 원장 조정의 DB 헬퍼 공용층 — 'use server' 아님(클라이언트 비노출, 서버 전용).
// 계산 규칙 정본은 lib/stockLedger(순수)이고, 여기는 조회(loadLedgerChecks)·적용(applyShiftRows)·
// 되돌리기(revertShiftRows)만 담는다. inventory/actions(무상 입수 CRUD)와 finance/actions
// (지출 수정·삭제의 재고 전파)가 같은 적용층을 쓰기 위해 분리했다 — 'use server' 파일은
// async 서버 액션만 내보낼 수 있어 이 헬퍼들을 직접 내보내면 공개 엔드포인트가 된다.
//
// 왜 필요한가(운영자 신고 2026-08-19, 쌀 40kg·점보롤). StockCheck.remainingQty 는 절대값이라
// 델타 기록(무상 입수·구매 수령)의 날짜·수량을 나중에 고치면 그 뒤 점검이 삼킨 수량이 증발한다.
// 조정은 자동이 아니다 — 서버는 계획만 만들고 운영자가 고른 경우에만 적용한다. 적용분은
// 스냅샷(LedgerShiftUndo)으로 되돌린다(§16).
import prisma, { type PrismaDb } from '@/lib/prisma'
import {
  planStockShift, planCheckPropagation,
  type LedgerCheck, type LedgerDelta, type PurchaseDelta, type ShiftRow,
  type PropagationCheck, type CheckSnapshot,
} from '@/lib/stockLedger'
import { specMultiplier } from '@/lib/units'

// 트랜잭션 클라이언트 타입 — lib/prisma 가 $extends 로 확장한 클라이언트라 Prisma.TransactionClient 와 다르다.
export type InventoryTx = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// locs[].carried — 표식의 **이전 값**. 키가 있을 때만 되돌린다(null 도 유효한 이전 값이라
// '없음'의 기준은 undefined 뿐이다). 입수·구매 조정은 표식을 안 건드리므로 키 자체가 없다.
export type LedgerShiftUndo = {
  trackedItemId: string
  checks: {
    id: string; remainingQty: number
    locs: { storageLocationId: string; remainingQty: number | null; carried?: boolean | null }[]
  }[]
  createdLinks: string[]   // 이 조정이 새로 만든 (품목,위치) 링크
}

// 이 품목의 '기본 배치 위치' — 반드시 이 품목에 링크된 위치 중에서 고른다.
// 종전 폴백은 `hubLocationId ?? 영업장 기본 허브(isHub)` 였는데, isHub 는 영업장 기본값이지
// 품목별 선언이 아니다. 링크 안 된 위치를 고르면 그 수량이 위치별 화면·보정 폼에서 증발한다
// (orphan — 601303c5 김치와 같은 클래스). 링크 집합 밖이면 다음 후보로 넘어간다.
// 폴백 허브에 링크를 만들어주는 방식은 기각 — 운영자가 선언한 적 없는 위치를 사실로 만든다.
export async function resolveItemHubLocationId(
  trackedItemId: string,
  hubLocationId: string | null,
  propertyId: string,
  linkedIds?: Set<string>,   // 호출부가 이미 갖고 있으면 재조회 생략
): Promise<string | null> {
  // 숨긴 위치(closedAt != null)는 허브 후보에서 제외 — 미지정 입수가 숨긴 위치로 귀속되면 안 된다(2단계 F3).
  // 호출부가 linkedIds 를 넘길 땐 열린 링크만 담아야 한다(confirmReceipt 등).
  let ids = linkedIds
  if (!ids) {
    const links = await prisma.trackedItemLocation.findMany({
      where: { trackedItemId, closedAt: null },
      select: { storageLocationId: true },
      orderBy: { storageLocation: { sortOrder: 'asc' } },
    })
    ids = new Set(links.map(l => l.storageLocationId))
  }
  if (ids.size === 0) return null
  if (hubLocationId && ids.has(hubLocationId)) return hubLocationId
  const def = await prisma.storageLocation.findFirst({ where: { propertyId, isHub: true }, select: { id: true } })
  if (def && ids.has(def.id)) return def.id
  // 첫 링크 — sortOrder 로 결정화(비결정적 '첫 위치' 방지)
  const first = await prisma.trackedItemLocation.findFirst({
    where: { trackedItemId, closedAt: null },
    select: { storageLocationId: true },
    orderBy: { storageLocation: { sortOrder: 'asc' } },
  })
  return first?.storageLocationId ?? null
}

export async function loadLedgerChecks(trackedItemId: string): Promise<LedgerCheck[]> {
  const rows = await prisma.stockCheck.findMany({
    where: { trackedItemId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: { locationBreakdown: { select: { storageLocationId: true, remainingQty: true } } },
  })
  return rows.map(c => ({
    id: c.id,
    dateMs: c.date.getTime(),
    createdAtMs: c.createdAt.getTime(),
    isReconcile: c.isReconcile,
    total: c.remainingQty,
    hasBreakdown: c.locationBreakdown.length > 0,
    byLoc: c.locationBreakdown.map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty })),
  }))
}

// 계획 실패 사유를 운영자 문구로. 0 클램프하지 않고 막는 것이 이 설계의 요지다.
export function shiftPlanError(code: 'NEGATIVE' | 'NO_LOCATION', dateMs: number): string {
  const d = new Date(dateMs).toISOString().slice(0, 10)
  return code === 'NEGATIVE'
    ? `조정하면 ${d} 점검의 잔량이 0 보다 작아집니다. 그 점검을 먼저 확인해 주세요.`
    : '이 품목에 연결된 보관 위치가 없어 위치별 잔량을 함께 옮길 수 없습니다.'
}

// before/after 델타로 조정 계획을 만든다. 위치는 '위치 미지정이면 품목 허브' 규칙(additionsSinceCheckByLocation 과 동일).
export async function buildAdditionShiftPlan(
  item: { id: string; hubLocationId: string | null },
  propertyId: string,
  before: { dateMs: number; createdAtMs: number; qty: number; storageLocationId: string | null } | null,
  after: { dateMs: number; createdAtMs: number; qty: number; storageLocationId: string | null } | null,
): Promise<{ ok: true; rows: ShiftRow[] } | { ok: false; error: string }> {
  const needsHub = (before && !before.storageLocationId) || (after && !after.storageLocationId)
  const hub = needsHub ? await resolveItemHubLocationId(item.id, item.hubLocationId, propertyId) : null
  const toDelta = (d: typeof before): LedgerDelta | null =>
    d ? { dateMs: d.dateMs, createdAtMs: d.createdAtMs, qty: d.qty, locationId: d.storageLocationId ?? hub } : null
  const checks = await loadLedgerChecks(item.id)
  const plan = planStockShift(checks, toDelta(before), toDelta(after))
  if (!plan.ok) return { ok: false, error: shiftPlanError(plan.code, plan.dateMs) }
  return { ok: true, rows: plan.rows }
}

// 이 지출이 잔량 산식에 기여하는 품목 — sumPurchases 의 (category, itemLabel) + qtyUnit 느슨 매칭.
// 지출 수정·삭제의 전파 게이트(finance)와 미리보기(inventory)가 같은 매칭을 봐야 한다.
export async function matchedTrackedItemForExpense(
  propertyId: string,
  e: { category: string; itemLabel: string | null; qtyUnit: string | null },
): Promise<{ id: string; trackUnit: string; specUnit: string | null; qtyUnit: string | null; hubLocationId: string | null } | null> {
  if (!e.itemLabel) return null
  const it = await prisma.trackedItem.findUnique({
    where: { propertyId_category_label: { propertyId, category: e.category, label: e.itemLabel } },
    select: { id: true, trackUnit: true, specUnit: true, qtyUnit: true, hubLocationId: true },
  })
  if (!it) return null
  // 느슨 매칭 — 둘 다 값이 있는데 다르면 이 품목의 잔량에 안 들어간다(sumPurchases 와 동일).
  if (it.qtyUnit && e.qtyUnit && it.qtyUnit !== e.qtyUnit) return null
  return it
}

// 구매 1건이 잔량 산식에 기여하는 품목 단위 환산량 — 읽기 정본 overview.sumPurchases 와 같은 규칙
// (useSpec 게이트 + specMultiplier). 조정 계획의 델타 크기는 반드시 읽기 쪽과 같은 값이어야
// 화면 잔량과 계획이 같은 수량을 본다. confirmReceipt 의 수령량 산출과는 specUnit 미설정 품목에서
// 다를 수 있는데(그쪽은 trackUnit 만 본다), 조정의 기준은 읽기 정본이다.
export function convertedPurchaseQty(
  item: { trackUnit: string; specUnit: string | null },
  e: { qtyValue: number | null; specValue: number | null; specUnit: string | null },
): number {
  const q = e.qtyValue ?? 0
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
  if (!useSpec) return q
  const spec = specMultiplier(e.specValue, e.specUnit, item.specUnit)
  return spec != null ? q * spec : q
}

// 구매(수령) 델타의 조정 계획 — 반영 경계가 receivedAt > 점검.createdAt (lib/stockLedger purchaseAfterCheck).
// qty 는 품목 단위 환산 후 값. excludeCheckIds — 수령 취소처럼 함께 삭제될 자동 점검은 계획에서 뺀다.
export async function buildPurchaseShiftPlan(
  item: { id: string; hubLocationId: string | null },
  propertyId: string,
  before: { receivedAtMs: number; qty: number; storageLocationId: string | null } | null,
  after: { receivedAtMs: number; qty: number; storageLocationId: string | null } | null,
  excludeCheckIds?: string[],
): Promise<{ ok: true; rows: ShiftRow[] } | { ok: false; error: string }> {
  const needsHub = (before && !before.storageLocationId) || (after && !after.storageLocationId)
  const hub = needsHub ? await resolveItemHubLocationId(item.id, item.hubLocationId, propertyId) : null
  const toDelta = (d: typeof before): PurchaseDelta | null =>
    d ? { receivedAtMs: d.receivedAtMs, qty: d.qty, locationId: d.storageLocationId ?? hub } : null
  const excluded = new Set(excludeCheckIds ?? [])
  const checks = (await loadLedgerChecks(item.id)).filter(c => !excluded.has(c.id))
  const plan = planStockShift(checks, toDelta(before), toDelta(after))
  if (!plan.ok) return { ok: false, error: shiftPlanError(plan.code, plan.dateMs) }
  return { ok: true, rows: plan.rows }
}

// ── 점검 수정의 뒤 점검 전파(2026-09-11 김치) ─────────────────────────────
// 계산 정본은 lib/stockLedger planCheckPropagation. 여기는 조회와 조립만 한다.

// 이월/실측 표식과 보충 마커까지 실어 온다 — 표식 없는 구식 행은 마커로 허브 차감을 되짚어야
// 휴리스틱이 성립한다(loadLedgerChecks 는 조정용이라 그 두 칸을 안 읽는다).
export async function loadPropagationChecks(trackedItemId: string): Promise<PropagationCheck[]> {
  const rows = await prisma.stockCheck.findMany({
    where: { trackedItemId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: {
      locationBreakdown: {
        select: { storageLocationId: true, remainingQty: true, restockedQty: true, carried: true },
      },
    },
  })
  return rows.map(c => ({
    id: c.id,
    dateMs: c.date.getTime(),
    createdAtMs: c.createdAt.getTime(),
    isReconcile: c.isReconcile,
    total: c.remainingQty,
    hasBreakdown: c.locationBreakdown.length > 0,
    byLoc: c.locationBreakdown.map(lb => ({
      locationId: lb.storageLocationId,
      qty: lb.remainingQty,
      carried: lb.carried,
      restockedQty: lb.restockedQty,
    })),
  }))
}

// 무상 입수(+)와 폐기(−)를 하나의 델타 목록으로. 위치 미지정은 품목 허브로 —
// actions.additionsSinceCheckByLocation(이월을 실제로 만드는 코드)과 같은 폴백이라야
// 휴리스틱이 그 이월값을 되짚는다.
export async function loadLedgerDeltas(
  item: { id: string; hubLocationId: string | null },
  propertyId: string,
): Promise<LedgerDelta[]> {
  const [adds, disposals] = await Promise.all([
    prisma.stockAddition.findMany({
      where: { trackedItemId: item.id },
      select: { date: true, createdAt: true, addedQty: true, storageLocationId: true },
    }),
    prisma.stockDisposal.findMany({
      where: { trackedItemId: item.id },
      select: { date: true, createdAt: true, disposedQty: true, storageLocationId: true },
    }),
  ])
  const needsHub = adds.some(a => !a.storageLocationId) || disposals.some(d => !d.storageLocationId)
  const hub = needsHub ? await resolveItemHubLocationId(item.id, item.hubLocationId, propertyId) : null
  return [
    ...adds.map(a => ({
      dateMs: a.date.getTime(), createdAtMs: a.createdAt.getTime(),
      qty: a.addedQty, locationId: a.storageLocationId ?? hub,
    })),
    ...disposals.map(d => ({
      dateMs: d.date.getTime(), createdAtMs: d.createdAt.getTime(),
      qty: -d.disposedQty, locationId: d.storageLocationId ?? hub,
    })),
  ]
}

// 계획 실패 사유를 운영자 문구로. 어느 점검의 어느 위치인지 이름으로 말한다(0 클램프 금지).
export function propagationPlanError(dateMs: number, locationName: string): string {
  const d = new Date(dateMs).toISOString().slice(0, 10)
  return `함께 조정하면 ${d} 점검의 ${locationName} 잔량이 0 보다 작아집니다. 그 점검을 먼저 확인해 주세요.`
}

export async function buildCheckPropagationPlan(
  item: { id: string; hubLocationId: string | null },
  propertyId: string,
  editedCheckId: string,
  before: CheckSnapshot,
  after: CheckSnapshot,
): Promise<{ ok: true; rows: ShiftRow[] } | { ok: false; error: string }> {
  const [checks, deltas, hubLocationId] = await Promise.all([
    loadPropagationChecks(item.id),
    loadLedgerDeltas(item, propertyId),
    resolveItemHubLocationId(item.id, item.hubLocationId, propertyId),
  ])
  const plan = planCheckPropagation(checks, editedCheckId, before, after, { hubLocationId, deltas })
  if (!plan.ok) {
    const loc = await prisma.storageLocation.findUnique({ where: { id: plan.locationId }, select: { name: true } })
    return { ok: false, error: propagationPlanError(plan.dateMs, loc?.name ?? '알 수 없는 위치') }
  }
  return { ok: true, rows: plan.rows }
}

// 계획 적용 — 총량과 위치별 잔량만 쓴다. 보충 마커(restockedQty)·createdAt 은 건드리지 않는다
// (마커는 이동량이지 잔량이 아니고, createdAt 을 밀면 구간 귀속 순서가 조용히 바뀐다).
// markCarried — 점검 전파가 새로 만드는 행은 정의상 이월 행이라 표식을 찍는다. 무상 입수·구매
// 전파는 귀속 행이라 표식 없이 둔다(종전 동작 그대로).
export async function applyShiftRows(
  tx: InventoryTx, trackedItemId: string, rows: ShiftRow[], opts?: { markCarried?: boolean },
): Promise<LedgerShiftUndo> {
  const undo: LedgerShiftUndo = { trackedItemId, checks: [], createdLinks: [] }
  const links = await tx.trackedItemLocation.findMany({ where: { trackedItemId }, select: { storageLocationId: true } })
  const linked = new Set(links.map(l => l.storageLocationId))
  for (const r of rows) {
    const snapshot: LedgerShiftUndo['checks'][number]['locs'] = []
    // 표식을 찍는 경로에서는 **이전 표식**을 먼저 읽어 스냅샷에 담는다 — 안 담으면 되돌려도
    // 표식만 새 값으로 남아, 값은 옛날인데 표식은 새 판정인 행이 생긴다.
    const wasCarried = opts?.markCarried
      ? new Map((await tx.stockCheckLocation.findMany({
          where: { stockCheckId: r.checkId }, select: { storageLocationId: true, carried: true },
        })).map(x => [x.storageLocationId, x.carried]))
      : null
    for (const l of r.locs) {
      snapshot.push({
        storageLocationId: l.locationId, remainingQty: l.storedQty,
        ...(wasCarried ? { carried: wasCarried.get(l.locationId) ?? null } : {}),
      })
      if (l.storedQty == null) {
        // 쓰기 계약 — 링크 없이 StockCheckLocation 행을 만들지 않는다(knowledge/domain-inventory.md 불변식).
        if (!linked.has(l.locationId)) {
          await tx.trackedItemLocation.create({ data: { trackedItemId, storageLocationId: l.locationId } })
          linked.add(l.locationId)
          undo.createdLinks.push(l.locationId)
        }
        await tx.stockCheckLocation.create({
          data: {
            stockCheckId: r.checkId, storageLocationId: l.locationId, remainingQty: l.nextQty,
            ...(opts?.markCarried ? { carried: l.carried ?? true } : {}),
          },
        })
      } else {
        // 덮어쓴 행·정지 행 모두 계획이 판정한 표식을 그대로 박는다.
        await tx.stockCheckLocation.updateMany({
          where: { stockCheckId: r.checkId, storageLocationId: l.locationId },
          data: {
            remainingQty: l.nextQty,
            ...(opts?.markCarried && l.carried !== undefined ? { carried: l.carried } : {}),
          },
        })
      }
    }
    await tx.stockCheck.update({ where: { id: r.checkId }, data: { remainingQty: r.nextTotal } })
    undo.checks.push({ id: r.checkId, remainingQty: r.storedTotal, locs: snapshot })
  }
  return undo
}

// 조정 되돌리기 — 페이로드는 클라이언트발이므로 점검 id 를 반드시 품목 스코프로 검증한다(B1 선례).
export async function revertShiftRows(tx: InventoryTx, undo: LedgerShiftUndo): Promise<void> {
  const ids = undo.checks.map(c => c.id)
  if (ids.length > 0) {
    const owned = await tx.stockCheck.findMany({
      where: { id: { in: ids }, trackedItemId: undo.trackedItemId }, select: { id: true },
    })
    const ownedIds = new Set(owned.map(o => o.id))
    for (const c of undo.checks) {
      if (!ownedIds.has(c.id)) continue
      await tx.stockCheck.update({ where: { id: c.id }, data: { remainingQty: c.remainingQty } })
      for (const l of c.locs) {
        if (l.remainingQty == null) {
          await tx.stockCheckLocation.deleteMany({ where: { stockCheckId: c.id, storageLocationId: l.storageLocationId } })
        } else {
          await tx.stockCheckLocation.updateMany({
            where: { stockCheckId: c.id, storageLocationId: l.storageLocationId },
            data: {
              remainingQty: l.remainingQty,
              // 키가 있을 때만 표식을 되돌린다 — null 도 유효한 이전 값이라 '없음'은 undefined 뿐이다.
              ...(l.carried !== undefined ? { carried: l.carried } : {}),
            },
          })
        }
      }
    }
  }
  for (const locId of undo.createdLinks) {
    // 그 사이 다른 점검이 그 위치를 쓰기 시작했으면 링크를 남긴다(재고 든 위치엔 링크가 있어야 한다).
    const used = await tx.stockCheckLocation.count({
      where: { storageLocationId: locId, stockCheck: { trackedItemId: undo.trackedItemId } },
    })
    if (used === 0) {
      await tx.trackedItemLocation.deleteMany({ where: { trackedItemId: undo.trackedItemId, storageLocationId: locId } })
    }
  }
}
