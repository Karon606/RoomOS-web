// 투어일을 비우는 저장이 상태 이력에 남기는 메모의 정본(만들기·읽기·같은 상태 행 쓰기)
//
// 왜 필요한가(2026-10-23 운영자 승인 '추천대로', (가)안). 입주자 수정 폼에서 '문의'로 바꿔 저장하면 투어일과 투어 시각이
// 지워지는데, 그 값이 어디에도 남지 않았다(운영 DB 입실 취소 49건 중 18건이 투어일을 지니고 있었다). 비우는 저장마다
// 상태 이력(TenantStatusLog) memo 에 `투어일 2026-09-28 비움`(시각이 있으면 `투어일 2026-09-28 14:00 비움`)을 남긴다.
//   · 상태가 함께 바뀌는 저장이면 그 전이 행 하나에 memo 를 싣는다(행을 둘 만들지 않는다).
//   · 상태가 그대로면 from === to 행을 하나 만든다. 사유(reason)는 비워 둔다. 사유가 아니라 기록이라 이어받기·이름 변경·
//     사유 수정·종료 사유 표시가 이 행을 사유로 읽지 않는다.
//   · 새 날짜로 바꾸는 저장은 대상이 아니다(비울 때만).
// 투어일을 쓰는 자리는 입주자 등록(addTenant, 새로 만들 뿐 비우지 않는다)과 입주자 수정(updateTenant)뿐이다.
// 새 쓰기 자리가 생기면 이 파일을 거쳐야 한다(감지망 scripts/check-tour-clear-log.mjs).
import type { LeaseStatus } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'

type TourValue = { tourDate: Date | string | null; tourTime: string | null }

const ymdOf = (d: Date | string): string | null => {
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)   // @db.Date 는 그 날짜의 UTC 자정이다
}

/**
 * 이 저장이 투어일을 비우면 남길 메모, 아니면 null.
 * `nextTourDate` 는 폼 값 그대로다. null = 폼에 칸이 없다(보존), '' = 비웠다, 날짜 = 새 값.
 */
export function tourClearedMemo(prev: TourValue, nextTourDate: string | null | undefined): string | null {
  if (nextTourDate !== '' || !prev.tourDate) return null
  const ymd = ymdOf(prev.tourDate)
  if (!ymd) return null
  const time = prev.tourTime && /^\d{2}:\d{2}$/.test(prev.tourTime) ? ` ${prev.tourTime}` : ''
  return `투어일 ${ymd}${time} 비움`
}

const MEMO_RE = /^투어일 (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))? 비움$/

/** 투어일 비움 메모를 읽는다. 이 꼴이 아니면 null. */
export function parseTourClearedMemo(memo: string | null | undefined): { ymd: string; time: string | null } | null {
  const m = (memo ?? '').match(MEMO_RE)
  return m ? { ymd: m[1], time: m[2] ?? null } : null
}

/**
 * 상태 이력 화면에 보일 메모 줄. 투어일 비움 메모는 `비운 투어일 2026.09.28 14:00`(전이 행·같은 상태 행이 같은 말투,
 * 독립 검수 3), 그 밖의 메모는 그대로다. 저장은 2026-09-28 꼴이라 내보내기에서 날짜로 읽히고, 화면은 목록 날짜 표기(점)와 맞춘다.
 */
export function statusLogMemoText(memo: string | null | undefined): string | null {
  const m = memo?.trim()
  if (!m) return null
  const v = tourClearedValueText(m)
  return v ? `비운 투어일 ${v}` : m
}

/** 투어일 비움 메모가 지운 값의 화면 글자('2026.09.28 14:00'). 이 꼴이 아니면 null. */
export function tourClearedValueText(memo: string | null | undefined): string | null {
  const t = parseTourClearedMemo(memo?.trim())
  return t ? `${t.ymd.replace(/-/g, '.')}${t.time ? ` ${t.time}` : ''}` : null
}

/** 상태가 그대로인 저장에서 투어일만 비웠을 때 남기는 행. 상태가 함께 바뀌면 이 함수를 부르지 말고 그 전이 행에 memo 를 싣는다. */
export async function createTourClearedLog(db: Pick<PrismaDb, 'tenantStatusLog'>, row: {
  tenantId: string; leaseTermId: string; propertyId: string; status: LeaseStatus; changedById: string | null; memo: string
}): Promise<void> {
  await db.tenantStatusLog.create({
    data: {
      tenantId: row.tenantId,
      leaseTermId: row.leaseTermId,
      propertyId: row.propertyId,
      fromStatus: row.status,
      toStatus: row.status,
      changedById: row.changedById,
      memo: row.memo,
    },
  })
}
