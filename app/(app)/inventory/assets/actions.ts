'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { getTrackedCategories } from '../categoryConfig'

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
}

export type AssetsData = {
  rooms: { roomId: string; roomNo: string; total: number; items: AssetItem[] }[]
  unassigned: AssetItem[]
  unassignedTotal: number
}

// 비품·자재 = 품목으로 입력된 지출 중 소모품(재고 추적 카테고리)·배송비를 제외한 내구재.
// (의자·거치대·수선유지 자재 등) 방 배정 여부로 나눠서 보여준다.
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
  }))

  const roomMap = new Map<string, { roomId: string; roomNo: string; total: number; items: AssetItem[] }>()
  const unassigned: AssetItem[] = []
  for (const it of items) {
    if (it.roomId && it.roomNo) {
      const cur = roomMap.get(it.roomId) ?? { roomId: it.roomId, roomNo: it.roomNo, total: 0, items: [] }
      cur.total += it.amount; cur.items.push(it)
      roomMap.set(it.roomId, cur)
    } else {
      unassigned.push(it)
    }
  }
  const rooms = [...roomMap.values()].sort((a, b) =>
    a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))

  return { rooms, unassigned, unassignedTotal: unassigned.reduce((s, i) => s + i.amount, 0) }
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

// 미배정(여분) 비품을 특정 방에 배정 → 해당 호실 지출로 이동. roomId=null 이면 배정 해제.
export async function assignExpenseToRoom(expenseId: string, roomId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const exp = await prisma.expense.findFirst({ where: { id: expenseId, propertyId }, select: { id: true } })
    if (!exp) return { ok: false, error: '지출 항목을 찾을 수 없습니다.' }
    if (roomId) {
      const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { id: true } })
      if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    }
    await prisma.expense.update({ where: { id: expenseId }, data: { roomId: roomId || null } })
    revalidatePath('/inventory/assets')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '배정에 실패했습니다.' }
  }
}
