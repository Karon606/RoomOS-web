// 보증금 몰취 수입의 카테고리 개명 백필 — '보증금' -> '보증금 몰취'.
//
// 왜: ExtraIncome 은 수익 계정인데 카테고리가 '보증금' 이면 세무 자료에서 보증금을 '받은' 기록
// (예수보증금 = 부채)으로 읽힌다(회계 패널 2026-08-01, 운영자 질의 후). 코드는 이미 새 이름을 쓰므로
// 과거 데이터만 옮기면 화면·집계가 한 이름으로 모인다.
//
// 안전장치
//  · 이 경로가 만든 것만 옮긴다 — payMethod '보유 보증금' + leaseTermId 있음. 운영자가 손으로 넣은
//    '보증금' 수입이 있다면 건드리지 않는다(현재 그런 건은 0건이나 조건으로 못 박는다).
//  · 기본은 미리보기. 실제 반영은 --apply.
//  · 되돌리기는 --revert (같은 조건으로 새 이름 -> 옛 이름).
//
// 실행: node --env-file=.env.local scripts/backfill-forfeit-category.mjs [--apply|--revert]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const OLD = '보증금'
const NEW = '보증금 몰취'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')
const from = revert ? NEW : OLD
const to = revert ? OLD : NEW

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const where = { category: from, payMethod: '보유 보증금', leaseTermId: { not: null } }
const rows = await prisma.extraIncome.findMany({
  where, select: { id: true, date: true, amount: true, detail: true, propertyId: true },
  orderBy: { date: 'desc' },
})

console.log(`\n[보증금 몰취 카테고리 백필] '${from}' -> '${to}' · 대상 ${rows.length}건${apply || revert ? '' : ' (미리보기)'}`)
for (const r of rows) {
  console.log(`  ${r.date.toISOString().slice(0, 10)}  ${r.amount.toLocaleString().padStart(9)}원  ${r.detail ?? ''}`)
}

// 손으로 넣은 동명 카테고리가 있으면 알린다 — 옮기지 않고 보고만 한다
const manual = await prisma.extraIncome.count({
  where: { category: from, OR: [{ payMethod: { not: '보유 보증금' } }, { leaseTermId: null }] },
})
if (manual > 0) console.log(`  건드리지 않는 수동 입력 '${from}' 수입: ${manual}건`)

if (!apply && !revert) {
  console.log('\n  실제 반영: --apply · 되돌리기: --revert')
  await prisma.$disconnect()
  process.exit(0)
}

let moved = 0
for (const r of rows) {
  await prisma.extraIncome.update({ where: { id: r.id }, data: { category: to } })
  moved++
}

// 영업장 수입 카테고리 목록도 함께 — 드롭다운에 옛 이름이 남으면 다시 갈린다
const props = await prisma.property.findMany({ select: { id: true, name: true, incomeCategories: true } })
for (const p of props) {
  const cats = (p.incomeCategories ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!cats.includes(from)) continue
  const next = cats.map(c => (c === from ? to : c))
  const dedup = [...new Set(next)]
  await prisma.property.update({ where: { id: p.id }, data: { incomeCategories: dedup.join(',') } })
  console.log(`  카테고리 목록 갱신: ${p.name} -> ${dedup.join(',')}`)
}

console.log(`\n  완료 — 수입 ${moved}건 이동`)
await prisma.$disconnect()
