// 부피 규격 + 매·장 수량인 지출에 '규격당' 기준이 새로 박히지 않았는지 — 읽기 전용, 위반 시 exit 1.
//   실행: npx tsx --env-file=.env.local scripts/check-unit-basis-drift.ts
//
// 왜 있나(2026-09-17, 신고 73c18e13). 종량제봉투 50L 20매 25,000원은 **1매 1,250원**이지 리터당
// 25원이 아니다(운영자 지적 2026-08-05). 그런데 기준을 정하는 자리가 다섯인데 규칙을 아는 곳이
// 하나뿐이라, 나머지 넷이 'spec' 으로 메워 그 규칙을 덮었다. 배선은 check-unit-basis-wiring 이
// 보고, 여기서는 **장부에 실제로 남은 값**을 본다 — 코드가 맞아도 데이터가 틀어질 수 있다.
//
// 판정: 규격 단위가 부피이고 수량 단위가 매·장인 행(정본 isVolumeSizeLabel)에 unitBasis='spec' 이
// 기록돼 있으면 위반이다. 기록이 없는(null) 행은 위반이 아니다 — 읽는 자리가 정본 규칙으로 답하니
// 표시가 맞다. 다만 몇 건인지는 명부로 남긴다(다음 사람이 세어 보지 않아도 되게).
//
// 멀티테넌트: 전 영업장을 본다. 특정 영업장 값을 하드코딩하지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { isVolumeSizeLabel } from '../lib/units'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })

async function main() {
  const rows = await prisma.expense.findMany({
    select: {
      id: true, propertyId: true, date: true, itemLabel: true,
      specValue: true, specUnit: true, qtyValue: true, qtyUnit: true, unitBasis: true, amount: true,
    },
    orderBy: { date: 'asc' },
  })
  const sized = rows.filter(r => isVolumeSizeLabel(r.specUnit, r.qtyUnit))
  const bad = sized.filter(r => r.unitBasis === 'spec')
  const unset = sized.filter(r => r.unitBasis !== 'spec' && r.unitBasis !== 'qty')

  console.log(`\n[단가 기준 장부] 지출 ${rows.length}행 / 부피 규격 + 매·장 수량 ${sized.length}행`)
  console.log(`  기준 미기록 ${unset.length}행 (위반 아님 — 읽는 자리가 정본 규칙으로 개당이라 답한다)`)
  console.log(`  기준이 '규격당'으로 박힌 행 ${bad.length}건`)
  for (const r of bad) {
    console.log(`  - ${r.date.toISOString().slice(0, 10)} [${r.itemLabel ?? '(품명 없음)'}] `
      + `${r.specValue}${r.specUnit} x ${r.qtyValue}${r.qtyUnit} ${r.amount.toLocaleString()}원 (id ${r.id})`)
  }
  await prisma.$disconnect()
  if (bad.length > 0) {
    console.log('\n  봉투류의 부피는 나눌 수 있는 양이 아니라 물건의 크기 표시다. 개당 단가여야 한다.')
    console.log('  되돌리려면: npx tsx --env-file=.env.local scripts/backfill-unit-basis-volume-sheet.ts')
    process.exit(1)
  }
}
main()
