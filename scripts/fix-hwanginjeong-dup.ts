// 402호 황인정 예약금 이중 기록 정정 (운영자 승인 2026-08-02).
//
// 무슨 일이 있었나
//   7/15 에 예약금 50,000 을 **일반 수납**으로 기록했다(그때는 예약금 전용 폼이 없었다 — 7/16 도입).
//   오늘 입실 처리하며 총액 379,000 을 **보증금 수납**으로 입력해 시스템이 보증금 50,000 +
//   이용료 329,000 두 줄을 만들었다. 그런데 7/15 기록이 그대로 남아 5만원이 두 번이 됐다.
//   겹친 사정 하나 — 입실 전환 때 reanchorReservationPrepaid 가 7월의 그 기록을 8월로 옮겼고,
//   그 직후 총액을 재입력하면서 중복이 완성됐다.
//
// 무엇을 고치나
//   7/15 자 이용료 record(seq1)를 소프트삭제한다. 그 돈은 seq2(보증금)가 이미 들고 있다.
//   결과: 이용료 청구 329,000 · 수납 329,000(완납) · 보증금 50,000 · 8월 매출 379,000 -> 329,000.
//   보증금은 매출이 아닌데 이용료로 섞여 매출이 5만원 과대였다.
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-hwangijeong-dup.ts [--apply]
// 되돌리기: --revert
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const DEL_MEMO = '[중복 정정] 7/15 예약금 — 같은 입금이 보증금 record 로 기록됨'
const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const lease = await prisma.leaseTerm.findFirst({
    where: { tenant: { name: '황인정' }, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
    select: { id: true, rentAmount: true, depositAmount: true, room: { select: { roomNo: true } } },
  })
  if (!lease) { console.log('계약을 찾을 수 없습니다.'); process.exit(1) }

  const show = async (label: string) => {
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, deletedAt: null },
      select: { seqNo: true, targetMonth: true, expectedAmount: true, actualAmount: true, payDate: true, isDeposit: true, isPaid: true, memo: true },
      orderBy: [{ targetMonth: 'asc' }, { seqNo: 'asc' }],
    })
    let rent = 0, dep = 0
    for (const r of recs) { if (r.isDeposit) dep += r.actualAmount; else rent += r.actualAmount }
    console.log(`\n[${label}]`)
    for (const r of recs) {
      console.log(`   ${r.targetMonth} seq${r.seqNo}  청구 ${String(r.expectedAmount).padStart(7)}  수납 ${String(r.actualAmount).padStart(7)}  ${r.payDate.toISOString().slice(0, 10)}  ${r.isDeposit ? '[보증금]' : '        '} ${r.isPaid ? '완납' : '    '} ${r.memo ?? ''}`)
    }
    console.log(`   이용료 청구 ${lease.rentAmount.toLocaleString()} · 수납 ${rent.toLocaleString()} · 잔액 ${(rent - lease.rentAmount).toLocaleString()}`)
    console.log(`   보증금 수납 ${dep.toLocaleString()} (계약 보증금 ${lease.depositAmount.toLocaleString()})`)
    console.log(`   8월 매출 인식분(보증금 제외) ${rent.toLocaleString()}`)
  }

  await show('현재')

  // 대상 — 7/15 자 이용료 record. 보증금 record 와 같은 날·같은 금액인 건만.
  const dupe = await prisma.paymentRecord.findFirst({
    where: {
      leaseTermId: lease.id, isDeposit: false, deletedAt: null,
      actualAmount: 50_000, payDate: new Date('2026-07-15T00:00:00.000Z'),
    },
    select: { id: true, seqNo: true, targetMonth: true },
  })
  const restored = await prisma.paymentRecord.findFirst({
    where: { leaseTermId: lease.id, isDeposit: false, deletedAt: { not: null }, memo: DEL_MEMO },
    select: { id: true },
  })

  if (revert) {
    if (!restored) { console.log('\n  되돌릴 대상이 없습니다.'); await prisma.$disconnect(); return }
    await prisma.paymentRecord.update({ where: { id: restored.id }, data: { deletedAt: null, memo: '' } })
    await recalc(prisma, lease.id, '2026-08', lease.rentAmount)
    await show('되돌림')
    await prisma.$disconnect(); return
  }

  if (!dupe) { console.log('\n  중복 대상을 찾지 못했습니다(이미 정정됐을 수 있습니다).'); await prisma.$disconnect(); return }
  console.log(`\n  삭제 대상: ${dupe.targetMonth} seq${dupe.seqNo} · 50,000원 · 2026-07-15`)

  if (!apply) { console.log('\n  실제 반영: --apply · 되돌리기: --revert'); await prisma.$disconnect(); return }

  await prisma.paymentRecord.update({
    where: { id: dupe.id },
    data: { deletedAt: new Date(), memo: DEL_MEMO },
  })
  await recalc(prisma, lease.id, dupe.targetMonth, lease.rentAmount)
  await show('정정 후')
  await prisma.$disconnect()
}

async function recalc(prisma: PrismaClient, leaseTermId: string, mon: string, expected: number) {
  const rows = await prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth: mon, isDeposit: false, deletedAt: null },
    orderBy: { payDate: 'asc' }, select: { id: true, actualAmount: true },
  })
  let cum = 0
  for (const r of rows) { cum += r.actualAmount; await prisma.paymentRecord.update({ where: { id: r.id }, data: { isPaid: cum >= expected } }) }
}

void main()
