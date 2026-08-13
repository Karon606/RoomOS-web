// 입주일(moveInDate) 한 값을 다루는 정본 — 표기 정규화와 딸린 계약 전파를 한 곳에서 본다.
import type { PrismaDb } from '@/lib/prisma'
import type { LeaseStatus } from '@prisma/client'
import { kstYmdStr } from '@/lib/kstDate'
import { syncRoomStayOnSave, STAY_ELIGIBLE_STATUSES } from '@/lib/roomStay'

// 트랜잭션 클라이언트 — lib/dueDay 의 DueDayDb 와 같은 모양이다(lib/prisma 익스텐션이 적용된 타입이라야
// tx 안에서도 규칙이 같다). 두 파일이 각자 들고 있는 것은 한쪽 상수만 바뀌어야 할 때 같이 안 움직이게 하려는 것이다.
export type MoveInDb = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

/**
 * 전파가 닿는 계약 — 죽지 않은 것 전부.
 *
 * 납부일(lib/dueDay DUE_PROPAGATION_STATUSES)과 명단이 다르다. 거기서 거주 전 단계를 뺀 이유는
 * 그 상태에 납부일이 남아 있는 것 자체를 lib/integrityAudit 이 오염으로 세기 때문인데(축 ②),
 * 입주일에는 그런 축이 없다. 오히려 반대다 — 저장 경로 넷(addTenant·updateTenant·
 * applyStatusTransition·일괄)이 '청구 상태인데 입주일이 없으면' 거부한다. 거주 전 단계의 입주일은
 * 화면에서 '입주 희망일'이라는 이름으로 멀쩡히 쓰이는 값이고, 예약 확정은 그 값을 필수로 받는다.
 * 그래서 예약·투어·문의 단계의 딸린 계약도 부모를 따라가야 한다.
 *
 * 빼는 것은 죽은 자식 둘뿐이다. 퇴실 완료(CHECKED_OUT)와 입실 취소(CANCELLED)의 입주일은
 * 지난 기록이라, 부모의 날을 심으면 이미 끝난 거주 구간의 시작이 뒤로 밀린다.
 */
const MOVE_IN_PROPAGATION_STATUSES: LeaseStatus[] =
  ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED', 'WAITING_TOUR', 'TOUR_DONE']

/**
 * 저장한 입주일 한 값을 폼이 쓰는 'YYYY-MM-DD' 로 가른다. 비어 있으면 빈 문자열.
 *
 * KST 기준이다 — @db.Date 는 UTC 자정으로 읽히고, 폼의 날짜 칸도 kstYmdStr 로 만든 문자열이라
 * 같은 기준끼리 견주어야 자정 근처에서 하루가 어긋나지 않는다(toDateInput 과 같은 한 벌).
 */
export function moveInYmd(d: Date | string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '' : kstYmdStr(dt)
}

/** 두 입주일이 같은 날을 가리키는가. 둘 다 비어 있으면 같은 것으로 본다. */
export function sameMoveInDate(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): boolean {
  return moveInYmd(a) === moveInYmd(b)
}

/**
 * 부모 계약의 입주일이 바뀔 때 딸린 계약을 함께 옮긴다(운영자 승인 2026-08-13, 신고 eb66b990).
 *
 * 한 사람이 방을 둘 쓰면 대개 같은 날 들어온다. 그래서 폼은 딸린 계약의 입주일을 부모와 같은 날로
 * 잡아 주는데, 나중에 부모만 바꾸면 딸린 쪽이 옛 날에 남는다. 입주일은 청구가 시작되는 달을 정하는
 * 값이라(lib/billing monthOfDate · 수납 관리 행 필터 · unpaid 의 leaseStartMonth) 갈리면 한 사람의
 * 두 방이 서로 다른 달부터 청구된다.
 *
 * 무엇을 따라오게 하는가. **비어 있거나 옛 부모 날과 같던** 딸린 계약만이다. 이 판정은 폼이
 * '메인 계약과 같음'과 '따로'를 가르는 그 기준과 문자 그대로 같은 함수(sameMoveInDate)다 —
 * 화면이 '같음'이라 부르는 것만 따라간다. 따로 적어 둔 날은 건드리지 않는다.
 * 상속을 표시하는 컬럼을 새로 두지 않는 이유는 납부일과 같다. 저장된 날이 곧 청구가 읽는 날이고,
 * '같은가'는 그 날들끼리 견주면 알 수 있다.
 *
 * 거주 구간 이력도 같이 옮긴다. 입주 구간의 startDate 는 moveInDate 의 파생이라(lib/roomStay
 * syncMoveInStart, 507호 신헌석 사건) 계약만 옮기면 감지망 축 ⑦ 이 곧바로 어긋남을 센다.
 * 부모 저장 경로가 이미 자기 계약에 하는 그 처리를, 따라 움직인 자식에게도 한 번씩 한다.
 *
 * @returns 실제로 바뀐 계약의 되돌리기 스냅샷. 부를 자리에 적용취소가 있으면 이걸 함께 실어야 한다.
 */
export async function propagateMoveInDateToSubLeases(
  db: MoveInDb,
  parentLeaseTermId: string,
  prevMoveInDate: Date | string | null,
  nextMoveInDate: Date | string | null,
): Promise<{ id: string; prevMoveInDate: Date | null }[]> {
  if (sameMoveInDate(prevMoveInDate, nextMoveInDate)) return []
  const subs = await db.leaseTerm.findMany({
    where: { parentLeaseTermId, status: { in: MOVE_IN_PROPAGATION_STATUSES } },
    // roomId·status — 아래 거주 구간 전파의 입력. 안 실으면 이력이 옛 날에 남는다.
    select: { id: true, moveInDate: true, roomId: true, status: true },
  })
  const targets = subs.filter(s => !s.moveInDate || sameMoveInDate(s.moveInDate, prevMoveInDate))
  if (targets.length === 0) return []
  const next = nextMoveInDate ? new Date(nextMoveInDate) : null
  await db.leaseTerm.updateMany({
    where: { id: { in: targets.map(t => t.id) } },
    data: { moveInDate: next },
  })
  for (const t of targets) {
    // 구간을 갖는 상태만 — 예약·투어 단계에는 구간이 없어야 한다(자격 게이트를 여기서 다시 밟지 않는다).
    if (!STAY_ELIGIBLE_STATUSES.includes(t.status)) continue
    await syncRoomStayOnSave(db, t.id, {
      prevRoomId: t.roomId, nextRoomId: t.roomId,
      prevStatus: t.status, nextStatus: t.status,
      prevMoveInDate: t.moveInDate, nextMoveInDate: next,
    })
  }
  return targets.map(t => ({ id: t.id, prevMoveInDate: t.moveInDate }))
}
