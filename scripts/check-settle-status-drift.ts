// 갚을 것이 아닌데 미정산으로 남은 지출을 세는 데이터 그물(verify:db). 읽기 전용(SELECT 만), 위반 시 exit 1.
//
// 규칙(lib/settleStatus, 운영자 승인 2026-10-26). 미정산은 갚을 것(신용카드 결제, 또는 배송비 결제구분 '신용')에만 있다.
// 신고 2f0f9f4c 에서 저축예금 계좌로 낸 착불 배송비가 미정산으로 남아 카드 정산에 떴다. 저장 경로는 고쳤고
// 남은 행은 scripts/fix-noncredit-unsettled.ts 로 정리한다. 이 그물은 새로 생기는 것을 잡는다. 판정은 화면과 같은 isDeferredRow.
// 실행: npx tsx --env-file=.env.local scripts/check-settle-status-drift.ts
import prisma from '../lib/prisma'
import { isDeferredRow } from '../lib/settleStatus'

async function main() {
  const rows = await prisma.expense.findMany({
    where: { settleStatus: 'UNSETTLED' },
    select: { id: true, propertyId: true, date: true, amount: true, payMethod: true, isShipping: true, detail: true, order: { select: { shippingType: true } } },
    orderBy: { date: 'asc' },
  })
  const bad = rows.filter(r => !isDeferredRow({ payMethod: r.payMethod, isShipping: r.isShipping, shippingType: r.order?.shippingType ?? null }))
  if (bad.length > 0) {
    console.error(`[정산상태 데이터] 갚을 것이 아닌데 미정산 ${bad.length}건 (미정산 ${rows.length}건 중). 정리: scripts/fix-noncredit-unsettled.ts`)
    for (const r of bad) {
      console.error(`  - ${r.id.slice(0, 8)} 영업장 ${r.propertyId.slice(0, 8)} ${r.date.toISOString().slice(0, 10)} ${r.amount}원 ${r.payMethod ?? '-'}${r.isShipping ? ` · 배송비(${r.order?.shippingType ?? '결제구분 없음'})` : ''} ${r.detail ?? ''}`)
    }
    process.exit(1)
  }
  console.log(`[정산상태 데이터] 갚을 것이 아닌 미정산 0건 (미정산 ${rows.length}건 전부 갚을 것)`)
}

main().finally(() => prisma.$disconnect())
