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
import { assertNotFuture } from '@/lib/completionDate'
import { splitWorkCost, isLaborItem } from '@/lib/roomWorkCost'
// 담당 어휘(직접·업체·제3자)는 청소와 같은 말이라 정본을 함께 쓴다. 사본을 만들면 한쪽만
// 늘었을 때 두 화면이 다른 목록을 낸다. 이름이 CLEANING_ 으로 시작하는 것은 그 상수가
// 청소에서 먼저 생겼기 때문이고, 옮기는 것은 이번 작업과 접점이 없어 하지 않는다.
import { type CleaningPerformer, WORK_EXPENSE_CATEGORY } from './cleaningConstants'
import { matchesWork } from '@/lib/roomWorkMatch'
import { autoOptionForSave } from '@/lib/reasonListSave'
import { fmtRoomNo } from '@/lib/roomNo'
import { settleStatusForNew, settleStatusForEdit } from '@/lib/settleStatus'
import { resolveWorkPay } from '@/lib/workPayDefault'
import { expenseSnapOf, EXPENSE_SNAP_SELECT, signRoomRecordEdit } from '@/lib/roomRecordEditSign'
import { ROOM_RECORD_STALE, type RoomRecordEditUndo, type RecordSnap } from '@/lib/roomRecordEditUndo'

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)
/** 견적 금액 정리. 양의 정수만 남기고 그 밖(0·음수·빈 값·숫자 아님)은 견적 없음(null)이다. */
const estimateOf = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

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
  /** 마지막으로 고친 시각(ISO). 한 건 수정 폼이 연 뒤 다른 곳에서 바뀌었는지 서버가 견준다(조건부 쓰기). */
  updatedAt: string
  /** 견적 금액(원). 돈이 아니라 메모다. 지출을 안 만들고 어떤 합계에도 안 든다(2026-10-27, 그물 check-work-estimate). null = 견적 없음. */
  estimateAmount: number | null
  /** 삭제된 행인가 — includeDeleted 로 실어 온 목록에서만 true 가 있다(복원만 할 수 있다). */
  deleted?: boolean
  /** 이 작업에 붙은 지출의 합. 여러 건이 붙을 수 있다(자재 여러 날 + 시공 하루). */
  /**
   * 이 작업의 **시공비**. 자재는 안 센다(운영자 확정 2026-08-27).
   *
   * "작업 이력에는 사실 언제 시공할지 미리 계획하고 언제 했는지 등에 대한 이력 관리를
   *  위한거니까 시공내역만 나오고 그 시공비가 얼마나 들었는지 참고 정도만 알면 될 것 같고…
   *  이 방에 든 지출에 어차피 시공비와 자재비가 다 나오니까 비용은 그쪽을 참고하면 될 것 같아.
   *  작업이력에는 세부 자재 비용이 필요하지는 않는듯 해."
   *
   * 자재가 작업에 걸려 있는 것 자체는 그대로 둔다(실측 10여 건). 데이터는 살아 있고
   * 표시만 시공비로 좁힌다 — 나중에 지출 쪽에서 품목별로 가를 때 그 연결이 쓰인다.
   */
  cost: number
  /** 그중 시공비 — 이번에 새로 나간 돈. */
  laborCost: number
  /** 그중 시공으로 세는 줄 수 — 여럿이면 왜 그 금액인지 행이 말해야 한다. */
  laborExpenseCount: number
  /** 걸린 지출 한 줄씩 — 화면이 줄마다 시공/자재 표식을 바꾼다(판정을 글자에서 떼는 자리). */
  /**
   * 걸린 지출 한 줄씩 — 완료 폼이 **이미 아는 값을 미리 채우는** 데 쓴다.
   *
   * 종전에는 지출이 걸려 있는데도 금액 칸이 0 이고 업체 칸이 빈 채로 물어봤다. 운영자 지적
   * 2026-08-28 — "비용을 넣어도 새로 안만들거면 그냥 미리 금액을 넣어주고 업체나 사람도
   * 미리 넣어주면 되는거 아냐?"
   */
  linkedExpenses: { id: string; amount: number; label: string; vendor: string | null; payMethod: string | null; financialAccountId: string | null }[]
  /** 그중 자재비 — 살 때 이미 나간 돈을 방별로 쪼갠 것. lib/roomWorkCost 참조. */
  materialCost: number
  expenseCount: number
}

/** 한 방의 작업 이력. 방 상세 위젯이 쓴다. */
/**
 * 방 하나의 작업 이력.
 *
 * includeDeleted — 삭제분까지 싣는다. **§16 의 2순위 진입점을 위한 것이다.** 종전에는
 * restoreRoomWork 를 부르는 곳이 삭제 토스트(6초) 하나뿐이라, 놓치면 복원할 길이 앱
 * 어디에도 없었다(2026-08-28 확인). 방 모달의 편집 모드가 그 자리를 받는다.
 */
export async function listRoomWorks(roomId: string, opts: { includeDeleted?: boolean } = {}): Promise<RoomWorkRow[]> {
  const { propertyId } = await requirePropertyAccess()
  // RoomWork 는 소프트삭제 익스텐션 대상이 아니다(lib/prisma SOFT_DELETE_MODELS 는 둘뿐) —
  // deletedAt 을 손으로 적어야 한다. RoomCleaning 도 같은 처지다.
  const rows = await prisma.roomWork.findMany({
    where: { propertyId, roomId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    orderBy: [{ doneDate: 'desc' }, { scheduledDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, roomId: true, kind: true, status: true,
      scheduledDate: true, doneDate: true,
      performer: true, performerName: true, memo: true, deletedAt: true, updatedAt: true, estimateAmount: true,
      room: { select: { roomNo: true } },
      expenses: { select: { id: true, amount: true, itemLabel: true, detail: true, costKind: true, vendor: true, payMethod: true, financialAccountId: true } },
    },
  })
  return rows.map(r => {
    const c = splitWorkCost(r.expenses)
    return {
      id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, kind: r.kind,
      status: r.status as 'PLANNED' | 'DONE',
      scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
      performer: (r.performer as CleaningPerformer | null) ?? null,
      performerName: r.performerName, memo: r.memo, updatedAt: r.updatedAt.toISOString(), estimateAmount: r.estimateAmount,
      cost: c.labor, laborCost: c.labor, materialCost: c.material,
      expenseCount: r.expenses.length,
      deleted: !!r.deletedAt,
      laborExpenseCount: r.expenses.filter(e => isLaborItem(e.itemLabel, e.detail, e.costKind)).length,
      linkedExpenses: r.expenses.map(e => ({
        id: e.id, amount: e.amount, label: e.itemLabel ?? e.detail ?? '(이름 없음)', vendor: e.vendor,
        payMethod: e.payMethod, financialAccountId: e.financialAccountId,
      })),
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
      performer: true, performerName: true, memo: true, updatedAt: true, estimateAmount: true,
      room: { select: { roomNo: true } },
      expenses: { select: { id: true, amount: true, itemLabel: true, detail: true, costKind: true, vendor: true, payMethod: true, financialAccountId: true } },
    },
  })
  return rows.map(r => {
    const c = splitWorkCost(r.expenses)
    return {
      id: r.id, roomId: r.roomId, roomNo: r.room.roomNo, kind: r.kind,
      status: r.status as 'PLANNED' | 'DONE',
      scheduledDate: ymd(r.scheduledDate), doneDate: ymd(r.doneDate),
      performer: (r.performer as CleaningPerformer | null) ?? null,
      performerName: r.performerName, memo: r.memo, updatedAt: r.updatedAt.toISOString(), estimateAmount: r.estimateAmount,
      cost: c.labor, laborCost: c.labor, materialCost: c.material,
      expenseCount: r.expenses.length,
      laborExpenseCount: r.expenses.filter(e => isLaborItem(e.itemLabel, e.detail, e.costKind)).length,
      linkedExpenses: r.expenses.map(e => ({
        id: e.id, amount: e.amount, label: e.itemLabel ?? e.detail ?? '(이름 없음)', vendor: e.vendor,
        payMethod: e.payMethod, financialAccountId: e.financialAccountId,
      })),
    }
  })
}

export async function createRoomWork(input: {
  roomId: string
  kind: string
  scheduledDate?: string | null
  performer?: CleaningPerformer | null
  /**
   * 맡길 업체·사람 이름. 담당을 '업체'로 골라도 어느 업체인지 적을 자리가 없었다
   * (운영자 지적 2026-08-28 — 메모 칸에 업체명을 적고 있었다).
   */
  performerName?: string | null
  memo?: string | null
  /** 견적 금액(원, 선택). 지출을 만들지 않는다. 0 이하·비우면 견적 없음(null). */
  estimateAmount?: number | null
  /**
   * 목록에 없는 종류를 적었을 때 영업장 작업 종류 목록에 더할지(2026-10-22 2차, 기본 켜짐). 끄면 이 기록만 그 이름으로 남는다.
   */
  addKindToList?: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    // 종류는 맨 글자다. 목록 이름과 대소문자·공백만 다르면 목록 표기로 맞춘다(lib/reasonListSave autoOptionForSave).
    // 지출 품목 글자 맞춤(lib/roomWorkMatch matchesWork)이 이 글자를 지출 품목명에서 찾으므로 '기타 · ' 꼴로 바꾸지 않는다.
    const kindSave = await autoOptionForSave(propertyId, 'workKindOptions', input.kind, { addToList: input.addKindToList })
    const kind = kindSave.value
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
        // 담당이 '직접'이거나 미정이면 이름을 안 남긴다 — 안 보이는 값이 저장되면 안 된다.
        performerName: input.performer && input.performer !== 'SELF' ? (input.performerName?.trim() || null) : null,
        memo: input.memo?.trim() || null,
        estimateAmount: estimateOf(input.estimateAmount),
      },
      select: { id: true },
    })
    await kindSave.commit()
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
  /**
   * 시공비를 낸 결제수단과 결제 계정(2026-10-27 운영자 지적 "작업 단에서도 결제수단을 뭘로할지 물어보는 옵션"). 비용이 있을 때만 쓴다.
   * 안 오면 lib/workPayDefault 규칙(같은 업체 직전 → 같은 카테고리 직전 → 영업장 목록 첫 값)으로 채운다. 계정은 이 영업장 것만 받는다.
   */
  payMethod?: string | null
  financialAccountId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string } | { ok: false; needsChoice: true; candidates: WorkLinkCandidate[] }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: {
        id: true, roomId: true, kind: true,
        room: { select: { roomNo: true } },
        expenses: { select: { id: true, amount: true, vendor: true, payMethod: true, financialAccountId: true, settleStatus: true, isShipping: true } },
      },
    })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    // 미래 완료일 거부 — 화면 maxDate 와 두 겹이다(운영자 확정 2026-09-17). 화면이 넷이어도
    // 다섯째 경로가 생기면 여기가 받친다.
    const fg = assertNotFuture(input.doneDate)
    if (!fg.ok) return { ok: false, error: fg.reason }
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

    // 결제수단 확정 — 지출을 만들거나 고칠 때만 쓴다. 화면이 안 보냈으면 기본값 규칙이다(null 을 남기지 않는다).
    // 걸린 지출 한 건을 고치는데 화면이 안 보냈으면 그 지출의 수단을 지킨다(비어 있을 때만 규칙으로 채운다).
    const sentPay = !!input.payMethod?.trim()
    const payRes = await resolveWorkPay(prisma, propertyId, {
      payMethod: input.payMethod, financialAccountId: input.financialAccountId,
      vendor: input.performerName, category: WORK_EXPENSE_CATEGORY,
    })
    if (!payRes.ok) return payRes
    const pay = payRes.pay

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
        // 후보 판정이 공임만 고르므로 표식도 시공이다. 자재를 걸고 싶으면 작업 행에서 바꾼다.
        await tx.expense.updateMany({ where: { id: { in: matched.map(e => e.id) } }, data: { roomWorkId: cur.id, costKind: 'LABOR' } })
        return
      }
      // 걸린 지출이 **한 건**이면 그 지출을 고친다. 종전에는 "새로 만들지 않습니다"라고만
      // 하고 아무것도 안 해서, 금액이나 업체를 고치려면 지출 화면으로 가야 했다.
      // 형제인 completeCleaning 이 원래 이 방식이다(1:1 이라 대상이 하나다).
      //
      // **여러 건이면 손대지 않는다.** 어느 줄의 금액인지 앱이 모른다 — 자재를 여러 날 사서
      // 붙여 둔 경우가 있어 아무 줄이나 고치면 엉뚱한 돈이 바뀐다. 그때는 화면이 지출 쪽으로 보낸다.
      if (cur.expenses.length === 1) {
        const only = cur.expenses[0]
        const next: {
          amount?: number; vendor?: string | null
          payMethod?: string; financialAccountId?: string | null; financeName?: string | null; settleStatus?: 'SETTLED' | 'UNSETTLED'
        } = {}
        if (cost > 0 && cost !== only.amount) next.amount = cost
        const name = input.performerName?.trim() || null
        if (name !== (only.vendor ?? null)) next.vendor = name
        // 결제수단 — 화면이 고른 값이 있거나 지출이 비어 있을 때만 바꾼다. 정산상태는 고치는 경로 정본(카드에서 카드면 지금 상태를 지킨다).
        if ((sentPay || !only.payMethod) && (pay.payMethod !== only.payMethod || pay.financialAccountId !== only.financialAccountId)) {
          next.payMethod = pay.payMethod
          next.financialAccountId = pay.financialAccountId
          next.financeName = pay.financeName
          next.settleStatus = settleStatusForEdit({ prevPayMethod: only.payMethod, nextPayMethod: pay.payMethod, current: only.settleStatus, isShipping: only.isShipping })
        }
        if (Object.keys(next).length > 0) await tx.expense.update({ where: { id: only.id, propertyId }, data: next })
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
            // 표식으로도 못 박는다 — 글자 판정에 기대지 않는다(운영자 확정 2026-08-27).
            costKind: 'LABOR',
            detail: `${fmtRoomNo(cur.room.roomNo, '')} ${cur.kind}${input.performerName ? ` · ${input.performerName}` : ''}`,
            vendor: input.performerName?.trim() || null,
            // 시공비는 무형 서비스라 재고 계산에 들면 안 된다. 형제인 completeCleaning 은
            // 원래 이 값을 세우는데 여기만 빠져 있었다(실측 2건이 false 였다).
            excludeFromInventory: true,
            // 결제수단과 정산상태(2026-10-27). 신용카드면 미정산으로 카드 정산에 오른다(lib/settleStatus 만드는 경로 정본).
            payMethod: pay.payMethod,
            financialAccountId: pay.financialAccountId,
            financeName: pay.financeName,
            settleStatus: settleStatusForNew(pay.payMethod),
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

/** 걸릴 만한 지출이 있는 작업 한 묶음 — 지출 저장 뒤 되묻기가 그대로 그린다. */
export type WorkLinkGroup = { workId: string; roomNo: string; kind: string; candidates: WorkLinkCandidate[] }

/**
 * 그날 저장한 지출 중 작업에 걸릴 만한 것을 찾는다 — 지출 저장 **뒤에** 부른다.
 *
 * **addExpense 안에 넣지 않는 이유.** 그 함수는 216줄에 다품목·방별 분배·주문 묶음·배송비·
 * OCR 학습이 얽힌 트랜잭션이다. 거기에 판정을 끼워 넣으면 저장이 그만큼 위험해진다.
 * 지출을 적는 것은 언제나 정당하고 작업 연결은 그 다음 문제라, 저장을 막지도 않는다.
 *
 * 방별 분배는 한 번의 저장이 **여러 방**에 걸쳐 여러 줄을 만든다(실측 07:30 한 번이 4개 후보).
 * 그래서 작업 단위로 묶어 돌려준다 — 화면이 창을 네 번 띄우지 않게.
 */
export async function findWorkLinkCandidates(dateYmd: string): Promise<WorkLinkGroup[]> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const date = ymdToDbDate(dateYmd)
  if (Number.isNaN(date.getTime())) return []
  const [works, free] = await Promise.all([
    prisma.roomWork.findMany({
      where: { propertyId, deletedAt: null, OR: [{ doneDate: date }, { scheduledDate: date }] },
      select: { id: true, roomId: true, kind: true, doneDate: true, scheduledDate: true, room: { select: { roomNo: true } } },
    }),
    prisma.expense.findMany({
      where: { propertyId, roomWorkId: null, date },
      select: { id: true, date: true, amount: true, itemLabel: true, detail: true, vendor: true, roomId: true, roomWorkId: true },
    }),
  ])
  const out: WorkLinkGroup[] = []
  for (const w of works) {
    const hit = free.filter(e => matchesWork(e, w))
    if (hit.length === 0) continue
    out.push({
      workId: w.id, roomNo: w.room.roomNo, kind: w.kind,
      candidates: hit.map(e => ({
        id: e.id, date: e.date.toISOString().slice(0, 10), amount: e.amount,
        label: e.itemLabel ?? e.detail ?? '(이름 없음)', vendor: e.vendor,
      })),
    })
  }
  return out
}

/** 고른 지출을 그 작업에 건다 — 완료 처리는 하지 않는다(상태는 운영자가 따로 정한다). */
export async function linkExpensesToWork(workId: string, expenseIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const w = await prisma.roomWork.findFirst({ where: { id: workId, propertyId, deletedAt: null }, select: { id: true } })
    if (!w) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    if (expenseIds.length === 0) return { ok: true }
    await prisma.expense.updateMany({ where: { id: { in: expenseIds }, propertyId, roomWorkId: null }, data: { roomWorkId: workId, costKind: 'LABOR' } })
    revalidatePath('/room-manage'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '연결에 실패했습니다.' }
  }
}

/**
 * 걸린 지출의 시공/자재 표식을 바꾼다 — **판정을 글자에서 떼는 자리다**.
 *
 * 종전에는 품목 이름으로만 갈랐다. 새 작업 종류가 생길 때마다 그 종류의 말을 판정어에
 * 더해야 했고, 자유 입력이라 다 맞힐 수가 없었다('실리콘 시공'은 걸리는데 '실리콘'은 자재).
 * 운영자가 여기서 한 번 고르면 그 답이 글자보다 강하다.
 */
export async function setExpenseCostKind(expenseId: string, costKind: 'LABOR' | 'MATERIAL'): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const r = await prisma.expense.updateMany({ where: { id: expenseId, propertyId }, data: { costKind } })
    if (r.count === 0) return { ok: false, error: '지출을 찾을 수 없습니다.' }
    revalidatePath('/room-manage'); revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '변경에 실패했습니다.' }
  }
}

/**
 * 걸린 지출 한 줄의 금액·업체를 고친다.
 *
 * 종전에는 걸린 지출이 여럿이면 "어느 줄인지 앱이 모른다"며 지출 화면으로 보냈다. 그런데
 * **운영자는 안다** — 화면이 줄을 안 보여줬을 뿐이다(운영자 지적 2026-08-28 — "지출로 가보면
 * 같은 업체에 묶여있기도 하거니와 방번호까지 다 지정되어있는데 왜 몰라?"). 줄을 보이고
 * 그 줄에서 고치게 하면 모호할 것이 없다.
 *
 * 2026-10-27 승인 계획 결정 7. 한 건 수정 폼에서 여러 건 걸린 작업의 줄마다 [금액·업체 고치기]가 이 문을 부른다.
 * **그 작업에 걸린 지출만** 고친다(workId 로 좁힌다). 종전에는 어느 작업에든 걸린 지출이면 고칠 수 있었다.
 * 종전 즉시 저장 금액 칸에는 적용취소가 없었다(§16 위반). 이제 쓰기 전·쓴 직후를 서명 토큰으로 돌려준다(undoRoomRecordEdit).
 */
export async function updateWorkExpense(input: {
  workId: string; expenseId: string; amount?: number; vendor?: string | null
}): Promise<{ ok: true; undo: RoomRecordEditUndo | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const work = await prisma.roomWork.findFirst({ where: { id: input.workId, propertyId, deletedAt: null }, select: { id: true } })
    if (!work) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    const cur = await prisma.expense.findFirst({ where: { id: input.expenseId, propertyId, roomWorkId: work.id }, select: EXPENSE_SNAP_SELECT })
    if (!cur) return { ok: false, error: '이 작업에 걸린 지출을 찾을 수 없습니다.' }
    const data: { amount?: number; vendor?: string | null } = {}
    if (input.amount != null) {
      if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: '금액은 0원보다 커야 합니다. 이 지출을 지우려면 지출 화면에서 지웁니다.' }
      data.amount = Math.round(input.amount)
    }
    if (input.vendor !== undefined) data.vendor = input.vendor?.trim() || null
    if (Object.keys(data).length === 0) return { ok: true, undo: null }
    const before = expenseSnapOf(cur)
    // 조건부 쓰기 — 읽은 뒤 그사이 이 줄이 바뀌었으면 안 쓴다.
    const r = await prisma.expense.updateMany({ where: { id: cur.id, propertyId, roomWorkId: work.id, amount: cur.amount, vendor: cur.vendor }, data })
    if (r.count === 0) return { ok: false, error: ROOM_RECORD_STALE }
    const after = { ...before, ...data }
    revalidatePath('/room-manage'); revalidatePath('/finance')
    return { ok: true, undo: signRoomRecordEdit(propertyId, { kind: 'work-expense', id: work.id, before: {}, after: {}, expense: { before, after } }) }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '변경에 실패했습니다.' }
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

/** 작업 기록 칸 스냅샷(적용취소 토큰). 칸은 lib/roomRecordEditUndo RECORD_SNAP_FIELDS.work 와 같다. */
function workSnapOf(w: { kind: string; scheduledDate: Date | null; doneDate: Date | null; performer: string | null; performerName: string | null; memo: string | null; estimateAmount: number | null }): RecordSnap {
  return { kind: w.kind, scheduledDate: ymd(w.scheduledDate), doneDate: ymd(w.doneDate), performer: w.performer, performerName: w.performerName, memo: w.memo, estimateAmount: w.estimateAmount }
}

const PERFORMER_VALUES: readonly string[] = ['SELF', 'VENDOR', 'THIRD_PARTY']

/**
 * 작업 기록 **한 건** 수정(2026-10-27 운영자 지적·승인 계획 2단계). 방 모달·작업 탭 행의 [수정] → Modal 폼이 부른다.
 *
 * 운영자 원문 요지. "특정 내역만 수정하고 싶은데 편집을 누르니 내역 전체를 수정할 수 있게 되버리네… 날짜는 날짜변경을 따로 눌러야하고
 * 업체나 상세 내역은 수정을 못하네". 그래서 그 건의 날짜·종류·수행자·업체·시공비·결제수단·메모를 **한 트랜잭션**에서 고친다.
 *
 * 칸. 예정 건은 예정일(비울 수 있다)·종류·담당·업체·메모. 완료 건은 완료일(미래 거부)·종류·수행자·업체·메모와 시공비·결제수단.
 * 시공비(완료 건만, cost 를 실었을 때만).
 *   · 걸린 지출 1건 — 그 지출의 금액·업체(=업체 이름)·결제수단을 고친다. 지출 날짜는 안 옮긴다(작업 날짜와 지출 날짜는 다른 축, 종전 날짜 변경과 같다).
 *     지출 품목명이 정확히 '{옛 종류} 시공' 이면(완료가 만든 줄) 새 종류로 품목명·내역을 고친다(결정 6). 손으로 적은 이름은 안 건드린다.
 *     0원은 받지 않는다(지출을 지우는 판단은 지출 화면 몫이다).
 *   · 여러 건 — 금액 칸을 받지 않는다(어느 줄의 돈인지 모른다, 결정 7). 줄마다 updateWorkExpense 로 고친다.
 *   · 0건 — 금액이 있으면 시공 지출을 새로 만든다(완료의 'create' 와 같은 줄). 같은 날 이 방에 걸릴 만한 미연결 지출이 있으면
 *     만들지 않고 거부한다(413호처럼 같은 돈이 두 벌 적히지 않게). 그때는 완료를 적용취소하고 다시 완료해 그 지출을 건다.
 * 열었을 때의 updatedAt 과 지금이 다르면 거부한다(조건부 쓰기). 저장 직전 모습을 서명 토큰으로 돌려준다(undoRoomRecordEdit).
 */
export async function updateRoomWork(input: {
  id: string
  expectedUpdatedAt: string
  date: string | null
  kind: string
  addKindToList?: boolean
  performer: CleaningPerformer | null
  performerName?: string | null
  memo?: string | null
  cost?: number | null
  payMethod?: string | null
  financialAccountId?: string | null
  /** 견적 금액(원). 안 실으면 그대로, 0 이하·null 이면 지운다. 지출과 무관하다(3단계, 2026-10-27). */
  estimateAmount?: number | null
}): Promise<{ ok: true; undo: RoomRecordEditUndo | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const cur = await prisma.roomWork.findFirst({
      where: { id: input.id, propertyId, deletedAt: null },
      select: {
        id: true, roomId: true, kind: true, status: true, scheduledDate: true, doneDate: true,
        performer: true, performerName: true, memo: true, updatedAt: true, estimateAmount: true,
        room: { select: { roomNo: true } },
        expenses: { select: { ...EXPENSE_SNAP_SELECT, isShipping: true } },
      },
    })
    if (!cur) return { ok: false, error: '작업 기록을 찾을 수 없습니다.' }
    if (cur.updatedAt.toISOString() !== input.expectedUpdatedAt) return { ok: false, error: ROOM_RECORD_STALE }
    const done = cur.status === 'DONE'

    // 날짜 — 완료 건은 완료일(꼭 있어야 하고 미래 거부), 예정 건은 예정일(비울 수 있다).
    let date: Date | null = null
    if (input.date) {
      date = ymdToDbDate(input.date)
      if (Number.isNaN(date.getTime())) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' }
    }
    if (done) {
      if (!date) return { ok: false, error: '완료일을 골라 주세요.' }
      const fg = assertNotFuture(input.date)
      if (!fg.ok) return { ok: false, error: fg.reason }
    }
    // 종류 — 예정 등록과 같은 맨 글자 규약. 지금 값(prev)과 같으면 목록에 안 더한다(목록에서 뺀 종류가 저장마다 되살아나지 않게).
    const kindSave = await autoOptionForSave(propertyId, 'workKindOptions', input.kind, { addToList: input.addKindToList, prev: cur.kind })
    const kind = kindSave.value
    if (!kind) return { ok: false, error: '작업 종류를 골라 주세요.' }
    // 수행자 — 완료 건은 셋 중 하나(완료 폼과 같다), 예정 건은 비울 수 있다(미정).
    const performer = input.performer && PERFORMER_VALUES.includes(input.performer) ? input.performer : null
    if (done && !performer) return { ok: false, error: '수행자를 골라 주세요.' }
    // 업체 이름 — 완료 건은 완료 폼처럼 늘 받고, 예정 건은 맡긴 경우에만 남긴다(예정 등록과 같다, 안 보이는 값을 저장하지 않는다).
    const name = done ? (input.performerName?.trim() || null) : (performer && performer !== 'SELF' ? (input.performerName?.trim() || null) : null)
    const memo = input.memo?.trim() || null
    if (memo && memo.length > 500) return { ok: false, error: '메모는 500자까지 적습니다.' }
    const estimateAmount = input.estimateAmount === undefined ? cur.estimateAmount : estimateOf(input.estimateAmount)

    // 시공비 — 완료 건만.
    const wantsCost = input.cost != null
    if (wantsCost && !done) return { ok: false, error: '예정 작업에는 시공비를 적지 않습니다. 완료 처리에서 적습니다.' }
    const cost = wantsCost ? Math.max(0, Math.round(Number(input.cost) || 0)) : 0
    if (wantsCost && cur.expenses.length > 1) return { ok: false, error: `이 작업에는 지출 ${cur.expenses.length}건이 걸려 있어 금액은 줄마다 고칩니다.` }
    if (wantsCost && cur.expenses.length === 1 && cost <= 0) return { ok: false, error: '시공비를 0원으로 바꾸려면 지출 화면에서 그 지출을 지웁니다.' }
    if (wantsCost && cur.expenses.length === 0 && cost > 0) {
      const free = await prisma.expense.findMany({
        where: { propertyId, roomId: cur.roomId, roomWorkId: null, date: date! },
        select: { id: true, date: true, amount: true, itemLabel: true, detail: true, vendor: true, roomId: true, roomWorkId: true },
      })
      if (free.some(e => matchesWork(e, { roomId: cur.roomId, kind, doneDate: date, scheduledDate: null }))) {
        return { ok: false, error: '같은 날 이 방에 이미 적어 둔 시공 지출이 있습니다. 완료를 적용취소한 뒤 다시 완료하면 그 지출을 걸 수 있습니다.' }
      }
    }
    const touchExpense = wantsCost && (cur.expenses.length === 1 || cost > 0)
    const sentPay = !!input.payMethod?.trim()
    const payRes = touchExpense
      ? await resolveWorkPay(prisma, propertyId, { payMethod: input.payMethod, financialAccountId: input.financialAccountId, vendor: name, category: WORK_EXPENSE_CATEGORY })
      : null
    if (payRes && !payRes.ok) return payRes
    const pay = payRes?.ok ? payRes.pay : null

    const before = workSnapOf(cur)
    const after = workSnapOf({ kind, scheduledDate: done ? cur.scheduledDate : date, doneDate: done ? date : cur.doneDate, performer, performerName: name, memo, estimateAmount })
    let expense: RoomRecordEditUndo['expense']

    await prisma.$transaction(async tx => {
      // 조건부 쓰기 — 연 뒤 그사이 바뀌었으면 안 쓴다(전부 되감긴다).
      const w = await tx.roomWork.updateMany({
        where: { id: cur.id, propertyId, deletedAt: null, updatedAt: cur.updatedAt },
        data: {
          kind,
          ...(done ? { doneDate: date } : { scheduledDate: date }),
          performer, performerName: name, memo, estimateAmount,
        },
      })
      if (w.count !== 1) throw new Error(ROOM_RECORD_STALE)
      if (!touchExpense || !pay) return
      if (cur.expenses.length === 1) {
        const only = cur.expenses[0]
        const next: {
          amount: number; vendor: string | null; itemLabel?: string; detail?: string
          payMethod?: string; financialAccountId?: string | null; financeName?: string | null; settleStatus?: 'SETTLED' | 'UNSETTLED'
        } = { amount: cost, vendor: name }
        // 완료가 만든 시공 줄이면 종류 이름을 따라간다(결정 6). 손으로 적은 품목명은 그대로다.
        if (kind !== cur.kind && only.itemLabel === `${cur.kind} 시공`) {
          next.itemLabel = `${kind} 시공`
          next.detail = `${fmtRoomNo(cur.room.roomNo, '')} ${kind}${name ? ` · ${name}` : ''}`
        }
        // 결제수단 — 화면이 고른 값이 있거나 지출이 비어 있을 때만 바꾼다. 정산상태는 고치는 경로 정본.
        if ((sentPay || !only.payMethod) && (pay.payMethod !== only.payMethod || pay.financialAccountId !== only.financialAccountId)) {
          next.payMethod = pay.payMethod
          next.financialAccountId = pay.financialAccountId
          next.financeName = pay.financeName
          next.settleStatus = settleStatusForEdit({ prevPayMethod: only.payMethod, nextPayMethod: pay.payMethod, current: only.settleStatus, isShipping: only.isShipping })
        }
        const e = await tx.expense.update({ where: { id: only.id, propertyId }, data: next, select: EXPENSE_SNAP_SELECT })
        expense = { before: expenseSnapOf(only), after: expenseSnapOf(e) }
        return
      }
      const e = await tx.expense.create({
        data: {
          propertyId, date: date!, amount: cost,
          category: WORK_EXPENSE_CATEGORY,
          roomId: cur.roomId,
          roomWorkId: cur.id,
          itemLabel: `${kind} 시공`,
          costKind: 'LABOR',
          detail: `${fmtRoomNo(cur.room.roomNo, '')} ${kind}${name ? ` · ${name}` : ''}`,
          vendor: name,
          excludeFromInventory: true,
          payMethod: pay.payMethod,
          financialAccountId: pay.financialAccountId,
          financeName: pay.financeName,
          settleStatus: settleStatusForNew(pay.payMethod),
        },
        select: EXPENSE_SNAP_SELECT,
      })
      expense = { before: null, after: expenseSnapOf(e) }
    })
    await kindSave.commit()
    revalidatePath('/room-manage'); if (expense) revalidatePath('/finance')
    return { ok: true, undo: signRoomRecordEdit(propertyId, { kind: 'work', id: cur.id, before, after, ...(expense ? { expense } : {}) }) }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '수정에 실패했습니다.' }
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
