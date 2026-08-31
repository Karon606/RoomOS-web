// 손으로 적은 LH 퇴실 사유를 목록값 'LH선정'으로 옮긴다 (2026-08-31 운영자 지시).
//
// 목록에 'LH당첨'이 있었는데도 두 건 다 '기타'에 손으로 적혀 있었다. 조선영 님은 '기타 · LH당첨',
// 박순자 님은 '기타 · LH청약 당첨'이다. 운영자가 목록을 안 쓰고 직접 적은 것이라, 통계로 묶으면
// 둘 다 '기타'로 세어진다.
//
// 목록 라벨을 'LH선정'으로 고치면서 이 두 건도 그 값으로 맞춘다. 사유는 자유 문자열이라
// 마이그레이션이 아니라 값 정정이다.
//
// 예행: node --env-file=.env.local scripts/fix-lh-checkout-reason.mjs
// 적용: node --env-file=.env.local scripts/fix-lh-checkout-reason.mjs --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const TARGET = 'LH선정'

const rows = await prisma.tenantStatusLog.findMany({
  where: { reason: { contains: 'LH' } },
  select: { id: true, reason: true, changedAt: true, tenant: { select: { name: true } } },
})

const todo = rows.filter(r => r.reason !== TARGET)
console.log(`LH 사유 ${rows.length}건 · 고칠 것 ${todo.length}건`)
for (const r of todo) {
  console.log(`  ${r.tenant?.name ?? '?'} · ${r.changedAt.toISOString().slice(0, 10)} · '${r.reason}' → '${TARGET}'`)
}

if (!apply) { console.log('\n예행 — 적용하려면 --apply'); await prisma.$disconnect(); process.exit(0) }
if (todo.length === 0) { console.log('\n고칠 것이 없다.'); await prisma.$disconnect(); process.exit(0) }

await prisma.tenantStatusLog.updateMany({
  where: { id: { in: todo.map(r => r.id) } },
  data: { reason: TARGET },
})
console.log('\n적용함.')
await prisma.$disconnect()
