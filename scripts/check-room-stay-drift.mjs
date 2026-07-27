// RoomStay(거주 구간 이력) 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
// 진실은 LeaseTerm.roomId 이고 RoomStay 는 파생 이력이라, 둘이 어긋나면 기록 지점이 빠진 것이다.
// 세 종류: ① 활성 lease 의 roomId 와 열린 구간의 roomId 불일치 ② 한 lease 에 열린 구간 2개 이상
//          ③ 호실 있는 활성 lease 인데 열린 구간이 없음.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// 열린 구간(현재 거주 중)이어야 하는 상태 — 백필 스크립트의 OPEN_STATUSES 와 같은 정의를 쓴다.
const OPEN_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED']

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

  const report = (title, rows) => {
    console.log(`\n[${title}] ${rows.length}건`)
    for (const r of rows) console.log(`  - ${r}`)
  }
  report('호실 불일치', mismatch)
  report('열린 구간 중복', duplicated)
  report('열린 구간 없음', missing)

  const total = mismatch.length + duplicated.length + missing.length
  console.log(`\n활성 계약 ${leases.length}건 검사 · 드리프트 ${total}건`)
  await prisma.$disconnect()
  if (total > 0) process.exit(1)
}
main()
