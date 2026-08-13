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

console.log(`\n계약 종속 가드 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
