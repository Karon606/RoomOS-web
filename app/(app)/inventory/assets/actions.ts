'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { requireEdit } from '@/lib/role'
import { getTrackedCategories } from '../categoryConfig'

// 품목 detail 문자열 재구성 (addExpense 와 동일 포맷: "[라벨] 규격 x 수량단위")
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))
function buildAssetDetail(e: { itemLabel: string | null; specValue: number | null; specUnit: string | null; qtyValue: number | null; qtyUnit: string | null }): string {
  const label = e.itemLabel ?? ''
  const spec = e.specValue != null ? ` ${fmtQty(e.specValue)}${e.specUnit ?? ''}` : ''
  const qty = e.qtyValue != null ? ` x ${fmtQty(e.qtyValue)}${e.qtyUnit ?? ''}` : ''
  return `[${label}]${spec}${qty}`
}

async function getPropertyId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

// 화면 표시용 — 같은 버킷(미배정/방/공용부) 안에서 동일 품목(라벨·규격·단위·카테고리)을
// 하나로 합쳐 표시. 장부(Expense)는 개별 구매 기록 그대로 유지하고 화면만 집계한다.
export type AssetItem = {
  id: string                    // 대표(React key) = ids[0]
  ids: string[]                 // 묶인 지출 id 전부
  count: number                 // 묶인 구매 건수
  date: string                  // 대표(최신) 일자
  itemLabel: string
  detail: string | null         // 합계 수량으로 재구성
  amount: number                // 합계 금액
  qtyValue: number | null       // 합계 수량
  qtyUnit: string | null
  category: string
  vendor: string | null
  roomId: string | null
  roomNo: string | null
  locationId: string | null     // 공용부(StorageLocation) 배정 시
  locationName: string | null
  isCommon: boolean             // 공용 자재(페인트 등) 표시
  breakdown: { date: string; qty: number | null; amount: number }[]   // 합산 펼치기 — 개별 구매 내역
}

export type AssetsData = {
  pending: AssetItem[]          // 수령 대기(receivedAt 없음) — 배정 전
  pendingTotal: number
  rooms: { roomId: string; roomNo: string; total: number; items: AssetItem[] }[]
  locations: { locationId: string; name: string; total: number; items: AssetItem[] }[]   // 공용부별
  common: AssetItem[]           // 공용 자재(방/공용부 배분 안 함)
  commonTotal: number
  unassigned: AssetItem[]
  unassignedTotal: number
}

type RawAsset = {
  id: string; date: string; itemLabel: string; amount: number
  qtyValue: number | null; qtyUnit: string | null; specValue: number | null; specUnit: string | null
  category: string; vendor: string | null
  roomId: string | null; roomNo: string | null; locationId: string | null; locationName: string | null
  isCommon: boolean; received: boolean
}

// 한 버킷의 행들을 동일 품목끼리 묶어 AssetItem[] 로 집계
function aggregateAssets(list: RawAsset[]): AssetItem[] {
  const map = new Map<string, { spec: number | null; specUnit: string | null; rows: RawAsset[] }>()
  for (const r of list) {
    const key = [r.itemLabel, r.specValue ?? '', r.specUnit ?? '', r.qtyUnit ?? '', r.category, r.isCommon ? 'C' : ''].join('␟')
    const g = map.get(key) ?? { spec: r.specValue, specUnit: r.specUnit, rows: [] }
    g.rows.push(r); map.set(key, g)
  }
  const out: AssetItem[] = []
  for (const g of map.values()) {
    const rows = g.rows
    const hasQty = rows.some(r => r.qtyValue != null)
    const qtyValue = hasQty ? rows.reduce((s, r) => s + (r.qtyValue ?? 0), 0) : null
    const amount = rows.reduce((s, r) => s + r.amount, 0)
    const date = rows.reduce((d, r) => (r.date > d ? r.date : d), rows[0].date)
    const rep = rows[0]
    out.push({
      id: rep.id, ids: rows.map(r => r.id), count: rows.length, date,
      itemLabel: rep.itemLabel,
      detail: buildAssetDetail({ itemLabel: rep.itemLabel, specValue: g.spec, specUnit: g.specUnit, qtyValue, qtyUnit: rep.qtyUnit }),
      amount, qtyValue, qtyUnit: rep.qtyUnit, category: rep.category, vendor: rep.vendor,
      roomId: rep.roomId, roomNo: rep.roomNo, locationId: rep.locationId, locationName: rep.locationName,
      isCommon: rep.isCommon,
      breakdown: rows.map(r => ({ date: r.date, qty: r.qtyValue, amount: r.amount }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

// 비품·자재 = 품목으로 입력된 지출 중 소모품(재고 추적 카테고리)·배송비를 제외한 내구재.
// (의자·거치대·수선유지 자재 등) 방/공용부 배정 여부로 나눠서 보여준다. 동일 품목은 합쳐서 표시.
export async function getDurableItems(): Promise<AssetsData> {
  const propertyId = await getPropertyId()
  const trackedCats = await getTrackedCategories(propertyId)

  const rows = await prisma.expense.findMany({
    where: {
      propertyId,
      itemLabel: { not: null },
      isShipping: false,
      excludeFromInventory: false,
      category: { notIn: trackedCats },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, date: true, itemLabel: true, amount: true,
      qtyValue: true, qtyUnit: true, specValue: true, specUnit: true,
      category: true, vendor: true, roomId: true,
      room: { select: { roomNo: true } },
      assignedLocationId: true,
      assignedLocation: { select: { name: true } },
      isCommonAsset: true, receivedAt: true,
    },
  })

  const raws: RawAsset[] = rows.map(r => ({
    id: r.id, date: r.date.toISOString().slice(0, 10), itemLabel: r.itemLabel ?? '',
    amount: r.amount, qtyValue: r.qtyValue, qtyUnit: r.qtyUnit, specValue: r.specValue, specUnit: r.specUnit,
    category: r.category, vendor: r.vendor,
    roomId: r.roomId, roomNo: r.room?.roomNo ?? null,
    locationId: r.assignedLocationId, locationName: r.assignedLocation?.name ?? null,
    isCommon: r.isCommonAsset, received: r.receivedAt != null,
  }))

  const roomBuckets = new Map<string, RawAsset[]>()
  const locBuckets = new Map<string, RawAsset[]>()
  const pendingRaw: RawAsset[] = []
  const commonRaw: RawAsset[] = []
  const unassignedRaw: RawAsset[] = []
  for (const r of raws) {
    if (!r.received) pendingRaw.push(r)              // 수령 대기 — 배정 전, 최우선 분리
    else if (r.roomId && r.roomNo) (roomBuckets.get(r.roomId) ?? roomBuckets.set(r.roomId, []).get(r.roomId)!).push(r)
    else if (r.locationId && r.locationName) (locBuckets.get(r.locationId) ?? locBuckets.set(r.locationId, []).get(r.locationId)!).push(r)
    else if (r.isCommon) commonRaw.push(r)
    else unassignedRaw.push(r)
  }

  const rooms = [...roomBuckets.entries()].map(([roomId, list]) => {
    const items = aggregateAssets(list)
    return { roomId, roomNo: list[0].roomNo!, total: items.reduce((s, i) => s + i.amount, 0), items }
  }).sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))

  const locations = [...locBuckets.entries()].map(([locationId, list]) => {
    const items = aggregateAssets(list)
    return { locationId, name: list[0].locationName!, total: items.reduce((s, i) => s + i.amount, 0), items }
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))

  const pending = aggregateAssets(pendingRaw)
  const common = aggregateAssets(commonRaw)
  const unassigned = aggregateAssets(unassignedRaw)
  return {
    pending, pendingTotal: pending.reduce((s, i) => s + i.amount, 0),
    rooms, locations,
    common, commonTotal: common.reduce((s, i) => s + i.amount, 0),
    unassigned, unassignedTotal: unassigned.reduce((s, i) => s + i.amount, 0),
  }
}

// 비품 수령 상태 토글 — received=true 면 수령 완료(receivedAt=지금), false 면 수령 대기로.
// (비품은 재고추적 대상이 아니라 자동 점검 생성 없이 receivedAt 만 설정)
export async function setAssetReceived(expenseIds: string[], received: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!expenseIds.length) return { ok: false, error: '대상 항목이 없습니다.' }
    await prisma.expense.updateMany({
      where: { id: { in: expenseIds }, propertyId },
      data: { receivedAt: received ? new Date() : null },
    })
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 공용 자재 표시/해제 — value=true 면 방·공용부 배정 해제하고 공용 자재로 마킹, false 면 일반 미배정으로.
export async function setCommonAsset(expenseIds: string[], value: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!expenseIds.length) return { ok: false, error: '대상 항목이 없습니다.' }
    await prisma.expense.updateMany({
      where: { id: { in: expenseIds }, propertyId },
      data: value ? { isCommonAsset: true, roomId: null, assignedLocationId: null } : { isCommonAsset: false },
    })
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 비품 카드 합치기 — 선택 카드(src)의 지출들을 대상 카드(dest)의 이름·사양·단위로 통일해 한 카드로 병합.
// (소모품 '다른 카드와 병합'과 동일 개념. 비품은 TrackedItem 이 아니라 Expense 집계라, 라벨·사양을 대상값으로 맞춰 재집계.)
// 장부 금액·구매기록은 유지(이름/사양만 변경). 환경설정 '품명 병합'에서 적용취소(완전 원복) 가능.
export async function combineAssets(
  destExpenseId: string, srcExpenseIds: string[],
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const dest = await prisma.expense.findFirst({
      where: { id: destExpenseId, propertyId },
      select: { itemLabel: true, specValue: true, specUnit: true, qtyUnit: true },
    })
    if (!dest) return { ok: false, error: '대상 품목을 찾을 수 없습니다.' }
    const srcIds = [...new Set(srcExpenseIds)].filter(id => id !== destExpenseId)
    if (!srcIds.length) return { ok: false, error: '합칠 항목이 없습니다.' }
    const srcs = await prisma.expense.findMany({
      where: { id: { in: srcIds }, propertyId },
      select: { id: true, itemLabel: true, specValue: true, specUnit: true, qtyValue: true, qtyUnit: true, detail: true },
    })
    if (!srcs.length) return { ok: false, error: '합칠 항목을 찾을 수 없습니다.' }

    let runId = ''
    await prisma.$transaction(async (tx) => {
      for (const e of srcs) {
        await tx.expense.update({
          where: { id: e.id },
          data: {
            itemLabel: dest.itemLabel, specValue: dest.specValue, specUnit: dest.specUnit, qtyUnit: dest.qtyUnit,
            detail: buildAssetDetail({ itemLabel: dest.itemLabel, specValue: dest.specValue, specUnit: dest.specUnit, qtyValue: e.qtyValue, qtyUnit: dest.qtyUnit }),
          },
        })
      }
      const oldLabels = [...new Set(srcs.map(s => s.itemLabel).filter(Boolean))]
      const run = await tx.itemNameMergeRun.create({
        data: {
          propertyId, canonical: dest.itemLabel ?? '', memberCount: oldLabels.length || srcs.length, newAliasKeys: [],
          affected: { assets: srcs.map(s => ({ id: s.id, oldLabel: s.itemLabel, oldSpecValue: s.specValue, oldSpecUnit: s.specUnit, oldQtyUnit: s.qtyUnit, oldDetail: s.detail })) },
        },
      })
      runId = run.id
    })
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance'); revalidatePath('/settings')
    return { ok: true, runId }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '합치기에 실패했습니다.' }
  }
}

export async function getAssignableRooms(): Promise<{ id: string; roomNo: string }[]> {
  const propertyId = await getPropertyId()
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
    select: { id: true, roomNo: true },
  })
  return rooms
}

// 공용부 배정 후보 = 위치 관리의 StorageLocation 중 창고(허브) 제외(허브=여분 보관 = 미배정 성격).
export async function getAssignableLocations(): Promise<{ id: string; name: string }[]> {
  const propertyId = await getPropertyId()
  return prisma.storageLocation.findMany({
    where: { propertyId, isHub: false },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  })
}

// 배정 대상 — 방 / 공용부(위치) / 해제(none)
export type AssignTarget =
  | { kind: 'none' }
  | { kind: 'room'; id: string }
  | { kind: 'location'; id: string }

// 대상 → Expense 의 roomId/assignedLocationId (상호배타)
function targetData(t: AssignTarget): { roomId: string | null; assignedLocationId: string | null } {
  if (t.kind === 'room') return { roomId: t.id, assignedLocationId: null }
  if (t.kind === 'location') return { roomId: null, assignedLocationId: t.id }
  return { roomId: null, assignedLocationId: null }
}

async function validateTarget(t: AssignTarget, propertyId: string): Promise<string | null> {
  if (t.kind === 'room') {
    const room = await prisma.room.findFirst({ where: { id: t.id, propertyId }, select: { id: true } })
    if (!room) return '호실을 찾을 수 없습니다.'
  } else if (t.kind === 'location') {
    const loc = await prisma.storageLocation.findFirst({ where: { id: t.id, propertyId }, select: { id: true } })
    if (!loc) return '위치(공용부)를 찾을 수 없습니다.'
  }
  return null
}

// 비품(집계 묶음 = expenseIds)을 방/공용부에 배정하거나(qty 만큼 분배) 해제(none). 장부는 개별 행 유지.
// - none: 묶인 행 전부 미배정 + 분할 묶음(allocationGroupId) 재병합(적용취소).
// - 배정: qty(null=전체) 만큼 수량 큰 행부터 통째 소진, 마지막 부분만 분할(금액 비례).
// 배정 상태(roomId/locId/공용) → 표시 종류·명칭
async function placeLabel(propertyId: string, roomId: string | null, locId: string | null, isCommon: boolean): Promise<{ kind: string; label: string | null }> {
  if (roomId) {
    const r = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { roomNo: true } })
    const no = r?.roomNo ?? ''
    return { kind: 'room', label: no ? (/^\d+$/.test(no) ? `${no}호` : no) : '방' }
  }
  if (locId) {
    const l = await prisma.storageLocation.findFirst({ where: { id: locId, propertyId }, select: { name: true } })
    return { kind: 'location', label: l?.name ?? '공용부' }
  }
  if (isCommon) return { kind: 'common', label: '공용 자재' }
  return { kind: 'none', label: '미배정' }
}

// 배정 변경 이력 기록 — 테이블 미적용(SQL 전)이면 조용히 무시(앱 정상 동작)
async function logAssignment(
  propertyId: string, itemLabel: string | null,
  from: { kind: string; label: string | null }, to: { kind: string; label: string | null }, qty: number | null,
) {
  if (from.kind === to.kind && from.label === to.label) return   // 변화 없음
  try {
    await prisma.assetAssignmentLog.create({
      data: { propertyId, itemLabel, fromKind: from.kind, fromLabel: from.label, toKind: to.kind, toLabel: to.label, qty },
    })
  } catch { /* asset_assignment_log 미적용 — 무시 */ }
}

// 비품 한 품목의 배정 변경 이력(최근순). 테이블 미적용 시 빈 배열.
export type AssetAssignmentLogRow = { id: string; itemLabel: string | null; fromKind: string; fromLabel: string | null; toKind: string; toLabel: string | null; qty: number | null; createdAt: string }
export async function getAssetAssignmentLog(itemLabel: string): Promise<AssetAssignmentLogRow[]> {
  try {
    const propertyId = await getPropertyId()
    const rows = await prisma.assetAssignmentLog.findMany({
      where: { propertyId, itemLabel }, orderBy: { createdAt: 'desc' }, take: 30,
    })
    return rows.map(r => ({ id: r.id, itemLabel: r.itemLabel, fromKind: r.fromKind, fromLabel: r.fromLabel, toKind: r.toKind, toLabel: r.toLabel, qty: r.qty, createdAt: r.createdAt.toISOString().slice(0, 10) }))
  } catch { return [] }
}

export async function assignAggregateToTarget(
  expenseIds: string[], target: AssignTarget, qty: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!expenseIds.length) return { ok: false, error: '대상 항목이 없습니다.' }
    const err = await validateTarget(target, propertyId)
    if (err) return { ok: false, error: err }
    const exps = await prisma.expense.findMany({ where: { id: { in: expenseIds }, propertyId } })
    if (!exps.length) return { ok: false, error: '지출 항목을 찾을 수 없습니다.' }

    const rep0 = exps[0]
    const fromState = await placeLabel(propertyId, rep0.roomId, rep0.assignedLocationId, rep0.isCommonAsset)

    if (target.kind === 'none') {
      await prisma.$transaction(exps.map(e => prisma.expense.update({ where: { id: e.id }, data: { roomId: null, assignedLocationId: null, isCommonAsset: false } })))
      const groups = [...new Set(exps.map(e => e.allocationGroupId).filter(Boolean) as string[])]
      for (const g of groups) await mergeUnassignedGroup(propertyId, g)
      await logAssignment(propertyId, rep0.itemLabel, fromState, { kind: 'none', label: '미배정' }, exps.reduce((s, e) => s + (e.qtyValue ?? 1), 0))
      revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
      return { ok: true }
    }

    const tData = targetData(target)
    const totalQty = exps.reduce((s, e) => s + (e.qtyValue ?? 1), 0)
    const movedQty = (qty == null || qty >= totalQty) ? totalQty : Math.max(1, qty)
    let need = (qty == null || qty >= totalQty) ? totalQty : Math.max(1, qty)
    // 수량 큰 행부터 통째 소진 → 분할 최소화. 마지막 부분만 쪼갬.
    const sorted = [...exps].sort((a, b) => (b.qtyValue ?? 1) - (a.qtyValue ?? 1))
    const ops: Prisma.PrismaPromise<unknown>[] = []
    for (const e of sorted) {
      if (need <= 1e-9) break
      const eq = e.qtyValue ?? 1
      if (eq <= need + 1e-9) {
        ops.push(prisma.expense.update({ where: { id: e.id }, data: { ...tData, isCommonAsset: false } }))
        need -= eq
      } else {
        const assignedAmount = Math.round(e.amount * (need / eq))
        const remainAmount = e.amount - assignedAmount
        const remainQty = Math.round((eq - need) * 1000) / 1000
        const groupId = e.allocationGroupId ?? randomUUID()
        ops.push(prisma.expense.update({ where: { id: e.id }, data: { qtyValue: remainQty, amount: remainAmount, allocationGroupId: groupId, detail: buildAssetDetail({ ...e, qtyValue: remainQty }) } }))
        ops.push(prisma.expense.create({ data: {
          date: e.date, amount: assignedAmount, category: e.category,
          detail: buildAssetDetail({ ...e, qtyValue: need }),
          vendor: e.vendor, memo: e.memo, payMethod: e.payMethod, settleStatus: e.settleStatus,
          receiptUrl: e.receiptUrl, receiptUrls: e.receiptUrls, financeName: e.financeName,
          itemLabel: e.itemLabel, specValue: e.specValue, specUnit: e.specUnit,
          qtyValue: need, qtyUnit: e.qtyUnit,
          receivedAt: e.receivedAt, excludeFromInventory: e.excludeFromInventory,
          allocationGroupId: groupId, orderId: e.orderId, isShipping: e.isShipping,
          propertyId, roomId: tData.roomId, assignedLocationId: tData.assignedLocationId,
          financialAccountId: e.financialAccountId, recurringExpenseId: e.recurringExpenseId, receivedLocationId: e.receivedLocationId,
        } }))
        need = 0
      }
    }
    await prisma.$transaction(ops)
    await logAssignment(propertyId, rep0.itemLabel, fromState, await placeLabel(propertyId, tData.roomId, tData.assignedLocationId, false), movedQty)
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '배정에 실패했습니다.' }
  }
}

// 같은 분할 묶음(allocationGroupId)의 '미배정(방·위치 모두 없음)' 행들을 하나로 재병합.
async function mergeUnassignedGroup(propertyId: string, groupId: string): Promise<void> {
  const unassigned = await prisma.expense.findMany({
    where: { propertyId, allocationGroupId: groupId, roomId: null, assignedLocationId: null },
    orderBy: { createdAt: 'asc' },
  })
  const assignedCount = await prisma.expense.count({
    where: { propertyId, allocationGroupId: groupId, OR: [{ roomId: { not: null } }, { assignedLocationId: { not: null } }] },
  })
  if (unassigned.length <= 1) {
    // 묶음에 남은 행이 1개뿐이면 묶음 의미 없음 → groupId 정리(단독 행 복귀)
    if (unassigned.length === 1 && assignedCount === 0) {
      await prisma.expense.update({ where: { id: unassigned[0].id }, data: { allocationGroupId: null } })
    }
    return
  }
  const target = unassigned[0]
  const sumQty = unassigned.reduce((s, e) => s + (e.qtyValue ?? 0), 0)
  const sumAmt = unassigned.reduce((s, e) => s + e.amount, 0)
  await prisma.$transaction([
    prisma.expense.update({
      where: { id: target.id },
      data: {
        qtyValue: sumQty, amount: sumAmt,
        detail: buildAssetDetail({ ...target, qtyValue: sumQty }),
        allocationGroupId: assignedCount > 0 ? groupId : null,  // 배정행 없으면 단독 복귀
      },
    }),
    prisma.expense.deleteMany({ where: { id: { in: unassigned.slice(1).map(e => e.id) } } }),
  ])
}

