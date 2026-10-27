'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { triggerRedeploy } from '@/lib/redeployHook'
import {
  createDriveResumableSession,
  setDrivePublicReadable,
  buildDriveThumbnailUrl,
  deleteFromDrive,
} from '@/lib/google-drive'
import { looksLike360 } from '@/lib/driveImage'
import { applyScheduledRentsFor } from '@/lib/scheduledRent'
import { kstMonthStr, kstYmdStr, kstMonthKey } from '@/lib/kstDate'
import { buildMoveCalendar, monthLastDay, type MoveCalendarMonth, type MoveCalendarRange } from '@/lib/moveCalendar'
import { fetchMoveLeases, loadMoveRange } from '@/lib/moveCalendarData'
import { createOverlapAck, softDeleteOverlapAck } from '@/lib/overlapAck'
import { fmtRoomNo } from '@/lib/roomNo'
import { withParticle } from '@/lib/koParticle'
import { syncLeaseRentForRoom, unrecordedPastMonths, RoomRentSyncStale, ROOM_RENT_SYNC_STALE, RENT_AXIS_STATUSES, type RentAxis, type RentSyncApplied } from '@/lib/roomRentSync'
import {
  ROOM_RENT_SYNC_UNDO_DOMAIN, canonicalRoomRentSyncUndo, parseRoomRentSyncUndo,
  ROOM_RENT_SYNC_UNDO_INVALID, ROOM_RENT_SYNC_UNDO_CONFLICT, ROOM_RENT_SYNC_UNDO_BILLED, type RoomRentSyncUndo,
} from '@/lib/roomRentSyncUndo'
import { signUndoBody, verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import { displayName } from '@/lib/displayName'

async function getPropertyId() {
  const { userId, propertyId, role } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId, role }
}

// 화면에서 온 호실 id 가 이 영업장 방이 아닐 때의 말. 있는지 없는지 가리지 않는다(2026-10-23 운영자 승인).
const ROOM_GONE = '호실을 찾을 수 없습니다.'

// 일괄 편집이 바꿀 수 있는 칸(2026-10-23 운영자 승인). 화면 객체·적용취소 토큰은 이 표의 칸만 골라 쓴다.
// 그대로 data 에 펼치면 propertyId·roomNo·isVacant·doorMasterKeyEnc 같은 칸이 실려 방을 남의 영업장으로 옮기거나 덮어쓴다.
const BATCH_ROOM_FIELDS = {
  type: 'string?', tier: 'string?', baseRent: 'number', scheduledRent: 'number?',
  rentUpdateDate: 'date?', windowType: 'string?', direction: 'string?',
} as const
type BatchRoomFields = Partial<{ type: string | null; tier: string | null; baseRent: number; scheduledRent: number | null; rentUpdateDate: Date | null; windowType: string | null; direction: string | null }>
const BATCH_ROOM_INPUT_INVALID = '일괄 수정 입력값이 올바르지 않습니다.'

/** 허용 칸만 골라 낸다. 안 실려 온 칸(undefined)은 빼고, 형이 틀린 칸이 하나라도 있으면 null(저장 거절). 날짜는 Date·ISO 문자열 둘 다 받는다. */
function pickBatchRoomFields(src: unknown): BatchRoomFields | null {
  if (!src || typeof src !== 'object') return null
  const s = src as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, kind] of Object.entries(BATCH_ROOM_FIELDS)) {
    const v = s[key]
    if (v === undefined) continue
    if (v === null) { if (!kind.endsWith('?')) return null; out[key] = null; continue }
    const base = kind.replace('?', '')
    if (base === 'date') {
      const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
      if (!d || Number.isNaN(d.getTime())) return null
      out[key] = d
      continue
    }
    if (typeof v !== base || (base === 'number' && !Number.isFinite(v))) return null
    out[key] = v
  }
  return out as BatchRoomFields
}

// 호실 목록 조회
export async function getRooms() {
  const { propertyId, role } = await getPropertyId()
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    include: {
      photos: { orderBy: { sortOrder: 'asc' } },
      leaseTerms: {
        // NON_RESIDENT 포함 — 창고·사무실 점유 표시(방 nonResidentVacant 설정과 연동, 2026-07-06)
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: {
          id: true,
          status: true,
          tenantId: true,
          // 별칭·영어이름·표시 선택도 내려보낸다 — 카드가 부를 이름은 lib/displayName 이 고른다(홈 타일과 같은 규칙).
          tenant: { select: { id: true, name: true, englishName: true, nickname: true, displayNameStyle: true } },
          // 방 어레인지 — 카드에 퇴실·입주 예정일을 병기하고, 단기 퇴실 도래를 파생 판정한다.
          isShortTerm: true,
          moveInDate: true,
          expectedMoveOut: true,
        },
        // status asc 는 LeaseStatus 선언 순서 — RESERVED · ACTIVE · CHECKOUT_PENDING · NON_RESIDENT 다.
        // 즉 예약이 거주보다 앞선다. 종전 주석은 그 반대로 적혀 있었고, 화면이 주석을 믿고 '첫 계약'을
        // 주 계약으로 쓰다가 예약 걸린 방에서 실거주자를 잃었다. 주 계약 선택은 화면(primaryLease)이
        // 의미로 하고, 여기 정렬은 take 로 잘릴 때 점유 계약이 먼저 남게 하는 역할만 한다.
        orderBy: { status: 'asc' },
        take: 3,   // 예약 + 거주 + 비거주 동시 존재 대비(2 면 비거주가 잘려 창고·사무실 표시가 사라진다)
      },
    },
    orderBy: { roomNo: 'asc' },
  })

  // 금액 읽기 차단(제한 스태프) — 기준·예정·비거주 이용료를 응답에서 제거. 조회 전용, 결제 수식 무관.
  if (!canReadScope(role, 'money')) {
    for (const r of rooms) {
      ;(r as { baseRent: number | null }).baseRent = null
      ;(r as { scheduledRent: number | null }).scheduledRent = null
      ;(r as { nonResidentRent: number | null }).nonResidentRent = null
    }
  }
  // 날짜는 'YYYY-MM-DD' 문자열로 고정해 내려보낸다 — 수납 관리(rooms/actions.ts)와 같은 문법이라야
  // 카드의 D-day·월 비교가 두 화면에서 같은 값을 낸다.
  const ymd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null
  return rooms.map(r => ({
    ...r,
    leaseTerms: r.leaseTerms.map(l => ({
      ...l,
      moveInDate: ymd(l.moveInDate),
      expectedMoveOut: ymd(l.expectedMoveOut),
    })),
  }))
}

// ── 입퇴실 캘린더 공통 재료 ────────────────────────────────────────
// 월 창(홈 '이달 입퇴실 N건')과 연속 범위(호실 관리 입퇴실 탭)가 lib/moveCalendarData 한 벌을 쓴다.
// 조회가 이 파일 밖에 있는 이유는 감지망 때문이다 — 그물이 사본을 들면 조회가 바뀔 때 옛 규칙에
// 남아 통과를 말한다(check-move-calendar-drift 가 같은 fetchMoveLeases 를 부른다).

// 연속 범위 경계 규칙은 lib/moveCalendar 의 moveRangeWindow 로 옮겼다 — 순수 함수라야 회귀가 선다.

/**
 * 입퇴실 캘린더 한 달치 — 그 달에 입주·퇴실·예약 시작이 있는 방의 체류 구간.
 *
 * 위 getRooms 를 재사용하지 않는 이유가 셋이다. `take: 3` 이라 계약이 넷인 방에서 하나가 잘리고,
 * 퇴실 완료(CHECKED_OUT)를 아예 안 읽어 과거 달의 퇴실이 통째로 사라지며, 사진·상세까지 딸려 와
 * 이 화면이 쓰지 않는 것을 실어 나른다. 이 화면의 질문은 '이 달에 무엇이 바뀌었나'라 조회도
 * 그 모양이어야 한다.
 *
 * 홈 현황의 '이달 입퇴실 N건'이 이 함수의 eventCount 를 딛는다 — 호실 관리는 연속 범위를
 * 보지만 그 탭 접미 N 도 같은 '이 달'의 수라야 두 화면이 다른 숫자를 말하지 않는다.
 */
export async function getMoveCalendarMonth(month: string): Promise<MoveCalendarMonth> {
  const { propertyId } = await getPropertyId()
  const target = /^\d{4}-\d{2}$/.test(month) ? month : kstMonthStr()
  const { changed, context } = await fetchMoveLeases(prisma, propertyId, `${target}-01`, monthLastDay(target))

  return buildMoveCalendar({
    month: target,
    today: kstYmdStr(),
    changed,
    context,
  })
}

/**
 * 입퇴실 캘린더 연속 범위 한 벌 — 여러 달을 이어 붙인 하나의 트랙(2026-08-17 운영자 오더).
 *
 * 종전에는 달마다 한 번씩 조회해 월 페이지를 그렸다. 운영자가 넘긴 질문은 "이 달"이 아니라
 * "다음에 무엇이 오는가"라, 경계를 달이 아니라 **데이터가 끝나는 곳**에 두고 한 번에 조회한다.
 *
 * 경계 규칙(패널 확정).
 *   · 왼쪽 = 이번 달 -1. 지난달 퇴실을 보며 다음 사람을 잡는 것이 이 화면의 일상 동선이다.
 *   · 오른쪽 = 마지막 변동이 있는 달. 단 바닥 +2 개월(끝이 오늘에 붙어 스크롤할 곳이 없는 상태 방지),
 *     천장 +6 개월(예약 하나가 반년 뒤에 있을 때 빈 트랙을 수천 px 끌지 않게).
 *   · 천장 밖에 남은 예정은 건수와 최초 날짜로만 말하고(beyond), 점프로 닿는다.
 *   · ?month= 가 범위 밖이면 그쪽으로 범위를 넓힌다 — 딥링크 착지와 '이전 달 더 보기'가
 *     이 한 규칙을 함께 쓴다(파라미터를 새로 만들지 않는다).
 *
 * 조회와 창 계산은 lib/moveCalendarData loadMoveRange 가 한다(2026-10-19). 'use server' 파일 안에
 * 두면 감지망이 같은 길을 못 지나 사본을 들게 된다. 순차 왕복은 둘이다(창과 무관한 것 / 창에 묶인 것).
 * '전체' 축은 모든 호실이 행이다. 방 목록은 그 함수가 읽어 작업 조회와 무변동 행이 함께 쓴다.
 */
export async function getMoveCalendarRange(focus?: string): Promise<MoveCalendarRange> {
  const { propertyId } = await getPropertyId()
  const today = kstYmdStr()
  const focusMonth = focus && /^\d{4}-\d{2}$/.test(focus) ? focus : today.slice(0, 7)
  return loadMoveRange(prisma, propertyId, { today, focusMonth })
}

/**
 * 캘린더 [겹침 확인] — 이 겹침은 의도된 것이라고 기록한다(겹침 판정 개정 2026-08-19).
 *
 * 판정·기록은 lib/overlapAck 정본이 한다. 화면이 보낸 날짜는 믿지 않는다 — 여기 오는 것은
 * 두 계약의 id 뿐이고, 구간은 서버가 지금 DB 를 다시 읽어 계산한다.
 */
export async function acknowledgeOverlap(frontLeaseTermId: string, backLeaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const res = await createOverlapAck({ propertyId, frontLeaseTermId, backLeaseTermId, ackedById: user.sub })
    if (!res.ok) return res
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '확인 처리 중 오류가 발생했습니다.' }
  }
}

/** 확인 해제 — 소프트삭제다. 되돌리면 그 겹침은 다시 답하지 않은 상태로 돌아간다. */
export async function releaseOverlapAck(ackId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const res = await softDeleteOverlapAck(ackId, propertyId)
    if (!res.ok) return res
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '해제 처리 중 오류가 발생했습니다.' }
  }
}

// 호실 추가
export async function addRoom(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const roomNo = formData.get('roomNo') as string
  const type = formData.get('type') as string
  const tier = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo = formData.get('memo') as string

  if (!roomNo?.trim()) return { ok: false, error: '호실 번호는 필수입니다.' }

  const existing = await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo: roomNo.trim() } },
  })
  if (existing) return { ok: false, error: `${withParticle(fmtRoomNo(roomNo, ''), '은/는')} 이미 존재합니다.` }

  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null

  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  const room = await prisma.room.create({
    data: {
      propertyId,
      roomNo:   roomNo.trim(),
      type:     type || null,
      tier:     tier || null,
      baseRent,
      memo:     memo || null,
      isVacant: true,
      floor,
      windowType: windowType || null,
      direction:  direction || null,
      areaPyeong,
      areaM2,
      nonResidentRent,
      nonResidentScheduled,
      nonResidentRentDate,
    },
  })

  revalidatePath('/room-manage')
  return { ok: true, id: room.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 수정
export async function updateRoom(formData: FormData): Promise<{ ok: true; sync?: RoomRentSyncSummary; undo?: RoomRentSyncUndo } | { ok: false; error: string }> {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const id      = formData.get('id') as string
  const roomNo  = formData.get('roomNo') as string
  const type    = formData.get('type') as string
  const tier    = formData.get('tier') as string
  const baseRent = Number(formData.get('baseRent')) || 0
  const memo    = formData.get('memo') as string
  const floor      = (formData.get('floor') as string)?.trim() || null
  const windowType = (formData.get('windowType') as string) || null
  const direction  = (formData.get('direction') as string) || null
  const areaPyeong = formData.get('areaPyeong') ? Number(formData.get('areaPyeong')) : null
  const areaM2     = formData.get('areaM2') ? Number(formData.get('areaM2')) : null
  // 방 특성 (2026-07-06) — 체크박스: 켜짐 '1', 꺼짐 미전송
  const noMoveInReport    = formData.get('noMoveInReport') === '1'
  const nonResidentVacant = formData.get('nonResidentVacant') !== '0'   // 기본 켜짐(공실로 표시)
  // 단독 계약 가능 여부(2026-08-13) — 반전 체크박스라 hidden 값이 '0' 일 때만 불가다. 기본 켜짐(가능).
  const standaloneLeaseAllowed = formData.get('standaloneLeaseAllowed') !== '0'
  // '비거주 계약만'(2026-10-27) — 단독 불가 방에서만 뜻이 있다. 가능으로 두면 늘 false 로 맞춘다(세 갈래가 두 칸, lib/roomAssignment).
  const nonResidentStandaloneAllowed = !standaloneLeaseAllowed && formData.get('nonResidentStandaloneAllowed') === '1'

  // 가격 예약 시스템 필드
  const scheduledRentRaw = formData.get('scheduledRent')
  const scheduledRent    = scheduledRentRaw ? (Number(scheduledRentRaw) || null) : null
  const rentUpdateDateRaw = formData.get('rentUpdateDate') as string
  const rentUpdateDate   = rentUpdateDateRaw ? new Date(rentUpdateDateRaw) : null

  // 예약 인상/인하: 적용일 없는 예약은 청구(effectiveBaseRent)도 적용 스케줄러도 동작 안 함(영구 방치).
  // → 예약 이용료와 적용 예정일은 반드시 함께 입력(둘 다 있거나 둘 다 없거나).
  if ((scheduledRent != null) !== (rentUpdateDate != null)) {
    return { ok: false, error: '예약 이용료와 적용 예정일은 함께 입력해야 합니다. (적용일이 없으면 인상·인하가 적용되지 않습니다)' }
  }

  // 비거주 이용료 필드
  const nrEnabled = formData.get('nonResidentEnabled') === '1'
  const nonResidentRent      = nrEnabled ? Number(formData.get('nonResidentRent') || 0) : null
  const nonResidentScheduled = nrEnabled && formData.get('nonResidentScheduled')
    ? (Number(formData.get('nonResidentScheduled')) || null)
    : null
  const nonResidentRentDateRaw = nrEnabled ? (formData.get('nonResidentRentDate') as string) : ''
  const nonResidentRentDate    = nonResidentRentDateRaw ? new Date(nonResidentRentDateRaw) : null

  // 비거주 축도 같은 규칙 — 금액만 있고 적용일이 없으면 청구에도 스케줄러에도 안 잡혀 고아 예약으로 남는다.
  if ((nonResidentScheduled != null) !== (nonResidentRentDate != null)) {
    return { ok: false, error: '비거주 예약 이용료와 적용 예정일은 함께 입력해야 합니다. (적용일이 없으면 인상·인하가 적용되지 않습니다)' }
  }

  // 화면에서 온 id 다. 영업장 범위로 읽고, 남의 영업장 방이면 있는지 없는지 말하지 않고 닫는다(2026-10-23 운영자 승인).
  // 이 확인이 없으면 남의 방 이용료가 바뀌고 그 방 계약의 임대료·선납 락까지 따라 바뀐다.
  const prevRoom = await prisma.room.findFirst({ where: { id, propertyId }, select: { roomNo: true, baseRent: true, nonResidentRent: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } })
  if (!prevRoom) return { ok: false, error: ROOM_GONE }

  // 확인창에서 고른 계약(축별 id)과 그때 본 계약의 updatedAt. 화면 값이라 모양만 거르고, 범위·조건은 정본(syncLeaseRentForRoom)이 본다.
  const picked = parseRentSyncPick(formData.get('rentSyncLeaseIds'), formData.get('rentSyncExpect'))
  if (!picked) return { ok: false, error: '계약 적용 정보가 올바르지 않습니다. 창을 닫고 다시 열어 주세요.' }

  // 방 저장과 계약 이용료 동기화는 한 트랜잭션이다(2026-10-27 운영자 승인, 홍은주 602호 사건). 종전에는 기본 이용료가 바뀌면 그 방 거주 계약을
  // 협의가까지 확인 없이 전부 덮었고 비거주 이용료는 계약을 안 따라갔다. 이제 두 축 모두 옛 기준가 그대로인 계약만 따라가고(followers),
  // 기준가와 다른 계약은 운영자가 확인창에서 고른 것만 옮긴다(leaseIds). 고른 계약이 그사이 바뀌었으면 방 저장까지 함께 되감는다(STALE).
  let synced: { resident: RentSyncApplied[]; nonResident: RentSyncApplied[] }
  const syncAt = new Date()   // 적용취소가 '그 뒤 새 수납 기록' 을 가려낼 기준 시각
  try {
    synced = await prisma.$transaction(async tx => {
      await tx.room.update({
        where: { id, propertyId },
        data: {
          roomNo:    roomNo.trim(),
          type:      type || null,
          tier:      tier || null,
          baseRent,
          memo:      memo || null,
          floor,
          windowType: windowType || null,
          direction:  direction || null,
          noMoveInReport,
          nonResidentVacant,
          standaloneLeaseAllowed,
          nonResidentStandaloneAllowed,
          areaPyeong,
          areaM2,
          scheduledRent,
          rentUpdateDate,
          nonResidentRent,
          nonResidentScheduled,
          nonResidentRentDate,
        },
      })
      const out: { resident: RentSyncApplied[]; nonResident: RentSyncApplied[] } = { resident: [], nonResident: [] }
      const axes: [RentAxis, number | null, number | null][] = [
        ['resident', prevRoom.baseRent, baseRent],
        ['nonResident', prevRoom.nonResidentRent, nonResidentRent],
      ]
      for (const [axis, prevRent, nextRent] of axes) {
        if (nextRent == null) continue   // 비거주 이용료를 끄면 계약은 그대로 둔다(따라갈 기준가가 없다).
        if (prevRent !== nextRent) {
          out[axis].push(...(await syncLeaseRentForRoom(tx, { propertyId, roomId: id, axis, prevRent, nextRent, excludeShortTerm: true })).applied)
        }
        const ids = picked.leaseIds[axis]
        if (ids.length > 0) {
          out[axis].push(...(await syncLeaseRentForRoom(tx, { propertyId, roomId: id, axis, prevRent, nextRent, leaseIds: ids, expect: picked.expect })).applied)
        }
      }
      return out
    })
  } catch (err) {
    if (err instanceof RoomRentSyncStale) return { ok: false, error: ROOM_RENT_SYNC_STALE }
    throw err
  }

  // 인상 예약 변경 → 락인 되쓰기. 없으면 이미 선납된 달의 락이 인상을 이겨 인상분이 영원히 미청구로 남는다
  // (할인에는 같은 장치가 이미 있다 — rewriteLockedExpectedForDiscountChange, 신고 70cde9d6).
  // 비거주 예약도 같은 축이다 — 한쪽만 걸면 비거주 선납 락에 인상분이 영원히 안 붙는다.
  if (prevRoom && (prevRoom.scheduledRent !== scheduledRent
      || (prevRoom.rentUpdateDate?.getTime() ?? null) !== (rentUpdateDate?.getTime() ?? null)
      || prevRoom.nonResidentScheduled !== nonResidentScheduled
      || (prevRoom.nonResidentRentDate?.getTime() ?? null) !== (nonResidentRentDate?.getTime() ?? null))) {
    const { rewriteLockedExpectedForRentSchedule } = await import('@/app/(app)/rooms/paymentEngine')
    await rewriteLockedExpectedForRentSchedule(
      id,
      { scheduledRent: prevRoom.scheduledRent, rentUpdateDate: prevRoom.rentUpdateDate, nonResidentScheduled: prevRoom.nonResidentScheduled, nonResidentRentDate: prevRoom.nonResidentRentDate },
      { scheduledRent, rentUpdateDate, nonResidentScheduled, nonResidentRentDate },
    )
  }

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')
  const applied = [...synced.resident, ...synced.nonResident]
  if (applied.length === 0) return { ok: true }
  // 토스트 문장(이름·전후 금액)과 적용취소 토큰. 서명 키가 없는 운영이면 토큰을 내지 않는다(화면이 [적용취소] 를 숨긴다).
  const names = await leaseNames(propertyId, applied.map(a => a.id))
  const sync: RoomRentSyncSummary = {
    roomNo: roomNo.trim(),
    resident: synced.resident.length ? { next: baseRent, leases: synced.resident.map(a => ({ name: names.get(a.id) ?? '', from: a.from, to: a.to })) } : undefined,
    nonResident: synced.nonResident.length && nonResidentRent != null ? { next: nonResidentRent, leases: synced.nonResident.map(a => ({ name: names.get(a.id) ?? '', from: a.from, to: a.to })) } : undefined,
  }
  const undo = signRoomRentSync(propertyId, {
    roomId: id,
    at: syncAt.toISOString(),
    room: { before: { baseRent: prevRoom.baseRent, nonResidentRent: prevRoom.nonResidentRent }, after: { baseRent, nonResidentRent } },
    leases: applied.map(a => ({ id: a.id, before: a.from, after: a.to })),
  })
  return { ok: true, sync, ...(undo ? { undo } : {}) }
}

// ── 방 이용료 저장의 계약 동기화(2026-10-27 운영자 승인, 홍은주 602호 사건) ─────────────────────────────
// 정본은 lib/roomRentSync syncLeaseRentForRoom. 화면은 저장 전에 previewRoomRentSync 로 '기준가와 다른 계약' 을 받아
// 있으면 choiceDialog 로 묻고, 고른 계약 id 를 updateRoom 에 실어 보낸다. 적용취소는 undoRoomRentSync(서명 토큰).

/** 토스트가 쓰는 결과. 축마다 새 기준가와 옮긴 계약(이름·전후 금액). */
export type RoomRentSyncSummary = {
  roomNo: string
  resident?: { next: number; leases: { name: string; from: number; to: number }[] }
  nonResident?: { next: number; leases: { name: string; from: number; to: number }[] }
}
/** 저장 전 미리보기. followers 는 저절로 따라갈 계약, differing 은 기준가와 달라 물어야 할 계약(단기 제외). */
export type RoomRentAxisPreview = {
  prevRent: number | null
  nextRent: number
  followers: { id: string; name: string; rentAmount: number }[]
  differing: { id: string; name: string; rentAmount: number; updatedAt: string; unrecordedPastMonths: number }[]
}

function parseRentSyncPick(rawIds: FormDataEntryValue | null, rawExpect: FormDataEntryValue | null):
  { leaseIds: Record<RentAxis, string[]>; expect: Record<string, string> } | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const empty = { leaseIds: { resident: [], nonResident: [] }, expect: {} }
  if (rawIds == null || rawIds === '') return empty
  try {
    const ids = JSON.parse(String(rawIds)) as Record<string, unknown>
    const exp = rawExpect ? JSON.parse(String(rawExpect)) as Record<string, unknown> : {}
    const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) && v.every(x => typeof x === 'string' && UUID.test(x)) ? v as string[] : null)
    const resident = list(ids.resident), nonResident = list(ids.nonResident)
    if (!resident || !nonResident || !exp || typeof exp !== 'object' || Array.isArray(exp)) return null
    const expect: Record<string, string> = {}
    for (const [k, v] of Object.entries(exp)) {
      if (!UUID.test(k) || typeof v !== 'string' || Number.isNaN(new Date(v).getTime())) return null
      expect[k] = v
    }
    return { leaseIds: { resident, nonResident }, expect }
  } catch { return null }
}

async function leaseNames(propertyId: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.leaseTerm.findMany({
    where: { id: { in: ids }, propertyId },
    select: { id: true, tenant: { select: { name: true, englishName: true, nickname: true, displayNameStyle: true } } },
  })
  return new Map(rows.map(r => [r.id, r.tenant ? displayName(r.tenant, r.tenant.displayNameStyle) : '']))
}

function signRoomRentSync(propertyId: string, u: Omit<RoomRentSyncUndo, 'sig' | 'v'>): RoomRentSyncUndo | null {
  const body: Omit<RoomRentSyncUndo, 'sig'> = { v: 1, ...u }
  const sig = signUndoBody(ROOM_RENT_SYNC_UNDO_DOMAIN, propertyId, canonicalRoomRentSyncUndo(body))
  if (sig === null) return null
  return { ...body, ...(sig ? { sig } : {}) }
}

/**
 * 저장 전 미리보기(읽기). 값을 안 넘긴 축은 지금 방 값을 기준으로 본다(호실 수정 폼의 '계약 N건이 이 금액과 다릅니다' 줄).
 * 비거주 이용료가 없거나 끈 방(null)은 비거주 축을 보지 않는다.
 */
export async function previewRoomRentSync(roomId: string, next: { baseRent?: number; nonResidentRent?: number | null }): Promise<
  { ok: true; roomNo: string; resident: RoomRentAxisPreview; nonResident: RoomRentAxisPreview | null } | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const { propertyId, role } = await getPropertyId()
    if (!canReadScope(role, 'money')) return { ok: false, error: '이용료를 볼 권한이 없습니다.' }
    const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { roomNo: true, baseRent: true, nonResidentRent: true } })
    if (!room) return { ok: false, error: ROOM_GONE }
    const leases = await prisma.leaseTerm.findMany({
      where: { roomId, propertyId, status: { in: [...RENT_AXIS_STATUSES.resident, ...RENT_AXIS_STATUSES.nonResident] } },
      select: { id: true, status: true, rentAmount: true, isShortTerm: true, updatedAt: true, moveInDate: true, tenant: { select: { name: true, englishName: true, nickname: true, displayNameStyle: true } } },
      orderBy: { moveInDate: 'asc' },
    })
    // 기록이 없는 지난 달은 락이 없어 새 금액으로 계산된다(미납 등). 확인창이 그 수를 미리 말한다(독립 검수 권고 4).
    // 첫 달은 입주월과 인수 기준월 중 늦은 쪽(대시보드 미납과 같은 기준, app/(app)/dashboard/unpaid.ts).
    const prop = await prisma.property.findUnique({ where: { id: propertyId }, select: { prevOwnerCutoffDate: true, acquisitionDate: true } })
    const cutoff = prop?.prevOwnerCutoffDate ?? prop?.acquisitionDate ?? null
    const cutoffMonth = cutoff ? kstMonthKey(cutoff) : null
    const recs = await prisma.paymentRecord.findMany({ where: { propertyId, leaseTermId: { in: leases.map(l => l.id) }, isDeposit: false }, select: { leaseTermId: true, targetMonth: true } })
    const recorded = new Map<string, Set<string>>()
    for (const r of recs) { if (!recorded.has(r.leaseTermId)) recorded.set(r.leaseTermId, new Set()); recorded.get(r.leaseTermId)!.add(r.targetMonth) }
    const curMonth = kstMonthStr()
    const pastUnrecorded = (l: typeof leases[number]) => {
      if (!l.moveInDate) return 0
      const mi = kstMonthKey(l.moveInDate)
      return unrecordedPastMonths(cutoffMonth && cutoffMonth > mi ? cutoffMonth : mi, curMonth, recorded.get(l.id) ?? new Set())
    }
    const axis = (a: RentAxis, prevRent: number | null, nextRent: number): RoomRentAxisPreview => {
      const mine = leases.filter(l => (RENT_AXIS_STATUSES[a] as string[]).includes(l.status))
      const name = (l: typeof leases[number]) => (l.tenant ? displayName(l.tenant, l.tenant.displayNameStyle) : '')
      const isFollower = (l: typeof leases[number]) => prevRent != null && l.rentAmount === prevRent
      // 칸을 비운 저장(0원 이하)은 계약을 건드리지 않는다(정본과 같은 규칙, 독립 검수 B1).
      if (nextRent <= 0) return { prevRent, nextRent, followers: [], differing: [] }
      return {
        prevRent, nextRent,
        followers: prevRent !== nextRent ? mine.filter(l => isFollower(l) && !l.isShortTerm).map(l => ({ id: l.id, name: name(l), rentAmount: l.rentAmount })) : [],
        differing: mine.filter(l => !isFollower(l) && !l.isShortTerm && l.rentAmount !== nextRent)
          .map(l => ({ id: l.id, name: name(l), rentAmount: l.rentAmount, updatedAt: l.updatedAt.toISOString(), unrecordedPastMonths: pastUnrecorded(l) })),
      }
    }
    const nextNR = next.nonResidentRent !== undefined ? next.nonResidentRent : room.nonResidentRent
    return {
      ok: true,
      roomNo: room.roomNo,
      resident: axis('resident', room.baseRent, next.baseRent ?? room.baseRent),
      nonResident: nextNR == null ? null : axis('nonResident', room.nonResidentRent, nextNR),
    }
  } catch (err) {
    if ((err as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

/** 방 이용료 저장의 계약 동기화 적용취소. 방 값과 계약 금액이 쓴 직후 그대로일 때만 전부 되돌린다. */
export async function undoRoomRentSync(raw: unknown): Promise<{ ok: true; leases: { from: number; to: number }[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const u = parseRoomRentSyncUndo(raw)
    if (!u || !verifyUndoBody(ROOM_RENT_SYNC_UNDO_DOMAIN, propertyId, canonicalRoomRentSyncUndo(u), u.sig)) {
      return { ok: false, error: ROOM_RENT_SYNC_UNDO_INVALID }
    }
    await prisma.$transaction(async tx => {
      const room = await tx.room.findFirst({ where: { id: u.roomId, propertyId }, select: { baseRent: true, nonResidentRent: true } })
      if (!room) throw new RoomRentUndoConflict(ROOM_RENT_SYNC_UNDO_INVALID)
      if (room.baseRent !== u.room.after.baseRent || room.nonResidentRent !== u.room.after.nonResidentRent) throw new RoomRentUndoConflict()
      const r = await tx.room.updateMany({
        where: { id: u.roomId, propertyId, baseRent: u.room.after.baseRent, nonResidentRent: u.room.after.nonResidentRent },
        data: { baseRent: u.room.before.baseRent, nonResidentRent: u.room.before.nonResidentRent },
      })
      if (r.count !== 1) throw new RoomRentUndoConflict()
      // 적용한 뒤 그 계약에 수납 기록(락)이 새로 생겼으면 새 금액으로 이미 청구가 잠긴 것이라 되돌리지 않는다(독립 검수 권고 3).
      const billed = await tx.paymentRecord.count({ where: { propertyId, leaseTermId: { in: u.leases.map(l => l.id) }, isDeposit: false, createdAt: { gt: new Date(u.at) } } })
      if (billed > 0) throw new RoomRentUndoConflict(ROOM_RENT_SYNC_UNDO_BILLED)
      for (const l of u.leases) {
        // 토큰의 계약 id 는 화면이 들고 온 값이다. 이 영업장 그 방 계약이 쓴 직후 금액 그대로일 때만 되돌린다.
        const w = await tx.leaseTerm.updateMany({ where: { id: l.id, propertyId, roomId: u.roomId, rentAmount: l.after }, data: { rentAmount: l.before } })
        if (w.count !== 1) throw new RoomRentUndoConflict()
      }
    })
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true, leases: u.leases.map(l => ({ from: l.after, to: l.before })) }
  } catch (err) {
    if ((err as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (err instanceof RoomRentUndoConflict) return { ok: false, error: err.message }
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

class RoomRentUndoConflict extends Error {
  constructor(message = ROOM_RENT_SYNC_UNDO_CONFLICT) { super(message); this.name = 'RoomRentUndoConflict' }
}

// 호실 삭제 — 과거 계약·수납(매출) 기록까지 연쇄 영구 삭제되므로,
// 이력이 있으면 1차 호출은 건수를 알려주며 거부하고 force 재호출에서만 실제 삭제(정보 동의 단계).
export async function deleteRoom(id: string, opts?: { force?: boolean }): Promise<
  { ok: true } | { ok: false; error: string; needsForce?: boolean; leases?: number; payments?: number }
> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()
  // 화면에서 온 id 다. 영업장 범위로 먼저 확인한다(2026-10-23 운영자 승인). 이 확인이 없으면 남의 방과 그 방의
  // 과거 계약·수납 기록까지 연쇄로 지워지고, 건수 안내로 남의 영업장 기록이 있는지도 새어 나간다.
  const owned = await prisma.room.findFirst({ where: { id, propertyId }, select: { id: true } })
  if (!owned) return { ok: false, error: ROOM_GONE }

  const activeLeases = await prisma.leaseTerm.count({
    where: {
      roomId: id,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
    },
  })
  if (activeLeases > 0) return { ok: false, error: '거주중인 입주자가 있어 삭제할 수 없습니다.' }

  // 과거 이력 확인 — 복구 불가 삭제임을 건수와 함께 동의받는다
  const pastLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))
  if (pastLeaseIds.length > 0 && !opts?.force) {
    const payments = await prisma.paymentRecord.count({ where: { leaseTermId: { in: pastLeaseIds } } })
    return {
      ok: false, needsForce: true, leases: pastLeaseIds.length, payments,
      error: `과거 계약 ${pastLeaseIds.length}건·수납 기록 ${payments}건이 함께 영구 삭제됩니다.`,
    }
  }

  // Drive 파일 정리
  const photos = await prisma.roomPhoto.findMany({ where: { roomId: id }, select: { driveFileId: true } })
  await Promise.allSettled(
    photos.filter(p => p.driveFileId).map(p => deleteFromDrive(p.driveFileId!))
  )

  // 과거 계약 기록 정리 (LeaseTerm → Room FK에 cascade 없어서 수동 처리)
  // 삭제 순서: TenantStatusLog → LeaseTerm (PaymentRecord는 LeaseTerm cascade로 자동 삭제)
  const oldLeaseIds = await prisma.leaseTerm
    .findMany({ where: { roomId: id }, select: { id: true } })
    .then(ls => ls.map(l => l.id))

  if (oldLeaseIds.length > 0) {
    await prisma.tenantStatusLog.deleteMany({ where: { leaseTermId: { in: oldLeaseIds } } })
    await prisma.leaseTerm.deleteMany({ where: { id: { in: oldLeaseIds } } })
  }

  await prisma.room.delete({ where: { id, propertyId } })
  revalidatePath('/room-manage')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 사진 업로드 — 클라이언트 직접 업로드 방식 (Vercel 페이로드 한도 우회)
// 흐름: createPhotoUploadSession → 클라이언트가 Drive에 직접 PUT → finalizeRoomPhoto

const MAX_PHOTO_BYTES = 50 * 1024 * 1024 // 50MB

export async function createPhotoUploadSession(input: {
  roomId: string
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.roomId) return { ok: false, error: '호실 정보가 없습니다.' }
    // 영업장 스코프 — 없으면 타 영업장 roomId로 업로드 가능(격리가 UUID 비밀성에 의존, 신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_PHOTO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }

    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `room_${input.roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[createPhotoUploadSession] failed:', err)
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeRoomPhoto(input: {
  roomId: string
  driveFileId: string
  fileName: string
}): Promise<{ ok: true; id: string; driveFileId: string; storageUrl: string; fileName: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    // 영업장 스코프 — 타 영업장 호실에 사진 행 삽입 차단(신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }

    // 링크 있는 사람 누구나 열람 가능하도록 권한 설정
    await setDrivePublicReadable(input.driveFileId)

    const lastPhoto = await prisma.roomPhoto.findFirst({
      where: { roomId: input.roomId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const photo = await prisma.roomPhoto.create({
      data: {
        roomId: input.roomId,
        storageUrl: buildDriveThumbnailUrl(input.driveFileId, 400),
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        sortOrder: (lastPhoto?.sortOrder ?? 0) + 1,
        // 파일명으로 360 판정을 값으로 굳힌다 — 하드코딩 360 부채 재발 방지(공개 API 가 매번 재파싱 안 하게)
        is360: looksLike360(input.fileName),
      },
    })

    revalidatePath('/room-manage')
    return {
      ok: true,
      id: photo.id,
      driveFileId: photo.driveFileId!,
      storageUrl: photo.storageUrl,
      fileName: photo.fileName ?? input.fileName,
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[finalizeRoomPhoto] failed:', err)
    // DB 저장 실패 시 Drive 파일은 정리 (orphan 방지)
    if (input.driveFileId) {
      try { await deleteFromDrive(input.driveFileId) } catch { /* 정리 실패는 무시 */ }
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

// 호실 사진 삭제 (Google Drive)
export async function deleteRoomPhoto(photoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()

    // 영업장 스코프 — 타 영업장 사진 id로 삭제 차단(신고 8dba0177 패널 검증)
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }

    if (photo.driveFileId) {
      await deleteFromDrive(photo.driveFileId)
    }

    await prisma.roomPhoto.delete({ where: { id: photoId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 공개 소개 페이지 갤러리에 이 방 사진을 노출할지 토글 — 켤 땐 사진이 최소 1장 있어야 한다.
// 공실 여부와 독립(운영자가 직접 켠다). 되돌리기는 반대 값으로 다시 호출.
export async function setRoomShowOnSite(roomId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, _count: { select: { photos: true } } },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (show && room._count.photos === 0) return { ok: false, error: '등록된 사진이 없어요. 사진을 먼저 올린 뒤 공개할 수 있습니다.' }
    await prisma.room.update({ where: { id: roomId, propertyId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    revalidatePath('/dashboard')
    revalidatePath('/settings')   // 웹사이트 탭의 '소개 페이지 반영 대기' 목록이 이 값으로 서 있다
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 사진 단위 공개 토글 — 방 공개가 켜졌을 때 이 사진을 소개 페이지에 노출할지. 대표(카드 썸네일·공개 첫 장)는
// 별도 필드 없이 '공개·비360 첫 장'으로 계산되므로 이 토글 하나로 대표 자동 승격까지 처리된다.
export async function setRoomPhotoShowOnSite(photoId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.roomPhoto.update({ where: { id: photoId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 소개 페이지 대표 썸네일 재배포 요청 — 사진을 여러 개 바꾼 뒤 편집 모달을 닫을 때 한 번 호출(변경 묶어 1회).
// Vercel 은 런타임에 정적 HTML 을 못 고쳐, 재배포 빌드에서 대표 썸네일이 최신화된다. 훅 미설정이면 무동작.
export async function requestGalleryRedeploy(): Promise<{ ok: true }> {
  try { await requireEdit(); await triggerRedeploy() } catch { /* 트리거 실패는 무시(다음 배포 때 반영) */ }
  return { ok: true }
}

// 사진의 360 지정 토글 — 파일명 자동판정이 놓친 360 파노라마를 운영자가 직접 표시. 저장하면 공개 웹(평면
// 목록에서 빠지고 360 버튼)·호실관리 뷰어·카드 대표 계산(360 제외)에 모두 반영된다.
export async function setRoomPhotoIs360(photoId: string, is360: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.roomPhoto.findFirst({ where: { id: photoId, room: { propertyId } }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.roomPhoto.update({ where: { id: photoId }, data: { is360 } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 사진 순서 저장 (오류신고 8dba0177) — 편집 UI가 최종 배열(photoIds, 표시 순서대로)을 넘기면 인덱스대로 sortOrder 재기록.
// 대표 이미지 = 첫 장(photos[0]) 규칙이라 '대표로 설정'도 이 액션(맨 앞 이동 배열)으로 처리된다.
// 부분 배열은 미포함 사진과의 상대 순서가 흔들리므로 전체 집합 일치일 때만 저장(reorderAssetItems와 동일 문법).
export async function reorderRoomPhotos(roomId: string, photoIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (photoIds.length === 0) return { ok: false, error: '정렬할 사진이 없습니다.' }
    if (new Set(photoIds).size !== photoIds.length) return { ok: false, error: '중복된 사진이 있습니다.' }
    const rows = await prisma.roomPhoto.findMany({ where: { roomId }, select: { id: true } })
    const current = new Set(rows.map(r => r.id))
    if (current.size !== photoIds.length || !photoIds.every(id => current.has(id)))
      return { ok: false, error: '사진 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.' }
    await prisma.$transaction(photoIds.map((id, i) =>
      prisma.roomPhoto.update({ where: { id }, data: { sortOrder: i } })
    ))
    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── [Trigger B] 예약된 가격 일괄 적용 ────────────────────────────────
// 규칙 본문은 lib/scheduledRent applyScheduledRentsFor 정본이다. 여기는 접근 검사를 거쳐
// 자기 영업장 id 를 넘기는 서버 액션 껍데기고, 크론(/api/cron/apply-rents)은 CRON_SECRET 을
// 거쳐 전 영업장에 대해 **같은 함수**를 부른다 — 두 경로가 갈릴 자리를 안 만든다.
// 호실 관리 페이지는 로드 시 await, 홈·고객 관리는 응답 후 after() 로 부른다.
export async function applyScheduledRents() {
  const { propertyId } = await getPropertyId()
  return applyScheduledRentsFor(propertyId)
}

// ── 단일 호실 즉시 적용 ──────────────────────────────────────────────
// 공실 상태에서 예정 가격을 즉시 baseRent에 반영. 활성 계약이 있으면 rentAmount도 동기화.
export type ScheduledRentUndo = {
  roomId: string; prevBaseRent: number; prevScheduledRent: number; prevRentUpdateDate: string | null
  leases: { id: string; prevRentAmount: number }[]
}

export async function applyScheduledRentNow(roomId: string): Promise<{ ok: true; newRent: number; undo: ScheduledRentUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const room = await prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { baseRent: true, scheduledRent: true, rentUpdateDate: true },
    })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    if (room.scheduledRent == null) return { ok: false, error: '예정 가격이 설정되어 있지 않습니다.' }

    const newRent = room.scheduledRent
    // 되돌리기 스냅샷 — 적용 전 월세·예약 필드·활성 계약별 rentAmount (감사 2026-07-10)
    const leases = await prisma.leaseTerm.findMany({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { id: true, rentAmount: true },
    })
    const undo: ScheduledRentUndo = {
      roomId, prevBaseRent: room.baseRent, prevScheduledRent: newRent,
      prevRentUpdateDate: room.rentUpdateDate ? room.rentUpdateDate.toISOString() : null,
      leases: leases.map(l => ({ id: l.id, prevRentAmount: l.rentAmount })),
    }

    await prisma.room.update({
      where: { id: roomId, propertyId },
      data: {
        baseRent:       newRent,
        scheduledRent:  null,
        rentUpdateDate: null,
      },
    })

    // 예약가 즉시 적용은 협의가 포함 전 계약이다(2026-06-29 운영자 결정, 정본의 'all' 갈래로 옮겼고 동작은 같다).
    await syncLeaseRentForRoom(prisma, { propertyId, roomId, axis: 'resident', prevRent: room.baseRent, nextRent: newRent, all: true })

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, newRent, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 예정 가격 즉시 적용 적용취소 — 월세·예약 필드·계약별 금액을 스냅샷으로 복원
export async function undoApplyScheduledRent(u: ScheduledRentUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const room = await prisma.room.findFirst({ where: { id: u.roomId, propertyId }, select: { id: true } })
    if (!room) return { ok: false, error: '호실을 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.room.update({ where: { id: u.roomId, propertyId }, data: {
        baseRent: u.prevBaseRent, scheduledRent: u.prevScheduledRent,
        rentUpdateDate: u.prevRentUpdateDate ? new Date(u.prevRentUpdateDate) : null,
      } }),
      // 토큰의 계약 id 는 화면이 들고 온 값이다. 이 영업장 계약만 되돌린다(남의 계약 임대료를 덮지 않게, 2026-10-23 운영자 승인).
      ...u.leases.map(l => prisma.leaseTerm.updateMany({ where: { id: l.id, propertyId }, data: { rentAmount: l.prevRentAmount } })),
    ])
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 일괄 편집
export async function batchUpdateRooms(
  roomIds: string[],
  data: {
    type?: string | null
    tier?: string | null
    baseRent?: number
    scheduledRent?: number | null
    rentUpdateDate?: Date | string | null
    windowType?: string | null
    direction?: string | null
  },
): Promise<{ ok: true; count: number; skippedNegotiated?: number; undo: BatchRoomsUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (roomIds.length === 0) return { ok: false, error: '선택된 호실이 없습니다.' }
    // 화면 객체는 허용 칸만 골라 쓴다(위 BATCH_ROOM_FIELDS). 아래 쓰기·스냅샷은 전부 거른 값(roomFields)으로 한다.
    const roomFields = pickBatchRoomFields(data)
    if (!roomFields) return { ok: false, error: BATCH_ROOM_INPUT_INVALID }
    if (Object.keys(roomFields).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }

    // 예약 이용료는 적용 예정일과 함께여야 함(적용일 없으면 인상·인하가 적용 안 됨). 예약 삭제 시 적용일도 함께 제거.
    if (roomFields.scheduledRent != null && roomFields.rentUpdateDate == null) {
      return { ok: false, error: '예약 이용료를 설정하려면 적용 예정일도 함께 지정해야 합니다.' }
    }
    if (roomFields.scheduledRent === null) roomFields.rentUpdateDate = null

    // baseRent 동기화 판정용 — 변경 전 기준가 확보 (updateMany 가 덮어쓰기 전에)
    const prevRents = roomFields.baseRent != null
      ? await prisma.room.findMany({ where: { id: { in: roomIds }, propertyId }, select: { id: true, baseRent: true } })
      : []

    // 되돌리기 스냅샷 — 바뀔 필드들의 원값(감사 백로그 2026-07-10)
    const keys = Object.keys(roomFields)
    const beforeRooms = await prisma.room.findMany({
      where: { id: { in: roomIds }, propertyId },
      select: { id: true, type: true, tier: true, baseRent: true, scheduledRent: true, rentUpdateDate: true, windowType: true, direction: true, nonResidentScheduled: true, nonResidentRentDate: true },
    })
    // 계약 스냅샷도 이 영업장 것만 뜬다. 화면 id 에 남의 방이 섞여도 그 방 계약이 적용취소 토큰에 실리지 않는다.
    const beforeLeases = roomFields.baseRent != null
      ? await prisma.leaseTerm.findMany({
          where: { roomId: { in: roomIds }, propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          select: { id: true, rentAmount: true },
        })
      : []
    const undo: BatchRoomsUndo = {
      rooms: beforeRooms.map(b => ({ id: b.id, fields: Object.fromEntries(keys.map(k => {
        const v = (b as Record<string, unknown>)[k]
        return [k, v instanceof Date ? v.toISOString() : (v ?? null)]
      })) })),
      leases: beforeLeases.map(l => ({ id: l.id, rentAmount: l.rentAmount })),
    }

    const r = await prisma.room.updateMany({
      where: { id: { in: roomIds }, propertyId },
      data: roomFields,
    })

    // baseRent 변경 시 활성 계약의 rentAmount 동기화 — 단, 계약별 협의 임대료
    // (방 기준가와 다르게 설정된 rentAmount)는 덮어쓰지 않는다. 일괄 변경이
    // 개별 협의가를 흔적 없이 지우던 문제 방지.
    // 기준가 그대로 쓰던 계약만 따라간다(정본 followers 갈래, 호실 수정과 같은 함수).
    let skippedNegotiated = 0
    if (roomFields.baseRent != null) {
      for (const room of prevRents) {
        const res = await syncLeaseRentForRoom(prisma, { propertyId, roomId: room.id, axis: 'resident', prevRent: room.baseRent, nextRent: roomFields.baseRent })
        skippedNegotiated += res.skipped.length
      }
    }

    // 인상 예약 일괄 변경 → 락인 되쓰기 (단건 경로와 동일 규칙). 한쪽만 걸면 다른 경로로 빠져나간다.
    if ('scheduledRent' in roomFields || 'rentUpdateDate' in roomFields) {
      const { rewriteLockedExpectedForRentSchedule } = await import('@/app/(app)/rooms/paymentEngine')
      const nextSched = 'scheduledRent' in roomFields ? (roomFields.scheduledRent ?? null) : undefined
      const nextDate = 'rentUpdateDate' in roomFields ? (roomFields.rentUpdateDate ?? null) : undefined
      for (const b of beforeRooms) {
        const after = {
          scheduledRent: nextSched !== undefined ? nextSched : b.scheduledRent,
          rentUpdateDate: nextDate !== undefined ? nextDate : b.rentUpdateDate,
        }
        if (b.scheduledRent === after.scheduledRent
            && (b.rentUpdateDate?.getTime() ?? null) === (after.rentUpdateDate?.getTime() ?? null)) continue
        // 비거주 축은 일괄 수정 대상이 아니라 전후 동일하게 넘긴다(비거주 계약은 before === after 로 자동 skip).
        await rewriteLockedExpectedForRentSchedule(
          b.id,
          { scheduledRent: b.scheduledRent, rentUpdateDate: b.rentUpdateDate, nonResidentScheduled: b.nonResidentScheduled, nonResidentRentDate: b.nonResidentRentDate },
          { ...after, nonResidentScheduled: b.nonResidentScheduled, nonResidentRentDate: b.nonResidentRentDate },
        )
      }
    }

    revalidatePath('/room-manage')
    revalidatePath('/rooms')
    revalidatePath('/tenants')
    return { ok: true, count: r.count, skippedNegotiated, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 호실 일괄 수정 적용취소 — 방 필드·동기화된 계약 임대료를 스냅샷으로 복원(v2.0 §16)
export type BatchRoomsUndo = {
  rooms: { id: string; fields: Record<string, unknown> }[]
  leases: { id: string; rentAmount: number }[]
}

export async function undoBatchUpdateRooms(u: BatchRoomsUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    // 토큰은 화면이 들고 온 값이다. 방 칸은 일괄 편집 허용 칸만 골라 되돌리고, 계약은 이 영업장 것만 되돌린다(2026-10-23 운영자 승인).
    const restore: { id: string; roomFields: BatchRoomFields }[] = []
    for (const x of u.rooms) {
      const roomFields = pickBatchRoomFields(x.fields)
      if (!roomFields) return { ok: false, error: BATCH_ROOM_INPUT_INVALID }
      restore.push({ id: x.id, roomFields })
    }
    await prisma.$transaction([
      ...restore.map(x => prisma.room.updateMany({ where: { id: x.id, propertyId }, data: x.roomFields })),
      ...u.leases.map(l => prisma.leaseTerm.updateMany({ where: { id: l.id, propertyId }, data: { rentAmount: l.rentAmount } })),
    ])
    revalidatePath('/room-manage'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// ============================================================
// 공용·외관 사진 (PropertyPhoto) — 방이 아닌 영업장에 묶인 소개 페이지 사진. 방 사진 액션과 평행 구조.
// ============================================================

// 기본 카테고리 세트 — 카테고리가 하나도 없을 때 자동 생성(멀티테넌트 lazy seed). 이후 운영자가 추가·이름변경·순서·삭제.
const DEFAULT_PHOTO_CATEGORIES = ['외관', '현관/로비', '복도', '주방/세탁', '샤워/화장실']

// 카테고리 + 사진 조회. 없으면 기본 세트를 만든 뒤 반환.
export async function getPropertyPhotoData() {
  await requireEdit()
  const { propertyId } = await getPropertyId()
  const query = () => prisma.propertyPhotoCategory.findMany({
    where: { propertyId },
    orderBy: { sortOrder: 'asc' },
    include: { photos: { orderBy: { sortOrder: 'asc' } } },
  })
  let categories = await query()
  if (categories.length === 0) {
    await prisma.propertyPhotoCategory.createMany({
      data: DEFAULT_PHOTO_CATEGORIES.map((name, i) => ({ name, sortOrder: i, propertyId })),
    })
    categories = await query()
  }
  return categories
}

export async function createPhotoCategory(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '카테고리 이름을 입력하세요.' }
    const last = await prisma.propertyPhotoCategory.findFirst({ where: { propertyId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const cat = await prisma.propertyPhotoCategory.create({ data: { name: trimmed, sortOrder: (last?.sortOrder ?? -1) + 1, propertyId } })
    revalidatePath('/room-manage')
    return { ok: true, id: cat.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function renamePhotoCategory(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, error: '카테고리 이름을 입력하세요.' }
    const r = await prisma.propertyPhotoCategory.updateMany({ where: { id, propertyId }, data: { name: trimmed } })
    if (r.count === 0) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function reorderPhotoCategories(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const rows = await prisma.propertyPhotoCategory.findMany({ where: { propertyId }, select: { id: true } })
    const own = new Set(rows.map(r => r.id))
    if (ids.length !== rows.length || !ids.every(id => own.has(id))) return { ok: false, error: '카테고리 목록이 일치하지 않습니다.' }
    await prisma.$transaction(ids.map((id, i) => prisma.propertyPhotoCategory.update({ where: { id }, data: { sortOrder: i } })))
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 카테고리 삭제 — 속한 사진의 Drive 파일을 정리한 뒤 삭제(사진 행은 FK CASCADE). 사진이 있으면 클라에서 확인받는다.
export async function deletePhotoCategory(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id, propertyId }, select: { id: true, photos: { select: { driveFileId: true } } } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    await Promise.allSettled(cat.photos.filter(p => p.driveFileId).map(p => deleteFromDrive(p.driveFileId!)))
    await prisma.propertyPhotoCategory.delete({ where: { id } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function createPropertyPhotoUploadSession(input: {
  categoryId: string; fileName: string; mimeType: string; fileSize: number; origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: input.categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_PHOTO_BYTES) return { ok: false, error: `파일 크기는 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `prop_${input.categoryId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const uploadUrl = await createDriveResumableSession({ fileName: uniqueName, mimeType: input.mimeType, fileSize: input.fileSize, origin: input.origin })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[createPropertyPhotoUploadSession] failed:', err)
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizePropertyPhoto(input: {
  categoryId: string; driveFileId: string; fileName: string
}): Promise<{ ok: true; id: string; driveFileId: string; storageUrl: string; fileName: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.driveFileId) return { ok: false, error: 'Drive 파일 ID가 없습니다.' }
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: input.categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    await setDrivePublicReadable(input.driveFileId)
    const last = await prisma.propertyPhoto.findFirst({ where: { categoryId: input.categoryId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const photo = await prisma.propertyPhoto.create({
      data: {
        storageUrl: buildDriveThumbnailUrl(input.driveFileId, 400),
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        is360: looksLike360(input.fileName),
        categoryId: input.categoryId,
        propertyId,
      },
    })
    revalidatePath('/room-manage')
    return { ok: true, id: photo.id, driveFileId: photo.driveFileId!, storageUrl: photo.storageUrl, fileName: photo.fileName ?? input.fileName }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    console.error('[finalizePropertyPhoto] failed:', err)
    if (input.driveFileId) { try { await deleteFromDrive(input.driveFileId) } catch { /* 정리 실패 무시 */ } }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function deletePropertyPhoto(photoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    if (photo.driveFileId) { try { await deleteFromDrive(photo.driveFileId) } catch { /* 정리 실패 무시 */ } }
    await prisma.propertyPhoto.delete({ where: { id: photoId } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function reorderPropertyPhotos(categoryId: string, photoIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const cat = await prisma.propertyPhotoCategory.findFirst({ where: { id: categoryId, propertyId }, select: { id: true } })
    if (!cat) return { ok: false, error: '카테고리를 찾을 수 없습니다.' }
    const rows = await prisma.propertyPhoto.findMany({ where: { categoryId }, select: { id: true } })
    const own = new Set(rows.map(r => r.id))
    if (photoIds.length !== rows.length || !photoIds.every(id => own.has(id))) return { ok: false, error: '사진 목록이 일치하지 않습니다.' }
    await prisma.$transaction(photoIds.map((id, i) => prisma.propertyPhoto.update({ where: { id }, data: { sortOrder: i } })))
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setPropertyPhotoShowOnSite(photoId: string, show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.propertyPhoto.update({ where: { id: photoId }, data: { showOnSite: show } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function setPropertyPhotoIs360(photoId: string, is360: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const photo = await prisma.propertyPhoto.findFirst({ where: { id: photoId, propertyId }, select: { id: true } })
    if (!photo) return { ok: false, error: '사진을 찾을 수 없습니다.' }
    await prisma.propertyPhoto.update({ where: { id: photoId }, data: { is360 } })
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
