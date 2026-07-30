// 거주 전(pending) 상태 lease 의 오염된 납부일(dueDay) 비우기 — 등록 폼 자동 파생 잔존이 저장된 건 정리(운영자 지적 2026-07-30).
// 근본수정(서버가 pending 저장 시 dueDay 비움)과 세트. 입실 처리 때 입주일 기준으로 재파생되므로 정보 손실 없음.
// 드라이런 기본, 적용은 --apply. 멱등(대상 없으면 0건).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

const DUE_PENDING_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED']

async function main() {
  const targets = await prisma.leaseTerm.findMany({
    where: { status: { in: DUE_PENDING_STATUSES }, dueDay: { not: null } },
    select: { id: true, status: true, dueDay: true, moveInDate: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  for (const l of targets) {
    console.log(`대상: ${l.tenant.name} [${l.status}] 납부일 '${l.dueDay}' → 비움 (입주 희망 ${l.moveInDate ? l.moveInDate.toISOString().slice(0, 10) : '미정'})`)
  }
  if (APPLY && targets.length > 0) {
    await prisma.leaseTerm.updateMany({ where: { id: { in: targets.map(l => l.id) } }, data: { dueDay: null } })
  }
  console.log(`거주 전 상태의 납부일 오염 ${targets.length}건 ${APPLY ? '비움' : '(드라이런 — 적용은 --apply)'}`)
  await prisma.$disconnect()
}
main()
