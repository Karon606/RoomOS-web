// 자격 없는 RoomStay 정리 — 실거주에 도달한 적 없는 lease(문의·투어·예약·미입주 취소)의 구간 삭제(2026-07-28 오더, 박의균 신고).
// 케이스 지목이 아니라 클래스 기준: 현재 상태도, 상태 이력(toStatus)도 점유 상태에 닿은 적 없는 lease 의 stay 전부.
// 드라이런 기본, 적용은 --apply. 멱등(대상 없으면 0건).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

// 점유(실거주) 상태 — 여기 닿은 적 있으면 stay 는 사실 기록이라 보존
const OCCUPANCY_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'CHECKED_OUT']

async function main() {
  const stays = await prisma.roomStay.findMany({
    select: {
      id: true, startDate: true, endDate: true,
      room: { select: { roomNo: true } },
      leaseTerm: {
        select: {
          status: true,
          tenant: { select: { name: true } },
          statusLogs: { select: { toStatus: true } },
        },
      },
    },
  })

  const targets = stays.filter(s => {
    const l = s.leaseTerm
    if (!l) return false
    const everOccupied = OCCUPANCY_STATUSES.includes(l.status) || l.statusLogs.some(g => OCCUPANCY_STATUSES.includes(g.toStatus))
    return !everOccupied
  })

  for (const s of targets) {
    console.log(`삭제 대상: ${s.room.roomNo}호 ${s.leaseTerm.tenant.name} [${s.leaseTerm.status}] ${s.startDate ? s.startDate.toISOString().slice(0, 10) : '?'} ~ ${s.endDate ? s.endDate.toISOString().slice(0, 10) : '(열림)'}`)
  }
  if (APPLY && targets.length > 0) {
    await prisma.roomStay.deleteMany({ where: { id: { in: targets.map(s => s.id) } } })
  }
  console.log(`전체 ${stays.length}건 중 자격 위반 ${targets.length}건 ${APPLY ? '삭제됨' : '(드라이런 — 적용은 --apply)'}`)
  await prisma.$disconnect()
}
main()
