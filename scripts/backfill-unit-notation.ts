// 같은 뜻인데 표기만 다른 단위를 하나로 접는다 — 기본 예행, --apply 로 적용.
//
// 왜 필요한가. **재고 매칭이 글자 그대로 비교한다**(overview.sumPurchases 의 qtyUnit 조건).
// 품목 카드가 'm' 인데 구매가 'M' 이면 그 구매는 잔량 산식에서 통째로 빠지고 경고도 없다.
// 지금은 그 품목 카드에 단위가 안 박혀 있어 무사하지만, 카드에 단위가 채워지는 순간 터진다
// (실측 2026-08-28 — 'm' 32건과 'M' 13건 공존, 현재 실피해 0건).
//
// **표기가 달라도 뜻이 다르면 접지 않는다.** 실물을 하나씩 본 결과 이런 것들이 있었다.
//   · 'A' 3건 — SUS 앵글밸브 15A. 배관 호칭경이다.
//   · 'W' 1건 — LED 직부등 15W. 전력이다.
//   · '포인트' 1건 — 결제선생 포인트를 실제로 샀다.
// 셋 다 정당한 규격이라 손대지 않는다. 접는 것은 대소문자·표기 차이뿐이다.
//
// 실행: npx tsx --env-file=.env.local scripts/backfill-unit-notation.ts [--apply]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

/** 접을 표기 — 왼쪽을 오른쪽으로. 뜻이 같은 것만 넣는다. */
const FOLD: Record<string, string> = {
  'M': 'm',        // 미터. 실측 13건(장판몰딩)
  '봉지': '봉',     // 같은 포장을 두 말로 적을 길을 막는다(현재 데이터 0건, 어휘 정리)
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  let changed = 0
  console.log(`${APPLY ? '적용' : '예행'} — 표기 접기\n`)

  for (const [from, to] of Object.entries(FOLD)) {
    for (const field of ['qtyUnit', 'specUnit'] as const) {
      const rows = await prisma.expense.findMany({
        where: { [field]: from },
        select: { id: true, date: true, itemLabel: true, qtyValue: true, amount: true },
      })
      if (rows.length === 0) continue
      changed += rows.length
      console.log(`  지출 ${field}  '${from}' -> '${to}'  ${rows.length}건`)
      for (const r of rows.slice(0, 3)) {
        console.log(`      ${r.date.toISOString().slice(0, 10)} ${r.itemLabel ?? '-'} ${r.qtyValue}${from} ${r.amount.toLocaleString()}원`)
      }
      if (rows.length > 3) console.log(`      외 ${rows.length - 3}건`)
      if (APPLY) await prisma.expense.updateMany({ where: { [field]: from }, data: { [field]: to } })
    }
    for (const field of ['qtyUnit', 'specUnit'] as const) {
      const items = await prisma.trackedItem.findMany({ where: { [field]: from }, select: { id: true, label: true } })
      if (items.length === 0) continue
      changed += items.length
      console.log(`  품목 카드 ${field}  '${from}' -> '${to}'  ${items.map(i => i.label).join(', ')}`)
      if (APPLY) await prisma.trackedItem.updateMany({ where: { [field]: from }, data: { [field]: to } })
    }
  }

  console.log(`\n${APPLY ? '적용' : '예행'} 완료 — ${changed}건`)
  if (!APPLY) console.log('실제로 고치려면 --apply 를 붙여 다시 실행한다.')
  await prisma.$disconnect()
}
void main()
