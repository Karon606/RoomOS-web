// 계약 종속 가드 회귀 테스트 — 실행: npx tsx scripts/test-lease-subordination.ts
//
// 여기서 고정하는 것 넷(2026-08-13, 다호실 2단계).
//   · 단독 계약 불가 방은 부모 지목 없이 저장할 수 없다.
//   · 부모는 같은 사람의 살아 있는 계약이다.
//   · 자기 자신을 부모로 두는 것과 2단 종속은 양방향으로 막힌다(그래서 순환이 만들어질 수 없다).
//   · **종전 전건 무변동** — 단독 계약이 되는 방에 부모 없이 저장하는 것은 늘 통과다.
//     이 축이 깨지면 기존 계약 전부가 저장 불가가 된다. 나머지 셋보다 이것이 먼저다.

import {
  leaseSubordinationDenial, roomAssignmentBlockReason,
  findOverlapAck, isSameDayTurnover, occupancyOverlapSpan,
  STANDALONE_LEASE_ERROR, STANDALONE_LEASE_IMPORT_ERROR,
} from '../lib/roomAssignment'
import { propagateDueDayToSubLeases, sameDueDay } from '../lib/dueDay'
import { propagateMoveInDateToSubLeases, sameMoveInDate, moveInYmd } from '../lib/moveInDate'
import { billForLeaseMonth, monthOfDate } from '../lib/billing'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}
/** 막혔는가만 본다 — 문구 글자까지 테스트에 박으면 어휘를 못 고친다. */
function blocked(name: string, denial: string | null, want: boolean) {
  eq(name, denial !== null, want)
}

const 부모509 = { id: '509', tenantId: '김', status: 'ACTIVE', parentLeaseTermId: null }

type Input = Parameters<typeof leaseSubordinationDenial>[0]
const base: Input = {
  roomStandaloneAllowed: true,
  parentLeaseTermId: null,
  parent: null,
  selfTenantId: '김',
  selfLeaseTermId: null,
  selfHasSubLeases: false,
}
const denial = (patch: Partial<Input>) => leaseSubordinationDenial({ ...base, ...patch })

// ── 무회귀 축 ── 단독 계약이 되는 방(기존 전건)은 부모가 없어도 늘 통과한다.
eq('무회귀 · 단독 가능 방 + 부모 없음', denial({}), null)
eq('무회귀 · 방 미배정(문의 단계)', denial({ roomStandaloneAllowed: true }), null)
eq('무회귀 · 단독 가능 방을 수정 저장', denial({ selfLeaseTermId: '601' }), null)

// ── 단독 계약 불가 방 ──
eq('단독 불가 방 + 부모 없음은 거부', denial({ roomStandaloneAllowed: false }), STANDALONE_LEASE_ERROR)
eq('단독 불가 방 + 부모 있으면 통과',
  denial({ roomStandaloneAllowed: false, parentLeaseTermId: '509', parent: 부모509 }), null)

// ── 부모의 자격 ──
blocked('부모를 못 찾으면 거부', denial({ parentLeaseTermId: '없음', parent: null }), true)
blocked('남의 계약은 부모가 될 수 없다',
  denial({ parentLeaseTermId: '509', parent: { ...부모509, tenantId: '박' } }), true)
blocked('퇴실 완료 계약은 부모가 될 수 없다',
  denial({ parentLeaseTermId: '509', parent: { ...부모509, status: 'CHECKED_OUT' } }), true)
blocked('입실 취소 계약은 부모가 될 수 없다',
  denial({ parentLeaseTermId: '509', parent: { ...부모509, status: 'CANCELLED' } }), true)
blocked('문의 단계는 부모가 될 수 없다',
  denial({ parentLeaseTermId: '509', parent: { ...부모509, status: 'WAITING_TOUR' } }), true)
for (const status of ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT']) {
  eq(`살아 있는 계약(${status})은 부모가 된다`,
    denial({ parentLeaseTermId: '509', parent: { ...부모509, status } }), null)
}

// ── 순환·2단 ──
blocked('자기 자신은 부모가 될 수 없다',
  denial({ parentLeaseTermId: '601', selfLeaseTermId: '601', parent: { ...부모509, id: '601' } }), true)
blocked('부모가 이미 딸려 있으면 거부(2단)',
  denial({ parentLeaseTermId: '509', parent: { ...부모509, parentLeaseTermId: '401' } }), true)
blocked('딸린 계약이 있는 계약은 남에게 딸릴 수 없다(2단 반대 방향)',
  denial({ parentLeaseTermId: '509', parent: 부모509, selfLeaseTermId: '601', selfHasSubLeases: true }), true)
// 위 둘을 함께 막으면 길이 2 이상의 순환은 만들어질 수 없다 — a 가 b 에 딸리려면 b 에 부모가 없어야 하고,
// b 가 a 에 딸리려면 a 에 자식이 없어야 하는데 첫 저장이 이미 a 에 자식을 만든다.
blocked('순환 시도(a→b 뒤 b→a)',
  denial({ parentLeaseTermId: 'a', parent: { id: 'a', tenantId: '김', status: 'ACTIVE', parentLeaseTermId: null }, selfLeaseTermId: 'b', selfHasSubLeases: true }), true)

// ── 엑셀 가져오기 축 ⑤ ── 시트에는 부모를 지목할 자리가 없으므로 통째로 막는다.
const sheet = (patch: Partial<Parameters<typeof roomAssignmentBlockReason>[0]>) => roomAssignmentBlockReason({
  incoming: { status: 'ACTIVE', moveIn: '2026-08-01', moveOut: null },
  nonResidentOccupied: false,
  roomStandaloneAllowed: true,
  others: [],
  ...patch,
})
eq('시트 · 단독 가능 방은 종전대로 통과', sheet({}), null)
eq('시트 · 단독 불가 방은 거부', sheet({ roomStandaloneAllowed: false }), STANDALONE_LEASE_IMPORT_ERROR)
eq('시트 · 단독 불가 방은 명의(비거주)도 거부',
  sheet({ roomStandaloneAllowed: false, incoming: { status: 'NON_RESIDENT', moveIn: null, moveOut: null } }),
  STANDALONE_LEASE_IMPORT_ERROR)
// 종료 상태는 방을 잡지 않는다 — 퇴실자 시트가 단독 불가 방 때문에 막히면 그것이 회귀다.
eq('시트 · 종료 계약은 단독 불가 방이어도 통과',
  sheet({ roomStandaloneAllowed: false, incoming: { status: 'CHECKED_OUT', moveIn: '2026-01-01', moveOut: '2026-07-31' } }), null)
// 비거주 점유 방 문구가 먼저다 — 두 설정이 같이 켜진 방(창고)에서 순서가 뒤집히면 안내가 엉킨다.
eq('시트 · 비거주 점유 문구가 먼저',
  sheet({ roomStandaloneAllowed: false, nonResidentOccupied: true })?.startsWith('해당 호실은 거주용이 아닌 방'), true)

// ── 겹침 판정 개정(2026-08-19 운영자 확정) ────────────────────────────
// 층 1 — 당일 회전은 정상. 층 2 — 하루 이상 겹침은 확인(LeaseOverlapAck)을 데이터로 받는다.

const span = (moveIn: string | null, moveOut: string | null) => ({ moveIn, moveOut })

eq('구간 · 포개진 자리를 답한다',
  occupancyOverlapSpan(span('2026-08-01', '2026-08-20'), span('2026-08-15', '2026-08-30')),
  { from: '2026-08-15', to: '2026-08-20' })
eq('구간 · 안 겹치면 null',
  occupancyOverlapSpan(span('2026-08-01', '2026-08-14'), span('2026-08-15', '2026-08-30')), null)
eq('구간 · 무기한 쪽은 열린 채로 남는다',
  occupancyOverlapSpan(span('2026-08-01', null), span('2026-08-15', null)),
  { from: '2026-08-15', to: null })

eq('회전 · 나가는 날 들어오는 하루는 회전이다',
  isSameDayTurnover(span('2026-07-01', '2026-08-15'), span('2026-08-15', '2026-08-30')), true)
eq('회전 · 순서를 바꿔도 같은 답',
  isSameDayTurnover(span('2026-08-15', '2026-08-30'), span('2026-07-01', '2026-08-15')), true)
eq('회전 · 입주일 없는 점유가 나가는 날도 회전이다',
  isSameDayTurnover(span(null, '2026-08-15'), span('2026-08-15', '2026-08-30')), true)
eq('회전 · 하루라도 더 포개지면 회전이 아니다',
  isSameDayTurnover(span('2026-07-01', '2026-08-16'), span('2026-08-15', '2026-08-30')), false)
eq('회전 · 같은 날 함께 시작하는 둘은 회전이 아니다',
  isSameDayTurnover(span('2026-08-15', '2026-08-15'), span('2026-08-15', '2026-08-30')), false)
eq('회전 · 안 겹치면 회전도 아니다',
  isSameDayTurnover(span('2026-07-01', '2026-08-14'), span('2026-08-15', '2026-08-30')), false)

// 가져오기 — 자기가 내보낸 시트를 그대로 다시 올리는 그 경로다.
eq('시트 · 당일 회전은 통과',
  sheet({
    incoming: { status: 'RESERVED', moveIn: '2026-08-15', moveOut: '2026-08-30' },
    others: [{ status: 'CHECKOUT_PENDING', moveIn: '2026-07-01', moveOut: '2026-08-15', tenantName: '앞사람' }],
  }), null)
eq('시트 · 하루 이상 겹침은 계속 차단',
  sheet({
    incoming: { status: 'RESERVED', moveIn: '2026-08-15', moveOut: '2026-08-30' },
    others: [{ status: 'CHECKOUT_PENDING', moveIn: '2026-07-01', moveOut: '2026-08-16', tenantName: '앞사람' }],
  }) !== null, true)

const ack = { frontLeaseTermId: 'A', backLeaseTermId: 'B', overlapFrom: '2026-08-18', overlapTo: '2026-08-19' }
const spanOf = (a: [string | null, string | null], b: [string | null, string | null]) =>
  occupancyOverlapSpan(span(a[0], a[1]), span(b[0], b[1]))

eq('확인 · 구간 안이면 덮인다',
  findOverlapAck([ack], 'A', 'B', spanOf(['2026-07-01', '2026-08-19'], ['2026-08-18', '2026-08-30']))?.overlapTo, '2026-08-19')
eq('확인 · 앞뒤가 바뀌어도 같은 확인이다',
  findOverlapAck([ack], 'B', 'A', spanOf(['2026-07-01', '2026-08-19'], ['2026-08-18', '2026-08-30'])) !== null, true)
eq('확인 · 구간을 하루라도 넘으면 실효(재발화)',
  findOverlapAck([ack], 'A', 'B', spanOf(['2026-07-01', '2026-08-20'], ['2026-08-18', '2026-08-30'])), null)
eq('확인 · 다른 계약 쌍은 안 덮인다',
  findOverlapAck([ack], 'A', 'C', spanOf(['2026-07-01', '2026-08-19'], ['2026-08-18', '2026-08-30'])), null)
eq('확인 · 무기한 겹침은 스냅샷이 없어 안 덮인다',
  findOverlapAck([ack], 'A', 'B', spanOf(['2026-07-01', null], ['2026-08-18', null])), null)

// ── 납부일 전파 축(2026-08-13 운영자 오더) ────────────────────────────
// 부모 계약의 납부일이 바뀌면 딸린 계약도 같은 날로 따라간다. 따라오는 것은 '비었거나 옛 부모 날과
// 같던' 계약뿐이다 — 폼이 '부모와 같음'이라 부르는 그 판정과 같은 한 벌이라야, 화면에서 '따로'로
// 보이던 계약이 저장 한 번에 조용히 끌려가지 않는다.
type FakeLease = { id: string; dueDay: string | null; status: string; parentLeaseTermId: string | null }
function fakeDb(rows: FakeLease[]) {
  const moved: { ids: string[]; dueDay: string | null }[] = []
  const db = {
    leaseTerm: {
      findMany: async ({ where }: { where: { parentLeaseTermId: string; status: { in: string[] } } }) =>
        rows.filter(r => r.parentLeaseTermId === where.parentLeaseTermId && where.status.in.includes(r.status))
            .map(r => ({ id: r.id, dueDay: r.dueDay })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { dueDay: string | null } }) => {
        moved.push({ ids: where.id.in, dueDay: data.dueDay })
        return { count: where.id.in.length }
      },
    },
  }
  return { db: db as unknown as Parameters<typeof propagateDueDayToSubLeases>[0], moved }
}
/** 실제로 옮겨 간 계약 id 목록(정렬). 되돌리기 스냅샷이 그대로 그 목록이어야 한다. */
async function movedIds(rows: FakeLease[], prev: string | null, next: string | null): Promise<string[]> {
  const { db } = fakeDb(rows)
  const snap = await propagateDueDayToSubLeases(db, '509', prev, next)
  return snap.map(s => s.id).sort()
}

eq('같음 정규화 · 30 과 말일은 같은 날', sameDueDay('30', '말일'), true)
eq('같음 정규화 · 빈 값 둘은 같다', sameDueDay(null, ''), true)
eq('같음 정규화 · 7 과 15 는 다르다', sameDueDay('7', '15'), false)

const 자식들: FakeLease[] = [
  { id: '601-빈값',   dueDay: null,   status: 'NON_RESIDENT',    parentLeaseTermId: '509' },
  { id: '602-부모와같음', dueDay: '7',  status: 'ACTIVE',          parentLeaseTermId: '509' },
  { id: '603-따로',   dueDay: '20',   status: 'ACTIVE',          parentLeaseTermId: '509' },
  { id: '604-거주전',  dueDay: null,   status: 'WAITING_TOUR',    parentLeaseTermId: '509' },
  { id: '605-퇴실',   dueDay: '7',    status: 'CHECKED_OUT',     parentLeaseTermId: '509' },
  { id: '701-남의부모', dueDay: '7',   status: 'ACTIVE',          parentLeaseTermId: '401' },
]
// 전파는 DB 를 읽고 쓰므로 async — 이 파일은 DB 없이 도는 검사라 위 가짜 클라이언트로 본다.
async function dueDayPropagationTests() {
  eq('전파 · 비었거나 같던 딸린 계약이 따라온다',
    await movedIds(자식들, '7', '15'), ['601-빈값', '602-부모와같음'])
  eq('전파 · 따로 정한 날은 안 움직인다',
    (await movedIds(자식들, '7', '15')).includes('603-따로'), false)
  eq('전파 · 거주 전 단계에는 납부일을 심지 않는다',
    (await movedIds(자식들, '7', '15')).includes('604-거주전'), false)
  eq('전파 · 끝난 계약의 지난 납부일은 손대지 않는다',
    (await movedIds(자식들, '7', '15')).includes('605-퇴실'), false)
  eq('전파 · 다른 계약에 딸린 것은 남의 일이다',
    (await movedIds(자식들, '7', '15')).includes('701-남의부모'), false)
  eq('전파 · 딸린 계약이 없으면 아무것도 안 한다', await movedIds([], '7', '15'), [])
  eq('전파 · 부모 날이 그대로면 아무것도 안 한다', await movedIds(자식들, '7', '7'), [])
  eq('전파 · 30 을 말일로 고쳐 적는 것은 같은 날이라 무변동', await movedIds(자식들, '30', '말일'), [])
  eq('전파 · 빈 부모가 날을 갖는 것도 변경이다(입실 처리)',
    await movedIds(자식들, null, '13'), ['601-빈값'])
  // 되돌리기 — 스냅샷은 '옮기기 전 값'이어야 한다. 원값이 아니라 새 값을 담으면 적용취소가 헛돈다.
  {
    const { db } = fakeDb(자식들)
    const snap = await propagateDueDayToSubLeases(db, '509', '7', '15')
    eq('전파 · 되돌리기 스냅샷은 옮기기 전 값',
      snap.slice().sort((a, b) => a.id.localeCompare(b.id)),
      [{ id: '601-빈값', prevDueDay: null }, { id: '602-부모와같음', prevDueDay: '7' }])
  }
}

// ── 입주일 전파 축(2026-08-13 운영자 승인, 신고 eb66b990) ──────────────
// 납부일과 같은 문법이되 명단이 다르다. 입주일은 거주 전 단계에서도 '입주 희망일'이라는 이름으로
// 멀쩡히 쓰이는 값이라, 빼는 것은 죽은 자식(퇴실 완료·입실 취소) 둘뿐이다.
// 여기서 함께 잠그는 것이 하나 더 있다 — 입주일은 청구가 시작되는 달을 정한다(lib/billing).
// 전파로 자식의 입주일이 움직이면 그 자식의 첫 청구월도 정확히 같이 움직여야 한다.
type FakeMoveInLease = {
  id: string; moveInDate: Date | null; status: string; roomId: string | null; parentLeaseTermId: string | null
}
type FakeStay = { id: string; leaseTermId: string; roomId: string | null; startDate: Date | null; endDate: Date | null }
const D = (ymd: string | null): Date | null => (ymd ? new Date(`${ymd}T00:00:00.000Z`) : null)

function fakeMoveInDb(rows: FakeMoveInLease[], stays: FakeStay[]) {
  const db = {
    leaseTerm: {
      findMany: async ({ where }: { where: { parentLeaseTermId: string; status: { in: string[] } } }) =>
        rows.filter(r => r.parentLeaseTermId === where.parentLeaseTermId && where.status.in.includes(r.status))
            .map(r => ({ id: r.id, moveInDate: r.moveInDate, roomId: r.roomId, status: r.status })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { moveInDate: Date | null } }) => {
        for (const r of rows) if (where.id.in.includes(r.id)) r.moveInDate = data.moveInDate
        return { count: where.id.in.length }
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null,
    },
    // 거주 구간 이력 — 입주 구간의 startDate 가 입주일을 따라가는지 보는 최소 저장소.
    roomStay: {
      findFirst: async ({ where }: { where: { leaseTermId: string; endDate?: null; id?: { not: string }; startDate?: { lt: Date } } }) => {
        let list = stays.filter(s => s.leaseTermId === where.leaseTermId)
        if (where.endDate === null) list = list.filter(s => s.endDate === null)
        if (where.id?.not) list = list.filter(s => s.id !== where.id!.not)
        if (where.startDate?.lt) list = list.filter(s => s.startDate && s.startDate < where.startDate!.lt)
        return list[0] ?? null
      },
      update: async ({ where, data }: { where: { id: string }; data: { startDate?: Date | null } }) => {
        const s = stays.find(x => x.id === where.id)
        if (s && data.startDate !== undefined) s.startDate = data.startDate
        return s ?? null
      },
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
  }
  return db as unknown as Parameters<typeof propagateMoveInDateToSubLeases>[0]
}

/** 이 사람의 딸린 계약 한 벌 — 테스트마다 새로 만든다(전파가 배열을 실제로 고친다). */
const 입주일자식들 = (): FakeMoveInLease[] => [
  { id: '601-빈값',    moveInDate: null,             status: 'NON_RESIDENT', roomId: null, parentLeaseTermId: '509' },
  { id: '602-부모와같음', moveInDate: D('2026-08-13'), status: 'ACTIVE',       roomId: null, parentLeaseTermId: '509' },
  { id: '603-따로',    moveInDate: D('2026-07-01'),  status: 'ACTIVE',       roomId: null, parentLeaseTermId: '509' },
  { id: '604-예약',    moveInDate: D('2026-08-13'),  status: 'RESERVED',     roomId: null, parentLeaseTermId: '509' },
  { id: '605-퇴실',    moveInDate: D('2026-08-13'),  status: 'CHECKED_OUT',  roomId: null, parentLeaseTermId: '509' },
  { id: '606-입실취소',  moveInDate: D('2026-08-13'), status: 'CANCELLED',    roomId: null, parentLeaseTermId: '509' },
  { id: '701-남의부모',  moveInDate: D('2026-08-13'), status: 'ACTIVE',       roomId: null, parentLeaseTermId: '401' },
]

async function movedInIds(rows: FakeMoveInLease[], prev: string | null, next: string | null): Promise<string[]> {
  const snap = await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, []), '509', D(prev), D(next))
  return snap.map(s => s.id).sort()
}

async function moveInPropagationTests() {
  eq('입주일 정규화 · Date 와 YYYY-MM-DD 는 같은 날', sameMoveInDate(D('2026-08-14'), '2026-08-14'), true)
  eq('입주일 정규화 · 빈 값 둘은 같다', sameMoveInDate(null, ''), true)
  eq('입주일 정규화 · 하루 차이는 다르다', sameMoveInDate('2026-08-14', '2026-08-15'), false)
  eq('입주일 정규화 · 못 읽는 값은 빈 값', moveInYmd('그런날없음'), '')

  eq('입주일 전파 · 비었거나 같던 딸린 계약이 따라온다',
    await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15'),
    ['601-빈값', '602-부모와같음', '604-예약'])
  eq('입주일 전파 · 따로 정한 날은 안 움직인다',
    (await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15')).includes('603-따로'), false)
  // 납부일과 갈리는 지점 — 예약·투어 단계의 입주일은 '입주 희망일'이라 뜻이 있고, 예약 확정은 그것을 필수로 받는다.
  eq('입주일 전파 · 예약 단계 딸린 계약도 따라온다(납부일과 다른 축)',
    (await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15')).includes('604-예약'), true)
  eq('입주일 전파 · 퇴실 완료 자식은 제외',
    (await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15')).includes('605-퇴실'), false)
  eq('입주일 전파 · 입실 취소 자식은 제외',
    (await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15')).includes('606-입실취소'), false)
  eq('입주일 전파 · 다른 계약에 딸린 것은 남의 일이다',
    (await movedInIds(입주일자식들(), '2026-08-13', '2026-08-15')).includes('701-남의부모'), false)
  eq('입주일 전파 · 딸린 계약이 없으면 아무것도 안 한다', await movedInIds([], '2026-08-13', '2026-08-15'), [])
  eq('입주일 전파 · 부모 날이 그대로면 아무것도 안 한다', await movedInIds(입주일자식들(), '2026-08-13', '2026-08-13'), [])
  eq('입주일 전파 · 빈 부모가 날을 갖는 것도 변경이다', await movedInIds(입주일자식들(), null, '2026-08-15'), ['601-빈값'])

  // 되돌리기 — 스냅샷은 '옮기기 전 값'이어야 한다(적용취소가 붙는 경로가 생기면 그대로 쓴다).
  {
    const rows = 입주일자식들()
    const snap = await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, []), '509', D('2026-08-13'), D('2026-08-15'))
    eq('입주일 전파 · 되돌리기 스냅샷은 옮기기 전 값',
      snap.slice().sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ id: s.id, prev: moveInYmd(s.prevMoveInDate) })),
      [{ id: '601-빈값', prev: '' }, { id: '602-부모와같음', prev: '2026-08-13' }, { id: '604-예약', prev: '2026-08-13' }])
  }

  // 거주 구간 이력 — 입주 구간의 시작이 함께 움직여야 감지망 축 ⑦(startDate ≠ moveInDate)이 안 켜진다.
  {
    const rows: FakeMoveInLease[] = [
      { id: '601', moveInDate: D('2026-08-13'), status: 'NON_RESIDENT', roomId: 'r601', parentLeaseTermId: '509' },
    ]
    const stays: FakeStay[] = [
      { id: 's1', leaseTermId: '601', roomId: 'r601', startDate: D('2026-08-13'), endDate: null },
    ]
    await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, stays), '509', D('2026-08-13'), D('2026-08-15'))
    eq('입주일 전파 · 딸린 계약의 입주 구간도 새 날로', moveInYmd(stays[0].startDate), '2026-08-15')
  }
  {
    // 이사 구간(시작이 옛 입주일과 다른 열린 구간)은 건드리지 않는다 — lib/roomStay 의 1차 가드 그대로.
    const rows: FakeMoveInLease[] = [
      { id: '601', moveInDate: D('2026-08-13'), status: 'ACTIVE', roomId: 'r601', parentLeaseTermId: '509' },
    ]
    const stays: FakeStay[] = [
      { id: 's1', leaseTermId: '601', roomId: 'r601', startDate: D('2026-08-20'), endDate: null },
    ]
    await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, stays), '509', D('2026-08-13'), D('2026-08-15'))
    eq('입주일 전파 · 이동 구간의 시작은 입주일을 따라가지 않는다', moveInYmd(stays[0].startDate), '2026-08-20')
  }

  // ── 청구 시작 연동(§4 인접, 역주입) ────────────────────────────────
  // 입주일이 곧 첫 청구월이다(lib/billing monthOfDate · 수납 관리 행 필터 · unpaid 의 leaseStartMonth).
  // 전파로 자식이 움직이면 그 자식의 청구 시작이 정확히 따라가야 한다. 산식은 손대지 않는다.
  {
    const rows = 입주일자식들()
    await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, []), '509', D('2026-08-13'), D('2026-08-15'))
    const 자식 = rows.find(r => r.id === '602-부모와같음')!
    eq('청구 시작 · 8/13 에서 8/15 는 같은 달이라 8월분 청구 그대로', monthOfDate(자식.moveInDate), '2026-08')
    eq('청구 시작 · 그 달이 첫 청구월이다', monthOfDate(자식.moveInDate)! <= '2026-08', true)
  }
  {
    const rows = 입주일자식들()
    await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, []), '509', D('2026-08-13'), D('2026-09-01'))
    const 자식 = rows.find(r => r.id === '602-부모와같음')!
    eq('청구 시작 · 달을 넘겨 옮기면 첫 청구월도 9월로 따라간다', monthOfDate(자식.moveInDate), '2026-09')
    eq('청구 시작 · 8월은 아직 청구 시작 전', monthOfDate(자식.moveInDate)! <= '2026-08', false)
  }
  {
    // 단기 자식은 입주월 한 달만 청구한다(lib/billing 단기 단일 청구). 입주일이 옮겨지면 그 한 달도 옮겨진다.
    const rows: FakeMoveInLease[] = [
      { id: '601', moveInDate: D('2026-08-13'), status: 'ACTIVE', roomId: null, parentLeaseTermId: '509' },
    ]
    const 단기 = (moveIn: Date | null) => ({ rentAmount: 300000, status: 'ACTIVE', isShortTerm: true, moveInDate: moveIn })
    eq('청구 시작 · 옮기기 전 단기 자식은 8월분 청구', billForLeaseMonth(단기(rows[0].moveInDate), '2026-08', null), 300000)
    await propagateMoveInDateToSubLeases(fakeMoveInDb(rows, []), '509', D('2026-08-13'), D('2026-09-01'))
    eq('청구 시작 · 옮긴 뒤 단기 자식의 8월분은 0', billForLeaseMonth(단기(rows[0].moveInDate), '2026-08', null), 0)
    eq('청구 시작 · 옮긴 뒤 단기 자식의 9월분이 청구', billForLeaseMonth(단기(rows[0].moveInDate), '2026-09', null), 300000)
  }
}

void dueDayPropagationTests()
  .then(moveInPropagationTests)
  .then(() => {
    console.log(`\n계약 종속 가드 회귀: ${pass} 통과 / ${fail} 실패`)
    if (fail > 0) process.exit(1)
  })
