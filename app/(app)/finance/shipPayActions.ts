'use server'

// 착불 배송비 화면 액션. 수령 자리(재고·비품)가 쓸 결제수단 선택지와, 미기록 착불을 '없었음' 으로 닫기·그 적용취소.
//
// 선택지는 지출 화면과 같은 한 벌이다(영업장 결제수단 목록 + 선불 계정 브랜드, 활성 결제 계정, lib/payMethodOptions).
// 결제 계정 이름은 돈 화면의 정보라 편집 권한이 있는 사람만 읽는다(수령 확인 자체가 편집 권한일 때만 열린다).
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { parseOptionList } from '@/lib/optionLists'
import { effectivePayMethods } from '@/lib/payMethodOptions'

export type ShipPayOptions = { methods: string[]; accounts: { id: string; type: string; brand: string; alias: string | null }[] }

export async function getShipPayOptions(): Promise<ShipPayOptions & { propertyId: string }> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const [prop, accounts] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId }, select: { paymentMethods: true } }),
    prisma.financialAccount.findMany({
      where: { propertyId, isActive: true }, orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, brand: true, alias: true },
    }),
  ])
  return {
    propertyId,
    methods: effectivePayMethods(parseOptionList('paymentMethods', prop?.paymentMethods), accounts),
    accounts: accounts.map(a => ({ id: a.id, type: String(a.type), brand: a.brand, alias: a.alias })),
  }
}

const CLOSE_STALE = '그 사이 이 주문의 배송비가 바뀌었습니다. 화면을 새로고침해 주세요.'

/**
 * 미기록 착불을 '배송비 없었음' 으로 닫는다. 착불 결제구분을 비운다(배송비가 없던 주문). 지금도 착불이고 배송비 행이 없을 때만(CAS).
 * 되돌리면 다시 '착불 · 배송비 미기록' 이 된다.
 */
// 닫기 적용취소 토큰. 닫은 그 주문이고 닫은 직후 그대로일 때만 되돌린다(갱신 시각 CAS, 독립 검수 2026-11-02).
export type CodCloseUndo = { orderId: string; closedAt: string }
export async function closeCodShipping(orderId: string): Promise<{ ok: true; undo: CodCloseUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const r = await prisma.expenseOrder.updateMany({
      where: { id: orderId, propertyId, shippingType: '착불', expenses: { none: { isShipping: true } } },
      data: { shippingType: null },
    })
    if (r.count !== 1) return { ok: false, error: CLOSE_STALE }
    const o = await prisma.expenseOrder.findFirst({ where: { id: orderId, propertyId }, select: { updatedAt: true } })
    revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/inventory/assets')
    return { ok: true, undo: { orderId, closedAt: (o?.updatedAt ?? new Date()).toISOString() } }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

/** '없었음' 의 적용취소. 닫은 그 주문이 닫은 직후 그대로일 때만(갱신 시각 CAS). 그 뒤 결제구분을 다시 고르거나 배송비 행이 생겼으면 거부한다. */
export async function undoCloseCodShipping(u: CodCloseUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const at = new Date(u?.closedAt ?? '')
    if (typeof u?.orderId !== 'string' || Number.isNaN(at.getTime())) return { ok: false, error: CLOSE_STALE }
    const r = await prisma.expenseOrder.updateMany({
      where: { id: u.orderId, propertyId, shippingType: null, updatedAt: at, expenses: { none: { isShipping: true } } },
      data: { shippingType: '착불' },
    })
    if (r.count !== 1) return { ok: false, error: CLOSE_STALE }
    revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/inventory/assets')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '적용취소 중 오류가 발생했습니다.' }
  }
}
