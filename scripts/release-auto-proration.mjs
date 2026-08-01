// 자동 적용돼 있던 퇴실 일할 해제 — 2026-08-01 정책 전환(자동 적용 폐지)의 잔여 데이터 정리.
//
// 배경: 종전에는 퇴실 예정으로 전환하면 시스템이 말없이 그 달 청구를 일할로 덮어썼다. 이제 예정
// 단계에서는 청구를 건드리지 않고 퇴실 처리 때 묻는다(운영자 승인). 코드는 바뀌었지만 이미 덮어써진
// 계약은 그대로 남으므로 여기서 떼어낸다.
//
// 왜 clearCheckoutProration(정본 적용취소)을 쓰지 않는가: 그 액션은 '위젯에서 적용한 것을 되돌리는'
// 용도라 스냅샷의 prevStatus·prevExpectedMoveOut 까지 복원한다. 민경진의 스냅샷은 prevStatus 'ACTIVE',
// prevExpectedMoveOut null 이라 실행하면 퇴실 예정 전환 자체가 취소된다. 우리가 떼려는 건 일할액뿐이다.
// 그래서 그 액션의 '적용 후 수동 수정됨' 분기와 같은 처리(일할 3필드만 제거)를 여기서 한다.
//
// 대상: CHECKOUT_PENDING 이면서 그 정산월에 수납 기록이 없는 계약. 퇴실 완료·수납 완결·환불 확정 건은
// 과거 결산이라 손대지 않는다.
//
// 실행: node --env-file=.env.local scripts/release-auto-proration.mjs [--apply]
// 되돌리기: 아래 출력된 값을 --restore <leaseId> <amount> <month> 로.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const restoreIdx = argv.indexOf('--restore')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

if (restoreIdx >= 0) {
  const [id, amount, month] = argv.slice(restoreIdx + 1)
  if (!id || !amount || !month) {
    console.log('사용법: --restore <leaseTermId> <amount> <YYYY-MM>')
    process.exit(1)
  }
  await prisma.leaseTerm.update({
    where: { id },
    data: { checkoutProratedAmount: Number(amount), checkoutProratedMonth: month },
  })
  console.log(`복원 완료 — ${id} 에 일할 ${Number(amount).toLocaleString()}원 @${month}`)
  await prisma.$disconnect()
  process.exit(0)
}

const rows = await prisma.leaseTerm.findMany({
  where: { status: 'CHECKOUT_PENDING', checkoutProratedAmount: { not: null } },
  select: {
    id: true, rentAmount: true, expectedMoveOut: true, checkoutProrationUndo: true,
    checkoutProratedAmount: true, checkoutProratedMonth: true,
    tenant: { select: { name: true } }, room: { select: { roomNo: true } },
  },
})

console.log(`\n[자동 일할 해제] 후보 ${rows.length}건${apply ? '' : ' (미리보기)'}`)
const targets = []
for (const l of rows) {
  const undo = l.checkoutProrationUndo
  // 환불이 확정된 계약은 절대 손대지 않는다 — 청구와 record 정합이 깨진다
  if (undo && typeof undo === 'object' && 'refund' in undo) {
    console.log(`  건너뜀 ${l.room?.roomNo}호 ${l.tenant.name} — 이용료 환불 확정분`)
    continue
  }
  const paid = await prisma.paymentRecord.count({
    where: { leaseTermId: l.id, targetMonth: l.checkoutProratedMonth, deletedAt: null, isDeposit: false },
  })
  if (paid > 0) {
    console.log(`  건너뜀 ${l.room?.roomNo}호 ${l.tenant.name} — ${l.checkoutProratedMonth} 수납 기록 ${paid}건(과거 결산)`)
    continue
  }
  console.log(`  대상  ${l.room?.roomNo}호 ${l.tenant.name} — 일할 ${l.checkoutProratedAmount.toLocaleString()}원 @${l.checkoutProratedMonth} 해제 시 그 달 청구 ${l.rentAmount.toLocaleString()}원`)
  console.log(`        되돌리기: --restore ${l.id} ${l.checkoutProratedAmount} ${l.checkoutProratedMonth}`)
  targets.push(l)
}

if (!apply) {
  console.log('\n  실제 반영: --apply')
  await prisma.$disconnect()
  process.exit(0)
}

for (const l of targets) {
  // 일할 3필드만 제거 — 상태·퇴실 예정일은 유지한다(정본 적용취소와 다른 지점)
  await prisma.leaseTerm.update({
    where: { id: l.id },
    data: { checkoutProratedAmount: null, checkoutProratedMonth: null },
  })
}
console.log(`\n  완료 — ${targets.length}건 해제`)
await prisma.$disconnect()
