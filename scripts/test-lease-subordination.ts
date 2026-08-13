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
  STANDALONE_LEASE_ERROR, STANDALONE_LEASE_IMPORT_ERROR,
} from '../lib/roomAssignment'
import { propagateDueDayToSubLeases, sameDueDay } from '../lib/dueDay'

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
  sheet({ roomStandaloneAllowed: false, nonResidentOccupied: true })?.startsWith('해당 호실은 세를 놓지 않는 방'), true)

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

void dueDayPropagationTests().then(() => {
  console.log(`\n계약 종속 가드 회귀: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
})
