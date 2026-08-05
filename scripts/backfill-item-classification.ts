// 잘못 갈린 품목 정리 (2026-08-05, 신고 41728d75).
//
// 둘을 한다. 둘 다 대상이 명시 목록이라 임의로 번지지 않는다.
//   1) 매트리스 커버 3건을 소모품비에서 수선유지비로. **방 배정은 하지 않는다** —
//      사면 미배정으로 갖고 있다가 쓸 때 배정하는 것이 정상 흐름이다(운영자 정정).
//      운영자가 손으로 하나만 바꿀 수 있었던 이유는 일괄 편집이 품목 지출의 카테고리 변경을
//      조용히 건너뛰기 때문이다. 그래서 스크립트로 한다.
//   2) 카드의 추적 단위를 굳힌다. 테프론 테이프(15롤이 아니라 150m)와 코발트 드릴비트
//      (10개가 아니라 15mm)는 **눈에 보이게 틀렸고**, 직결피스·직결나사는 지금은 맞게 보이지만
//      규격 모드라 규격이 붙은 구매가 한 번 들어오면 뒤집힌다.
//      규격이 물건의 크기 표시일 뿐인데 앱이 나눌 수 있는 양으로 다룬 것이 공통 원인이다 —
//      봉투 50L 을 리터당으로 나눌 수 없다는 운영자 지적과 같은 축이다.
//
// 되돌리기 스냅샷을 파일로 남긴다. 되돌릴 수 없는 일괄 변경은 하지 않는다.
import { writeFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

// 카테고리를 옮길 대상 — 같은 이름이 이미 비품 쪽에 이력이 있는 것만
const MOVE = [{ label: '매트리스 커버 (방수)', from: '소모품비', to: '수선유지비' }]
// 추적 단위를 수량으로 굳힐 카드
// A4용지는 넣지 않는다. 규격 근거(500매)가 실제로 있어 감지망도 경고하지 않았고,
// 지금 500매로 맞게 보인다. 여기 넣으면 1팩으로 바뀌어 **눈에 보이는 변화**가 생긴다.
// 굳히기는 근거가 없는 카드에만 한다.
// 코발트 드릴비트 — 입력은 1.5mm 10개로 정확한데 앱이 지름을 나눌 수 있는 양으로 봐서
// 1.5 x 10 = 15mm 를 잔량으로 계산했다. 개로 세면 10개가 맞다(운영자 확인 2026-08-05).
const PIN_QTY = [
  '테프론 테이프', '스텐 와샤머리 직결피스', '스테인리스스틸 직결나사 접시머리 7종 세트',
  '코발트 드릴비트', '공구엔 코발트 드릴비트 일자',
]

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const snapshot: Record<string, unknown> = { at: new Date().toISOString(), expenses: [], cards: [], deletedCards: [] }

  for (const m of MOVE) {
    const rows = await prisma.expense.findMany({
      where: { itemLabel: m.label, category: m.from, isShipping: false },
      select: { id: true, propertyId: true, category: true, date: true, specText: true },
    })
    console.log(`[이동] "${m.label}" ${m.from} 에서 ${m.to} 로 ${rows.length}건${APPLY ? '' : ' (미리보기)'}`)
    for (const r of rows) console.log(`  - ${r.date.toISOString().slice(0, 10)} ${r.specText ?? ''}`)
    ;(snapshot.expenses as unknown[]).push(...rows.map(r => ({ id: r.id, category: r.category })))
    if (!APPLY) continue
    await prisma.expense.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { category: m.to } })

    // 옮긴 뒤 그 카테고리에 남은 지출이 없으면 카드도 정리한다.
    // 판정은 기존 정본과 같다 — 기록이 있으면 보관, 없으면 삭제.
    for (const propertyId of new Set(rows.map(r => r.propertyId))) {
      const left = await prisma.expense.count({ where: { propertyId, itemLabel: m.label, category: m.from } })
      if (left > 0) continue
      const card = await prisma.trackedItem.findFirst({ where: { propertyId, label: m.label, category: m.from } })
      if (!card) continue
      const used = await prisma.stockCheck.count({ where: { trackedItemId: card.id } })
        + await prisma.stockAddition.count({ where: { trackedItemId: card.id } })
        + await prisma.stockDisposal.count({ where: { trackedItemId: card.id } })
      ;(snapshot.deletedCards as unknown[]).push({ ...card, hadRecords: used })
      if (used > 0) await prisma.trackedItem.update({ where: { id: card.id }, data: { isArchived: true } })
      else await prisma.trackedItem.delete({ where: { id: card.id } })
      console.log(`  카드 "${card.label}" ${used > 0 ? '보관 처리' : '삭제'}`)
    }
  }

  console.log('')
  for (const label of PIN_QTY) {
    const cards = await prisma.trackedItem.findMany({
      where: { label, isArchived: false },
      select: { id: true, label: true, trackUnit: true, specUnit: true, qtyUnit: true },
    })
    for (const c of cards) {
      if (c.trackUnit === 'qty' && !c.specUnit) { console.log(`[단위] "${c.label}" 이미 수량 기준`); continue }
      // 점검이 하나라도 있으면 과거 잔량이 조용히 다른 뜻이 된다. 그때는 손대지 않는다.
      const checks = await prisma.stockCheck.count({ where: { trackedItemId: c.id } })
      if (checks > 0) {
        console.log(`[단위] "${c.label}" 점검 ${checks}건이라 건너뛴다 — 과거 잔량의 뜻이 바뀐다`)
        continue
      }
      console.log(`[단위] "${c.label}" ${c.trackUnit}${c.specUnit ? `(${c.specUnit})` : ''} 에서 qty 로${APPLY ? '' : ' (미리보기)'}`)
      ;(snapshot.cards as unknown[]).push({ id: c.id, trackUnit: c.trackUnit, specUnit: c.specUnit })
      if (APPLY) await prisma.trackedItem.update({ where: { id: c.id }, data: { trackUnit: 'qty', specUnit: null } })
    }
  }

  if (APPLY) {
    const f = `backfill-item-classification-undo-${Date.now()}.json`
    writeFileSync(f, JSON.stringify(snapshot, null, 2))
    console.log(`\n되돌리기 스냅샷: ${f}`)
  } else {
    console.log('\n--apply 를 붙이면 실제로 씁니다.')
  }
  await prisma.$disconnect()
}

main()
