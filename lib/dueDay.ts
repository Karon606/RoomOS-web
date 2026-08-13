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
