// 규격 누락 백필 (운영자 확인 2026-08-03) — 수량·낱개 용량이 비어 재고 기여가 0이던 지출.
//
// check-spec-missing 이 잡아 온 2건이다. 값은 운영자만 아는 것이라 스크립트가 추정하지 않는다.
//
// (1) 2026-05-31 코스트코 코리아 상봉점 12,990원 · detail '[세탁조크리너] 530ml x 6팩'
//     운영자 확인 — 530ml 짜리 병 6개를 한 번에 산 것이고, 재고는 지금대로 **개수**로 센다.
//     그래서 530 을 규격 칸에 넣지 않는다. 이 품목의 specUnit 은 'ml' 이 아니라 '개'라
//     (TrackedItem.specUnit='개') 거기 530ml 를 넣으면 check-spec-dims 가 잡는 차원 불일치가
//     새로 하나 생긴다. 530ml 는 detail 문구에 이미 남아 있어 정보가 사라지지 않는다.
//     수량 6개 · 낱개 1개 → specMultiplier(1,'개','개')=1 이라 집계 기여 6개.
//
// (2) 2026-05-07 이마트에브리데이 8,500원 · detail '[A4용지] 500매'
//     낱개 용량 500매는 이미 있고 **몇 팩인지**만 비어 있었다. 운영자 확인 — 1팩.
//     수량 1팩 · 낱개 500매 → 집계 기여 500매.
//
// 두 건 다 품목 설정(TrackedItem)은 건드리지 않는다. 재발 감지는 check-spec-missing 이 맡는다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-spec-backfill.ts            (미리보기)
//       npx tsx --env-file=.env.local scripts/fix-spec-backfill.ts --apply
//       npx tsx --env-file=.env.local scripts/fix-spec-backfill.ts --revert
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type Patch = { qtyValue: number | null; qtyUnit: string | null; specValue: number | null; specUnit: string | null }
type Target = { id: string; name: string; next: Patch; prev: Patch }

// prev 는 손대기 전 실측값이다(2026-08-03). 추정이 아니다.
const TARGETS: Target[] = [
  {
    id: 'fe71f7c2-fcd6-4b0e-a578-549c520d95b6',
    name: '세탁조크리너',
    next: { qtyValue: 6, qtyUnit: '개', specValue: 1, specUnit: '개' },
    prev: { qtyValue: null, qtyUnit: null, specValue: null, specUnit: null },
  },
  {
    id: '2aacbfe9-08d7-4d43-9d5f-12a6b2841a51',
    name: 'A4용지',
    next: { qtyValue: 1, qtyUnit: '팩', specValue: 500, specUnit: '매' },
    prev: { qtyValue: null, qtyUnit: '팩', specValue: 500, specUnit: '매' },
  },
]

const fmt = (p: Patch) => `수량 ${p.qtyValue ?? 'null'}${p.qtyUnit ?? ''} · 낱개 ${p.specValue ?? 'null'}${p.specUnit ?? ''}`

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  let missing = 0

  for (const t of TARGETS) {
    const row = await prisma.expense.findUnique({
      where: { id: t.id },
      select: { date: true, vendor: true, itemLabel: true, detail: true, amount: true,
                qtyValue: true, qtyUnit: true, specValue: true, specUnit: true },
    })
    if (!row) { console.error(`${t.name} 지출을 찾지 못했다 — id 확인 필요`); missing++; continue }

    const target = revert ? t.prev : t.next
    console.log(`\n${row.date.toISOString().slice(0, 10)}  ${row.vendor}  ${row.itemLabel}  ${row.amount?.toLocaleString()}원`)
    console.log(`  내역  ${row.detail}`)
    console.log(`  현재  ${fmt(row as Patch)}`)
    console.log(`  변경  ${fmt(target)}`)

    if (apply || revert) await prisma.expense.update({ where: { id: t.id }, data: target })
  }

  if (missing) process.exitCode = 1
  if (!apply && !revert) console.log('\n미리보기다. 반영하려면 --apply, 되돌리려면 --revert')
  else console.log(revert ? '\n되돌렸다.' : '\n반영했다. npm run verify:data 로 확인할 것.')
  await prisma.$disconnect()
}
void main()
