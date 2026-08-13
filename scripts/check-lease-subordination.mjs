// 계약 종속 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 축 ① 딸려 있는데 부모가 없거나 죽은 계약.
//
// 왜 이게 사고인가 — 딸린 계약의 계약서는 부모 한 장이다(합본). 부모가 사라지거나 끝나면
// 그 계약은 **종이가 어디에도 없는 계약**이 된다. 발급은 막혀 있고(부모로만 발급), 부모는
// 발급될 수 없으니 601호 창고는 돈을 받는데 근거 문서가 영영 안 생긴다.
// 부모 삭제는 FK 가 SET NULL 로 받아 계약 자체는 살려 두는데, 그 순간이 정확히 이 상태다.
// 남의 계약을 부모로 가진 것과 2단 종속(부모가 또 딸려 있음)도 같은 축에서 본다 — 저장
// 경로의 가드가 막는 것들이라, 여기서 발견되면 가드를 우회한 길이 어딘가 있다는 뜻이다.
//
// 축 ② 단독 계약이 불가한 방에 부모 없이 남아 있는 살아 있는 계약.
//
// 왜 이게 사고인가 — 방 설정을 '단독 불가'로 켠 시점에 그 방에 이미 계약이 있으면 그 계약은
// 부모 없이 남는다. 저장 가드는 새로 들어오는 것만 보고(이미 확정된 건을 재저장조차 못 하게
// 막으면 그게 회귀다) 이미 있는 것은 안 본다. 그 빈자리를 세는 것이 이 축의 일이다.
// 이 상태의 계약은 합본에 실리지 않아 601호가 계약서에서 통째로 빠진 채 발급된다.
//
// 기준선 0/0. 종속 계약이 생기기 전에는 두 축 모두 후보 자체가 없다.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

/** 부모가 될 수 있는 상태 — lib/roomAssignment 의 PARENT_LEASE_STATUSES 와 같은 명단이다. */
const PARENT_OK = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT']
/** 살아 있는 계약 — 끝난 계약(퇴실 완료·입실 취소)은 방도 종이도 필요 없다. */
const ALIVE = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'WAITING_TOUR', 'TOUR_DONE']

/**
 * 축 ① 판정 — 이 종속이 깨져 있는가. 성하면 null, 깨졌으면 사유.
 * @param l  { id, tenantId, parentLeaseTermId, parent: { tenantId, status, parentLeaseTermId } | null }
 */
function brokenSubordination(l) {
  if (!l.parentLeaseTermId) return null
  if (!l.parent) return '부모 계약이 없다(삭제됐거나 연결이 끊겼다)'
  if (l.parent.tenantId !== l.tenantId) return '부모가 다른 고객의 계약이다'
  if (!PARENT_OK.includes(l.parent.status)) return `부모가 끝난 계약이다(${l.parent.status})`
  if (l.parent.parentLeaseTermId) return '부모가 또 다른 계약에 딸려 있다(2단 종속)'
  if (l.parentLeaseTermId === l.id) return '자기 자신을 부모로 가리킨다'
  return null
}

/** 축 ② 판정 — 단독 계약 불가 방에 부모 없이 있는 살아 있는 계약인가. */
function orphanInNoStandaloneRoom(l) {
  if (l.parentLeaseTermId) return null
  if (!l.room || l.room.standaloneLeaseAllowed) return null
  if (!ALIVE.includes(l.status)) return null
  return `${l.room.roomNo}호는 단독 계약이 불가한 방인데 딸릴 계약이 없다`
}

// ── 자가 역주입 ── 그물이 실제로 발화하는가. 실데이터가 0건이라 이 확인이 없으면
// "위반 0건"이 빈 그물의 침묵인지 건강함인지 구분되지 않는다.
const 역주입 = [
  ['축① 부모 부재', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: 'p', parent: null })],
  ['축① 남의 계약', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: 'p', parent: { tenantId: 'u', status: 'ACTIVE', parentLeaseTermId: null } })],
  ['축① 죽은 부모', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: 'p', parent: { tenantId: 't', status: 'CHECKED_OUT', parentLeaseTermId: null } })],
  ['축① 2단 종속', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: 'p', parent: { tenantId: 't', status: 'ACTIVE', parentLeaseTermId: 'g' } })],
  ['축② 단독 불가 방 고아', orphanInNoStandaloneRoom({ parentLeaseTermId: null, status: 'NON_RESIDENT', room: { roomNo: '601', standaloneLeaseAllowed: false } })],
]
const 미발화 = 역주입.filter(([, r]) => r === null).map(([n]) => n)
// 성한 값에는 침묵해야 한다 — 무조건 발화하는 그물은 발화하지 않는 그물과 똑같이 쓸모없다.
const 오탐 = [
  ['정상 종속', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: 'p', parent: { tenantId: 't', status: 'ACTIVE', parentLeaseTermId: null } })],
  ['단독 계약', brokenSubordination({ id: 'a', tenantId: 't', parentLeaseTermId: null, parent: null })],
  ['단독 가능 방', orphanInNoStandaloneRoom({ parentLeaseTermId: null, status: 'ACTIVE', room: { roomNo: '509', standaloneLeaseAllowed: true } })],
  ['끝난 계약은 안 본다', orphanInNoStandaloneRoom({ parentLeaseTermId: null, status: 'CHECKED_OUT', room: { roomNo: '601', standaloneLeaseAllowed: false } })],
].filter(([, r]) => r !== null).map(([n]) => n)

const leases = await prisma.leaseTerm.findMany({
  select: {
    id: true, tenantId: true, status: true, parentLeaseTermId: true,
    tenant: { select: { name: true } },
    room: { select: { roomNo: true, standaloneLeaseAllowed: true } },
    parentLeaseTerm: { select: { tenantId: true, status: true, parentLeaseTermId: true } },
  },
})

const violations = []
for (const l of leases) {
  const row = { ...l, parent: l.parentLeaseTerm }
  const a = brokenSubordination(row)
  if (a) violations.push(`축① ${l.tenant.name} ${l.room?.roomNo ?? '호실 미지정'} — ${a}`)
  const b = orphanInNoStandaloneRoom(row)
  if (b) violations.push(`축② ${l.tenant.name} — ${b}`)
}

const subCount = leases.filter(l => l.parentLeaseTermId).length
const noStandalone = leases.filter(l => l.room && !l.room.standaloneLeaseAllowed).length
console.log(`[계약 종속] 계약 ${leases.length}건 · 종속 ${subCount}건 · 단독 불가 방 계약 ${noStandalone}건`
  + ` / 위반 ${violations.length}건 (기준선 0)`)
console.log(`  역주입 ${역주입.length - 미발화.length}/${역주입.length} 발화 · 오탐 ${오탐.length}건`)
for (const v of violations) console.error(`  ${v}`)
if (미발화.length) console.error(`  역주입 미발화: ${미발화.join(', ')}`)
if (오탐.length) console.error(`  오탐: ${오탐.join(', ')}`)

await prisma.$disconnect()
if (violations.length || 미발화.length || 오탐.length) process.exit(1)
