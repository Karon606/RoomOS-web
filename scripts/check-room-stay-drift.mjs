// RoomStay(거주 구간 이력) 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
// 진실은 LeaseTerm.roomId 이고 RoomStay 는 파생 이력이라, 둘이 어긋나면 기록 지점이 빠진 것이다.
// 정방향 3종: ① 활성 lease 의 roomId 와 열린 구간의 roomId 불일치 ② 한 lease 에 열린 구간 2개 이상
//            ③ 호실 있는 활성 lease 인데 열린 구간이 없음.
// 역방향 3종(자격 위반, 2026-07-28 오더 — 박의균 신고): ④ 비자격 상태 lease 의 열린 구간
//            ⑤ 문의·투어·예약 단계 lease 에 구간 존재 ⑥ 열린 구간의 startDate 가 미래.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// 열린 구간(현재 거주 중)이어야 하는 상태 — lib/roomStay.ts STAY_ELIGIBLE_STATUSES·백필과 같은 정의를 쓴다.
const OPEN_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']
// 점유 전 단계 — 이 상태의 lease 는 구간이 하나라도 있으면 위반(입주한 적 없는 사람).
const PRE_OCCUPANCY_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED']

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { status: { in: OPEN_STATUSES }, roomId: { not: null } },
    select: {
      id: true, status: true, roomId: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      roomStays: {
        where: { endDate: null },
        select: { id: true, roomId: true, startDate: true, room: { select: { roomNo: true } } },
        orderBy: { startDate: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const mismatch = []
  const duplicated = []
  const missing = []
  for (const l of leases) {
    const who = `${l.room?.roomNo ?? '?'}호 ${l.tenant.name} [${l.status}]`
    if (l.roomStays.length === 0) { missing.push(who); continue }
    if (l.roomStays.length > 1) {
      duplicated.push(`${who} — 열린 구간 ${l.roomStays.length}개(${l.roomStays.map(s => `${s.room.roomNo}호 ${s.startDate ? s.startDate.toISOString().slice(0, 10) : '시작일 미상'}`).join(', ')})`)
    }
    const open = l.roomStays[0]
    if (open.roomId !== l.roomId) {
      mismatch.push(`${who} — 계약은 ${l.room?.roomNo ?? '?'}호, 열린 구간은 ${open.room.roomNo}호`)
    }
  }

  // 역방향 — 전체 stay 를 lease 상태와 대조 (자격 없는 구간이 생기면 생성 게이트가 뚫린 것)
  const allStays = await prisma.roomStay.findMany({
    select: {
      id: true, startDate: true, endDate: true,
      room: { select: { roomNo: true } },
      leaseTerm: { select: { status: true, tenant: { select: { name: true } } } },
    },
  })
  const todayYmd = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)   // KST
  const openIneligible = []
  const preOccupancy = []
  const futureStart = []
  for (const s of allStays) {
    const who = `${s.room.roomNo}호 ${s.leaseTerm?.tenant?.name ?? '?'} [${s.leaseTerm?.status ?? '?'}]`
    if (s.endDate === null && s.leaseTerm && !OPEN_STATUSES.includes(s.leaseTerm.status)) openIneligible.push(who)
    if (s.leaseTerm && PRE_OCCUPANCY_STATUSES.includes(s.leaseTerm.status)) preOccupancy.push(who)
    if (s.endDate === null && s.startDate && s.startDate.toISOString().slice(0, 10) > todayYmd) futureStart.push(`${who} — 시작 ${s.startDate.toISOString().slice(0, 10)}`)
  }

  const report = (title, rows) => {
    console.log(`\n[${title}] ${rows.length}건`)
    for (const r of rows) console.log(`  - ${r}`)
  }
  report('호실 불일치', mismatch)
  report('열린 구간 중복', duplicated)
  report('열린 구간 없음', missing)
  report('비자격 상태의 열린 구간', openIneligible)
  report('점유 전 단계 lease 의 구간', preOccupancy)
  report('미래 시작 열린 구간', futureStart)

  const total = mismatch.length + duplicated.length + missing.length
    + openIneligible.length + preOccupancy.length + futureStart.length
  console.log(`\n활성 계약 ${leases.length}건 · 전체 구간 ${allStays.length}건 검사 · 드리프트 ${total}건`)
  await prisma.$disconnect()
  if (total > 0) process.exit(1)
}
main()
