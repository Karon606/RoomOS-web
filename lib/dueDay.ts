// 납부일(dueDay) 한 값을 다루는 정본 — 표기 정규화와 딸린 계약 전파를 한 곳에서 본다.
import type { PrismaDb } from '@/lib/prisma'
import type { LeaseStatus } from '@prisma/client'

// 트랜잭션 클라이언트 — lib/prisma 익스텐션이 적용된 타입이라야 tx 안에서도 규칙이 같다(roomStay 관례).
export type DueDayDb = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// 전파가 닿는 계약 — 청구가 도는 상태만.
// 거주 전 단계(문의·투어·예약·취소)는 뺀다. 그 상태에 납부일이 남아 있는 것 자체를 lib/integrityAudit
// 이 오염으로 세기 때문이다. 끝난 계약(퇴실 완료)의 납부일은 지난 기록이라 손대지 않는다.
const DUE_PROPAGATION_STATUSES: LeaseStatus[] = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']

/**
 * 저장한 납부일 한 값을 화면이 쓰는 두 짝(제출값 raw · 표시값 disp)으로 가른다.
 *
 * 30 이상은 '말일'로 모은다 — 2월에 30일은 없으니 저장된 '30'과 '말일'은 같은 날을 가리킨다.
 * 표시 정본(fmtDueDay)·구간 버킷(dueDayBucketOf)이 이미 쓰는 그 규칙이다.
 */
export function dueDayParts(dueDay: string | null | undefined): { raw: string; disp: string } {
  const d = dueDay ?? ''
  if (!d) return { raw: '', disp: '' }
  const n = parseInt(d, 10)
  if (!isNaN(n)) return n >= 30 ? { raw: '말일', disp: '말일' } : { raw: d, disp: `${n}일` }
  return d.includes('말') ? { raw: '말일', disp: '말일' } : { raw: d, disp: d }
}

/** 두 납부일이 같은 날을 가리키는가. 둘 다 비어 있으면 같은 것으로 본다('30'과 '말일'도 같다). */
export function sameDueDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return dueDayParts(a).raw === dueDayParts(b).raw
}

/**
 * 이용 기간 시작일 정본(운영자 승인 2026-10-21, 504호). 계약의 dueDay 한 칸은 두 뜻을 함께 졌다.
 * 기간이 며칠에 시작하는가(주기)와 돈을 언제까지 내는가(기한)다. '납부일만 옮김' 계약은 둘이 갈린다
 * (504호. 기간 매월 1일~말일, 납부일 6일). 그래서 주기는 cycleDay 칸에 따로 두고, 비어 있으면 dueDay 와 같다.
 *
 * 주기로 읽는 자리(청구 기간·퇴실 정산·입주달 첫 달 규칙·무청구 판정·납부 확인서 기간·인수월 양도인 판정)는
 * 전부 이 함수를 부른다. 기한으로 읽는 자리(미납·연체·알림·문자 {납기일}·정렬·계약서 '매월 납부일')는 dueDay 그대로다.
 * cycleDay 칸을 필수로 받는 이유는 select 에서 빠뜨리면 tsc 가 잡게 하려는 것이다(빠뜨리면 조용히 dueDay 로 떨어진다).
 */
export function cycleDayOf(l: { cycleDay: string | null; dueDay: string | null }): string | null {
  return l.cycleDay ?? l.dueDay
}

/** 기간 시작과 납부일이 갈린 계약인가(cycleDay 가 있고 dueDay 와 다른 날). 같은 날이면 갈린 것이 아니다. */
export function hasSplitCycle(l: { cycleDay: string | null; dueDay: string | null }): boolean {
  return !!l.cycleDay && !sameDueDay(l.cycleDay, l.dueDay)
}

/** 날짜 칸 하나를 그 달 안의 일(1~31, 말일·30 이상은 31)로. 못 읽으면 null. */
function dueDayNumber(v: string | null | undefined): number | null {
  const raw = dueDayParts(v).raw
  if (!raw) return null
  if (raw === '말일') return 31
  const n = parseInt(raw, 10)
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null
}

/**
 * 납부일만 옮길 때 새 납부일이 기간 시작보다 늦은가(운영자 승인 2026-10-21 3번. 늦추기만 허용, 앞당기기 거절).
 * 같은 달 안의 날로 견준다. 기간이 20일에 시작하는데 납부일을 5일로 두면 그 달 기한이 기간보다 먼저 와서
 * 아직 시작도 안 한 기간의 돈을 미리 받게 된다. 같은 날이면 갈린 것이 아니라 거절한다(그건 그냥 기간과 같은 납부일이다).
 */
export function dueDayAfterCycle(cycleDay: string | null, dueDay: string | null): boolean {
  const c = dueDayNumber(cycleDay)
  const d = dueDayNumber(dueDay)
  return c != null && d != null && d > c
}

/** '매월 1일~말일' 의 '1일~말일' 조각. 기간 시작이 1일이면 말일까지, 아니면 다음 달 전날까지다. */
export function cyclePeriodLabel(cycleDay: string | null): string {
  const c = dueDayNumber(cycleDay)
  if (c == null) return ''
  if (c === 1) return '1일~말일'
  if (c === 31) return '말일~다음 달 말일 전날'
  return `${c}일~다음 달 ${c - 1}일`
}

/**
 * 입주일 기준 납부일 파생 — 30일 이상이면 '말일'(등록 폼 applyDueDay 와 동일 규칙).
 *
 * 원래 app/(app)/tenants/actions.ts 안의 로컬 함수였다. 정합 감사(lib/integrityAudit)가 같은 규칙으로
 * '희망일에서 파생한 값인가'를 견주어야 하는데, 서버 액션 파일('use server')은 async 함수만 내보낼 수
 * 있어 거기서 가져올 길이 없다. 그래서 납부일 한 값을 다루는 이 정본으로 올린다 — 동작은 그대로다.
 *
 * UTC 로 읽는 이유는 moveInDate 가 @db.Date 이고 그 날의 UTC 자정으로 저장되기 때문이다(ymdToDbDate).
 * 로컬 게터로 읽으면 KST 기기에서 하루 앞의 날이 나와 파생 납부일이 통째로 밀린다.
 */
export function dueDayFromMoveIn(moveIn: Date): string {
  const day = moveIn.getUTCDate()
  return day >= 30 ? '말일' : String(day)
}

/**
 * 부모 계약의 납부일이 바뀔 때 딸린 계약을 함께 옮긴다(운영자 오더 2026-08-13).
 *
 * 한 사람이 방을 둘 쓰면 돈은 대개 같은 날 한 번에 들어온다. 그래서 폼은 딸린 계약의 납부일을
 * 부모와 같은 날로 잡아 주는데, 나중에 부모만 바꾸면 딸린 쪽이 옛 날에 남아 청구가 갈린다.
 *
 * 무엇을 따라오게 하는가. **비어 있거나 옛 부모 날과 같던** 딸린 계약만이다. 이 판정은 폼이
 * '부모와 같음'과 '따로'를 가르는 그 기준(dueDay 가 비었거나 부모와 같으면 같음 모드)과 같은
 * 한 벌이다 — 화면이 '같음'이라 부르는 것만 따라간다. 따로 적어 둔 날은 건드리지 않는다.
 * 상속을 표시하는 컬럼을 새로 두지 않는 이유가 여기 있다. 저장된 날이 곧 청구가 읽는 날이고,
 * '같은가'는 그 날들끼리 견주면 알 수 있다.
 *
 * 거주 전 단계의 딸린 계약에는 심지 않는다 — 그 상태에 납부일이 있는 것 자체가 오염이다.
 *
 * @returns 실제로 바뀐 계약의 되돌리기 스냅샷. 부를 자리에 적용취소가 있으면 이걸 함께 실어야 한다.
 */
export async function propagateDueDayToSubLeases(
  db: DueDayDb,
  parentLeaseTermId: string,
  prevDueDay: string | null,
  nextDueDay: string | null,
): Promise<{ id: string; prevDueDay: string | null }[]> {
  if (sameDueDay(prevDueDay, nextDueDay)) return []
  const subs = await db.leaseTerm.findMany({
    where: { parentLeaseTermId, status: { in: DUE_PROPAGATION_STATUSES } },
    select: { id: true, dueDay: true },
  })
  const targets = subs.filter(s => !s.dueDay || sameDueDay(s.dueDay, prevDueDay))
  if (targets.length === 0) return []
  await db.leaseTerm.updateMany({
    where: { id: { in: targets.map(t => t.id) } },
    data: { dueDay: nextDueDay },
  })
  return targets.map(t => ({ id: t.id, prevDueDay: t.dueDay }))
}
