'use server'

// 방 청소 이력 — 등록·완료·적용취소 (2026-08-05, 신고 b21e4e98).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다. 상태 관리 문제라
// **회계에 접점이 0이다.** 이 파일은 ExtraIncome 도 Expense 도 만들지 않는다.
// 비용 연결은 2단계이고, 그때도 Expense 를 만들어 id 를 걸 뿐 금액을 여기 복사하지 않는다.
//
// 적용하는 모든 기능에는 적용취소가 있어야 한다는 원칙에 따라 완료·건너뜀은 되돌릴 수 있다.
// 삭제는 소프트삭제다.

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
// 상수·타입은 별도 모듈에서 가져온다. 'use server' 파일은 async 함수만 내보낼 수 있어
// 여기서 다시 export 하면 안 된다 — 재수출도 같은 규칙에 걸린다.
import {
  CLEANING_EXPENSE_CATEGORY,
  type CleaningReason, type CleaningStatus, type CleaningPerformer, type CleaningRow,
  type CleaningFundStatus,
} from './cleaningConstants'
import { CLEANING_FEE_CATEGORY } from '@/lib/incomeCategories'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

// 보증금에서 청소비 명목으로 뗀 몰취의 사유 문자열 — lib/depositWithholdReasons 의 선택지 그대로다.
// 받은 청소비와 이름만 같을 뿐 다른 테이블·다른 개념이라 수입 카테고리 상수를 재사용하지 않는다.
const CLEANING_WITHHOLD_REASON = '청소비'

type CheckoutLeaseCandidate = { id: string; moveOutDate: Date | null; expectedMoveOut: Date | null }
// 퇴실일은 확정 퇴실일이 있으면 그것, 없으면 예정일. 둘 다 없으면 맨 뒤로 민다.
const checkoutTime = (l: CheckoutLeaseCandidate) => (l.moveOutDate ?? l.expectedMoveOut)?.getTime() ?? -Infinity

/** 그 방의 퇴실·퇴실예정 계약 중 퇴실일이 가장 늦은 것. 없으면 null. */
function pickLatestCheckoutLease(rows: CheckoutLeaseCandidate[]): string | null {
  let best: CheckoutLeaseCandidate | null = null
  for (const r of rows) if (!best || checkoutTime(r) > checkoutTime(best)) best = r
  return best?.id ?? null
}

/** 그 방의 청소 이력 — 최근 것부터. */
export async function getRoomCleanings(roomId: string): Promise<CleaningRow[]> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: { roomId, propertyId, deletedAt: null },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, leaseTermId: true,
      reason: true, status: true, scheduledDate: true, doneDate: true,
      performer: true, performerName: true, memo: true, expenseId: true, fromCleaningFund: true,
      room: { select: { roomNo: true } },
    },
  })
  const expIds = rows.map(r => r.expenseId).filter((v): v is string => !!v)
  const exps = expIds.length
    ? await prisma.expense.findMany({ where: { id: { in: expIds } }, select: { id: true, amount: true } })
    : []
  const amountByExpense = new Map(exps.map(e => [e.id, e.amount]))
  const costById: Record<string, number> = {}
  for (const r of rows) if (r.expenseId) costById[r.id] = amountByExpense.get(r.expenseId) ?? 0

  return rows.map(r => ({
    id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, leaseTermId: r.leaseTermId,
    reason: r.reason as CleaningReason, status: r.status as CleaningStatus,
    scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
    performer: (r.performer as CleaningPerformer | null) ?? null,
    performerName: r.performerName, memo: r.memo,
    // 금액은 지출에서 읽는다. 여기 복사해 두면 지출에서 고쳤을 때 갈린다.
    cost: costById[r.id] ?? null,
    fromCleaningFund: r.fromCleaningFund,
  }))
}

/** 영업장 전체의 '아직 안 끝난' 청소 — 호실 카드 배지·필터가 쓴다. roomId 를 키로 돌려준다. */
export async function getOpenCleaningsByRoom(): Promise<Record<string, { status: CleaningStatus; scheduledDate: string | null }>> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: { propertyId, deletedAt: null, status: 'PLANNED' },
    select: { roomId: true, status: true, scheduledDate: true },
  })
  const out: Record<string, { status: CleaningStatus; scheduledDate: string | null }> = {}
  for (const r of rows) out[r.roomId] = { status: r.status as CleaningStatus, scheduledDate: ymd(r.scheduledDate) }
  return out
}

export async function createCleaning(input: {
  roomId: string
  reason: CleaningReason
  scheduledDate?: string | null
  leaseTermId?: string | null
  memo?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const row = await prisma.roomCleaning.create({
      data: {
        propertyId, roomId: input.roomId,
        leaseTermId: input.leaseTermId ?? null,
        reason: input.reason,
        scheduledDate: input.scheduledDate ? new Date(`${input.scheduledDate}T00:00:00`) : null,
        memo: input.memo?.trim() || null,
      },
      select: { id: true },
    })
    revalidatePath('/room-manage')
    return { ok: true, id: row.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '등록에 실패했습니다.' }
  }
}

/**
 * 완료 처리. 되돌리면 예정으로 돌아간다 — 되돌리기가 없으면 오탭 한 번에 이력이 굳는다.
 *
 * 비용이 있으면 그때 Expense 1건을 만들고 id 를 건다. **금액은 여기 복사하지 않는다.**
 * 사본을 두면 지출에서 금액을 고쳤을 때 갈린다. 비용 0(직접 청소)이면 Expense 를 안 만든다 —
 * 자기 노동은 비용이 아니고, 지출 정본이 금액 0 을 애초에 거부한다.
 *
 * fromCleaningFund 는 **회계 처리가 아니라 표식**이다. 어느 돈으로 냈는지를 적을 뿐 손익을 안 바꾼다.
 * 예비비처럼 Expense 를 안 만드는 방식을 베끼면 실제로 나간 현금이 손익에서 사라진다 —
 * 예비비는 자기자본 적립이라 그게 성립하지만 청소비는 **이미 수익으로 인식된 돈**이라 성립하지 않는다.
 *
 * 부담 표식은 **퇴실 청소에만** 붙는다. 받은 청소비는 그 퇴실 건에 딸린 돈이라
 * 도배 후·입실 중 청소에는 귀속시킬 계약이 없다. 그리고 귀속 계약은 **완료 시점에 한 번만**
 * 정한다 — 매번 다시 풀면 나중에 계약 상태가 바뀔 때 과거 기록의 귀속이 조용히 움직인다.
 */
export async function completeCleaning(input: {
  id: string
  doneDate: string
  performer: CleaningPerformer
  performerName?: string | null
  cost?: number | null
  fromCleaningFund?: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: {
        id: true, roomId: true, expenseId: true, reason: true, leaseTermId: true,
        room: { select: { roomNo: true } },
      },
    })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    const doneDate = new Date(`${input.doneDate}T00:00:00`)
    const cost = Math.max(0, Math.round(input.cost ?? 0))
    // 퇴실 청소가 아니면 부담 표식을 무시한다. 비용 0(직접 청소)도 부담할 것이 없다.
    const fromFund = !!input.fromCleaningFund && cost > 0 && cur.reason === 'CHECKOUT'

    await prisma.$transaction(async tx => {
      let expenseId = cur.expenseId
      // 다시 완료 처리하면 **있는 지출을 고친다.** 지우고 새로 만들면 운영자가 지출 화면에서
      // 손본 것(구매처·메모·영수증)이 통째로 사라지고 되돌릴 길이 없다. Expense 에는 소프트삭제 칸이 없다.
      if (expenseId && cost > 0) {
        await tx.expense.update({
          where: { id: expenseId },
          data: {
            date: doneDate, amount: cost,
            detail: `${cur.room.roomNo}호 청소${input.performerName ? ` · ${input.performerName}` : ''}`,
            vendor: input.performerName?.trim() || null,
          },
        })
      } else if (expenseId && cost === 0) {
        // 비용을 0으로 바꿨다. 지출을 지우지 않고 **연결만 끊는다** — 실제로 나간 돈일 수 있고,
        // 지우는 판단은 지출 화면에서 운영자가 한다.
        expenseId = null
      }
      if (!expenseId && cost > 0) {
        const e = await tx.expense.create({
          data: {
            propertyId, date: doneDate, amount: cost,
            category: CLEANING_EXPENSE_CATEGORY,
            roomId: cur.roomId,
            detail: `${cur.room.roomNo}호 청소${input.performerName ? ` · ${input.performerName}` : ''}`,
            vendor: input.performerName?.trim() || null,
            // 서비스·무형이라 재고 계산에서 뺀다. 방에 귀속돼 있어 방별 비용 집계에는 들어간다.
            excludeFromInventory: true,
          },
          select: { id: true },
        })
        expenseId = e.id
      }
      // 귀속 계약 해석 — 부담 표식을 붙이는데 아직 어느 퇴실 건인지 안 걸려 있을 때만, 한 번.
      // 예정 등록에서 계약을 안 고르고 만든 청소가 대부분이라 여기서 이어 붙인다.
      let leaseTermId = cur.leaseTermId
      if (fromFund && !leaseTermId) {
        const cands = await tx.leaseTerm.findMany({
          where: { roomId: cur.roomId, propertyId, status: { in: ['CHECKED_OUT', 'CHECKOUT_PENDING'] } },
          select: { id: true, moveOutDate: true, expectedMoveOut: true },
        })
        leaseTermId = pickLatestCheckoutLease(cands)
      }
      await tx.roomCleaning.update({
        where: { id: input.id },
        data: {
          status: 'DONE', doneDate,
          performer: input.performer,
          performerName: input.performerName?.trim() || null,
          expenseId,
          leaseTermId,
          fromCleaningFund: fromFund,
        },
      })
    })
    revalidatePath('/room-manage')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '처리에 실패했습니다.' }
  }
}

/** 완료·건너뜀을 예정으로 되돌린다. */
export async function reopenCleaning(id: string): Promise<{ ok: true; expenseKept: boolean } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true, expenseId: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    // **지출은 지우지 않는다.** 실제로 나간 돈이고, 청소 상태를 되돌린다고 그 돈이 안 나간 것이 되지 않는다.
    // 연결만 끊고 지출은 그대로 둔다 — 지울지는 지출 화면에서 운영자가 정한다.
    // 종전에는 여기서 하드 삭제했는데 Expense 에는 소프트삭제 칸이 없어 되돌릴 길이 없었다.
    await prisma.roomCleaning.update({
      where: { id },
      data: { status: 'PLANNED', doneDate: null, performer: null, performerName: null, expenseId: null, fromCleaningFund: false },
    })
    revalidatePath('/room-manage')
    return { ok: true, expenseKept: !!cur.expenseId }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

/** 안 하기로 함. 목록에서 지우지 않고 상태로 남긴다 — 지우면 왜 안 했는지가 사라진다. */
export async function skipCleaning(id: string, memo?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { status: 'SKIPPED', memo: memo?.trim() || undefined } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '처리에 실패했습니다.' }
  }
}

export async function deleteCleaning(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

/** 삭제 적용취소. */
export async function restoreCleaning(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId }, select: { id: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}

/**
 * 받은 청소비 잔고 — **읽기 전용 파생 조회.** 그 방에 관련된 계약별로 돌려준다.
 *
 * 잔고 = 받은 청소비(부가수익 '청소비') + 보증금에서 뗀 청소비(몰취) − 그 돈으로 부담한 청소 지출.
 * 세 항목 다 원장에 이미 있는 값이라 여기서는 합만 낸다. 어디에도 저장하지 않는다 —
 * 사본을 두면 수납·몰취·지출 어느 쪽을 고쳐도 갈린다.
 *
 * 지출 금액은 청소 이력이 아니라 `Expense` 에서 읽는다(청소 이력에는 금액 사본이 없다).
 */
export async function getCleaningFundStatus(roomId: string): Promise<CleaningFundStatus> {
  const { propertyId } = await requirePropertyAccess()
  const [cleanings, checkoutCands] = await Promise.all([
    prisma.roomCleaning.findMany({
      where: { roomId, propertyId, deletedAt: null },
      select: { leaseTermId: true, status: true, fromCleaningFund: true, expenseId: true },
    }),
    prisma.leaseTerm.findMany({
      where: { roomId, propertyId, status: { in: ['CHECKED_OUT', 'CHECKOUT_PENDING'] } },
      select: { id: true, moveOutDate: true, expectedMoveOut: true },
    }),
  ])
  // completeCleaning 이 쓸 해석과 **같은 규칙**이다. 체크하기 전 미리보기와 기록된 결과가
  // 다른 계약을 가리키면 그게 곧 다음 신고가 된다.
  const checkoutLeaseTermId = pickLatestCheckoutLease(checkoutCands)

  const leaseIds = [...new Set([
    ...cleanings.map(c => c.leaseTermId).filter((v): v is string => !!v),
    ...(checkoutLeaseTermId ? [checkoutLeaseTermId] : []),
  ])]
  if (leaseIds.length === 0) return { leases: [], checkoutLeaseTermId }

  const fundedExpenseIds = cleanings
    .filter(c => c.status === 'DONE' && c.fromCleaningFund && c.expenseId)
    .map(c => c.expenseId as string)

  const [leases, incomes, refunds, expenses] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { id: { in: leaseIds }, propertyId },
      select: { id: true, cleaningFee: true },
    }),
    // 소프트삭제분은 익스텐션이 자동으로 뺀다(where 에 deletedAt 를 쓰지 않는다).
    prisma.extraIncome.groupBy({
      by: ['leaseTermId'],
      where: { leaseTermId: { in: leaseIds }, propertyId, category: CLEANING_FEE_CATEGORY },
      _sum: { amount: true },
    }),
    prisma.depositRefund.groupBy({
      by: ['leaseTermId'],
      where: { leaseTermId: { in: leaseIds }, propertyId, reason: CLEANING_WITHHOLD_REASON },
      _sum: { withheldAmount: true },
    }),
    fundedExpenseIds.length
      ? prisma.expense.findMany({ where: { id: { in: fundedExpenseIds }, propertyId }, select: { id: true, amount: true } })
      : Promise.resolve([] as { id: string; amount: number }[]),
  ])

  const feeByLease = new Map(leases.map(l => [l.id, l.cleaningFee]))
  const incomeByLease = new Map(incomes.map(g => [g.leaseTermId as string, g._sum.amount ?? 0]))
  const withheldByLease = new Map(refunds.map(g => [g.leaseTermId, g._sum.withheldAmount ?? 0]))
  const amountByExpense = new Map(expenses.map(e => [e.id, e.amount]))
  const fundedByLease = new Map<string, number>()
  for (const c of cleanings) {
    if (c.status !== 'DONE' || !c.fromCleaningFund || !c.expenseId || !c.leaseTermId) continue
    fundedByLease.set(c.leaseTermId, (fundedByLease.get(c.leaseTermId) ?? 0) + (amountByExpense.get(c.expenseId) ?? 0))
  }

  return {
    leases: leaseIds.map(id => ({
      leaseTermId: id,
      realizedIncome: (incomeByLease.get(id) ?? 0) + (withheldByLease.get(id) ?? 0),
      contractFee: feeByLease.get(id) ?? 0,
      fundedExpenseTotal: fundedByLease.get(id) ?? 0,
    })),
    checkoutLeaseTermId,
  }
}
