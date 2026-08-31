// 발행 줄이 가리키는 수납이 실제로 있는지 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가 (2026-08-25 신고). 발행 줄은 (계약·수납일·수단)으로 찾는다. 그 축이 움직이거나
// 수납이 지워지면 옛 줄은 **아무도 안 가리키는 채 남고 합계에 계속 든다.** 실제로 408호에
// 수납이 없는 8/22 줄이 하나 생겨 8월 합계를 764만에서 811만으로 부풀렸다.
//
// 두 방향.
//   (가) 발행 줄에 대응하는 살아 있는 수납이 없다 — 유령 줄.
//   (나) 발행 표시가 켜진 수납인데 발행 줄이 없다 — 합계에서 통째로 빠진다.
//
// 삭제 표시된 발행 줄은 대상이 아니다. 다만 **집계가 그것을 세면 안 된다** — CashReceipt 는
// 소프트삭제 익스텐션 대상이 아니라(lib/prisma) 조회마다 손으로 걸러야 한다. 그 규율이
// 무너지면 (다)로 잡는다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-cash-receipt-orphan.ts
import { readFileSync } from 'node:fs'
import { PrismaClient, Prisma } from '@prisma/client'
import { cashReceiptKey, receiptRowVerdict } from '../lib/cashReceipt'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []
  const ymd = (d: Date) => d.toISOString().slice(0, 10)

  const receipts = await prisma.cashReceipt.findMany({
    where: { deletedAt: null },
    select: { id: true, leaseTermId: true, payDate: true, payMethod: true, amount: true, issuedAt: true },
  })
  const stamped = await prisma.paymentRecord.findMany({
    where: { cashReceiptIssuedAt: { not: null } },
    select: { leaseTermId: true, payDate: true, payMethod: true, actualAmount: true },
  })
  // 키와 판정은 정본이 쥔다 — 여기 사본을 두면 갈린다(lib/cashReceipt).
  const key = cashReceiptKey
  const stampedKeys = new Set(stamped.map(key))
  const receiptKeys = new Set(receipts.map(key))

  // 이용료 환불이 만드는 정상 중간 상태를 유령과 가른다 (2026-09-01). 판정 근거는 정본 주석 참조.
  const pendingKeys = new Set<string>()
  {
    const leases = await prisma.leaseTerm.findMany({
      where: { checkoutProrationUndo: { not: Prisma.DbNull } },
      select: { id: true, checkoutProrationUndo: true },
    })
    const ids: string[] = []
    for (const l of leases) {
      const snap = (l.checkoutProrationUndo as { refund?: { deletedRecordIds?: string[] } } | null)?.refund
      if (Array.isArray(snap?.deletedRecordIds)) ids.push(...snap.deletedRecordIds)
    }
    if (ids.length > 0) {
      // 소프트삭제된 것을 일부러 본다 — deletedAt 을 명시하면 자동 필터가 안 붙는다(lib/prisma).
      const gone = await prisma.paymentRecord.findMany({
        where: { id: { in: ids }, deletedAt: { not: null }, cashReceiptIssuedAt: { not: null } },
        select: { leaseTermId: true, payDate: true, payMethod: true },
      })
      for (const g of gone) pendingKeys.add(key(g))
    }
  }

  // (가) 유령 줄
  let pending = 0
  for (const r of receipts) {
    const v = receiptRowVerdict(key(r), stampedKeys, pendingKeys)
    if (v === 'ok') continue
    if (v === 'refundPending') {
      pending++
      console.log(`  [환불 대기] ${r.amount.toLocaleString()}원 (발행 ${ymd(r.issuedAt)}) — 이용료 환불로 표시가 꺼져 있다. 홈택스 취소·재발행 후 표시를 다시 켜면 풀린다`)
      continue
    }
    violations.push(`[발행 줄] 유령 — ${r.amount.toLocaleString()}원 (수납일 ${ymd(r.payDate)} · 발행 ${ymd(r.issuedAt)})에 대응하는 발행 표시 수납이 없다. 합계에 그대로 든다`)
  }
  // (나) 빠진 줄
  const seen = new Set<string>()
  for (const p of stamped) {
    const k = key(p)
    if (seen.has(k)) continue
    seen.add(k)
    if (!receiptKeys.has(k)) {
      violations.push(`[발행 줄] 누락 — 수납(${ymd(p.payDate)} ${p.actualAmount.toLocaleString()}원)에 발행 표시가 켜져 있는데 발행 줄이 없다. 그 금액이 합계에서 통째로 빠진다`)
    }
  }
  // (다) 집계가 삭제 표시를 거르는가 — 소스 대조
  const src = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  const agg = src.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)
  if (!agg) violations.push('[발행 줄] getMonthPaymentAggregates 를 못 찾았다 — 대조가 건너뛰어졌다. 감지망을 고칠 것')
  else if (!/prisma\.cashReceipt\.findMany\(\{[\s\S]{0,400}?deletedAt: null/.test(agg[0])) {
    violations.push('[발행 줄] 집계가 삭제 표시된 발행 줄을 안 거른다 — CashReceipt 는 소프트삭제 익스텐션 대상이 아니라 손으로 걸러야 한다. 껐다 켠 건이 두 번 세어진다')
  }

  console.log(`[발행 줄] 발행 ${receipts.length}건 · 발행 표시 수납 ${stamped.length}건 · 환불 대기 ${pending}건 검사 / 위반 ${violations.length}건`)
  if (violations.length > 0) {
    console.error('')
    for (const v of violations.slice(0, 20)) console.error(`  - ${v}`)
    if (violations.length > 20) console.error(`  ... 외 ${violations.length - 20}건`)
  }
  await prisma.$disconnect()
  process.exit(violations.length > 0 ? 1 : 0)

}

void main()
