// RoomStay(거주 구간 이력) 백필 — 기존 lease 당 1구간(roomId, 입주일~퇴실일/현재) 편입. B단계 ①(아키텍트 설계 2026-07-28).
// 과거에 덮어써 사라진 이사 이력은 복구 불가 — 현 lease 의 단일 구간만 기록하고 도입 시점부터 축적한다.
// 멱등: 이미 RoomStay 가 있는 lease 는 스킵. 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

// 열린 구간(현재 거주 중)으로 볼 상태 — 종료 상태(CHECKED_OUT·CANCELLED)만 endDate 를 닫는다
const OPEN_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED']

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { roomId: { not: null } },
    select: {
      id: true, status: true, moveInDate: true, moveOutDate: true, roomId: true, propertyId: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      roomStays: { select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  })

  let created = 0, skipped = 0
  for (const l of leases) {
    if (l.roomStays.length > 0) { skipped++; continue }   // 이미 편입됨(멱등)
    const open = OPEN_STATUSES.includes(l.status)
    const endDate = open ? null : (l.moveOutDate ?? null)
    console.log(`${l.room.roomNo}호 ${l.tenant.name} [${l.status}] ${l.moveInDate ? l.moveInDate.toISOString().slice(0, 10) : '입주일 미상'} ~ ${endDate ? endDate.toISOString().slice(0, 10) : (open ? '현재' : '종료일 미상')}`)
    created++
    if (!APPLY) continue
    await prisma.roomStay.create({
      data: {
        leaseTermId: l.id, roomId: l.roomId, propertyId: l.propertyId,
        startDate: l.moveInDate, endDate,
      },
    })
  }
  console.log(`대상 ${created}건 생성 · ${skipped}건 스킵(기존) ${APPLY ? '(적용됨)' : '(드라이런 — 적용은 --apply)'}`)
  await prisma.$disconnect()
}
main()
