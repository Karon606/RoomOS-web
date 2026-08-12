// 주 계약 선택 회귀 테스트 — 실행: npx tsx scripts/test-lease-primary.ts
// 방 축(primaryRoomLease: 이 방을 대표하는 계약)과 사람 축(primaryTenantLease: 이 사람을
// 대표하는 계약)은 같은 한 규칙의 두 얼굴이다. 둘이 갈라지면 같은 계약을 호실 화면과 고객
// 화면이 다르게 고르고, '수납 첫 행 = 주 계약' 같은 상호 검증이 무너진다.
// 여기서 고정하는 것: 위계(거주 > 예약 > 첫 계약), 예약 동률(입주 예정일 이른 쪽), 전치 항등.

import { primaryRoomLease, primaryTenantLease, roomLeaseRowOrder } from '../lib/leaseStatus'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

type L = { id: string; status: string; moveInDate: string | null }
const l = (id: string, status: string, moveInDate: string | null = null): L => ({ id, status, moveInDate })

// ── 위계 ── 거주(ACTIVE·CHECKOUT_PENDING) > 예약 > 배열 첫 계약.
const cases: { name: string; leases: L[]; expect: string | undefined }[] = [
  { name: '빈 집합은 없음', leases: [], expect: undefined },
  { name: '거주 하나', leases: [l('a', 'ACTIVE', '2026-08-01')], expect: 'a' },
  { name: '거주가 예약을 이긴다', leases: [l('r', 'RESERVED', '2026-08-01'), l('a', 'ACTIVE', '2026-09-01')], expect: 'a' },
  { name: '퇴실 예정도 거주다', leases: [l('r', 'RESERVED', '2026-08-01'), l('c', 'CHECKOUT_PENDING', null)], expect: 'c' },
  { name: '거주 둘이면 배열 순서', leases: [l('a1', 'ACTIVE', '2026-09-01'), l('a2', 'ACTIVE', '2026-08-01')], expect: 'a1' },
  { name: '예약 동률은 입주 예정일 이른 쪽', leases: [l('r2', 'RESERVED', '2026-09-01'), l('r1', 'RESERVED', '2026-08-15')], expect: 'r1' },
  { name: '입주 예정일 미정 예약은 뒤로', leases: [l('rx', 'RESERVED', null), l('r1', 'RESERVED', '2026-08-15')], expect: 'r1' },
  { name: '거주·예약이 없으면 첫 계약', leases: [l('n', 'NON_RESIDENT', null), l('t', 'TOUR_DONE', null)], expect: 'n' },
  // 1인 다호실 — 509호 거주 + 601호 창고(비거주). 메인은 사는 방이다.
  { name: '다호실: 거주 + 비거주면 거주가 메인', leases: [l('storage', 'NON_RESIDENT', '2026-08-13'), l('home', 'ACTIVE', '2026-05-01')], expect: 'home' },
  { name: '다호실: 비거주만 있으면 그것이 메인', leases: [l('storage', 'NON_RESIDENT', '2026-08-13')], expect: 'storage' },
  { name: '다호실: 예약 + 비거주면 예약이 메인', leases: [l('storage', 'NON_RESIDENT', null), l('r', 'RESERVED', '2026-09-01')], expect: 'r' },
]

for (const c of cases) {
  eq(`방 축 · ${c.name}`, primaryRoomLease(c.leases)?.id, c.expect)
  // ── 전치 항등 ── 같은 집합이면 두 축이 반드시 같은 계약을 고른다.
  eq(`전치 항등 · ${c.name}`, primaryTenantLease(c.leases)?.id, primaryRoomLease(c.leases)?.id)
}

// ── 수납 행 순서와의 정합 ── '첫 행 = 주 계약'(roomLeaseRowOrder 주석의 약속).
//
// 약속이 성립하는 범위를 여기서 명시한다. 거주 계약이 둘 이상인 집합에서는 두 규칙이 갈린다 —
// 행 순서는 거주층 안을 입주 예정일로 정렬하고, 주 계약은 배열에서 처음 만나는 거주 계약을
// 고른다. 그런데 한 방에 거주 계약이 둘인 상태는 감지망 축 ②(이중 점유)가 사고라고 부르는
// 상태이고, 한 사람에게 거주 계약이 둘인 상태도 축 ①이 사고라고 부른다. 즉 갈리는 구간은
// 애초에 존재해서는 안 되는 구간이다. 정상 범위에서 약속이 참임을 잠근다.
for (const c of cases) {
  if (c.leases.length === 0) continue
  const ordered = roomLeaseRowOrder(c.leases)
  // 행 순서는 거주·예약·비거주만 세운다 — 그 셋이 하나도 없는 집합은 대상 밖이다.
  if (ordered.length === 0) continue
  if (c.leases.filter(x => ['ACTIVE', 'CHECKOUT_PENDING'].includes(x.status)).length > 1) continue
  eq(`첫 행 = 주 계약 · ${c.name}`, ordered[0].id, primaryRoomLease(c.leases)?.id)
}

// 원본 배열 불변 — 정렬이 호출부의 배열을 뒤집으면 같은 데이터가 두 번째 호출에서 달라진다.
const original = [l('r2', 'RESERVED', '2026-09-01'), l('r1', 'RESERVED', '2026-08-15')]
primaryTenantLease(original)
eq('원본 배열 불변', original.map(x => x.id), ['r2', 'r1'])

console.log(`\n주 계약 선택 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
