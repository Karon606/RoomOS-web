'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
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

export type AssetItem = {
  id: string
  date: string
  itemLabel: string
  detail: string | null
  amount: number
  qtyValue: number | null
  qtyUnit: string | null
  category: string
  vendor: string | null
  roomId: string | null
  roomNo: string | null
  locationId: string | null     // 공용부(StorageLocation) 배정 시
  locationName: string | null
}

export type AssetsData = {
  rooms: { roomId: string; roomNo: string; total: number; items: AssetItem[] }[]
  locations: { locationId: string; name: string; total: number; items: AssetItem[] }[]   // 공용부별
  unassigned: AssetItem[]
  unassignedTotal: number
}

// 비품·자재 = 품목으로 입력된 지출 중 소모품(재고 추적 카테고리)·배송비를 제외한 내구재.
// (의자·거치대·수선유지 자재 등) 방/공용부 배정 여부로 나눠서 보여준다.
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
      id: true, date: true, itemLabel: true, detail: true, amount: true,
      qtyValue: true, qtyUnit: true, category: true, vendor: true, roomId: true,
      room: { select: { roomNo: true } },
      assignedLocationId: true,
      assignedLocation: { select: { name: true } },
    },
  })

  const items: AssetItem[] = rows.map(r => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    itemLabel: r.itemLabel ?? '',
    detail: r.detail,
    amount: r.amount,
    qtyValue: r.qtyValue,
    qtyUnit: r.qtyUnit,
    category: r.category,
    vendor: r.vendor,
    roomId: r.roomId,
    roomNo: r.room?.roomNo ?? null,
    locationId: r.assignedLocationId,
    locationName: r.assignedLocation?.name ?? null,
  }))

  const roomMap = new Map<string, { roomId: string; roomNo: string; total: number; items: AssetItem[] }>()
  const locMap = new Map<string, { locationId: string; name: string; total: number; items: AssetItem[] }>()
  const unassigned: AssetItem[] = []
  for (const it of items) {
    if (it.roomId && it.roomNo) {
      const cur = roomMap.get(it.roomId) ?? { roomId: it.roomId, roomNo: it.roomNo, total: 0, items: [] }
      cur.total += it.amount; cur.items.push(it)
      roomMap.set(it.roomId, cur)
    } else if (it.locationId && it.locationName) {
      const cur = locMap.get(it.locationId) ?? { locationId: it.locationId, name: it.locationName, total: 0, items: [] }
      cur.total += it.amount; cur.items.push(it)
      locMap.set(it.locationId, cur)
    } else {
      unassigned.push(it)
    }
  }
  const rooms = [...roomMap.values()].sort((a, b) =>
    a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))
  const locations = [...locMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ko', { numeric: true }))

  return { rooms, locations, unassigned, unassignedTotal: unassigned.reduce((s, i) => s + i.amount, 0) }
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

// 비품을 방/공용부에 배정(통째) 또는 해제(none). 해제 시: 분할(allocationGroupId)이면 같은 묶음 미배정 행 자동 재병합.
export async function assignExpenseToTarget(expenseId: string, target: AssignTarget): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const exp = await prisma.expense.findFirst({ where: { id: expenseId, propertyId }, select: { id: true, allocationGroupId: true } })
    if (!exp) return { ok: false, error: '지출 항목을 찾을 수 없습니다.' }
    const err = await validateTarget(target, propertyId)
    if (err) return { ok: false, error: err }
    await prisma.expense.update({ where: { id: expenseId }, data: targetData(target) })
    // 해제(=미배정 복귀)면 같은 분할 묶음의 미배정 행끼리 재병합
    if (target.kind === 'none' && exp.allocationGroupId) await mergeUnassignedGroup(propertyId, exp.allocationGroupId)
    revalidatePath('/inventory/assets')
    revalidatePath('/inventory')
    revalidatePath('/finance')
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

// 비품 중 일부 수량만 방/공용부에 배정 → 그 수량만큼 새 행으로 분할(금액 비례),
// 나머지는 원래 자리 유지. 같은 allocationGroupId 로 묶어 표시·재병합.
// qty >= 전체수량 또는 수량 정보 없으면 통째 이동.
export async function assignExpensePartialToTarget(
  expenseId: string, target: { kind: 'room' | 'location'; id: string }, qty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const exp = await prisma.expense.findFirst({ where: { id: expenseId, propertyId } })
    if (!exp) return { ok: false, error: '지출 항목을 찾을 수 없습니다.' }
    const verr = await validateTarget(target, propertyId)
    if (verr) return { ok: false, error: verr }
    const tData = targetData(target)

    const totalQty = exp.qtyValue ?? 0
    let q = qty
    if (!(q > 0)) q = 1
    if (q > totalQty) q = totalQty

    // 수량 정보 없거나 전량 배정 → 통째 이동
    if (totalQty <= 1 || q >= totalQty) {
      await prisma.expense.update({ where: { id: expenseId }, data: tData })
      revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
      return { ok: true }
    }

    // 부분 분할 — 금액은 수량 비례, 잔여는 원본이 흡수
    const assignedAmount = Math.round(exp.amount * (q / totalQty))
    const remainAmount = exp.amount - assignedAmount
    const remainQty = Math.round((totalQty - q) * 1000) / 1000
    const groupId = exp.allocationGroupId ?? randomUUID()

    await prisma.$transaction([
      // 원본 = 나머지 (배정 위치 유지: 미배정이면 미배정, 다른 방/공용부면 그대로)
      prisma.expense.update({
        where: { id: expenseId },
        data: { qtyValue: remainQty, amount: remainAmount, allocationGroupId: groupId, detail: buildAssetDetail({ ...exp, qtyValue: remainQty }) },
      }),
      // 신규 = 배정분 (그 방/공용부로)
      prisma.expense.create({
        data: {
          date: exp.date, amount: assignedAmount, category: exp.category,
          detail: buildAssetDetail({ ...exp, qtyValue: q }),
          vendor: exp.vendor, memo: exp.memo, payMethod: exp.payMethod,
          settleStatus: exp.settleStatus, receiptUrl: exp.receiptUrl, receiptUrls: exp.receiptUrls,
          financeName: exp.financeName,
          itemLabel: exp.itemLabel, specValue: exp.specValue, specUnit: exp.specUnit,
          qtyValue: q, qtyUnit: exp.qtyUnit,
          receivedAt: exp.receivedAt, excludeFromInventory: exp.excludeFromInventory,
          allocationGroupId: groupId, orderId: exp.orderId, isShipping: exp.isShipping,
          propertyId, roomId: tData.roomId, assignedLocationId: tData.assignedLocationId,
          financialAccountId: exp.financialAccountId, recurringExpenseId: exp.recurringExpenseId,
          receivedLocationId: exp.receivedLocationId,
        },
      }),
    ])
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '배정에 실패했습니다.' }
  }
}
