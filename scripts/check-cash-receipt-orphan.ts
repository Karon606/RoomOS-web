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
// 2026-09-21 운영자 확정("보증금은 돌려주는 금액, 청소비 또한 퇴실할 때 처리하는 금액이므로
// 받을 때는 현금영수증 처리하면 안되는 건들이야")으로 세 축이 붙었다. 기준선은 전부 0 이고
// **래칫**이다 — 지금 0 인 것을 실측으로 확인했으니, 1 이 되는 날은 규칙이 뚫린 날이다.
//   (라) 살아 있는 줄이 보증금·청소비를 들었다 — 예외 발행이거나 규칙이 뚫린 것이다.
//   (마) 보증금 record 에 도장이 있는데 그 키의 줄이 없거나 보증금을 안 들었다 — 도장과 줄이 갈렸다.
//   (바) 줄 금액이 그 키의 이용료 몫보다 큰데 보증금·청소비를 안 들었다고 말한다.
//        **(바)가 소스 그물을 우회한 회귀를 데이터에서 잡는다** — 소스는 통과하는데 값만 틀린 경우다.
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
    select: { id: true, leaseTermId: true, payDate: true, payMethod: true, amount: true, issuedAt: true, inclDeposit: true, inclCleaning: true },
  })
  // **살아 있는 record 만 본다**(독립 검수 2026-09-22). 이 스크립트는 확장 없는 PrismaClient 를
  // 직접 만들어 소프트삭제 필터를 안 지난다. 안 거르면 지워진 수납이 발행 줄을 받치는 것으로
  // 세어져, 아무도 안 가리키는 줄(408호 클래스)을 정상으로 읽는다.
  const stamped = await prisma.paymentRecord.findMany({
    where: { cashReceiptIssuedAt: { not: null }, deletedAt: null },
    select: { leaseTermId: true, payDate: true, payMethod: true, actualAmount: true, isDeposit: true },
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
  // ── 받을 때 발행 대상은 이용료 몫뿐 (운영자 확정 2026-09-21) ──────────────
  //
  // 기준선은 셋 다 0 이다(2026-09-21 전수 실측 — 살아 있는 줄 49건 전부 inclRent 만 참이고
  // 도장이 찍힌 보증금 record 는 0건). 0 이 1 이 되는 날은 규칙이 뚫린 날이거나 세무 담당자
  // 확인을 거친 예외가 처음 생긴 날이다. 후자라면 이 기준선을 **의식적으로** 올릴 일이다.

  // (라) 살아 있는 줄이 보증금·청소비를 들었다.
  for (const r of receipts) {
    if (!r.inclDeposit && !r.inclCleaning) continue
    const what = [r.inclDeposit ? '보증금' : '', r.inclCleaning ? '청소비' : ''].filter(Boolean).join('·')
    violations.push(`[발행 몫] 예외 — ${r.amount.toLocaleString()}원 (발행 ${ymd(r.issuedAt)})이 ${what} 을(를) 포함한다. 받을 때는 발행 대상이 아니다`)
  }

  // (마) 보증금 record 에 도장이 있는데 줄이 그것을 안 받친다.
  const lineByKey = new Map(receipts.map(r => [key(r), r]))
  for (const p of stamped) {
    if (!p.isDeposit) continue
    const line = lineByKey.get(key(p))
    if (line?.inclDeposit) continue
    violations.push(`[발행 몫] 도장 — 보증금 수납(${ymd(p.payDate)} ${p.actualAmount.toLocaleString()}원)에 발행 표시가 있는데 ${line ? '그 발행 줄은 보증금을 안 들었다' : '발행 줄이 없다'}`)
  }

  // (바) 줄 금액이 그 키의 이용료 몫을 넘는데 보증금·청소비는 안 들었다고 말한다.
  //      **소스 그물을 우회한 회귀를 데이터에서 잡는 자리다.** 소스는 통과하는데 값만 틀린 경우가
  //      여기 걸린다. 조정 전표는 받은 돈이 아니라 뺀다(paymentCompositionFor 와 같은 기준).
  {
    const live = await prisma.paymentRecord.findMany({
      where: { isBillingAdjust: false, deletedAt: null },   // 이름 그대로 살아 있는 것만(독립 검수 2026-09-22)
      select: { leaseTermId: true, payDate: true, payMethod: true, actualAmount: true, isDeposit: true },
    })
    const rentByKey = new Map<string, number>()
    for (const p of live) {
      if (p.isDeposit) continue
      const k = key(p)
      rentByKey.set(k, (rentByKey.get(k) ?? 0) + p.actualAmount)
    }
    for (const r of receipts) {
      if (r.inclDeposit || r.inclCleaning) continue   // 예외 발행은 (라)가 이미 말했다
      // **환불 대기는 비켜 간다**(2026-09-22). 환불은 원 수납을 소프트삭제하고 새 record 에는
      // 도장을 일부러 안 찍는다. 그래서 살아 있는 이용료 몫이 0 이 되는데, 그 줄이 환불 전
      // 금액을 드는 것은 정상 중간 상태다 — 홈택스가 아직 그 금액이고, 운영자가 취소·재발행할
      // 때까지 앱 합계도 그 금액이어야 한다(lib/cashReceipt receiptRowVerdict 의 판정과 같다).
      // 이것을 울면 첫 환불부터 매번 울고, 그러면 진짜 초과도 같이 안 읽힌다.
      if (receiptRowVerdict(key(r), stampedKeys, pendingKeys) === 'refundPending') continue
      const rent = rentByKey.get(key(r)) ?? 0
      if (r.amount <= rent) continue
      violations.push(`[발행 몫] 초과 — 발행 ${r.amount.toLocaleString()}원 (발행 ${ymd(r.issuedAt)} · 수납일 ${ymd(r.payDate)})이 이용료 몫 ${rent.toLocaleString()}원을 넘는데 보증금·청소비를 안 들었다고 적혀 있다`)
    }
  }

  // (다) 집계가 삭제 표시를 거르는가 — 소스 대조
  const src = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  const agg = src.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)
  if (!agg) violations.push('[발행 줄] getMonthPaymentAggregates 를 못 찾았다 — 대조가 건너뛰어졌다. 감지망을 고칠 것')
  else if (!/prisma\.cashReceipt\.findMany\(\{[\s\S]{0,400}?deletedAt: null/.test(agg[0])) {
    violations.push('[발행 줄] 집계가 삭제 표시된 발행 줄을 안 거른다 — CashReceipt 는 소프트삭제 익스텐션 대상이 아니라 손으로 걸러야 한다. 껐다 켠 건이 두 번 세어진다')
  }

  console.log(`[발행 줄] 발행 ${receipts.length}건 · 발행 표시 수납 ${stamped.length}건 · 환불 대기 ${pending}건 검사 (축 가·나·다·라 예외 몫·마 보증금 도장·바 이용료 몫 초과) / 위반 ${violations.length}건`)
  if (violations.length > 0) {
    console.error('')
    for (const v of violations.slice(0, 20)) console.error(`  - ${v}`)
    if (violations.length > 20) console.error(`  ... 외 ${violations.length - 20}건`)
  }
  await prisma.$disconnect()
  process.exit(violations.length > 0 ? 1 : 0)

}

void main()
