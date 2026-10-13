// 현금영수증 발행 기록 백필 — PaymentRecord.cashReceiptIssuedAt 를 CashReceipt 로 옮긴다.
//
// 실행: npx tsx --env-file=.env.local scripts/backfill-cash-receipt.ts [--apply]
// 기본은 예행이다. --apply 없이는 아무것도 쓰지 않는다.
//
// 왜 이 모양인가. 종전 스탬프는 **한 결제가 만든 형제 record 전부**에 찍혔다. 그래서 옮길 때도
// 형제를 하나로 묶어 발행 한 줄을 만든다 — 그러지 않으면 쪼개진 결제가 여러 건으로 부풀어
// 건수가 틀어진다. 실측(2026-08-24)으로는 32건이 전부 단독이라 1대1이지만, 규칙은 형제를 전제로 둔다.
//
// 금액은 **그 수납 금액 그대로**다. 운영자 확인 — "여기에는 다른 금액으로 발행하지는 않았어".
// 나중에 다르게 끊은 것이 발견되면 화면에서 고친다.
//
// ── 2026-10-13 봉합: 지워진 수납을 옮기지 않는다, 그리고 다시 쓰지 않는다 ──────────
//
// 이 스크립트는 2026-08-24 한 번 돌았다. 그때 조회가 확장 없는 PrismaClient 라 **소프트삭제된 수납까지**
// 옮겼다. 519호 임형진 470,000원은 7월에 홈택스에서 취소하고 앱에서도 지운 수납인데, 여기서 살아 있는
// 발행 줄로 다시 태어나 지금도 7월 합계에 든다(5,660,000원 14건, 빼면 5,190,000원 13건). 점검은 그
// 줄을 '환불 대기'로 읽어 영구 미검출이었다(패널 2026-10-13, 결함 D3).
//   1. 조회에 deletedAt: null 을 건다. 지워진 수납은 발행 사실의 근거가 아니다.
//   2. --apply 는 발행 줄이 하나라도 있으면 거부한다. 이미 발행 줄이 정본이 된 뒤의 재실행은 운영자가
//      화면에서 고친 금액·발행일을 수납 금액으로 되덮거나 지운 줄을 되살린다. 정말 다시 써야 하면
//      스크립트를 고쳐 그 이유를 이 머리말에 남긴다.
//
// 아래 '두 번 돌려도 안전하다'는 첫 실행 당시의 문장이다. 그 판정(같은 계약·수납일·발행일이면 건너뜀)은
// 발행일이 바뀐 줄·지운 줄을 못 알아봐서 사실 안전하지 않았다.
// 두 번 돌려도 안전하다. 이미 같은 (계약·수납일·발행일) 줄이 있으면 건너뛴다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstYmdStr, kstMonthKey } from '../lib/kstDate'

const APPLY = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  if (APPLY) {
    const existing = await prisma.cashReceipt.count()
    if (existing > 0) {
      console.error(`발행 줄이 이미 ${existing}건 있다. 이 백필은 2026-08-24 에 끝났고 지금은 발행 줄이 정본이라 다시 쓰지 않는다(머리말 참조).`)
      await prisma.$disconnect()
      process.exit(1)
    }
  }

  const rows = await prisma.paymentRecord.findMany({
    // 확장 없는 클라이언트라 소프트삭제를 손으로 거른다. 519호가 이 줄 하나가 없어 생겼다.
    where: { cashReceiptIssuedAt: { not: null }, deletedAt: null },
    orderBy: [{ leaseTermId: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, propertyId: true, leaseTermId: true, tenantId: true,
      payDate: true, payMethod: true, createdAt: true,
      cashReceiptIssuedAt: true, actualAmount: true, isDeposit: true,
    },
  })

  // 형제 묶음 — 앱의 판정과 같은 축(계약·수납일·수단·생성시각 2초 이내).
  type Group = {
    propertyId: string; leaseTermId: string; tenantId: string
    payDate: Date; payMethod: string | null
    firstCreatedAt: Date
    issuedAt: Date
    amount: number
    hasDeposit: boolean
    ids: string[]
  }
  const groups: Group[] = []
  for (const r of rows) {
    const g = groups.find(x =>
      x.leaseTermId === r.leaseTermId &&
      kstYmdStr(new Date(x.payDate)) === kstYmdStr(new Date(r.payDate)) &&
      (x.payMethod ?? '') === (r.payMethod ?? '') &&
      Math.abs(x.firstCreatedAt.getTime() - new Date(r.createdAt).getTime()) <= 2000)
    if (g) {
      g.amount += r.actualAmount
      g.hasDeposit = g.hasDeposit || r.isDeposit
      g.ids.push(r.id)
      // 형제끼리 발행 시각이 밀리초 단위로 갈릴 수 있다(옛 코드가 루프 안에서 new Date() 를 불렀다).
      // 가장 이른 것을 그 결제의 발행 시각으로 삼는다.
      if (r.cashReceiptIssuedAt! < g.issuedAt) g.issuedAt = r.cashReceiptIssuedAt!
    } else {
      groups.push({
        propertyId: r.propertyId, leaseTermId: r.leaseTermId, tenantId: r.tenantId,
        payDate: r.payDate, payMethod: r.payMethod,
        firstCreatedAt: new Date(r.createdAt),
        issuedAt: r.cashReceiptIssuedAt!,
        amount: r.actualAmount,
        hasDeposit: r.isDeposit,
        ids: [r.id],
      })
    }
  }

  console.log(`발행 표시 record ${rows.length}건 → 발행 ${groups.length}건`)
  const byMonth = new Map<string, { n: number; sum: number }>()
  for (const g of groups) {
    const m = kstMonthKey(g.issuedAt)
    const e = byMonth.get(m) ?? { n: 0, sum: 0 }
    e.n += 1; e.sum += g.amount
    byMonth.set(m, e)
  }
  for (const m of [...byMonth.keys()].sort()) {
    console.log(`  ${m}: ${byMonth.get(m)!.sum.toLocaleString()}원 ${byMonth.get(m)!.n}건`)
  }

  if (!APPLY) {
    console.log('\n예행이다. 실제로 쓰려면 --apply 를 붙일 것.')
    await prisma.$disconnect()
    return
  }

  let made = 0, skipped = 0
  for (const g of groups) {
    const dup = await prisma.cashReceipt.findFirst({
      where: { leaseTermId: g.leaseTermId, payDate: g.payDate, issuedAt: g.issuedAt },
      select: { id: true },
    })
    if (dup) { skipped += 1; continue }
    await prisma.cashReceipt.create({
      data: {
        propertyId: g.propertyId, leaseTermId: g.leaseTermId, tenantId: g.tenantId,
        issuedAt: g.issuedAt, amount: g.amount,
        payDate: g.payDate, payMethod: g.payMethod,
        // 종전 스탬프는 항목을 안 남겼다. 보증금 몫이 섞였는지만 record 로 알 수 있고,
        // 청소비 몫은 애초에 찍힌 적이 없다(ExtraIncome 에 칸이 없었다).
        inclDeposit: g.hasDeposit,
        inclCleaning: false,
        inclRent: g.amount > 0 && !(g.hasDeposit && g.ids.length === 1),
        memo: null,
      },
    })
    made += 1
  }
  console.log(`\n새로 만든 발행 ${made}건 / 이미 있어 건너뜀 ${skipped}건`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
