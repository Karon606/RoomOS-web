// 예약 임대료 인상('그 달 이용료부터') 회귀 테스트 — 실행: npx tsx scripts/test-rent-increase.ts
// DB 불필요, 순수함수(lib/billing billForLeaseMonth·monthOfDate)만 고정한다.
//
// 정본 규칙(운영자 확정, knowledge/domain-billing.md '예약 인상은 그 달 이용료부터'):
//   방 scheduledRent + rentUpdateDate(예 7/1)가 걸려 있으면, 적용일이 지나기 전이라도
//   대상월이 인상 적용월 이상이면 인상가로 청구한다. "7/1부 인상 = 7월 이용료부터"이므로
//   6월에 미리 내는 7월분(선납)도 인상가가 맞다.
//
// 이 파일이 덮는 것 — 경계(전월·적용월·다음달), 선납과 락인의 우선순위, 락 되쓰기,
// 퇴실·재입실 새 계약, 같은 방의 NON_RESIDENT 공존(418호 유형), 예약 취소·변경.
//
// 알려진 결함(knownFail)은 통과로 세지 않고 아래 목록에 모아 보고한다. 현재 동작이 고쳐지면
// 자동으로 통과로 잡히며 '승격 필요' 안내가 뜬다 — verify 체인은 어느 쪽이든 깨지지 않는다.

import { billForLeaseMonth, monthOfDate, unpaidForLease, type UnpaidRecord } from '../lib/billing'

let pass = 0
let fail = 0
const knownFails: string[] = []
const promotions: string[] = []

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

// 알려진 제품 결함 — correct(정본 기대값)와 current(현재 동작)를 둘 다 적는다.
// actual === current  → 알려진 결함으로 기록(체인 통과).
// actual === correct  → 결함 해소, 통과로 세고 eq 승격 안내.
// 둘 다 아님          → 제3의 값이므로 하드 실패(회귀 감지).
function knownFail(name: string, actual: unknown, correct: unknown, current: unknown, note: string) {
  const a = JSON.stringify(actual)
  if (a === JSON.stringify(correct)) {
    pass++
    promotions.push(`${name} — 결함 해소됨. eq 로 승격하라.`)
    return
  }
  if (a === JSON.stringify(current)) {
    knownFails.push(`${name}\n    정본 기대: ${JSON.stringify(correct)} / 현재 동작: ${a}\n    ${note}`)
    return
  }
  fail++
  console.error(`FAIL ${name} (알려진 결함도 정본도 아닌 제3의 값)\n  정본: ${JSON.stringify(correct)}\n  기존 결함: ${JSON.stringify(current)}\n  실제: ${a}`)
}

// 실측 기준값 — 구가 450,000 / 인상가 480,000 / 7월 1일부 적용
const OLD = 450_000
const NEW = 480_000
const UPD = '2026-07'                      // 인상 적용월
const ROOM = { scheduledRent: NEW, rentUpdateDate: new Date(2026, 6, 1) }   // 로컬 7/1

// ── 1. 적용 경계 — 전월은 구가, 적용월부터 인상가 ────────────────────────
{
  const lease = { rentAmount: OLD, status: 'ACTIVE', room: ROOM }
  eq('경계: 인상 예약 두 달 전(5월) 구가', billForLeaseMonth(lease, '2026-05', null), OLD)
  eq('경계: 인상 예약 직전 달(6월) 구가', billForLeaseMonth(lease, '2026-06', null), OLD)
  eq('경계: 인상 적용 월(7월) 인상가', billForLeaseMonth(lease, '2026-07', null), NEW)
  eq('경계: 인상 다음 달(8월) 인상가 유지', billForLeaseMonth(lease, '2026-08', null), NEW)
  eq('경계: 해가 바뀌어도 인상가 유지', billForLeaseMonth(lease, '2027-03', null), NEW)

  // 적용일이 월 중간(7/15)이어도 판정은 월 단위 — '7월 이용료부터'라 7월 전액이 인상가다.
  // 일할로 쪼개지 않는다(정본 effectiveBaseRent 는 mon >= rentUpdateMonth 비교뿐).
  const mid = { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: NEW, rentUpdateDate: new Date(2026, 6, 15) } }
  eq('경계: 적용일 7/15 여도 7월 전액 인상가', billForLeaseMonth(mid, '2026-07', null), NEW)
  eq('경계: 적용일 7/15, 6월은 구가', billForLeaseMonth(mid, '2026-06', null), OLD)

  // 적용월 환산 — Date 와 평탄화('YYYY-MM') 두 형태가 같은 달로 읽힌다.
  // (Prisma @db.Date 는 UTC 자정 Date 라 UTC 음수 오프셋 지역에서는 하루 밀릴 수 있다.
  //  여기서는 로컬 Date 로 고정해 판정 규칙만 본다.)
  eq('경계: rentUpdateDate 월 환산', monthOfDate(new Date(2026, 6, 1)), UPD)
  const flat = { rentAmount: OLD, status: 'ACTIVE', scheduledRent: NEW, rentUpdateMonth: UPD }
  eq('경계: 평탄화 형태도 같은 결과(6월)', billForLeaseMonth(flat, '2026-06', null), OLD)
  eq('경계: 평탄화 형태도 같은 결과(7월)', billForLeaseMonth(flat, '2026-07', null), NEW)
  // 평탄화 값이 room 객체보다 우선한다(?? 연산 순서) — 호출부가 명시로 덮어쓸 수 있다.
  eq('경계: 평탄화가 room 보다 우선', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', scheduledRent: 500_000, rentUpdateMonth: UPD, room: ROOM }, '2026-07', null), 500_000)
}

// ── 2. 선납 — 적용일 전에 낸 인상 대상 월분도 인상가 ─────────────────────
// 6월에 7월분을 미리 낸다. record 가 아직 없으면(locked null) 추천 납부액은 인상가여야 한다.
// 이 자리가 신고 ede8e3f8(7월 인상 선납이 옛 금액으로 처리돼 과납)의 재발 방지선이다.
{
  const lease = { rentAmount: OLD, status: 'ACTIVE', room: ROOM }
  eq('선납: 6월에 내는 7월분 추천액 = 인상가', billForLeaseMonth(lease, '2026-07', null), NEW)

  // 이미 구가로 락인된 7월 — 락(우선순위 ②)이 예약 인상(③)을 이긴다. 이것이 정본 우선순위다.
  // 그래서 인상 예약을 나중에 걸면 rewriteLockedExpectedForRentSchedule 로 되써야 반영된다.
  eq('선납: 구가로 락인된 7월은 락 우선', billForLeaseMonth(lease, '2026-07', OLD), OLD)
  eq('선납: 락 되쓰기 후 인상가 반영', billForLeaseMonth(lease, '2026-07', NEW), NEW)

  // 미수 판정 — 구가만 낸 선납은 인상분 30,000 이 미수로 남아야 한다(락이 되쓰인 뒤).
  const R = (targetMonth: string, expectedAmount: number, actualAmount: number): UnpaidRecord =>
    ({ targetMonth, expectedAmount, actualAmount, isDeposit: false, isPrevOwner: false, isBillingAdjust: false })
  eq('선납: 구가만 낸 7월 미수 = 인상 차액', unpaidForLease([R('2026-07', NEW, OLD)]), NEW - OLD)
  eq('선납: 락이 구가면 미수 0(인상분 미인식 — 되쓰기 전 상태)', unpaidForLease([R('2026-07', OLD, OLD)]), 0)
  eq('선납: 인상가 완납이면 미수 0', unpaidForLease([R('2026-07', NEW, NEW)]), 0)
}

// ── 3. 락 되쓰기 시뮬레이터 — rewriteLockedExpectedForRentSchedule 과 같은 순서 ──
// 서버(app/(app)/rooms/actions.ts:2427)는 예약 변경 전후로 billForLeaseMonth 를 두 번 돌려
// '변경 전 기준값 그대로 락인된' record 만 새 값으로 되쓴다. 협의 락인은 손대지 않는다.
type Rec = { id: string; targetMonth: string; expectedAmount: number }
type RoomSched = {
  scheduledRent: number | null; rentUpdateDate: Date | null
  nonResidentScheduled?: number | null; nonResidentRentDate?: Date | null
}
type LeaseLite = { rentAmount: number; status: string; isShortTerm?: boolean; checkoutProratedMonth?: string | null; discounts?: null }

function rewriteLocksForSchedule(lease: LeaseLite, recs: Rec[], prev: RoomSched, next: RoomSched) {
  const changed: { month: string; before: number; after: number }[] = []
  if (lease.isShortTerm) return changed
  const months = [...new Set(recs.map(r => r.targetMonth))].sort()
  for (const mon of months) {
    if (lease.checkoutProratedMonth === mon) continue
    const base = { rentAmount: lease.rentAmount, status: lease.status, discounts: lease.discounts ?? null }
    const before = billForLeaseMonth({ ...base, room: prev }, mon, null)
    const after = billForLeaseMonth({ ...base, room: next }, mon, null)
    if (before === after) continue
    const monthRecs = recs.filter(r => r.targetMonth === mon)
    const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    if (lockedMax !== before) continue   // 협의 락인 — 불변
    for (const r of monthRecs) if (r.expectedAmount === lockedMax) r.expectedAmount = after
    changed.push({ month: mon, before, after })
  }
  return changed
}

{
  const NONE: RoomSched = { scheduledRent: null, rentUpdateDate: null }
  const SCHED: RoomSched = { scheduledRent: NEW, rentUpdateDate: new Date(2026, 6, 1) }

  // 인상 예약을 새로 걸면 — 선납된 7월 락(구가)만 인상가로 되쓰이고 6월은 그대로다.
  {
    const recs: Rec[] = [
      { id: 'r6', targetMonth: '2026-06', expectedAmount: OLD },
      { id: 'r7', targetMonth: '2026-07', expectedAmount: OLD },
    ]
    const changed = rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE' }, recs, NONE, SCHED)
    eq('되쓰기: 인상 예약 등록 시 7월 락만 변경', changed, [{ month: '2026-07', before: OLD, after: NEW }])
    eq('되쓰기: 6월 락 불변', recs.find(r => r.id === 'r6')!.expectedAmount, OLD)
    eq('되쓰기: 7월 락 인상가', recs.find(r => r.id === 'r7')!.expectedAmount, NEW)
  }

  // 협의 락인(기준값과 다른 금액)은 손대지 않는다 — 근거 없는 매출 정정 방지.
  {
    const recs: Rec[] = [{ id: 'r7', targetMonth: '2026-07', expectedAmount: 460_000 }]
    const changed = rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE' }, recs, NONE, SCHED)
    eq('되쓰기: 협의 락인은 불변', [changed.length, recs[0].expectedAmount], [0, 460_000])
  }

  // 퇴실 일할이 걸린 달은 불변 — 그 달은 정산액이 청구 권위다.
  {
    const recs: Rec[] = [{ id: 'r7', targetMonth: '2026-07', expectedAmount: OLD }]
    const changed = rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE', checkoutProratedMonth: '2026-07' }, recs, NONE, SCHED)
    eq('되쓰기: 일할 정산 월은 불변', [changed.length, recs[0].expectedAmount], [0, OLD])
  }

  // 단기 계약은 되쓰기 대상이 아니다(체류 전체 사용료라 월 기준이 없다).
  {
    const recs: Rec[] = [{ id: 'r7', targetMonth: '2026-07', expectedAmount: OLD }]
    eq('되쓰기: 단기는 제외', rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE', isShortTerm: true }, recs, NONE, SCHED).length, 0)
  }

  // 예약 취소 — 되쓰기가 반대 방향으로 돌아 인상분 미수가 사라진다(적용취소 정합).
  {
    const recs: Rec[] = [{ id: 'r7', targetMonth: '2026-07', expectedAmount: NEW }]
    const changed = rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE' }, recs, SCHED, NONE)
    eq('되쓰기: 예약 취소는 구가로 복원', [changed, recs[0].expectedAmount], [[{ month: '2026-07', before: NEW, after: OLD }], OLD])
  }
}

// ── 4. 우선순위 상호작용 — 일할 · 할인 · 단기 ────────────────────────────
{
  const lease = { rentAmount: OLD, status: 'ACTIVE', room: ROOM }
  // ① 퇴실 일할이 인상보다 우선(그 달 정산액이 청구 권위)
  eq('우선순위: 일할 정산이 인상보다 우선', billForLeaseMonth(
    { ...lease, checkoutProratedAmount: 160_000, checkoutProratedMonth: '2026-07' }, '2026-07', null), 160_000)
  // ② 할인은 인상가 위에 얹힌다(계약서는 정가, 수납에서만 할인)
  const dc = [{ discountType: 'amount', value: 20_000, scope: 'permanent' }]
  eq('우선순위: 할인은 인상가 기준으로 차감', billForLeaseMonth({ ...lease, discounts: dc }, '2026-07', null), NEW - 20_000)
  eq('우선순위: 인상 전 달은 구가 기준 할인', billForLeaseMonth({ ...lease, discounts: dc }, '2026-06', null), OLD - 20_000)
  const pct = [{ discountType: 'percent', value: 10, scope: 'permanent' }]
  eq('우선순위: 정률 할인도 인상가 기준', billForLeaseMonth({ ...lease, discounts: pct }, '2026-07', null), NEW - 48_000)
  // ③ 단기 비입주월 0 규칙이 인상보다 우선(체류 전체 사용료라 월 fallback 자체가 없다)
  eq('우선순위: 단기 비입주월은 인상과 무관하게 0', billForLeaseMonth(
    { ...lease, isShortTerm: true, moveInDate: '2026-06-20' }, '2026-07', null), 0)
}

// ── 5. 퇴실·재입실 — 새 계약에 적용되는 값 ───────────────────────────────
// 퇴실로 공실이 되면서 운영자가 '즉시 적용'을 고르면 room.baseRent 가 인상가로 옮겨지고
// 예약 필드는 비워진다(tenants/actions.ts ~776). 새 계약 rentAmount 는 그 baseRent 를 물려받는다.
{
  // (가) 즉시 적용함 — 방에 예약이 남지 않는다. 새 계약은 전 구간 인상가(과거 소급이 아니라 새 계약이다).
  const afterApply = { rentAmount: NEW, status: 'ACTIVE', room: { scheduledRent: null, rentUpdateDate: null } }
  eq('재입실: 즉시 적용 후 새 계약 6월분', billForLeaseMonth(afterApply, '2026-06', null), NEW)
  eq('재입실: 즉시 적용 후 새 계약 7월분', billForLeaseMonth(afterApply, '2026-07', null), NEW)

  // (나) 즉시 적용 안 함 — 방에 예약이 남는다. 새 계약 rentAmount 는 구가지만 7월부터는 인상가로 청구된다.
  const keepSched = { rentAmount: OLD, status: 'RESERVED', room: ROOM }
  eq('재입실: 예약 유지 시 6월 입주분은 구가', billForLeaseMonth(keepSched, '2026-06', null), OLD)
  eq('재입실: 예약 유지 시 7월분부터 인상가', billForLeaseMonth(keepSched, '2026-07', null), NEW)

  // (다) RESERVED 표시액 — 입주월 기준으로 본다(rooms/actions.ts 예약 분기, 신고 50a2a69b).
  // 8월 입주 예약이면 조회 월이 6월이어도 표시액은 8월 기준 = 인상가.
  const moveInMonth = '2026-08'
  eq('재입실: 8월 입주 예약의 표시액은 인상가', billForLeaseMonth(keepSched, moveInMonth, null), NEW)
  eq('재입실: 6월 입주 예약의 표시액은 구가', billForLeaseMonth(keepSched, '2026-06', null), OLD)

  // (라) 퇴실한 옛 계약 — 엔진은 status 를 받지 않는다. CHECKED_OUT 을 청구에서 빼는 것은
  // 전적으로 호출부 필터(unpaid.ts·dashboard 는 ACTIVE·CHECKOUT_PENDING·NON_RESIDENT 만 조회)의 책임이다.
  // 엔진 단독으로는 퇴실 계약도 인상가를 돌려준다 — 결함이 아니라 계약된 역할 분담이다.
  eq('재입실: 엔진은 상태를 모른다(호출부 필터 책임)', billForLeaseMonth({ ...keepSched, status: 'CHECKED_OUT' }, '2026-07', null), NEW)
}

// ── 6. NON_RESIDENT 공존(418호 유형) — 같은 방에 비거주 계약 + 거주 계약 ──
// 방 415·418·사무실처럼 명의만 있는 비거주 계약은 거주 요율이 아니라 Room.nonResidentRent 를 쓴다.
// 예약 인상도 축이 둘로 나뉘어 있다 — 거주는 scheduledRent/rentUpdateDate,
// 비거주는 nonResidentScheduled/nonResidentRentDate(prisma schema Room, 적용 스케줄러도 분리 처리).
// 그런데 billForLeaseMonth 의 effectiveBaseRent 는 거주 축 하나만 읽고 lease 상태를 분기하지 않는다.
{
  const NR = 100_000        // 비거주 월이용료(Room.nonResidentRent)
  // 같은 방 ROOM(거주 인상 예약 450,000 → 480,000)에 두 계약이 공존한다.
  const activeLease = { rentAmount: OLD, status: 'ACTIVE', room: ROOM }              // ACTIVE 실거주자
  const nonResLease = { rentAmount: NR, status: 'NON_RESIDENT', room: ROOM }         // NON_RESIDENT 명의자

  // 거주 계약은 정본대로 동작한다.
  eq('418호: ACTIVE 계약 6월 구가', billForLeaseMonth(activeLease, '2026-06', null), OLD)
  eq('418호: ACTIVE 계약 7월 인상가', billForLeaseMonth(activeLease, '2026-07', null), NEW)

  // 비거주 계약은 적용월 전까지는 정상이다.
  eq('418호: NON_RESIDENT 계약 6월은 비거주 요율', billForLeaseMonth(nonResLease, '2026-06', null), NR)

  // 거주 인상 예약은 비거주 계약을 건드리지 않는다 — effectiveBaseRent 가 상태로 축을 고른다.
  // (종전 결함: 100,000 이 480,000 으로 4.8배가 됐고 미납 화면까지 전파됐다.)
  eq('418호: NON_RESIDENT 계약 7월도 비거주 요율', billForLeaseMonth(nonResLease, '2026-07', null), NR)
  eq('418호: NON_RESIDENT 계약 8월 이후도 비거주 요율', billForLeaseMonth(nonResLease, '2026-08', null), NR)

  // 비거주 예약 인상(nonResidentScheduled)은 엔진에 통로 자체가 없다.
  // 비거주 전용 방(거주 예약 없음)에 7/1부 100,000 → 120,000 예약을 걸어도 7월 청구가 구가로 남는다.
  // 거주 계약에는 '그 달 이용료부터'가 적용되는데 비거주에는 안 되는 비대칭이다.
  const nrOnly = {
    rentAmount: NR, status: 'NON_RESIDENT',
    room: {
      scheduledRent: null, rentUpdateDate: null,
      nonResidentScheduled: 120_000, nonResidentRentDate: new Date(2026, 6, 1),
    },
  }
  eq('사무실: 비거주 예약 인상(120,000)이 7월부터 반영', billForLeaseMonth(nrOnly, '2026-07', null), 120_000)
  // 선반영 경계 — 거주 축과 같은 규칙이라 적용월 직전(6월)은 구가다. 6월에 내는 7월분만 인상가다.
  eq('사무실: 비거주 예약 인상 적용월 전(6월)은 구가', billForLeaseMonth(nrOnly, '2026-06', null), NR)
  // 고아 방어 — 적용일 없이 금액만 있으면 영원히 미적용(거주 축의 '고아' 규칙과 대칭).
  eq('사무실: 비거주 예약이 적용일 없으면 미적용', billForLeaseMonth(
    { rentAmount: NR, status: 'NON_RESIDENT', room: { scheduledRent: null, rentUpdateDate: null, nonResidentScheduled: 120_000, nonResidentRentDate: null } },
    '2027-01', null), NR)

  // 락 되쓰기까지 오염된다 — rewriteLockedExpectedForRentSchedule 이 NON_RESIDENT 계약도 루프에 넣는다
  // (rooms/actions.ts:2436 status in [ACTIVE, RESERVED, CHECKOUT_PENDING, NON_RESIDENT]).
  // 표시만 틀리는 것이 아니라 DB 의 expectedAmount 가 실제로 덮어써진다.
  {
    const recs: Rec[] = [{ id: 'nr7', targetMonth: '2026-07', expectedAmount: NR }]
    const changed = rewriteLocksForSchedule(
      { rentAmount: NR, status: 'NON_RESIDENT' }, recs,
      { scheduledRent: null, rentUpdateDate: null },
      { scheduledRent: NEW, rentUpdateDate: new Date(2026, 6, 1) },
    )
    eq('418호: 거주 인상 예약은 NON_RESIDENT 락을 되쓰지 않는다',
      [changed.length, recs[0].expectedAmount], [0, NR])
  }

  // 반대 방향 — 비거주 축만 바꾸면 비거주 락만 움직이고 거주 락은 무접점이어야 한다.
  {
    const NR_NONE: RoomSched = { scheduledRent: null, rentUpdateDate: null, nonResidentScheduled: null, nonResidentRentDate: null }
    const NR_SCHED: RoomSched = { scheduledRent: null, rentUpdateDate: null, nonResidentScheduled: 120_000, nonResidentRentDate: new Date(2026, 6, 1) }
    const nrRecs: Rec[] = [{ id: 'nr7', targetMonth: '2026-07', expectedAmount: NR }]
    const nrChanged = rewriteLocksForSchedule({ rentAmount: NR, status: 'NON_RESIDENT' }, nrRecs, NR_NONE, NR_SCHED)
    const resRecs: Rec[] = [{ id: 'r7', targetMonth: '2026-07', expectedAmount: OLD }]
    const resChanged = rewriteLocksForSchedule({ rentAmount: OLD, status: 'ACTIVE' }, resRecs, NR_NONE, NR_SCHED)
    eq('되쓰기: 비거주 축 변경은 NR 락만 바꾸고 거주 락은 무접점',
      [nrChanged.length, nrRecs[0].expectedAmount, resChanged.length, resRecs[0].expectedAmount],
      [1, 120_000, 0, OLD])
  }

  // 공존 자체는 문제가 아니다 — 두 계약의 청구는 서로 독립이어야 한다.
  eq('418호: 두 계약은 서로의 청구에 영향 없음(6월)', [
    billForLeaseMonth(activeLease, '2026-06', null),
    billForLeaseMonth(nonResLease, '2026-06', null),
  ], [OLD, NR])
}

// ── 7. 예약 취소·변경 — 값이 null 로 돌아가거나 다른 값이 된 경우 ────────
{
  // 취소(둘 다 null) — 전 구간 구가.
  const cancelled = { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: null, rentUpdateDate: null } }
  eq('취소: 예약 삭제 후 7월 구가', billForLeaseMonth(cancelled, '2026-07', null), OLD)
  eq('취소: 예약 삭제 후 8월 구가', billForLeaseMonth(cancelled, '2026-08', null), OLD)
  eq('취소: room 자체가 없어도 구가(회귀 0)', billForLeaseMonth({ rentAmount: OLD, status: 'ACTIVE' }, '2026-07', null), OLD)
  eq('취소: room null 이어도 구가', billForLeaseMonth({ rentAmount: OLD, status: 'ACTIVE', room: null }, '2026-07', null), OLD)

  // 고아(금액만 있고 적용일 없음) — 영원히 미적용. 신고 ede8e3f8 의 원인 데이터 형태다.
  // 지금은 저장 경로에서 XOR 로 막지만, 엔진 쪽 방어도 여기서 고정한다.
  eq('고아: 적용일 없으면 인상 미적용', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: NEW, rentUpdateDate: null } }, '2027-01', null), OLD)
  eq('고아: 금액 없이 적용일만 있으면 구가', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: null, rentUpdateDate: new Date(2026, 6, 1) } }, '2026-07', null), OLD)
  eq('고아: 예약 금액 0 은 미적용', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: 0, rentUpdateDate: new Date(2026, 6, 1) } }, '2026-07', null), OLD)
  eq('고아: 잘못된 적용일은 미적용', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: NEW, rentUpdateDate: '2026-13-99' } }, '2026-07', null), OLD)

  // 금액 변경 — 마지막 예약값이 이긴다.
  eq('변경: 인상가를 500,000 으로 고치면 그 값', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: 500_000, rentUpdateDate: new Date(2026, 6, 1) } }, '2026-07', null), 500_000)
  // 적용월 변경(7월 → 8월) — 7월은 구가로 되돌아간다.
  const moved = { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: NEW, rentUpdateDate: new Date(2026, 7, 1) } }
  eq('변경: 적용월을 8월로 미루면 7월 구가', billForLeaseMonth(moved, '2026-07', null), OLD)
  eq('변경: 적용월을 8월로 미루면 8월 인상가', billForLeaseMonth(moved, '2026-08', null), NEW)
  // 인하 예약도 같은 규칙(예약 가격변경은 방향을 가리지 않는다).
  eq('변경: 인하 예약도 적용월부터', billForLeaseMonth(
    { rentAmount: OLD, status: 'ACTIVE', room: { scheduledRent: 400_000, rentUpdateDate: new Date(2026, 6, 1) } }, '2026-07', null), 400_000)

  // 이미 적용이 끝난 뒤(applyScheduledRents 가 baseRent 로 옮기고 예약 비움) — rentAmount 가 곧 인상가.
  eq('적용 완료: rentAmount 가 인상가, 예약 비움', billForLeaseMonth(
    { rentAmount: NEW, status: 'ACTIVE', room: { scheduledRent: null, rentUpdateDate: null } }, '2026-08', null), NEW)
  // 적용 완료 후에도 과거 달은 락인이 지킨다(소급 재계산 금지).
  eq('적용 완료: 과거 달은 락인이 구가를 지킨다', billForLeaseMonth(
    { rentAmount: NEW, status: 'ACTIVE', room: { scheduledRent: null, rentUpdateDate: null } }, '2026-05', OLD), OLD)
}

console.log(`\n예약 임대료 인상 회귀: ${pass} 통과 / ${fail} 실패 / ${knownFails.length} 알려진 결함`)
if (promotions.length > 0) {
  console.log('\n[승격 필요] 알려진 결함이 해소됐다. knownFail 을 eq 로 바꿔라.')
  for (const p of promotions) console.log(`  - ${p}`)
}
if (knownFails.length > 0) {
  console.log('\n[알려진 결함] 청구 엔진이 lease 상태를 분기하지 않는다 — 수정은 별도 승인 사안이라 여기서는 고정만 한다.')
  for (const k of knownFails) console.log(`  - ${k}`)
}
if (fail > 0) process.exit(1)
