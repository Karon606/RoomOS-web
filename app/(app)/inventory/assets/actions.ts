'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
// 이 파일의 모든 쓰기 게이트는 재고 스코프로 판정한다(전역 requireEdit 아님) — 제한 스태프 재고 쓰기 허용(65992b0a).
import { requireScopeEdit } from '@/lib/role'
const requireEdit = () => requireScopeEdit('inventory')
import { getTrackedCategories } from '../categoryConfig'

// 품목 detail 문자열 재구성 (addExpense 와 동일 포맷: "[라벨] 규격 x 수량단위")
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))
function buildAssetDetail(e: { itemLabel: string | null; specValue: number | null; specUnit: string | null; specText?: string | null; qtyValue: number | null; qtyUnit: string | null }): string {
  const label = e.itemLabel ?? ''
  const spec = e.specText ? ` ${e.specText}` : e.specValue != null ? ` ${fmtQty(e.specValue)}${e.specUnit ?? ''}` : ''
  const qty = e.qtyValue != null ? ` x ${fmtQty(e.qtyValue)}${e.qtyUnit ?? ''}` : ''
  return `[${label}]${spec}${qty}`
}

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
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
  specText: string | null       // 서술형 규격(카드 구분·검색용)
  specValue: number | null      // 숫자 규격값(60 등) — 카드 제목 규격 병기용(오류신고 86f1418e)
  specUnit: string | null       // 규격 단위(cm 등)
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
  isService: boolean            // 서비스·무형(시공비) — 자산 아님, 방별 비용 집계용
  assignedAt: string | null     // 방/공용부 배정일(대표=최근). null=미배정 또는 미상
  breakdown: { id: string; date: string; qty: number | null; amount: number; specValue: number | null; specUnit: string | null; specText: string | null }[]   // 합산 펼치기 — 개별 구매 내역(행별 규격 수정용 id 포함)
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
  qtyValue: number | null; qtyUnit: string | null; specValue: number | null; specUnit: string | null; specText: string | null
  category: string; vendor: string | null
  roomId: string | null; roomNo: string | null; locationId: string | null; locationName: string | null
  isCommon: boolean; received: boolean; assignedAt: string | null
  isService: boolean               // 서비스·무형(시공비 등) — 방별 비용에 포함, 카드에 칩 표시
}

// 한 버킷의 행들을 동일 품목끼리 묶어 AssetItem[] 로 집계
function aggregateAssets(list: RawAsset[]): AssetItem[] {
  const map = new Map<string, { spec: number | null; specUnit: string | null; specText: string | null; rows: RawAsset[] }>()
  for (const r of list) {
    const key = [r.itemLabel, r.specValue ?? '', r.specUnit ?? '', r.specText ?? '', r.qtyUnit ?? '', r.category, r.isCommon ? 'C' : '', r.isService ? 'S' : ''].join('␟')
    const g = map.get(key) ?? { spec: r.specValue, specUnit: r.specUnit, specText: r.specText, rows: [] }
    g.rows.push(r); map.set(key, g)
  }
  const out: AssetItem[] = []
  for (const g of map.values()) {
    const rows = g.rows
    const hasQty = rows.some(r => r.qtyValue != null)
    const qtyValue = hasQty ? rows.reduce((s, r) => s + (r.qtyValue ?? 0), 0) : null
    const amount = rows.reduce((s, r) => s + r.amount, 0)
    const date = rows.reduce((d, r) => (r.date > d ? r.date : d), rows[0].date)
    const assignedAt = rows.map(r => r.assignedAt).filter((x): x is string => !!x).sort().pop() ?? null   // 대표=가장 최근 배정일
    const rep = rows[0]
    out.push({
      id: rep.id, ids: rows.map(r => r.id), count: rows.length, date,
      itemLabel: rep.itemLabel, specText: g.specText, specValue: g.spec, specUnit: g.specUnit,
      detail: buildAssetDetail({ itemLabel: rep.itemLabel, specValue: g.spec, specUnit: g.specUnit, specText: g.specText, qtyValue, qtyUnit: rep.qtyUnit }),
      amount, qtyValue, qtyUnit: rep.qtyUnit, category: rep.category, vendor: rep.vendor,
      roomId: rep.roomId, roomNo: rep.roomNo, locationId: rep.locationId, locationName: rep.locationName,
      isCommon: rep.isCommon, isService: rep.isService, assignedAt,
      breakdown: rows.map(r => ({ id: r.id, date: r.date, qty: r.qtyValue, amount: r.amount, specValue: r.specValue, specUnit: r.specUnit, specText: r.specText }))
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
      category: { notIn: trackedCats },
      // 물품(내구재)은 전부, 서비스·무형은 방/공용부에 귀속된 것만(방별 투자 비용 복원, 신고 54fb838b)
      OR: [
        { excludeFromInventory: false },
        { excludeFromInventory: true, roomId: { not: null } },
        { excludeFromInventory: true, assignedLocationId: { not: null } },
      ],
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, date: true, itemLabel: true, amount: true,
      qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, specText: true,
      category: true, vendor: true, roomId: true,
      room: { select: { roomNo: true } },
      assignedLocationId: true,
      assignedLocation: { select: { name: true } },
      isCommonAsset: true, receivedAt: true, assignedAt: true, excludeFromInventory: true,
    },
  })

  const raws: RawAsset[] = rows.map(r => ({
    id: r.id, date: r.date.toISOString().slice(0, 10), itemLabel: r.itemLabel ?? '',
    amount: r.amount, qtyValue: r.qtyValue, qtyUnit: r.qtyUnit, specValue: r.specValue, specUnit: r.specUnit, specText: r.specText,
    category: r.category, vendor: r.vendor,
    roomId: r.roomId, roomNo: r.room?.roomNo ?? null,
    locationId: r.assignedLocationId, locationName: r.assignedLocation?.name ?? null,
    isCommon: r.isCommonAsset, received: r.receivedAt != null, isService: r.excludeFromInventory,
    assignedAt: r.assignedAt ? kstYmd(r.assignedAt) : null,
  }))

  const roomBuckets = new Map<string, RawAsset[]>()
  const locBuckets = new Map<string, RawAsset[]>()
  const pendingRaw: RawAsset[] = []
  const commonRaw: RawAsset[] = []
  const unassignedRaw: RawAsset[] = []
  for (const r of raws) {
    // 서비스(무형·시공비)는 '수령' 개념이 없으므로 수령 대기로 보내지 않고 바로 배정 대상으로(오류신고 0443289d).
    if (!r.received && !r.isService) pendingRaw.push(r)   // 수령 대기 — 배정 전, 최우선 분리(물품만)
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
export async function setAssetReceived(expenseIds: string[], received: boolean, qty?: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!expenseIds.length) return { ok: false, error: '대상 항목이 없습니다.' }
    // 부분 수령(분할 배송) — qty가 전체 미만이면 그 수량만 수령: 수량 큰 행부터 통째 소진,
    // 마지막만 분할(금액 비례·allocationGroupId 공유). 잔여는 수령 대기 유지. (배정 분할과 동일 선례)
    if (received && qty != null) {
      const exps = await prisma.expense.findMany({ where: { id: { in: expenseIds }, propertyId } })
      const totalQty = exps.reduce((s, e) => s + (e.qtyValue ?? 1), 0)
      if (qty > 0 && qty < totalQty) {
        let need = qty
        const now = new Date()
        const sorted = [...exps].sort((a, b) => (b.qtyValue ?? 1) - (a.qtyValue ?? 1))
        const ops: Prisma.PrismaPromise<unknown>[] = []
        for (const e of sorted) {
          if (need <= 1e-9) break
          const eq = e.qtyValue ?? 1
          if (eq <= need + 1e-9) {
            ops.push(prisma.expense.update({ where: { id: e.id }, data: { receivedAt: now } }))
            need -= eq
          } else {
            const recvAmount = Math.round(e.amount * (need / eq))
            const remainQty = Math.round((eq - need) * 1000) / 1000
            const groupId = e.allocationGroupId ?? randomUUID()
            ops.push(prisma.expense.update({ where: { id: e.id }, data: { qtyValue: remainQty, amount: e.amount - recvAmount, allocationGroupId: groupId, detail: buildAssetDetail({ ...e, qtyValue: remainQty }) } }))
            ops.push(prisma.expense.create({ data: {
              date: e.date, amount: recvAmount, category: e.category,
              detail: buildAssetDetail({ ...e, qtyValue: need }),
              vendor: e.vendor, memo: e.memo, payMethod: e.payMethod, settleStatus: e.settleStatus,
              receiptUrl: e.receiptUrl, receiptUrls: e.receiptUrls, financeName: e.financeName,
              itemLabel: e.itemLabel, specValue: e.specValue, specUnit: e.specUnit,
              qtyValue: need, qtyUnit: e.qtyUnit,
              receivedAt: now, excludeFromInventory: e.excludeFromInventory,
              allocationGroupId: groupId, orderId: e.orderId, isShipping: e.isShipping,
              propertyId, roomId: e.roomId, assignedLocationId: e.assignedLocationId,
              financialAccountId: e.financialAccountId, recurringExpenseId: e.recurringExpenseId, receivedLocationId: e.receivedLocationId,
            } }))
            need = 0
          }
        }
        await prisma.$transaction(ops)
        revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
        return { ok: true }
      }
    }
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

// 배정일 입력·수정 — 방/공용부에 배정된 비품 묶음의 배정일(assignedAt)을 설정. 빈 값이면 미상(null)으로.
// 구매 행별 규격 지정·수정 — 그룹 키에 규격이 포함되므로 규격이 달라지면 별도 카드로 분리된다.
// 사이즈가 달라 단가가 다른 제품(의자발커버 등)이 한 카드로 묶여 배정이 임의로 되던 문제 해결(오류신고 3707bf65).
// 금액·수량은 불변 — 규격 표기만 변경(§4: 재고 수학은 내구재 카테고리 밖이라 무영향).
export async function setAssetRowSpec(expenseId: string, specValue: number | null, specUnit: string | null, specText?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const row = await prisma.expense.findFirst({ where: { id: expenseId, propertyId }, select: { id: true } })
    if (!row) return { ok: false, error: '구매 행을 찾을 수 없습니다.' }
    await prisma.expense.update({ where: { id: expenseId }, data: { specValue, specUnit, specText: specText ?? null } })
    revalidatePath('/inventory/assets')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setAssetAssignedAt(expenseIds: string[], dateStr: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (!expenseIds.length) return { ok: false, error: '대상 항목이 없습니다.' }
    const val = dateStr ? new Date(`${dateStr}T00:00:00Z`) : null
    if (dateStr && Number.isNaN(val!.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    await prisma.expense.updateMany({
      where: { id: { in: expenseIds }, propertyId },
      data: { assignedAt: val },
    })
    revalidatePath('/inventory/assets'); revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 무상입수 — 무상으로 생긴 비품을 0원 Expense(재고자산)로 등록. 지출 ≥1원 강제를 우회.
// 재무 합계 영향 0(0원), 화면엔 amount===0 → '무상' 배지. 스키마 변경 없음.
export async function addFreeAsset(input: {
  itemLabel: string; category: string
  specValue?: number | null; specUnit?: string | null
  specText?: string | null
  qtyValue: number; qtyUnit?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const label = input.itemLabel.trim()
    if (!label) return { ok: false, error: '품목명을 입력하세요.' }
    const cat = (input.category || '').trim() || '비품'
    const trackedCats = await getTrackedCategories(propertyId)
    if (trackedCats.includes(cat)) return { ok: false, error: '소모품(재고추적) 분류는 무상 비품에 쓸 수 없습니다.' }
    const qty = input.qtyValue > 0 ? input.qtyValue : 1
    const qtyUnit = (input.qtyUnit || '').trim() || '개'
    await prisma.expense.create({
      data: {
        propertyId,
        date: new Date(),          // 오늘
        amount: 0,                 // 무상
        category: cat,
        itemLabel: label,
        specValue: input.specValue ?? null,
        specUnit: input.specUnit ?? null,
        specText: input.specText?.trim() || null,
        qtyValue: qty,
        qtyUnit,
        detail: buildAssetDetail({ itemLabel: label, specValue: input.specValue ?? null, specUnit: input.specUnit ?? null, specText: input.specText?.trim() || null, qtyValue: qty, qtyUnit }),
        receivedAt: new Date(),    // 무상은 보통 손에 들어온 상태 → 수령 완료
        memo: '무상입수',
        isShipping: false,
        excludeFromInventory: false,
        isCommonAsset: false,
      },
    })
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '무상 비품 등록 중 오류가 발생했습니다.' }
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
  assignedAt?: Date | null,   // 운영자 지정 배정일 — 이력 표시는 이 값 우선(없으면 기록 시각)
) {
  if (from.kind === to.kind && from.label === to.label) return   // 변화 없음
  try {
    await prisma.assetAssignmentLog.create({
      data: { propertyId, itemLabel, fromKind: from.kind, fromLabel: from.label, toKind: to.kind, toLabel: to.label, qty, assignedAt: assignedAt ?? null },
    })
  } catch { /* asset_assignment_log 미적용 — 무시 */ }
}

// 날짜 표시는 KST 기준 — UTC slice 는 자정 근처·+09 저장값에서 하루 밀린다(운영자 신고 2026-07-09)
const kstYmd = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)

// 비품 한 품목의 배정 변경 이력(최근순). 테이블 미적용 시 빈 배열.
export type AssetAssignmentLogRow = { id: string; itemLabel: string | null; fromKind: string; fromLabel: string | null; toKind: string; toLabel: string | null; qty: number | null; assignedAt: string | null; createdAt: string }
export async function getAssetAssignmentLog(itemLabel: string): Promise<AssetAssignmentLogRow[]> {
  try {
    const propertyId = await getPropertyId()
    const rows = await prisma.assetAssignmentLog.findMany({
      where: { propertyId, itemLabel }, orderBy: { createdAt: 'desc' }, take: 30,
    })
    return rows.map(r => ({ id: r.id, itemLabel: r.itemLabel, fromKind: r.fromKind, fromLabel: r.fromLabel, toKind: r.toKind, toLabel: r.toLabel, qty: r.qty, assignedAt: r.assignedAt ? kstYmd(r.assignedAt) : null, createdAt: kstYmd(r.createdAt) }))
  } catch { return [] }
}

// ============================================================
// 이동 연산 공통 — 수량 큰 행부터 통째 소진해 분할 최소화, 마지막만 쪼갬(금액 비례 분배).
//   data.assignedAt 을 생략하면 행의 기존 배정일을 유지한다(이력 되돌리기용).
// ============================================================
type ExpRow = Prisma.ExpenseGetPayload<Record<string, never>>
type MoveData = { roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean; assignedAt?: Date | null }
function buildSplitOps(exps: ExpRow[], propertyId: string, data: MoveData, qty: number | null):
  { ops: Prisma.PrismaPromise<unknown>[]; movedQty: number; touchedGroups: string[] } {
  const totalQty = exps.reduce((s, e) => s + (e.qtyValue ?? 1), 0)
  const movedQty = (qty == null || qty >= totalQty) ? totalQty : Math.max(1, qty)
  let need = movedQty
  // 선입선출 — 오래된 구매분부터 차감(운영자 확인 2026-07-09). 같은 날짜 안에서는 큰 행부터(분할 최소화).
  const sorted = [...exps].sort((a, b) => a.date.getTime() - b.date.getTime() || (b.qtyValue ?? 1) - (a.qtyValue ?? 1))
  const ops: Prisma.PrismaPromise<unknown>[] = []
  const touched: string[] = []
  for (const e of sorted) {
    if (need <= 1e-9) break
    const eq = e.qtyValue ?? 1
    if (e.allocationGroupId) touched.push(e.allocationGroupId)
    if (eq <= need + 1e-9) {
      ops.push(prisma.expense.update({ where: { id: e.id }, data }))
      need -= eq
    } else {
      const assignedAmount = Math.round(e.amount * (need / eq))
      const remainAmount = e.amount - assignedAmount
      const remainQty = Math.round((eq - need) * 1000) / 1000
      const groupId = e.allocationGroupId ?? randomUUID()
      if (!e.allocationGroupId) touched.push(groupId)
      ops.push(prisma.expense.update({ where: { id: e.id }, data: { qtyValue: remainQty, amount: remainAmount, allocationGroupId: groupId, detail: buildAssetDetail({ ...e, qtyValue: remainQty }) } }))
      ops.push(prisma.expense.create({ data: {
        date: e.date, amount: assignedAmount, category: e.category,
        detail: buildAssetDetail({ ...e, qtyValue: need }),
        vendor: e.vendor, memo: e.memo, payMethod: e.payMethod, settleStatus: e.settleStatus,
        receiptUrl: e.receiptUrl, receiptUrls: e.receiptUrls, financeName: e.financeName,
        itemLabel: e.itemLabel, specValue: e.specValue, specUnit: e.specUnit, specText: e.specText, unitBasis: e.unitBasis,
        qtyValue: need, qtyUnit: e.qtyUnit,
        receivedAt: e.receivedAt, excludeFromInventory: e.excludeFromInventory,
        allocationGroupId: groupId, orderId: e.orderId, isShipping: e.isShipping,
        propertyId, roomId: data.roomId, assignedLocationId: data.assignedLocationId, isCommonAsset: data.isCommonAsset,
        assignedAt: 'assignedAt' in data ? data.assignedAt : e.assignedAt,
        financialAccountId: e.financialAccountId, recurringExpenseId: e.recurringExpenseId, receivedLocationId: e.receivedLocationId,
      } }))
      need = 0
    }
  }
  return { ops, movedQty, touchedGroups: [...new Set(touched)] }
}

export async function assignAggregateToTarget(
  expenseIds: string[], target: AssignTarget, qty: number | null,
  assignedAtYmd?: string | null,   // 배정일 직접 지정(YYYY-MM-DD, 미지정 = 오늘) — 운영자 요청 2026-07-08
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
    const isNone = target.kind === 'none'
    const tData = isNone ? { roomId: null, assignedLocationId: null } : targetData(target)
    // 배정일 — 방/공용부 배정 시 기본 '지금', 직접 지정 가능(이후 상세에서 수정). 미배정 복귀는 비움.
    const assignedAtVal = isNone ? null : (assignedAtYmd ? new Date(assignedAtYmd) : new Date())
    const { ops, movedQty, touchedGroups } = buildSplitOps(exps, propertyId, { ...tData, isCommonAsset: false, assignedAt: assignedAtVal }, qty)
    await prisma.$transaction(ops)
    if (isNone) for (const g of touchedGroups) await mergeUnassignedGroup(propertyId, g)
    await logAssignment(propertyId, rep0.itemLabel, fromState,
      isNone ? { kind: 'none', label: '미배정' } : await placeLabel(propertyId, tData.roomId, tData.assignedLocationId, false), movedQty, assignedAtVal)
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '배정에 실패했습니다.' }
  }
}

// ============================================================
// 배정 이력 되돌리기·삭제 — 이력 라벨(방번호·공용부명)로 위치를 복원해 역이동.
//   되돌리면 그 이력 행이 함께 삭제되고 새 이력은 남지 않는다(운영자 요청 2026-07-08).
// ============================================================
async function resolvePlace(propertyId: string, kind: string, label: string | null):
  Promise<{ roomId: string | null; locationId: string | null; isCommon: boolean } | { error: string }> {
  if (kind === 'room') {
    const no = (label ?? '').replace(/호$/, '')
    const room = await prisma.room.findFirst({ where: { propertyId, roomNo: no }, select: { id: true } })
    if (!room) return { error: `'${label}' 방을 찾을 수 없습니다.` }
    return { roomId: room.id, locationId: null, isCommon: false }
  }
  if (kind === 'location') {
    const loc = await prisma.storageLocation.findFirst({ where: { propertyId, name: label ?? '' }, select: { id: true } })
    if (!loc) return { error: `'${label}' 공용부를 찾을 수 없습니다.` }
    return { roomId: null, locationId: loc.id, isCommon: false }
  }
  return { roomId: null, locationId: null, isCommon: kind === 'common' }
}

export async function revertAssignmentLog(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const log = await prisma.assetAssignmentLog.findFirst({ where: { id: logId, propertyId } })
    if (!log) return { ok: false, error: '이력을 찾을 수 없습니다.' }
    const to = await resolvePlace(propertyId, log.toKind, log.toLabel)
    if ('error' in to) return { ok: false, error: to.error }
    const from = await resolvePlace(propertyId, log.fromKind, log.fromLabel)
    if ('error' in from) return { ok: false, error: from.error }
    // 지금 '간 곳(to)'에 남아 있는 같은 품목 행에서 그만큼 되가져온다
    const exps = await prisma.expense.findMany({ where: {
      propertyId, itemLabel: log.itemLabel,
      roomId: to.roomId, assignedLocationId: to.locationId,
      ...(to.roomId || to.locationId ? {} : { isCommonAsset: to.isCommon }),
    } })
    const avail = exps.reduce((s, e) => s + (e.qtyValue ?? 1), 0)
    if (!exps.length || (log.qty != null && avail + 1e-9 < log.qty))
      return { ok: false, error: `${log.toLabel ?? '해당 위치'}에 되돌릴 수량이 남아 있지 않습니다(이후 다른 곳으로 옮겨진 것 같아요). 이 이력은 삭제만 할 수 있습니다.` }
    const isNone = !from.roomId && !from.locationId && !from.isCommon
    const data: MoveData = { roomId: from.roomId, assignedLocationId: from.locationId, isCommonAsset: from.isCommon }
    if (isNone || from.isCommon) data.assignedAt = null   // 미배정·공용 복귀는 배정일 비움, 방·공용부 복귀는 기존 배정일 유지
    const { ops, touchedGroups } = buildSplitOps(exps, propertyId, data, log.qty)
    ops.push(prisma.assetAssignmentLog.delete({ where: { id: log.id } }))
    await prisma.$transaction(ops)
    if (isNone) for (const g of touchedGroups) await mergeUnassignedGroup(propertyId, g)
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

export async function deleteAssignmentLog(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.assetAssignmentLog.deleteMany({ where: { id: logId, propertyId } })
    revalidatePath('/inventory/assets')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// ============================================================
// 일괄 배정 — 선택한 비품들을 한 대상(방/공용부)에 각자 지정 수량만큼 배정 + 적용취소(v2.0 §16·rollback)
//   품목별 qty(null=전량)를 받아 assignAggregateToTarget 재사용. 영향 행 원상태 스냅샷 +
//   분할로 새로 생긴 행 id를 모아 undo 토큰으로 반환 → undoBatchAssignAssets 가 정확히 원복.
// ============================================================
export type AssetAssignUndo = {
  restore: {
    id: string; roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean
    qtyValue: number | null; amount: number; allocationGroupId: string | null; detail: string | null
  }[]
  deleteIds: string[]
}

export async function batchAssignAssets(
  input: { items: { ids: string[]; qty: number | null }[]; target: AssignTarget; assignedAt?: string | null },
): Promise<{ ok: true; assigned: number; undo: AssetAssignUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const items = input.items.filter(i => i.ids.length)
    if (!items.length) return { ok: false, error: '선택된 비품이 없습니다.' }
    const verr = await validateTarget(input.target, propertyId)
    if (verr) return { ok: false, error: verr }

    // 적용취소용 — 영향 행 전체의 원상태 스냅샷
    const allIds = [...new Set(items.flatMap(i => i.ids))]
    const restore = await prisma.expense.findMany({
      where: { id: { in: allIds }, propertyId },
      select: { id: true, roomId: true, assignedLocationId: true, isCommonAsset: true, qtyValue: true, amount: true, allocationGroupId: true, detail: true },
    })

    const deleteIds: string[] = []
    let assigned = 0
    for (const it of items) {
      const before = new Set((await prisma.expense.findMany({ where: { propertyId }, select: { id: true } })).map(e => e.id))
      const res = await assignAggregateToTarget(it.ids, input.target, it.qty, input.assignedAt ?? null)
      if (!res.ok) continue
      assigned++
      const after = await prisma.expense.findMany({ where: { propertyId }, select: { id: true } })
      for (const e of after) if (!before.has(e.id)) deleteIds.push(e.id)   // 분할로 새로 생긴 행
    }
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true, assigned, undo: { restore, deleteIds } }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '일괄 배정 중 오류가 발생했습니다.' }
  }
}

export async function undoBatchAssignAssets(undo: AssetAssignUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.$transaction([
      ...(undo.deleteIds.length ? [prisma.expense.deleteMany({ where: { id: { in: undo.deleteIds }, propertyId } })] : []),
      ...undo.restore.map(r => prisma.expense.update({
        where: { id: r.id },
        data: {
          roomId: r.roomId, assignedLocationId: r.assignedLocationId, isCommonAsset: r.isCommonAsset,
          qtyValue: r.qtyValue, amount: r.amount, allocationGroupId: r.allocationGroupId, detail: r.detail,
        },
      })),
    ])
    revalidatePath('/inventory/assets'); revalidatePath('/inventory'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '적용취소 중 오류가 발생했습니다.' }
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

