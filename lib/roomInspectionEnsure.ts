// 퇴실·청소 완료가 방 점검을 만들고, 그 처리를 무르면 걷는 서버 전용 정본(화면이 직접 부르지 못한다).
//
// 'use server' 파일이 아니다. 영업장 id 를 인자로 받는 함수라 화면에서 부를 수 있으면 남의 영업장에 점검을 만든다
// (lib/reasonListSave 와 같은 이유). 화면이 부르는 문은 app/(app)/room-manage/inspectionActions.ts 이고, 그쪽은 관문을 지난 뒤 이 파일을 쓴다.
//
// 규칙(운영자 승인 2026-10-27, 신고 2911c217).
//   · 퇴실 처리 때 퇴실 점검(예정일 = 퇴실일)과 입실 전 점검(예정일 없음) 둘, 청소 완료 때 청소 검수(그 청소에 묶임) 하나를 만든다.
//     퇴실 예정 전환 때는 만들지 않는다.
//   · 그 방에 같은 단계의 열린(예정) 점검이 있으면 새로 안 만든다. 같은 퇴실·같은 청소로 만든 점검이 이미 살아 있어도(완료 포함) 안 만든다.
//   · 무르는 처리(퇴실 적용취소·청소 완료 적용취소)는 **예정 상태인 것만** 소프트삭제한다. 끝낸 점검은 사실이라 남긴다.
//   · 같은 퇴실·같은 청소로 다시 처리하면 소프트삭제한 그 점검을 되살린다. 체크해 둔 항목이 그대로 돌아온다.
//   · 실패해도 던지지 않는다. 퇴실·청소는 이미 끝났고 점검이 그것을 되돌릴 이유가 없다. 부르는 쪽이 한 줄로 알린다.
import 'server-only'
import prisma from '@/lib/prisma'
import { parseOptionList } from '@/lib/optionLists'
import { withParticle } from '@/lib/koParticle'
import { seedInspectionItems } from '@/lib/roomInspectionSeed'
import { getTrackedCategories } from '@/app/(app)/inventory/categoryConfig'
import {
  INSPECTION_TEMPLATE_FIELD, INSPECTION_ASSET_STAGES, INSPECTION_STAGE_LABEL, moveInClosedMarker,
  type InspectionStage,
} from '@/app/(app)/room-manage/inspectionConstants'

export type EnsureInspectionKind = 'created' | 'revived' | 'skipped-open' | 'skipped-exists' | 'skipped-none' | 'failed'
export type EnsureInspectionResult = { kind: EnsureInspectionKind; id: string | null; stage: InspectionStage; itemCount: number }

/** 그 단계 항목을 정한다. 영업장 목록·제외 품목·비품 행을 읽어 순수 함수(lib/roomInspectionSeed)에 넘긴다. */
async function planItems(propertyId: string, roomId: string, stage: InspectionStage) {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { checkoutInspectionItems: true, cleaningInspectionItems: true, moveinInspectionItems: true, inspectionExcludedItems: true },
  })
  const field = INSPECTION_TEMPLATE_FIELD[stage]
  const template = field === 'checkoutInspectionItems' ? parseOptionList('checkoutInspectionItems', p?.checkoutInspectionItems)
    : field === 'cleaningInspectionItems' ? parseOptionList('cleaningInspectionItems', p?.cleaningInspectionItems)
    : parseOptionList('moveinInspectionItems', p?.moveinInspectionItems)
  const withAssets = INSPECTION_ASSET_STAGES.includes(stage)
  const trackedCategories = withAssets ? await getTrackedCategories(propertyId) : []
  const assets = withAssets
    ? await prisma.expense.findMany({
        where: {
          propertyId, roomId, receivedAt: { not: null }, disposedAt: null, isShipping: false, excludeFromInventory: false,
          itemLabel: { not: null }, category: { notIn: trackedCategories },
          // 방 작업(도배·장판)에 묶인 시공 자재는 점검할 비품이 아니다(2026-10-27 운영자 결정 ②).
          roomWorkId: null,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, itemLabel: true, category: true, receivedAt: true, disposedAt: true, isShipping: true, excludeFromInventory: true, roomWorkId: true },
      })
    : []
  return seedInspectionItems({
    stage, template, assets, trackedCategories,
    excluded: parseOptionList('inspectionExcludedItems', p?.inspectionExcludedItems),
    assetStages: INSPECTION_ASSET_STAGES,
  })
}

/**
 * 점검 한 건과 그 항목을 한 트랜잭션으로 만든다. 손수 등록(inspectionActions createInspection)과 자동 생성이 이 한 벌을 쓴다.
 * 부르는 쪽이 방이 이 영업장 것인지 이미 확인했어야 한다.
 */
export async function createRoomInspection(propertyId: string, input: {
  roomId: string
  stage: InspectionStage
  leaseTermId?: string | null
  cleaningId?: string | null
  scheduledDate?: Date | null
}): Promise<{ id: string; itemCount: number }> {
  const items = await planItems(propertyId, input.roomId, input.stage)
  return prisma.$transaction(async tx => {
    const row = await tx.roomInspection.create({
      data: {
        propertyId, roomId: input.roomId, stage: input.stage, status: 'PLANNED',
        leaseTermId: input.leaseTermId ?? null, cleaningId: input.cleaningId ?? null,
        scheduledDate: input.scheduledDate ?? null,
      },
      select: { id: true },
    })
    if (items.length > 0) {
      await tx.roomInspectionItem.createMany({
        data: items.map(it => ({ inspectionId: row.id, propertyId, label: it.label, sortOrder: it.sortOrder, source: it.source, expenseId: it.expenseId })),
      })
    }
    return { id: row.id, itemCount: items.length }
  })
}

/**
 * 그 단계 점검이 없으면 만든다(열린 것이 있으면 건너뛰고, 무른 것이 있으면 되살린다).
 *
 * 열쇠는 단계와 출처다. 퇴실이 만든 점검은 계약(leaseTermId), 청소 검수는 청소(cleaningId)다.
 * 열린 점검은 방·단계로 본다. 같은 방에 같은 단계의 할 일이 둘 서면 '청소 필요' 처럼 숫자가 실제보다 커진다.
 */
export async function ensureRoomInspection(propertyId: string, input: {
  roomId: string
  stage: InspectionStage
  leaseTermId?: string | null
  cleaningId?: string | null
  scheduledDate?: Date | null
  /**
   * 되살리기만 한다(걷힌 것이 없으면 새로 안 만든다). 청소 삭제 적용취소가 쓴다. 이 기능 전에 끝난 옛 청소를 되살렸다고
   * 그 청소의 검수가 새로 생기면, 지운 적 없는 할 일이 생긴다(2026-10-27 운영자 판단 ③ 반영 때의 보수적 판단).
   */
  reviveOnly?: boolean
}): Promise<EnsureInspectionResult> {
  const stage = input.stage
  try {
    const open = await prisma.roomInspection.findFirst({
      where: { propertyId, roomId: input.roomId, stage, status: 'PLANNED', deletedAt: null },
      select: { id: true },
    })
    if (open) return { kind: 'skipped-open', id: open.id, stage, itemCount: 0 }
    const key = input.cleaningId ? { cleaningId: input.cleaningId } : input.leaseTermId ? { leaseTermId: input.leaseTermId } : null
    if (key) {
      const alive = await prisma.roomInspection.findFirst({
        where: { propertyId, roomId: input.roomId, stage, deletedAt: null, ...key },
        select: { id: true },
      })
      if (alive) return { kind: 'skipped-exists', id: alive.id, stage, itemCount: 0 }
      // 무른 처리로 걷힌 예정 점검을 되살린다. 운영자가 손으로 지운 것도 같은 칸(deletedAt)이지만, 같은 퇴실·청소를 다시 처리한
      // 자리라 그 점검이 다시 필요한 것은 같다. 체크해 둔 항목이 그대로 돌아온다.
      const gone = await prisma.roomInspection.findFirst({
        where: { propertyId, roomId: input.roomId, stage, status: 'PLANNED', deletedAt: { not: null }, ...key },
        orderBy: { deletedAt: 'desc' },
        select: { id: true },
      })
      if (gone) {
        await prisma.roomInspection.update({
          where: { id: gone.id, propertyId },
          data: { deletedAt: null, scheduledDate: input.scheduledDate ?? null },
        })
        const itemCount = await prisma.roomInspectionItem.count({ where: { inspectionId: gone.id, propertyId } })
        return { kind: 'revived', id: gone.id, stage, itemCount }
      }
    }
    if (input.reviveOnly) return { kind: 'skipped-none', id: null, stage, itemCount: 0 }
    const made = await createRoomInspection(propertyId, input)
    return { kind: 'created', id: made.id, stage, itemCount: made.itemCount }
  } catch {
    return { kind: 'failed', id: null, stage, itemCount: 0 }
  }
}

/** 퇴실 처리가 만드는 둘. 퇴실 점검 예정일은 퇴실일, 입실 전 점검은 날짜 없이(다음 입실 날을 아직 모른다). */
export async function ensureCheckoutInspections(propertyId: string, roomId: string | null, leaseTermId: string): Promise<{
  checkout: EnsureInspectionResult | null
  movein: EnsureInspectionResult | null
}> {
  if (!roomId) return { checkout: null, movein: null }
  const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { moveOutDate: true } }).catch(() => null)
  const checkout = await ensureRoomInspection(propertyId, { roomId, stage: 'CHECKOUT', leaseTermId, scheduledDate: lease?.moveOutDate ?? null })
  const movein = await ensureRoomInspection(propertyId, { roomId, stage: 'BEFORE_MOVEIN', leaseTermId, scheduledDate: null })
  return { checkout, movein }
}

/** 못 만든 점검이 있으면 그 사실 한 문장. 퇴실·청소 결과 안내 끝에 잇는다. */
export function inspectionFailureNotice(results: readonly (EnsureInspectionResult | null)[]): string | null {
  const failed = results.filter((r): r is EnsureInspectionResult => !!r && r.kind === 'failed').map(r => INSPECTION_STAGE_LABEL[r.stage])
  if (failed.length === 0) return null
  return `${withParticle(failed.join('·'), '을/를')} 만들지 못했습니다. 호실 관리 '작업'에서 직접 등록해 주세요.`
}

/**
 * 퇴실을 무르면 그 퇴실이 만든 예정 점검을 걷는다(퇴실 점검·입실 전 점검). 끝낸 점검은 그대로 둔다.
 * 판정은 저작자가 아니라 전제다. 그 방에 다시 사람이 사니, 그 퇴실의 예정 점검은 거짓이 된다(clearAutoCheckoutCleaning 과 같은 판정).
 */
export async function clearCheckoutInspections(propertyId: string, leaseTermId: string): Promise<void> {
  try {
    await prisma.roomInspection.updateMany({
      where: { propertyId, leaseTermId, stage: { in: ['CHECKOUT', 'BEFORE_MOVEIN'] }, status: 'PLANNED', deletedAt: null },
      data: { deletedAt: new Date() },
    })
  } catch { /* 점검은 상태 전이를 막지 않는다 */ }
}

/** 청소 완료를 무르면 그 청소의 예정 검수를 걷는다. 끝낸 검수는 그대로 둔다. */
export async function clearCleaningInspection(propertyId: string, cleaningId: string): Promise<void> {
  try {
    await prisma.roomInspection.updateMany({
      where: { propertyId, cleaningId, stage: 'AFTER_CLEANING', status: 'PLANNED', deletedAt: null },
      data: { deletedAt: new Date() },
    })
  } catch { /* 점검은 청소 되돌리기를 막지 않는다 */ }
}

/** 그 방의 열린 입실 전 점검 진행. 없으면 null. 입실 처리 안내·입실 버튼 앞 안내 줄이 쓴다. */
export async function openMoveInInspectionSummary(propertyId: string, roomId: string): Promise<{ id: string; checked: number; total: number } | null> {
  const open = await prisma.roomInspection.findFirst({
    where: { propertyId, roomId, stage: 'BEFORE_MOVEIN', status: 'PLANNED', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!open) return null
  const [total, pending] = await Promise.all([
    prisma.roomInspectionItem.count({ where: { inspectionId: open.id, propertyId } }),
    prisma.roomInspectionItem.count({ where: { inspectionId: open.id, propertyId, result: 'PENDING' } }),
  ])
  return { id: open.id, checked: total - pending, total }
}

/** 이 퇴실이 만든 열린 퇴실 점검(퇴실 처리 토스트의 '퇴실 점검 N항목 · 열기'). 없으면 null(이미 다른 퇴실의 점검이 열려 있던 경우 포함). */
export async function checkoutInspectionForLease(propertyId: string, leaseTermId: string): Promise<{ id: string; roomId: string; itemCount: number } | null> {
  try {
    const row = await prisma.roomInspection.findFirst({
      where: { propertyId, leaseTermId, stage: 'CHECKOUT', status: 'PLANNED', deletedAt: null },
      select: { id: true, roomId: true },
    })
    if (!row) return null
    const itemCount = await prisma.roomInspectionItem.count({ where: { inspectionId: row.id, propertyId } })
    return { id: row.id, roomId: row.roomId, itemCount }
  } catch { return null }
}

/**
 * 입실이 그 방의 열린 입실 전 점검을 '안 함'으로 닫는다(2026-10-27 운영자 결정 ③). 입실을 만드는 모든 경로가 부른다
 * (상태 위젯 입실 처리·수정 폼 거주중 전환·홈 알림 입실·moveInTenant). 사람이 들어간 방의 입실 전 점검은 더 할 수 없는 일이라
 * 예정으로 남겨 두면 거주 중인 방에 '점검 남음' 이 선다. 끝낸 판정은 그대로 남는다(상태만 닫는다).
 *
 * 누가 닫았는지는 doneBy 로그 칸에 `auto-movein:<계약 id>` 로 남긴다. 입실 적용취소가 이 표식으로 **그 입실이 닫은 점검만** 되연다
 * (손으로 '안 하기로' 한 점검은 표식이 없어 안 열린다). 칸을 새로 두지 않는 것은 스키마 변경이 계획 밖이라서다.
 * 실패해도 던지지 않는다(입실은 이미 끝났다). 닫았으면 남은 항목 수를 돌려준다(입실 토스트 둘째 줄).
 */
export async function closeMoveInInspectionOnMoveIn(propertyId: string, roomId: string | null, leaseTermId: string): Promise<{ id: string; pending: number; total: number } | null> {
  if (!roomId) return null
  try {
    const open = await prisma.roomInspection.findFirst({
      where: { propertyId, roomId, stage: 'BEFORE_MOVEIN', status: 'PLANNED', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!open) return null
    const [total, pending] = await Promise.all([
      prisma.roomInspectionItem.count({ where: { inspectionId: open.id, propertyId } }),
      prisma.roomInspectionItem.count({ where: { inspectionId: open.id, propertyId, result: 'PENDING' } }),
    ])
    await prisma.roomInspection.update({
      where: { id: open.id, propertyId },
      data: { status: 'SKIPPED', doneBy: moveInClosedMarker(leaseTermId) },
    })
    return { id: open.id, pending, total }
  } catch { return null }
}

/**
 * 입실 적용취소(거주중 -> 입실 예약)가 그 입실이 닫은 입실 전 점검을 예정으로 되연다. 같은 방·같은 단계에 이미 다른 예정 점검이 있으면
 * 되열지 않는다(열린 할 일이 둘 서지 않게). 실패해도 던지지 않는다.
 */
export async function reopenMoveInInspectionOnUndo(propertyId: string, leaseTermId: string): Promise<void> {
  try {
    const closed = await prisma.roomInspection.findMany({
      where: { propertyId, stage: 'BEFORE_MOVEIN', status: 'SKIPPED', doneBy: moveInClosedMarker(leaseTermId), deletedAt: null },
      select: { id: true, roomId: true },
    })
    for (const row of closed) {
      const other = await prisma.roomInspection.findFirst({
        where: { propertyId, roomId: row.roomId, stage: 'BEFORE_MOVEIN', status: 'PLANNED', deletedAt: null },
        select: { id: true },
      })
      if (other) continue
      await prisma.roomInspection.update({ where: { id: row.id, propertyId }, data: { status: 'PLANNED', doneBy: null } })
    }
  } catch { /* 점검은 입실 되돌리기를 막지 않는다 */ }
}
