// 주방세제 지출의 사라진 낱개 용량 복구 (신고 1fd2e22b, 운영자 지시 2026-08-02).
//
// 무슨 일이 있었나
//   영수증 인식이 '애플민트향'(서술 규격)을 읽자 폼이 숫자 규격 2.1L 을 통째로 버렸다.
//   그래서 DB 에 specValue·specUnit 이 null 로 들어갔고, 재고는 수량 4 를 그대로 받아 '4ml' 로 찍었다.
//   실제는 2.1L 짜리 4개 = 8,400ml 다. 같은 원인으로 단가도 14,710 ÷ (4 × 2.1) = 1,751 원/개로 표시됐다.
//
// 코드는 봉합했다(서술 규격이 있어도 숫자 규격을 버리지 않는다). 이 스크립트는 이미 들어간 행만 되살린다.
// 금액(14,710)은 건드리지 않는다. 규격을 채우면 총량과 단가가 자동으로 다시 계산된다.
//
// 대상 판정 — 물리 단위로 재고를 추적하는 품목(trackUnit='spec')인데 specValue 가 비어 있고
// 수령 전(receivedAt=null)인 지출. 이미 수령한 건은 잔량에 반영돼 있어 함께 손대면 이중 정정이 된다.
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-dishsoap-spec.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const ITEM = '주방세제'
const SPEC_VALUE = 2.1
const SPEC_UNIT = 'L'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const rows = await prisma.expense.findMany({
    where: {
      itemLabel: ITEM, receivedAt: null,
      ...(revert ? { specValue: SPEC_VALUE } : { specValue: null }),
    },
    select: { id: true, date: true, amount: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, specText: true, vendor: true },
  })

  const item = await prisma.trackedItem.findFirst({
    where: { label: ITEM },
    select: { specUnit: true, trackUnit: true },
  })
  console.log(`품목 '${ITEM}' 재고 단위 ${item?.specUnit ?? '-'} · 추적 기준 ${item?.trackUnit ?? '-'}\n`)
  console.log(`대상 ${rows.length}건`)
  for (const r of rows) {
    const q = r.qtyValue ?? 0
    const before = r.specValue ? `${r.specValue}${r.specUnit ?? ''} x ${q}${r.qtyUnit ?? ''}` : `규격 없음 · ${q}${r.qtyUnit ?? ''}`
    const after = revert ? `규격 없음 · ${q}${r.qtyUnit ?? ''}` : `${SPEC_VALUE}${SPEC_UNIT} x ${q}${r.qtyUnit ?? ''} = ${(SPEC_VALUE * q * 1000).toLocaleString()}ml`
    const unit = r.amount != null && q > 0 ? Math.round(r.amount / q) : 0
    console.log(`  ${r.date.toISOString().slice(0, 10)} ${r.vendor ?? ''} ${r.amount?.toLocaleString()}원 · ${r.specText ?? ''}`)
    console.log(`     ${before}  ->  ${after}   (단가 ${unit.toLocaleString()}원/개, 변화 없음)`)
  }

  if (!rows.length) { await prisma.$disconnect(); return }
  if (!apply) { console.log('\n실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  for (const r of rows) {
    await prisma.expense.update({
      where: { id: r.id },
      data: revert
        ? { specValue: null, specUnit: null }
        : { specValue: SPEC_VALUE, specUnit: SPEC_UNIT, unitBasis: 'qty' },
    })
  }
  console.log(`\n${rows.length}건 반영 완료`)
  await prisma.$disconnect()
}

void main()
