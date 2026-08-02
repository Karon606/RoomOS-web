// 520호 김민정 정정 — 신고 2c6de978 (운영자 승인 2026-08-02).
//
// 무엇을 바로잡나
//   1. 이용료 329,000(단기 2주 단가) -> 470,000(월 이용료). 단기 체크만 끄면 2주 단가가
//      그대로 월세로 승격되던 경로의 잔여 데이터다. 경로 자체는 코드로 봉합했다.
//   2. 7월 락인 청구액 329,000 -> 470,000. rentAmount 만 고치면 화면이 안 바뀐다 —
//      청구 우선순위가 '일할 > 락인 > 이용료' 라 이미 박힌 락인이 이긴다.
//   3. 8/2 에 받은 100,000 의 귀속월을 2026-08 -> 2026-07 로. **결제일은 오늘 그대로 둔다**
//      (운영자 확정). 7/20 입주·납부일 20일이면 첫 기간이 7/20~8/19 라 그 돈은 7월분이다.
//      그 record 가 만든 8월 락인도 함께 사라진다.
//   4. 자동 메모 "2026-07 과납 이월" 정리 — 7월에 과납이 있어서가 아니라 7월이 (잘못된 단가로)
//      완납이라 넘어온 것이라 사실과 반대로 읽힌다.
//
// 결과: 7월 청구 470,000 · 수납 429,000 · 부족 41,000 / 8월은 8/20 부터 470,000.
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-kimminjung-2c6de978.ts [--apply]
// 되돌리기: --revert (이용료·락인·귀속월·메모를 원상복구)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const OLD_RENT = 329_000, NEW_RENT = 470_000
const FROM_MONTH = '2026-08', TO_MONTH = '2026-07'
const MOVE_AMOUNT = 100_000
const OLD_MEMO = '2026-07 과납 이월'
const NEW_MEMO = '7월분으로 납부(8월에 받음)'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const lease = await prisma.leaseTerm.findFirst({
    where: { tenant: { name: '김민정' }, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
    select: { id: true, rentAmount: true, isShortTerm: true, room: { select: { roomNo: true } } },
  })
  if (!lease) { console.log('계약을 찾을 수 없습니다.'); process.exit(1) }

  const show = async (label: string) => {
    const l = await prisma.leaseTerm.findUnique({ where: { id: lease.id }, select: { rentAmount: true } })
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, deletedAt: null, isDeposit: false },
      select: { targetMonth: true, seqNo: true, expectedAmount: true, actualAmount: true, payDate: true, isPaid: true, memo: true },
      orderBy: [{ targetMonth: 'asc' }, { seqNo: 'asc' }],
    })
    console.log(`\n[${label}] 이용료 ${l!.rentAmount.toLocaleString()}`)
    const byMon = new Map<string, { exp: number; act: number }>()
    for (const r of recs) {
      const c = byMon.get(r.targetMonth) ?? { exp: 0, act: 0 }
      c.exp = Math.max(c.exp, r.expectedAmount); c.act += r.actualAmount
      byMon.set(r.targetMonth, c)
      console.log(`   ${r.targetMonth} seq${r.seqNo}  청구 ${String(r.expectedAmount).padStart(7)}  수납 ${String(r.actualAmount).padStart(7)}  ${r.payDate.toISOString().slice(0, 10)}  ${r.isPaid ? '완납' : '    '}  ${r.memo ?? ''}`)
    }
    for (const [m, v] of [...byMon].sort()) {
      console.log(`   => ${m}  청구 ${v.exp.toLocaleString()} · 수납 ${v.act.toLocaleString()} · 잔액 ${(v.act - v.exp).toLocaleString()}`)
    }
  }

  await show('현재')
  if (!apply && !revert) { console.log('\n  실제 반영: --apply · 되돌리기: --revert'); await prisma.$disconnect(); return }

  if (revert) {
    await prisma.leaseTerm.update({ where: { id: lease.id }, data: { rentAmount: OLD_RENT } })
    // 7월로 옮겼던 건을 8월로 되돌린다
    const moved = await prisma.paymentRecord.findFirst({
      where: { leaseTermId: lease.id, targetMonth: TO_MONTH, actualAmount: MOVE_AMOUNT, memo: NEW_MEMO, deletedAt: null },
      select: { id: true },
    })
    if (moved) {
      const seq = await prisma.paymentRecord.count({ where: { leaseTermId: lease.id, targetMonth: FROM_MONTH } })
      await prisma.paymentRecord.update({
        where: { id: moved.id },
        data: { targetMonth: FROM_MONTH, seqNo: seq + 1, expectedAmount: OLD_RENT, memo: OLD_MEMO },
      })
    }
    await prisma.paymentRecord.updateMany({
      where: { leaseTermId: lease.id, targetMonth: TO_MONTH, expectedAmount: NEW_RENT, isDeposit: false, deletedAt: null },
      data: { expectedAmount: OLD_RENT },
    })
    await recalc(prisma, lease.id, TO_MONTH, OLD_RENT)
    await recalc(prisma, lease.id, FROM_MONTH, OLD_RENT)
    await show('되돌림')
    await prisma.$disconnect(); return
  }

  // 1) 이용료
  await prisma.leaseTerm.update({ where: { id: lease.id }, data: { rentAmount: NEW_RENT } })

  // 2) 8월의 100,000 을 7월로 — 결제일은 그대로
  const target = await prisma.paymentRecord.findFirst({
    where: { leaseTermId: lease.id, targetMonth: FROM_MONTH, actualAmount: MOVE_AMOUNT, isDeposit: false, deletedAt: null },
    select: { id: true, payDate: true },
  })
  if (!target) { console.log('\n  옮길 100,000 record 를 찾지 못했습니다. 중단합니다.'); await prisma.$disconnect(); process.exit(1) }
  const julySeq = await prisma.paymentRecord.count({ where: { leaseTermId: lease.id, targetMonth: TO_MONTH } })
  await prisma.paymentRecord.update({
    where: { id: target.id },
    data: { targetMonth: TO_MONTH, seqNo: julySeq + 1, expectedAmount: NEW_RENT, memo: NEW_MEMO },
  })

  // 3) 7월 락인 되쓰기 — 기존 기준값(329,000)으로 박힌 것만
  await prisma.paymentRecord.updateMany({
    where: { leaseTermId: lease.id, targetMonth: TO_MONTH, expectedAmount: OLD_RENT,
      isDeposit: false, isPrevOwner: false, deletedAt: null },
    data: { expectedAmount: NEW_RENT },
  })

  // 4) 완납 재판정
  await recalc(prisma, lease.id, TO_MONTH, NEW_RENT)
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
