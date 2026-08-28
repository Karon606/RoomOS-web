// 라면 지출의 브랜드·제품명 채움 + 단위를 '봉'으로 통일 — 기본 예행, --apply 로 적용.
//
// 운영자 확정 2026-08-28. 추정은 하나도 없다 — 아래 표는 운영자가 날짜별로 직접 알려준 것이다.
//   · 4/7, 4/13 과 7/20 이후: 오뚜기 '진라면 매운맛'
//   · 5/1, 5/11, 5/31, 6/25:  삼양 '삼양라면 깔끔한 감칠맛'
//
// 단위는 '총 봉수' 한 모양으로 접는다(운영자 확정 — "7월20일은 100봉만 있어도 사실 돼").
// 4~6월은 `N박스 × M개` 라 총 봉수 = N×M 이고, 7월 이후는 `N개 × 120g` 이라 총 봉수 = N 이다.
// **재고 총량은 안 바뀐다.** sumPurchases 는 규격 단위가 품목 단위와 같을 때만 곱하고
// (4~6월: '개'='개' 라 곱함) 차원이 다르면 수량만 쓰는데(7월 이후: 'g' vs '개'), 접은 뒤에는
// 규격이 비어 어느 쪽이든 수량만 쓴다. 실측으로 845봉 그대로임을 확인했다.
//
// 품목 카드의 규격 단위도 '개'에서 '봉'으로 함께 바꾼다. 안 바꾸면 카드와 지출이 어긋난다.
// changeTrackedItemUnit 정본은 비물리 단위 변환을 거부하므로(부피·무게·길이만) 여기서 직접 쓴다.
// 배율이 1이라 점검 이력을 손댈 필요가 없다 — scaleStockValues 를 부르지 않는 이유다.
//
// 실행: npx tsx --env-file=.env.local scripts/backfill-ramen-brand-unit.ts [--apply]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

const BRAND: Record<string, { brand: string; productName: string }> = {
  '2026-04-07': { brand: '오뚜기', productName: '진라면 매운맛' },
  '2026-04-13': { brand: '오뚜기', productName: '진라면 매운맛' },
  '2026-05-01': { brand: '삼양', productName: '삼양라면 깔끔한 감칠맛' },
  '2026-05-11': { brand: '삼양', productName: '삼양라면 깔끔한 감칠맛' },
  '2026-05-31': { brand: '삼양', productName: '삼양라면 깔끔한 감칠맛' },
  '2026-06-25': { brand: '삼양', productName: '삼양라면 깔끔한 감칠맛' },
  '2026-07-20': { brand: '오뚜기', productName: '진라면 매운맛' },
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const rows = await prisma.expense.findMany({
    where: { itemLabel: '라면', category: '부식비' },
    select: { id: true, date: true, brand: true, productName: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, detail: true, amount: true },
    orderBy: { date: 'asc' },
  })

  let changed = 0
  console.log(`${APPLY ? '적용' : '예행'} — 라면 지출 ${rows.length}건\n`)
  for (const r of rows) {
    const d = r.date.toISOString().slice(0, 10)
    // 총 봉수 — 규격이 '개'(낱개)면 수량과 곱하고, 그 밖(g 등)이면 수량이 이미 낱개 수다.
    const bong = r.specUnit === '개' && r.specValue ? (r.qtyValue ?? 0) * r.specValue : (r.qtyValue ?? 0)
    const b = BRAND[d]
    const patch: Record<string, unknown> = {}
    if (b && !r.brand) patch.brand = b.brand
    if (b && !r.productName) patch.productName = b.productName
    if (r.qtyValue !== bong) patch.qtyValue = bong
    if (r.qtyUnit !== '봉') patch.qtyUnit = '봉'
    if (r.specValue !== null) patch.specValue = null
    if (r.specUnit !== null) patch.specUnit = null
    // 상세 문구도 새 표기로 — 화면이 옛 단위를 그대로 읽어 주면 고친 뜻이 안 산다.
    const nextDetail = `[라면] ${(b?.productName ?? r.productName) ?? '라면'} x ${bong}봉`
    if (r.detail !== nextDetail) patch.detail = nextDetail

    if (Object.keys(patch).length === 0) { console.log(`  ${d}  변경 없음`); continue }
    changed++
    console.log(`  ${d}  ${r.qtyValue}${r.qtyUnit ?? ''} x ${r.specValue ?? '-'}${r.specUnit ?? ''}  ->  ${bong}봉`
      + `${patch.brand ? `  브랜드 ${patch.brand} · ${patch.productName}` : (r.brand ? `  (브랜드 이미 ${r.brand})` : '')}`)
    if (APPLY) await prisma.expense.update({ where: { id: r.id }, data: patch })
  }

  const item = await prisma.trackedItem.findFirst({ where: { label: '라면', category: '부식비' }, select: { id: true, specUnit: true } })
  if (item && item.specUnit !== '봉') {
    console.log(`\n  품목 카드 규격 단위  ${item.specUnit}  ->  봉`)
    if (APPLY) await prisma.trackedItem.update({ where: { id: item.id }, data: { specUnit: '봉' } })
  }

  console.log(`\n${APPLY ? '적용' : '예행'} 완료 — 바뀔 지출 ${changed}건`)
  if (!APPLY) console.log('실제로 고치려면 --apply 를 붙여 다시 실행한다.')
  await prisma.$disconnect()
}
void main()
