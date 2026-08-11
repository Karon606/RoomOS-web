// 입주 가능 판정 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 감지 대상 한 가지: 퇴실 예정일이 잡힌 예약이 걸린 방인데, 같은 방의 다른 점유 계약은
// 무기한이라 '입주 가능'에서 빠지는 방.
//
// 왜 이게 사고인가 — 예약자는 "그 방이 며칠에 빈다"를 믿고 날짜를 잡은 사람이다.
// 그런데 실제로 그 방을 비워 줄 사람의 퇴실 예정일이 없으면, 그 약속을 받쳐 주는 사실이
// 화면 어디에도 없다. 호실 관리 '입주 가능'은 이 방을 (옳게) 빼지만, 예약은 그대로 남아
// 조용히 지켜지지 않을 약속이 된다.
//
// 오탐 방지 — 무기한 계약이라도 그 **입주일이 예약 퇴실일보다 뒤**면 정상이다. 예약자가
// 먼저 쓰고 완전히 나간 다음에 무기한 입주가 시작되는 사슬(404호 조성훈 8/15~8/31 뒤
// 박정후 9/1 무기한, 2026-08-11 유령 퇴실일 정정으로 처음 등장)은 아무 약속도 깨지 않는다.
// 위반은 예약 기간이 무기한 점유와 실제로 겹칠 때만이다 — 그 예약은 비워 줄 사람의
// 퇴실 예정일 없이 잡힌 약속이라 조용히 지켜지지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// 방을 잡고 있는 계약 — app/(app)/room-manage/RoomManageClient.tsx OCCUPYING_STATUSES 와 같은 정의.
const OCCUPYING_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING']

async function main() {
  const rooms = await prisma.room.findMany({
    orderBy: { roomNo: 'asc' },
    select: {
      roomNo: true,
      property: { select: { name: true } },
      leaseTerms: {
        where: { status: { in: OCCUPYING_STATUSES } },
        select: { status: true, moveInDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
      },
    },
  })

  const ymd = (d) => d ? new Date(d).toISOString().slice(0, 10) : null
  const violations = []
  for (const r of rooms) {
    const occ = r.leaseTerms
    if (occ.length === 0) continue
    const datedReservations = occ.filter(l => l.status === 'RESERVED' && l.expectedMoveOut)
    if (datedReservations.length === 0) continue
    const indefinite = occ.filter(l => !l.expectedMoveOut)
    if (indefinite.length === 0) continue
    // 예약이 무기한 점유와 겹치는가 — 예약 퇴실일이 무기한 계약의 입주일보다 앞이면 안 겹친다.
    // 무기한 계약에 입주일이 없으면 이미 시작된 점유로 보고 겹침으로 판정한다.
    const clashes = datedReservations.some(res => indefinite.some(ind => {
      const indStart = ymd(ind.moveInDate)
      return !indStart || ymd(res.expectedMoveOut) >= indStart
    }))
    if (!clashes) continue
    violations.push({
      roomNo: r.roomNo,
      property: r.property?.name ?? '?',
      detail: occ.map(l => `${l.status}/${l.tenant?.name ?? '-'}/${ymd(l.expectedMoveOut) ?? '무기한'}`).join(' | '),
    })
  }

  if (violations.length > 0) {
    console.error(`[입주 가능 정합] 위반 ${violations.length}건 — 날짜 잡힌 예약이 무기한 점유 위에 얹혀 있다.`)
    for (const v of violations) console.error(`  ${v.property} ${v.roomNo}호: ${v.detail}`)
    console.error('  조치: 무기한 계약의 퇴실 예정일을 넣거나, 그 예약을 다른 방으로 옮긴다.')
    process.exit(1)
  }
  console.log(`[입주 가능 정합] 방 ${rooms.length}개 검사 / 위반 0건`)
  await prisma.$disconnect()
}

main()
