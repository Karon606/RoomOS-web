'use server'

// 방 작업 이력(청소가 아닌 것) — 등록·완료·적용취소·삭제 (2026-08-25, 신고 b21e4e98 후속).
//
// 청소(cleaningActions)와 형제다. 다른 것 셋뿐이다.
//   · 종류가 고정 사유 4종이 아니라 **환경설정 목록에서 고른 문자열**이다.
//   · 받은 청소비로 부담하는 표식이 없다. 도배·장판은 청소비 몫이 아니다.
//   · 비용 링크 방향이 반대다. 청소는 RoomCleaning.expenseId(1:1)인데, 작업은 자재를 여러 날
//     나눠 사고 시공은 하루라 **Expense.roomWorkId**(1:N)다.
//
// 회계에 접점이 없다. 이 파일은 완료 시 Expense 를 만들 뿐 금액을 RoomWork 에 복사하지 않는다.
// 지출 화면에서 그 지출을 고치면 그것이 사실이고, 여기는 가리키기만 한다.

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { ymdToDbDate } from '@/lib/kstDate'
import { splitWorkCost } from '@/lib/roomWorkCost'
// 담당 어휘(직접·업체·제3자)는 청소와 같은 말이라 정본을 함께 쓴다. 사본을 만들면 한쪽만
// 늘었을 때 두 화면이 다른 목록을 낸다. 이름이 CLEANING_ 으로 시작하는 것은 그 상수가
// 청소에서 먼저 생겼기 때문이고, 옮기는 것은 이번 작업과 접점이 없어 하지 않는다.
import { type CleaningPerformer } from './cleaningConstants'
import { matchesWork } from '@/lib/roomWorkMatch'
import { fmtRoomNo } from '@/lib/roomNo'

/** 작업 비용이 잡히는 지출 카테고리. 이미 쌓인 도배·장판 87건이 전부 이 값이다(실측 2026-08-25). */
const WORK_EXPENSE_CATEGORY = '수선유지비'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

export type RoomWorkRow = {
  id: string
  roomId: string
  roomNo: string
  kind: string
  status: 'PLANNED' | 'DONE'
  scheduledDate: string | null
  doneDate: string | null
  performer: CleaningPerformer | null
  performerName: string | null
  memo: string | null
  /** 이 작업에 붙은 지출의 합. 여러 건이 붙을 수 있다(자재 여러 날 + 시공 하루). */
  cost: number
  /** 그중 시공비 — 이번에 새로 나간 돈. */
  laborCost: number
  /** 그중 자재비 — 살 때 이미 나간 돈을 방별로 쪼갠 것. lib/roomWorkCost 참조. */
  materialCost: number
  expenseCount: number
}

/** 한 방의 작업 이력. 방 상세 위젯이 쓴다. */
export async function listRoomWorks(roomId: string): Promise<RoomWorkRow[]> {
  const { propertyId } = await requirePropertyAccess()
  // RoomWork 는 소프트삭제 익스텐션 대상이 아니다(lib/prisma SOFT_DELETE_MODELS 는 둘뿐) —
  // deletedAt 을 손으로 적어야 한다. RoomCleaning 도 같은 처지다.
  const rows = await prisma.roomWork.findMany({
    where: { propertyId, roomId, deletedAt: null },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, kind: true, status: true,
      scheduledDate: true, doneDate: true,
      performer: true, performerName: true, memo: true,
      room: { select: { roomNo: true } },
      expenses: { select: { amount: true, itemLabel: true, detail: true } },
    },
  })
  return rows.map(r => {
    const c = splitWorkCost(r.expenses)
    return {
      id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, kind: r.kind,
      status: r.status as 'PLANNED' | 'DONE',
      scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
      performer: (r.performer as CleaningPerformer | null) ?? null,
      performerName: r.performerName, memo: r.memo,
      cost: c.total, laborCost: c.labor, materialCost: c.material,
      expenseCount: r.expenses.length,
    }
  })
}

/** 영업장 전체 작업 이력 — 호실 관리 '작업' 뷰가 쓴다. 삭제분은 안 싣는다(복원 진입점이 토스트뿐). */
export async function getPropertyRoomWorks(): Promise<RoomWorkRow[]> {
  const { propertyId } = await requirePropertyAccess()
  const rows = await prisma.roomWork.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, kind: true, status: true,
      scheduledDate: true, doneDate: true,
      performer: true, performerName: true, memo: true,
      room: { select: { roomNo: true } },
      expenses: { select: { amount: true, itemLabel: true, detail: true } },
    },
  })
  return rows.map(r => {
    const c = splitWorkCost(r.expenses)
    return {
      id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, kind: r.kind,
      status: r.status as 'PLANNED' | 'DONE',
      scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
      performer: (r.performer as CleaningPerformer | null) ?? null,
      performerName: r.performerName, memo: r.memo,
      cost: c.total, laborCost: c.labor, materialCost: c.material,
      expenseCount: r.expenses.length,
    }
  })
}

export async function createRoomWork(input: {
  roomId: string
  kind: string
  scheduledDate?: string | null
  performer?: CleaningPerformer | null
  memo?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const kind = input.kind.trim()
    if (!kind) return { ok: false, error: '작업 종류를 골라 주세요.' }
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    const row = await prisma.roomWork.create({
      data: {
        propertyId, roomId: input.roomId,
        // 고른 이름을 **그대로 적는다.** 목록에서 지워도 지나간 기록은 남아야 한다.
        kind,
        scheduledDate: input.scheduledDate ? ymdToDbDate(input.scheduledDate) : null,
        performer: input.performer ?? null,
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

/** 이 작업에 걸릴 만한 미연결 지출 — 되묻기 화면이 그대로 그린다. */
export type WorkLinkCandidate = { id: string; date: string; amount: number; label: string; vendor: string | null }

/**
 * 작업 완료.
 *
 * **mode 가 이 함수의 핵심이다**(2026-08-27 신설).
 *   · 'ask'(기본) — 걸릴 만한 미연결 지출이 있으면 **아무것도 쓰지 않고** 후보를 돌려준다.
 *     운영자가 고른 뒤에 다시 부른다. 자동으로 묶는 분기는 하나도 두지 않는다.
 *   · 'link' — 그 후보들을 이 작업에 걸고 완료 처리한다. 새 지출을 안 만든다.
 *   · 'create' — 종전 동작. 시공비로 지출을 새로 한 줄 만든다.
 *
 * 왜 필요한가. 종전 판정은 '**이 작업에** 걸린 지출이 있나'만 물어서, 지출을 방에만 걸고
 * 작업에는 안 걸었으면 0 이라 못 막았다. 413호가 정확히 그 경우였고 같은 돈이 두 벌 적혔다.
 */
export async function completeRoomWork(input: {
  id: string
  doneDate: string
  performer: CleaningPerformer
  performerName?: string | null
  cost?: number | null
  mode?: 'ask' | 'link' | 'create'
}): Promise<{ ok: true } | { ok: false; error: string } | { ok: false; needsChoice: true; candidates: WorkLinkCandidate[] }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: {
        id: true, roomId: true, kind: true,
        room: { select: { roomNo: true } },
        expenses: { select: { id: true } },
      },
    })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    const doneDate = ymdToDbDate(input.doneDate)
    const cost = Math.max(0, Math.round(input.cost ?? 0))
    const mode = input.mode ?? 'ask'

    // 걸릴 만한 미연결 지출 — 판정은 lib/roomWorkMatch 정본 하나다.
    // 같은 날 같은 방의 미연결 지출만 끌어와 JS 에서 거른다(공임 판정과 종류 포함은 SQL 로 못 쓴다).
    const free = await prisma.expense.findMany({
      where: { propertyId, roomId: cur.roomId, roomWorkId: null, date: doneDate },
      select: { id: true, date: true, amount: true, itemLabel: true, detail: true, vendor: true, roomId: true, roomWorkId: true },
    })
    const matched = free.filter(e => matchesWork(e, { roomId: cur.roomId, kind: cur.kind, doneDate, scheduledDate: null }))

    // 'ask' 는 아무것도 쓰지 않는다. 저장 전에 되묻는 것이 이 갈래의 전부다.
    if (mode === 'ask' && matched.length > 0) {
      return {
        ok: false, needsChoice: true,
        candidates: matched.map(e => ({
          id: e.id, date: e.date.toISOString().slice(0, 10), amount: e.amount,
          label: e.itemLabel ?? e.detail ?? '(이름 없음)', vendor: e.vendor,
        })),
      }
    }

    await prisma.$transaction(async tx => {
      await tx.roomWork.update({
        where: { id: cur.id },
        data: {
          status: 'DONE', doneDate,
          performer: input.performer,
          performerName: input.performerName?.trim() || null,
        },
      })
      // 비용 0이면 지출을 만들지 않는다(직접 했으면 나간 돈이 없다). 이미 붙은 지출이 있으면
      // **건드리지 않는다** — 자재를 여러 날 사서 붙여 둔 것이 있을 수 있고, 그 판단은
      // 지출 화면에서 운영자가 한다. 여기서 만드는 것은 이번 완료가 만든 공임 한 줄뿐이다.
      // 'link' — 이미 적어 둔 지출을 이 작업에 건다. 새로 만들지 않는다.
      if (mode === 'link' && matched.length > 0) {
        await tx.expense.updateMany({ where: { id: { in: matched.map(e => e.id) } }, data: { roomWorkId: cur.id } })
        return
      }
      if (cost > 0 && cur.expenses.length === 0) {
        await tx.expense.create({
          data: {
            propertyId, date: doneDate, amount: cost,
            category: WORK_EXPENSE_CATEGORY,
            roomId: cur.roomId,
            roomWorkId: cur.id,
            // 품목명을 '도배 시공' 처럼 적는다. 종전에는 detail 만 있고 itemLabel 이 비어서
            // 공임 판정(lib/roomWorkCost)이 이 줄을 **자재로 셌다** — 그 방 투자금의 공임·자재
            // 구성이 틀어진다. LABOR_RE 에 맨 '도배'를 더하면 자재까지 공임이 되므로,
            // 만드는 쪽이 자기 이름을 공임으로 말하게 하는 편이 안전하다.
            itemLabel: `${cur.kind} 시공`,
            detail: `${fmtRoomNo(cur.room.roomNo, '')} ${cur.kind}${input.performerName ? ` · ${input.performerName}` : ''}`,
            vendor: input.performerName?.trim() || null,
            // 시공비는 무형 서비스라 재고 계산에 들면 안 된다. 형제인 completeCleaning 은
            // 원래 이 값을 세우는데 여기만 빠져 있었다(실측 2건이 false 였다).
            excludeFromInventory: true,
          },
        })
      }
    })
    revalidatePath('/room-manage'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '완료 처리에 실패했습니다.' }
  }
}

/** 지출 연결 적용취소 — roomWorkId 만 되돌린다. 지출 자체는 안 건드린다(§16). */
export async function unlinkExpensesFromWork(expenseIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    if (expenseIds.length === 0) return { ok: true }
    await prisma.expense.updateMany({ where: { id: { in: expenseIds }, propertyId }, data: { roomWorkId: null } })
    revalidatePath('/room-manage'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '적용취소에 실패했습니다.' }
  }
}

/**
 * 날짜 변경 — 그 행에 보이는 날짜를 고친다. 예정 건이면 예정일, 완료 건이면 완료일이다.
 * 청소의 rescheduleCleaning 과 같은 문법이되, **지출 날짜는 안 옮긴다** — 작업의 지출은
 * 자재를 여러 날 나눠 산 것까지 걸려 있어(1:N) 한 날짜로 몰면 그 사실이 사라진다.
 * 청소는 1:1 이라 함께 옮기는 것이 맞았다.
 */
export async function rescheduleRoomWork(input: { id: string; date: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: { id: true, status: true },
    })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    const date = ymdToDbDate(input.date)
    if (Number.isNaN(date.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    await prisma.roomWork.update({
      where: { id: cur.id },
      data: cur.status === 'DONE' ? { doneDate: date } : { scheduledDate: date },
    })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '날짜 변경에 실패했습니다.' }
  }
}

/** 적용취소 — 완료를 되돌린다. 붙은 지출은 지우지 않는다(실제로 나간 돈이다). */
export async function reopenRoomWork(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    await prisma.roomWork.update({
      where: { id: cur.id },
      data: { status: 'PLANNED', doneDate: null, performer: null, performerName: null },
    })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

/** 소프트삭제. 붙은 지출의 연결은 그대로 둔다 — 되살리면 다시 이어져야 한다. */
export async function deleteRoomWork(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({ where: { id, propertyId, deletedAt: null }, select: { id: true } })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    await prisma.roomWork.update({ where: { id: cur.id }, data: { deletedAt: new Date() } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

/** 삭제 적용취소. */
export async function restoreRoomWork(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({ where: { id, propertyId }, select: { id: true } })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    await prisma.roomWork.update({ where: { id: cur.id }, data: { deletedAt: null } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '되살리기에 실패했습니다.' }
  }
}
