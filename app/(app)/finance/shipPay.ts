// 배송비 행의 결제수단 확인과 수령 때 착불 배송비 행 만들기·되돌리기 공용층. 'use server' 아님(서버 전용, 화면에서 부를 수 없다).
//
// 지출 등록·주문 묶기(finance/actions), 소모품 수령(inventory/actions), 비품 수령(inventory/assets/actions)이 같은 판정을 탄다.
// 순수 판정과 문구는 lib/codShipping, 미정산 판정은 lib/settleStatus 정본이다(여기서 다시 짓지 않는다).
import prisma, { type PrismaDb } from '@/lib/prisma'
import { Prisma, type SettleStatus } from '@prisma/client'
import { accName, accountTypesFor } from '@/lib/payMethodOptions'
import { resolveShipPay, asksCodAtReceipt, SHIP_PAY_SAME } from '@/lib/codShipping'
import { settleStatusForNew } from '@/lib/settleStatus'
import { expenseTargetMonth, targetMonthForSave } from '@/lib/expenseTargetMonth'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'

export type ShipPayInput = { payMethod?: string | null; accountId?: string | null } | null | undefined
export type ShipPay = { payMethod: string; financialAccountId: string | null; financeName: string | null }

// 수령 때 적은 착불 배송비. amount 가 0 이하면 아무것도 만들지 않는다.
export type CodShipInput = { amount: number; payMethod: string; accountId: string | null }
// 수령 직후 토스트 [수령 취소] 가 그 수령이 만든 배송비 행을 함께 지우는 조각. 만든 직후 값 그대로일 때만 지운다(CAS).
export type CodShipUndo = { id: string; orderId: string; amount: number; updatedAt: string }

export const COD_SHIP_NOT_ASKED = '이 주문은 이미 배송비가 적혀 있거나 착불 주문이 아닙니다. 화면을 새로고침해 주세요.'
export const COD_SHIP_UNDO_STALE = '그 사이 착불 배송비 지출이 바뀌어 수령을 취소하지 않았습니다. 지출 관리에서 배송비 줄을 확인해 주세요.'

/**
 * 배송비 행의 결제수단을 정한다. '같은 수단'·빈 값이면 머리 그대로. 다른 수단이면 계정을 이 영업장에서 다시 읽고
 * 그 수단이 묻는 계정 종류인지 본다(계좌이체에 카드가 이어지지 않게). 계정 이름은 서버가 짓는다.
 */
export async function shipPayForSave(
  propertyId: string,
  head: { payMethod: string | null; financialAccountId: string | null; financeName: string | null },
  choice: ShipPayInput,
): Promise<{ ok: true; pay: ShipPay } | { ok: false; error: string }> {
  const m = (choice?.payMethod ?? '').trim()
  if (m.length > 40) return { ok: false, error: '배송비 결제수단이 올바르지 않습니다.' }
  if (!m || m === SHIP_PAY_SAME) return { ok: true, pay: resolveShipPay(head, null, null) }
  const accId = (choice?.accountId ?? '').trim()
  if (!accId) return { ok: true, pay: resolveShipPay(head, { payMethod: m }, null) }
  const accounts = await prisma.financialAccount.findMany({
    where: { propertyId }, select: { id: true, type: true, brand: true, alias: true },
  })
  const acc = accounts.find(a => a.id === accId)
  if (!acc) return { ok: false, error: '결제 계정을 찾을 수 없습니다.' }
  const types = accountTypesFor(m, accounts.map(a => ({ type: String(a.type), brand: a.brand, alias: a.alias })))
  if (!types || !types.includes(String(acc.type))) return { ok: false, error: '배송비 결제 계정이 결제수단과 맞지 않습니다.' }
  return { ok: true, pay: resolveShipPay(head, { payMethod: m, accountId: acc.id }, { id: acc.id, name: accName(acc) }) }
}

export function shipSettle(pay: ShipPay, shippingType: string | null): SettleStatus {
  return settleStatusForNew(pay.payMethod, { isShipping: true, shippingType }) as SettleStatus
}

/** 이 주문들 중 수령 자리에서 착불 배송비를 물을 주문 id. 미기록 착불이고 본품을 아직 하나도 안 받았다. */
export async function codAskOrderIds(propertyId: string, orderIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(orderIds.filter((v): v is string => !!v))]
  if (!ids.length) return new Set()
  const orders = await prisma.expenseOrder.findMany({
    where: { id: { in: ids }, propertyId, shippingType: '착불' },
    select: { id: true, shippingType: true, expenses: { select: { isShipping: true, receivedAt: true } } },
  })
  return new Set(orders.filter(o => asksCodAtReceipt(o, o.expenses)).map(o => o.id))
}

/**
 * 수령 때 적은 착불 배송비로 만들 배송비 행. 받는 본품 행(head)의 주문이 지금 물을 주문일 때만 만든다(그 사이 다른 수령이
 * 먼저 적었으면 거부). 날짜는 수령일(KST 오늘), 귀속월은 본품의 귀속월이다(배송비만 다른 달 결산에 남지 않게).
 * 결과는 부르는 쪽 트랜잭션에 넣을 create 인자다.
 */
export async function codShipCreateData(
  propertyId: string,
  head: {
    orderId: string | null; category: string; vendor: string | null; vendorBizNo: string | null; channel: string | null
    payMethod: string | null; financialAccountId: string | null; financeName: string | null
    date: Date; targetMonth: string | null
  },
  input: CodShipInput,
  now: Date,
): Promise<{ ok: true; data: Prisma.ExpenseUncheckedCreateInput | null } | { ok: false; error: string }> {
  const amount = Math.round(Number(input?.amount) || 0)
  if (!(amount > 0)) return { ok: true, data: null }
  if (amount > 10_000_000) return { ok: false, error: '배송비 금액이 올바르지 않습니다.' }
  if (!head.orderId || !(await codAskOrderIds(propertyId, [head.orderId])).has(head.orderId)) return { ok: false, error: COD_SHIP_NOT_ASKED }
  const p = await shipPayForSave(propertyId, head, { payMethod: input.payMethod, accountId: input.accountId })
  if (!p.ok) return p
  const ymd = kstYmdStr(now)
  return {
    ok: true,
    data: {
      propertyId,
      date: ymdToDbDate(ymd),
      targetMonth: targetMonthForSave(expenseTargetMonth({ targetMonth: head.targetMonth, date: head.date }), ymd),
      category: head.category,
      amount,
      detail: '배송비 (착불)',
      vendor: head.vendor,
      vendorBizNo: head.vendorBizNo,
      channel: head.channel,
      payMethod: p.pay.payMethod,
      financialAccountId: p.pay.financialAccountId,
      financeName: p.pay.financeName,
      settleStatus: shipSettle(p.pay, '착불'),
      orderId: head.orderId,
      isShipping: true,
      excludeFromInventory: true,
    },
  }
}

/**
 * 수령 트랜잭션 맨 앞에 넣는 관문 둘(배열 트랜잭션용). 화면을 연 뒤 같은 주문의 다른 수령이 먼저 배송비를 적었거나 본품을 받았으면
 * 그 트랜잭션 전체를 실패시킨다(동시에 두 번 받으면 배송비 줄이 둘 생기던 틈, 독립 검수 2026-11-02).
 *   1) 그 주문 키로 트랜잭션 잠금(pg_advisory_xact_lock). 같은 주문의 두 수령은 차례로 선다.
 *   2) 잠근 뒤 다시 본다. 여전히 착불이고 배송비 줄이 없고 이번에 받는 행 말고 받은 본품이 없어야 한다. 아니면 0 으로 나눠 실패한다
 *      (배열 트랜잭션은 결과로 분기할 수 없어 SQL 오류로 멈춘다). 부르는 쪽은 isCodShipGuardError 로 그 실패를 거부 문장으로 바꾼다.
 */
export function codShipGuardOps(propertyId: string, orderId: string, receivingIds: string[]): Prisma.PrismaPromise<unknown>[] {
  return [
    prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'cod-ship:' + orderId}))`),
    prisma.$queryRaw(Prisma.sql`
      SELECT 1 / (CASE WHEN EXISTS (
        SELECT 1 FROM "expense_orders" o
        WHERE o."id" = ${orderId}::uuid AND o."propertyId" = ${propertyId}::uuid AND o."shippingType" = '착불'
          AND NOT EXISTS (SELECT 1 FROM "expenses" s WHERE s."orderId" = o."id" AND s."isShipping" = true)
          AND NOT EXISTS (SELECT 1 FROM "expenses" r WHERE r."orderId" = o."id" AND r."isShipping" = false
                          AND r."receivedAt" IS NOT NULL AND NOT (r."id" = ANY(${receivingIds}::uuid[])))
      ) THEN 1 ELSE 0 END) AS ok`),
  ]
}
export function isCodShipGuardError(err: unknown): boolean {
  return /division by zero/i.test(String((err as Error)?.message ?? err))
}

export function codShipUndoOf(row: { id: string; orderId: string | null; amount: number; updatedAt: Date }): CodShipUndo | null {
  return row.orderId ? { id: row.id, orderId: row.orderId, amount: row.amount, updatedAt: row.updatedAt.toISOString() } : null
}

/**
 * 수령 직후 [수령 취소] 가 그 수령이 만든 배송비 행을 지운다. 부르는 쪽 트랜잭션 안이다. 조각은 화면이 들고 온 값이라
 * 이 영업장 배송비 행이고, 무르는 수령 행과 같은 주문이고, 만든 직후 값(금액·갱신 시각) 그대로일 때만 지운다.
 * 하나라도 어긋나면 던져서 수령 취소까지 함께 롤백한다.
 */
type Tx = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
export async function deleteCodShipTx(tx: Tx, propertyId: string, piece: CodShipUndo, orderIdOfReceipt: string | null): Promise<void> {
  if (!piece || typeof piece.id !== 'string' || !orderIdOfReceipt || piece.orderId !== orderIdOfReceipt) throw new Error(COD_SHIP_UNDO_STALE)
  const at = new Date(piece.updatedAt)
  if (Number.isNaN(at.getTime())) throw new Error(COD_SHIP_UNDO_STALE)
  const r = await tx.expense.deleteMany({
    where: { id: piece.id, propertyId, isShipping: true, orderId: piece.orderId, amount: piece.amount, updatedAt: at },
  })
  if (r.count !== 1) throw new Error(COD_SHIP_UNDO_STALE)
}

/** 토스트 이후의 수령 취소. 그 주문이 착불이고 배송비 행이 남았고 이제 받은 본품이 하나도 없으면 참(남아 있다고 말한다). */
export async function codShipKeptAfterCancel(propertyId: string, orderId: string | null): Promise<boolean> {
  if (!orderId) return false
  const o = await prisma.expenseOrder.findFirst({
    where: { id: orderId, propertyId, shippingType: '착불' },
    select: { expenses: { select: { isShipping: true, receivedAt: true } } },
  })
  if (!o) return false
  return o.expenses.some(e => e.isShipping) && o.expenses.every(e => e.isShipping || e.receivedAt == null)
}
