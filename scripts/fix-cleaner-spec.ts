// 세탁조크리너 규격 누락 백필 (운영자 확인 2026-08-03) — 수량·낱개 용량이 둘 다 비어 재고 기여가 0이던 건.
//
// 대상: 2026-05-31 코스트코 코리아 상봉점 12,990원, detail '[세탁조크리너] 530ml x 6팩'
// 운영자 확인: 530ml 짜리 병 6개를 한 번에 산 것이고, 재고는 지금대로 **개수**로 센다.
//
// 그래서 530 을 규격 칸에 넣지 않는다. 이 품목의 specUnit 은 'ml' 이 아니라 '개'다
// (TrackedItem.specUnit='개'). 낱개 용량 칸에 530ml 를 넣으면 차원이 어긋나
// check-spec-dims 가 잡는 그 불일치가 새로 하나 생긴다. 530ml 는 detail 문구에 이미 남아 있다.
//
// 수량 6개 · 낱개 1개 → specMultiplier(1,'개','개')=1 이라 집계 기여 6개. 품목 설정은 안 건드린다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-cleaner-spec.ts            (미리보기)
//       npx tsx --env-file=.env.local scripts/fix-cleaner-spec.ts --apply
//       npx tsx --env-file=.env.local scripts/fix-cleaner-spec.ts --revert
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const TARGET_ID = 'fe71f7c2-fcd6-4b0e-a578-549c520d95b6'
const NEXT = { qtyValue: 6, qtyUnit: '개', specValue: 1, specUnit: '개' }
// 되돌릴 값 — 넷 다 null 이던 상태(실측 2026-08-03)
const PREV = { qtyValue: null, qtyUnit: null, specValue: null, specUnit: null }

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')

  const row = await prisma.expense.findUnique({
    where: { id: TARGET_ID },
    select: { date: true, vendor: true, itemLabel: true, detail: true, amount: true,
              qtyValue: true, qtyUnit: true, specValue: true, specUnit: true },
  })
  if (!row) { console.error('대상 지출을 찾지 못했다 — id 확인 필요'); process.exitCode = 1; await prisma.$disconnect(); return }

  console.log(`대상  ${row.date.toISOString().slice(0, 10)}  ${row.vendor}  ${row.itemLabel}  ${row.amount?.toLocaleString()}원`)
  console.log(`내역  ${row.detail}`)
  console.log(`현재  수량 ${row.qtyValue ?? 'null'}${row.qtyUnit ?? ''} · 낱개 ${row.specValue ?? 'null'}${row.specUnit ?? ''}`)

  const next = revert ? PREV : NEXT
  console.log(`변경  수량 ${next.qtyValue ?? 'null'}${next.qtyUnit ?? ''} · 낱개 ${next.specValue ?? 'null'}${next.specUnit ?? ''}`)

  if (!apply && !revert) { console.log('\n미리보기다. 반영하려면 --apply, 되돌리려면 --revert'); await prisma.$disconnect(); return }
  await prisma.expense.update({ where: { id: TARGET_ID }, data: next })
  console.log(revert ? '\n되돌렸다.' : '\n반영했다. npm run verify:data 로 확인할 것.')
  await prisma.$disconnect()
}
void main()
