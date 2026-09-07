// 잘라 쓰지 않는 품목의 잔량 축을 수량으로 선언하는 일회성 정리(운영자 확정 2026-09-07).
//
// 왜 필요한가. 길이 규격이 붙은 카드는 잔량을 그 길이로 센다(overview.ts:338 useSpec).
// 그것은 **잘라 쓰는 품목에만 맞다.** 빨래줄 10m 한 세트는 통으로 쓰는 물건이라 10m 가 잔량이
// 아니라 한 세트의 사양이다. 같은 모양으로 이미 옳게 선언된 선례가 점보롤이다(qty + specUnit m).
//
// 규격 값이 아예 없는 카드(수세미·박스테이프)는 지금도 우연히 수량으로 세어 맞게 보이지만,
// 규격이 붙은 구매가 한 번 들어오면 그날 숫자가 뒤집힌다(overview.ts:308~321 규격 자동 반영).
// qty 로 못박으면 그 자동 반영이 이 카드를 건너뛴다(:321) — 지금 표시는 한 자리도 안 바뀐다.
//
// 이력 확인: 빨래줄 점검·보충·폐기 0건(축을 바꿔도 환산할 기록이 없다), 수세미 69건·박스테이프
// 1건은 이미 개 단위라 축 선언과 어긋나지 않는다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-uncuttable-track-unit.ts        (예행)
//       npx tsx --env-file=.env.local scripts/fix-uncuttable-track-unit.ts --apply (적용)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const apply = process.argv.includes('--apply')

// 통으로 쓰는 것이 운영자 확인으로 확정된 품목들. 이름을 코드에 박는 것은 일회성 정리라서다 —
// 앞으로는 지출 저장 직전 확인창이 물어 카드가 스스로 답을 갖는다(2단계).
const TARGETS = ['빨래줄', '수세미', '박스테이프 (투명)']

async function main() {
  const rows = await prisma.trackedItem.findMany({
    where: { label: { in: TARGETS }, isArchived: false },
    select: { id: true, label: true, trackUnit: true, specUnit: true, qtyUnit: true },
  })
  let changed = 0
  for (const r of rows) {
    if (r.trackUnit === 'qty') { console.log(`${r.label} — 이미 수량 축이다(건너뜀)`); continue }
    changed++
    const before = r.specUnit?.trim() ? `${r.specUnit} 로 셈` : '규격 값 없이 규격 축'
    console.log(`${r.label} — ${before} → ${r.qtyUnit ?? '개'} 로 셈`)
    if (apply) await prisma.trackedItem.update({ where: { id: r.id }, data: { trackUnit: 'qty' } })
  }
  console.log(`\n대상 ${rows.length}건 중 ${changed}건${apply ? ' 적용함' : ' (예행, --apply 로 적용)'}`)
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
