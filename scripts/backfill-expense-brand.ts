// 규격 칸에 섞여 들어간 브랜드·제품명을 제 칸으로 옮긴다 — 운영자 확정 백필.
//   실행: npx tsx --env-file=.env.local scripts/backfill-expense-brand.ts [--apply]
//
// 왜 섞였나. 브랜드·제품명이 갈 자리가 없어서 운영자가 서술 규격(specText)에 통째로 적었다.
// 2026-08-27 에 칸이 생겼고(Expense.brand·productName) 이건 그 이전 기록의 이전이다.
//
// **추정하지 않는다.** 아래 표는 운영자가 한 건씩 확정해 준 것이다(2026-08-27).
//   · 미니냉장고 두 건은 같은 제품을 두 번 산 것 — 둘 다 갈란츠 BC-70-63H, 규격 1도어/70L/실버
//   · DVALA 는 IKEA 제품 — 브랜드는 'IKEA'
//   · TV 겸용 모니터 4건은 전부 같은 모델
// 금액·날짜·품명·카테고리는 한 톨도 안 건드린다. specText 는 브랜드·제품명을 뺀 나머지만 남긴다.
import prisma from '../lib/prisma'

const APPLY = process.argv.includes('--apply')

/** 옮길 규칙 — (품명, 지금 규격) 이 정확히 일치하는 행만 손댄다. */
const RULES: { label: string; specText: string; brand: string; productName: string; nextSpec: string | null }[] = [
  { label: 'TV 겸용 모니터', specText: 'LG IPS사용 100Hz KXM2400FH75 화이트, 60cm',
    brand: 'LG', productName: 'KXM2400FH75', nextSpec: 'IPS / 100Hz / 화이트 / 60cm' },
  { label: '무선 전기 주전자 ', specText: '필립스 3000 시리즈 HD9318/00',
    brand: '필립스', productName: '3000 시리즈 HD9318/00', nextSpec: null },
  { label: '욕실 환풍기', specText: '하츠 마이티 HBF-T301/ 181 x 181 x 90 mm',
    brand: '하츠', productName: '마이티 HBF-T301', nextSpec: '181 x 181 x 90 mm' },
  { label: '미니냉장고', specText: '갈란츠 BC-70-63H',
    brand: '갈란츠', productName: 'BC-70-63H', nextSpec: '1도어 / 70L / 실버' },
  { label: '미니냉장고', specText: '1도어, 실버, BC-70-63H',
    brand: '갈란츠', productName: 'BC-70-63H', nextSpec: '1도어 / 70L / 실버' },
  { label: '매트리스 커버 (방수)', specText: 'DVÅLA 90x200 라이트블루',
    brand: 'IKEA', productName: 'DVÅLA', nextSpec: '90x200 / 라이트블루' },
  { label: '라면', specText: '진라면 매운맛',
    brand: '오뚜기', productName: '진라면 매운맛', nextSpec: null },
]

async function main() {
  let total = 0
  const plan: { ids: string[]; r: typeof RULES[number] }[] = []
  for (const r of RULES) {
    const rows = await prisma.expense.findMany({
      where: { itemLabel: r.label, specText: r.specText },
      select: { id: true, date: true, amount: true, brand: true },
    })
    const targets = rows.filter(x => x.brand == null)   // 이미 옮긴 건 건너뛴다(멱등)
    total += targets.length
    plan.push({ ids: targets.map(x => x.id), r })
    console.log(`\n[${r.label}] ${targets.length}건${rows.length !== targets.length ? ` (이미 옮김 ${rows.length - targets.length}건 제외)` : ''}`)
    console.log(`  규격  ${r.specText}`)
    console.log(`   ->   브랜드 ${r.brand} · 제품명 ${r.productName} · 규격 ${r.nextSpec ?? '(비움)'}`)
    for (const x of targets) console.log(`        ${x.date.toISOString().slice(0, 10)} ${x.amount.toLocaleString()}원`)
  }
  console.log(`\n합계 ${total}건${APPLY ? '' : ' (예행 — 쓰지 않는다)'}`)

  // 규칙이 겨냥한 것 말고 다른 행을 건드리지 않는지 — 규칙마다 (품명·규격) 완전일치라 이론상
  // 안 겹치지만, 겹치면 같은 행이 두 번 갱신되므로 확인한다.
  const all = plan.flatMap(p => p.ids)
  if (new Set(all).size !== all.length) { console.log('\n같은 행이 두 규칙에 걸렸다 — 중단한다.'); process.exit(1) }

  if (!APPLY) { console.log('\n적용하려면 --apply 를 붙인다.'); await prisma.$disconnect(); return }
  for (const { ids, r } of plan) {
    if (ids.length === 0) continue
    await prisma.expense.updateMany({
      where: { id: { in: ids } },
      data: { brand: r.brand, productName: r.productName, specText: r.nextSpec },
    })
  }
  console.log(`\n${total}건 적용 완료.`)
  const left = await prisma.expense.count({ where: { specText: { not: null }, brand: null, itemLabel: { in: RULES.map(r => r.label) } } })
  console.log(`규칙 대상 품명 중 아직 브랜드가 빈 행 ${left}건 (진짜 규격만 남은 것들)`)
  await prisma.$disconnect()
}
main()
