// 규격 누락 감지 — 물리 단위로 재고를 추적하는 품목인데 지출에 낱개 용량이 없는 건.
//
// 기존 check-spec-dims 는 "규격이 있는데 단위가 품목과 다름"만 본다(specValue > 0 필터).
// 이번 신고(1fd2e22b)의 오염은 규격 자체가 사라진 경우라 그 그물을 통과했다.
// 화면 경고도 차원 불일치만 커버해 침묵했다. 운영자 눈이 유일한 탐지기였다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-spec-missing.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const items = await prisma.trackedItem.findMany({
    where: { trackUnit: 'spec' }, select: { label: true, specUnit: true },
  })
  const specItems = new Map(items.filter(i => i.specUnit).map(i => [i.label, i.specUnit!]))
  const rows = await prisma.expense.findMany({
    // qtyValue: { gt: 0 } 를 뺐다 — **수량 자체가 비어** 재고 기여가 0인 수령분을 통과시켰다.
    // 실측 세탁조크리너 2026-05-31 (detail 은 '530ml x 6팩' 인데 수량·규격 둘 다 null, 12,990원).
    where: { itemLabel: { in: [...specItems.keys()] }, OR: [{ specValue: null }, { qtyValue: null }, { qtyValue: 0 }] },
    orderBy: { date: 'desc' },
    select: { date: true, itemLabel: true, amount: true, qtyValue: true, qtyUnit: true, specText: true, receivedAt: true, vendor: true },
  })
  if (rows.length === 0) { console.log('[규격 누락] 위반 0건'); await prisma.$disconnect(); return }
  console.log(`[규격 누락] ${rows.length}건 — 낱개 용량이 없어 재고가 개수로만 집계됩니다\n`)
  for (const r of rows) {
    console.log(`  ${r.date.toISOString().slice(0, 10)}  ${r.itemLabel}  ${r.qtyValue ?? '수량없음'}${r.qtyUnit ?? ''}  ${r.amount?.toLocaleString() ?? '-'}원  품목단위 ${specItems.get(r.itemLabel!)}  ${r.receivedAt ? '수령완료' : '수령대기'}  ${r.specText ?? ''}`)
  }
  console.log('\n지출 상세에서 낱개 용량을 넣으면 총량이 다시 계산됩니다.')
  await prisma.$disconnect()
  process.exitCode = 1
}
void main()
