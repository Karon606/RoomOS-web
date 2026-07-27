// RoomStay(거주 구간 이력) 백필 — 기존 lease 당 1구간(roomId, 입주일~퇴실일/현재) 편입. B단계 ①(아키텍트 설계 2026-07-28).
// 과거에 덮어써 사라진 이사 이력은 복구 불가 — 현 lease 의 단일 구간만 기록하고 도입 시점부터 축적한다.
// 자격 기준(2026-07-28 오더, 박의균 신고): RoomStay 는 "실제 점유" 이력 — 자격 3상태 + CHECKED_OUT(과거 실거주)만.
// RESERVED(미입주)·CANCELLED(비점유 이탈)·문의·투어는 백필 전면 제외.
// 멱등: 이미 RoomStay 가 있는 lease 는 스킵. 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

// 열린 구간(현재 거주 중)으로 볼 상태 — lib/roomStay.ts 의 STAY_ELIGIBLE_STATUSES 와 동일 정의
const OPEN_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { roomId: { not: null }, status: { in: [...OPEN_STATUSES, 'CHECKED_OUT'] } },
    select: {
      id: true, status: true, moveInDate: true, moveOutDate: true, roomId: true, propertyId: true, updatedAt: true,
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
    // 종료(CHECKED_OUT)인데 퇴실일이 없으면 마지막 수정일로 마감 — null endDate("현재" 오독)를 남기지 않는다.
    const endDate = open ? null : (l.moveOutDate ?? l.updatedAt)
    console.log(`${l.room.roomNo}호 ${l.tenant.name} [${l.status}] ${l.moveInDate ? l.moveInDate.toISOString().slice(0, 10) : '입주일 미상'} ~ ${endDate ? endDate.toISOString().slice(0, 10) : '현재'}`)
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
