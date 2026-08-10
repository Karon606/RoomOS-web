// 'CHECKED_OUT인데 moveOutDate 없음' 전수 백필 — 생성 경로 근본 수정(updateTenant·applyStatusTransition
// 서버 보정)과 세트로 1회 실행하는 마이그레이션(운영자 지적 2026-07-20, 데이터 땜빵 금지 원칙).
// 근거 우선순위: expectedMoveOut → 마지막 CHECKED_OUT 전환 상태 로그 시각. 둘 다 없으면 건너뛰고 보고만.
// 원복: 아래 로그로 출력되는 lease id들의 moveOutDate를 null로 되돌리면 됨.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })
const targets = await p.leaseTerm.findMany({
  where: { status: 'CHECKED_OUT', moveOutDate: null },
  select: { id: true, expectedMoveOut: true, tenant: { select: { name: true } },
    statusLogs: { where: { deletedAt: null, toStatus: 'CHECKED_OUT' }, orderBy: { changedAt: 'desc' }, take: 1, select: { changedAt: true } } },
})
console.log('대상:', targets.length, '건')
for (const l of targets) {
  const basis = l.expectedMoveOut ?? l.statusLogs[0]?.changedAt ?? null
  if (!basis) { console.log('스킵(근거 없음):', l.id, l.tenant.name); continue }
  const ymd = basis.toISOString().slice(0, 10)
  await p.leaseTerm.update({ where: { id: l.id }, data: { moveOutDate: new Date(ymd) } })
  console.log('백필:', l.tenant.name, '->', ymd, l.expectedMoveOut ? '(예정일 근거)' : '(상태 로그 근거)')
}
const remain = await p.leaseTerm.count({ where: { status: 'CHECKED_OUT', moveOutDate: null } })
console.log('잔여(근거 없음):', remain, '건')
await p.$disconnect()
