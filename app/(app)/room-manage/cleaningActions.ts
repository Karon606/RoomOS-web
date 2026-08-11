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
import { CLEANING_FEE_CATEGORY, DEPOSIT_SOURCED_PAY_METHOD } from '@/lib/incomeCategories'
import { CLEANING_WITHHOLD_REASON } from '@/lib/depositWithholdReasons'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

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

/**
 * 최근에 맡긴 업체·사람 이름 5개 — 완료 폼 이름 칸의 선택지. 최신순.
 *
 * **Expense.vendor 와 합치지 않는다.** 그쪽은 완료 처리가 이 이름을 받아 적은 파생 사본이고,
 * 지출 화면에서 손으로 넣은 구매처(청소와 무관한 곳까지)가 같은 칸에 섞여 있다. 둘을 합치면
 * 선택지가 금세 더러워지고, 사본이 갈렸을 때 어느 쪽이 맞는지도 못 가린다. 정본은 청소 이력 한 곳이다.
 *
 * 직접 청소(SELF)는 뺀다 — 적을 이름이 없는 수행자라 이름 칸 자체가 안 뜬다.
 */
export async function getRecentCleaningPerformers(): Promise<string[]> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: {
      propertyId, deletedAt: null, status: 'DONE',
      performer: { in: ['VENDOR', 'THIRD_PARTY'] },
      performerName: { not: null },
    },
    // 같은 날 완료한 건이 여럿이면 doneDate 만으로는 순서가 안 정해져 새로고침마다 목록이 흔들린다.
    orderBy: [{ doneDate: 'desc' }, { createdAt: 'desc' }],
    // 같은 곳에 계속 맡긴 영업장은 앞쪽이 한 이름으로 채워진다. 넉넉히 읽어 중복을 걷어낸 뒤 자른다.
    take: 100,
    select: { performerName: true },
  })
  const out: string[] = []
  for (const r of rows) {
    const name = r.performerName?.trim()
    if (!name || out.includes(name)) continue
    out.push(name)
  }
  return out.slice(0, 5)
}

/**
 * 영업장 전체의 '아직 안 끝난' 청소 — 호실 카드 배지·필터가 쓴다. roomId 를 키로 돌려준다.
 *
 * 한 방에 예정이 여럿이면 **가장 이른 예정일** 하나만 남긴다. 카드 보조줄은 한 줄이라
 * 어느 건을 말하는지 여기서 정해야 한다 — 조회 순서에 맡기면(종전: 마지막 행이 이김)
 * 같은 방이 새로고침마다 다른 날을 말할 수 있다. 운영자가 먼저 마주칠 일정이 가장 이른 것이다.
 *
 * 예정일이 없는 건(등록 때 날짜를 비울 수 있다)은 날짜 있는 건에 밀린다. 그런 건만 남으면
 * scheduledDate 가 null 로 나가고, 화면은 보조줄 없이 배지만 그린다 — 없는 날짜는 짓지 않는다.
 */
export async function getOpenCleaningsByRoom(): Promise<Record<string, { status: CleaningStatus; scheduledDate: string | null }>> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomCleaning.findMany({
    where: { propertyId, deletedAt: null, status: 'PLANNED' },
    select: { roomId: true, status: true, scheduledDate: true },
  })
  const out: Record<string, { status: CleaningStatus; scheduledDate: string | null }> = {}
  for (const r of rows) {
    const next = { status: r.status as CleaningStatus, scheduledDate: ymd(r.scheduledDate) }
    const cur = out[r.roomId]
    // 'YYYY-MM-DD' 는 사전순이 곧 날짜순이라 문자열 비교로 이르고 늦음이 갈린다.
    if (cur && (!next.scheduledDate || (cur.scheduledDate && cur.scheduledDate <= next.scheduledDate))) continue
    out[r.roomId] = next
  }
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
 * 사본을 두면 지출에서 금액을 고쳤을 때 갈린다. 비용 0 이면 Expense 를 안 만든다 —
 * 자기 노동은 비용이 아니고, 지출 정본이 금액 0 을 애초에 거부한다.
 *
 * 직접 청소(SELF)도 비용을 받는다. 노동이 공짜인 것과 세제·용품값이 나간 것은 별개고,
 * 그 돈은 실제로 통장에서 빠진다. 기본값이 0 이라 안 적으면 종전과 똑같이 지출이 안 생긴다.
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
      // expenseId 는 관계가 아니라 uuid 칸이라 지출 화면에서 그 지출을 지우면 끊긴 채로 남는다
      // (Expense 에는 소프트삭제 칸이 없어 하드 삭제다). 없는 것을 고치려 들면 트랜잭션이 통째로
      // 깨져 완료 처리 자체가 실패하므로, 먼저 살아 있는지 보고 없으면 안 걸린 것으로 친다.
      if (expenseId) {
        const alive = await tx.expense.findFirst({ where: { id: expenseId, propertyId }, select: { id: true } })
        if (!alive) expenseId = null
      }
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

/**
 * 완료·건너뜀을 예정으로 되돌린다(§16 적용취소).
 *
 * **지출은 지우지도 끊지도 않는다.** 실제로 나간 돈이고, 청소 상태를 되돌린다고 그 돈이
 * 안 나간 것이 되지 않는다. 지울지는 지출 화면에서 운영자가 정한다.
 *
 * 두 번 틀렸던 자리다. 처음에는 여기서 Expense 를 하드 삭제했는데 소프트삭제 칸이 없어
 * 되돌릴 길이 없었다. 그다음에는 연결(expenseId)만 끊었는데, 그러면 다시 완료할 때
 * completeCleaning 이 "걸린 지출이 없다"고 보고 **생성 분기로 떨어져 같은 청소에 지출이 두 건**
 * 생겼다. 연결을 그대로 두면 재완료가 저절로 수정 분기로 가 한 건이 유지된다.
 * fromCleaningFund 만 내린다 — 부담 표식은 완료된 청소에 붙는 것이고 완료 시점에 다시 정한다.
 *
 * **업체·사람 이름(performerName)도 지우지 않는다.** 지출을 남기는 것과 같은 방향이다.
 * 되돌리는 이유는 대개 날짜나 금액이라 누가 했는지는 그대로인데, 이름을 지워 버리면 재완료 때
 * 다시 받아 적어야 하고 오타 한 번에 같은 업체가 두 이름으로 갈린다. 수행자 구분(performer)은
 * 완료 시점의 사실이라 fromCleaningFund 와 함께 내린다.
 */
export async function reopenCleaning(id: string): Promise<{ ok: true; expenseKept: boolean } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true, expenseId: true } })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    await prisma.roomCleaning.update({
      where: { id },
      data: { status: 'PLANNED', doneDate: null, performer: null, fromCleaningFund: false },
    })
    revalidatePath('/room-manage')
    return { ok: true, expenseKept: !!cur.expenseId }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

/**
 * 그 행에 보이는 날짜를 바꾼다. 예정·안 함 건은 예정일, 완료 건은 완료일이다.
 * 화면의 동사는 어느 쪽이든 '날짜 변경' 하나라 서버 동사도 하나로 둔다.
 *
 * 완료 건의 완료일은 지출 date 와 짝이라 **연결된 지출의 날짜도 함께 옮긴다.**
 * completeCleaning 이 생성·수정 양쪽에서 doneDate 를 지출 date 로 쓰고 있어,
 * 여기만 안 옮기면 청소 이력과 지출 화면의 같은 건이 서로 다른 날을 말한다.
 *
 * 종전에는 예정 상태에서만 열려 있었다. 완료일을 고칠 문이 없으니 운영자가 되돌리기로
 * 우회했고, 그 우회로가 지출을 두 건으로 불리던 경로였다(reopenCleaning 주석 참고).
 */
export async function rescheduleCleaning(input: { id: string; date: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomCleaning.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: { id: true, status: true, expenseId: true },
    })
    if (!cur) return { ok: false, error: '청소 기록을 찾을 수 없습니다.' }
    const date = new Date(`${input.date}T00:00:00`)
    if (Number.isNaN(date.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }

    if (cur.status !== 'DONE') {
      await prisma.roomCleaning.update({ where: { id: input.id }, data: { scheduledDate: date } })
      revalidatePath('/room-manage')
      return { ok: true }
    }
    await prisma.$transaction(async tx => {
      await tx.roomCleaning.update({ where: { id: input.id }, data: { doneDate: date } })
      // updateMany 라 지출이 이미 지워졌으면 조용히 0건이다. update 였다면 없는 것을 고치려다
      // 트랜잭션이 깨져 완료일 변경까지 실패한다.
      if (cur.expenseId) await tx.expense.updateMany({ where: { id: cur.expenseId, propertyId }, data: { date } })
    })
    revalidatePath('/room-manage')
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '변경에 실패했습니다.' }
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

  const [leases, incomes, depositSourced, refunds, expenses] = await Promise.all([
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
    // 그중 퇴실 정산이 보증금 청소비 몫으로 만든 분 — 아래 몰취 항과 같은 돈이라 한 번만 세야 한다.
    prisma.extraIncome.groupBy({
      by: ['leaseTermId'],
      where: { leaseTermId: { in: leaseIds }, propertyId, category: CLEANING_FEE_CATEGORY, payMethod: DEPOSIT_SOURCED_PAY_METHOD },
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
  const depositSourcedByLease = new Map(depositSourced.map(g => [g.leaseTermId as string, g._sum.amount ?? 0]))
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
      // 몰취 항은 **아직 부가수익으로 안 갈린 옛 기록**을 위한 보정이다(2026-08-11). 퇴실 정산이
      // 청소비 몫을 '청소비' 부가수익으로 만들기 시작하면서 같은 돈이 두 항에 들어가게 됐다.
      // 이미 부가수익으로 선 만큼은 몰취 항에서 뺀다 — 안 빼면 507호가 20,000 을 40,000 으로 보고한다.
      realizedIncome: (incomeByLease.get(id) ?? 0)
        + Math.max(0, (withheldByLease.get(id) ?? 0) - (depositSourcedByLease.get(id) ?? 0)),
      contractFee: feeByLease.get(id) ?? 0,
      fundedExpenseTotal: fundedByLease.get(id) ?? 0,
    })),
    checkoutLeaseTermId,
  }
}
