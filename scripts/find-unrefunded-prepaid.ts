// 퇴실이 끝난 계약 중 미래 달 선납을 덜 돌려준 건을 찾는다 — 읽기 전용, 아무것도 안 고친다.
//
// 왜. 퇴실 정산이 귀속월 한 달만 집계하던 시절(2026-08-31 봉합 전)에는, 다음 달을 미리 낸
// 사람이 나가면 그 돈이 계산에 아예 안 들어왔다. 미납으로도 과납으로도 안 뜨고 매출로만
// 잡혀서 어느 감지망도 못 잡는다. 그래서 사람이 찾아야 한다.
//
// 판정. 정산 경계월 = checkoutProratedMonth, 없으면 퇴실일이 속한 정산 기간의 달, 그것도
// 없으면 퇴실월. 그 경계월보다 **뒤** 귀속의 살아 있는 수납이 남아 있으면 후보다.
// 단기 계약은 입주월 단일 청구라 제외한다(일할 정산 자체가 정책 밖).
//
// 실행: node --env-file=.env.local scripts/find-unrefunded-prepaid.mjs
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { settlementPeriodFor } from '../lib/settlementPeriod'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const ymd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', isShortTerm: false },
    select: {
      id: true, moveInDate: true, moveOutDate: true, expectedMoveOut: true, dueDay: true,
      checkoutProratedMonth: true, checkoutProrationUndo: true,
      property: { select: { name: true } },
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      paymentRecords: {
        where: { isDeposit: false, isPrevOwner: false, deletedAt: null, actualAmount: { gt: 0 } },
        select: { targetMonth: true, actualAmount: true, payDate: true, memo: true },
        orderBy: { targetMonth: 'asc' },
      },
    },
  })

  const rows: { property: string; room: string; name: string; outYmd: string; boundary: string; sum: number; refunded: boolean; detail: string }[] = []
  for (const l of leases) {
    const outYmd = ymd(l.moveOutDate) ?? ymd(l.expectedMoveOut)
    if (!outYmd) continue
    // 경계월 — 확정 때 쓴 값이 있으면 그것이 가장 정확하다.
    let boundary = l.checkoutProratedMonth
    if (!boundary) {
      const period = settlementPeriodFor({ dueDay: l.dueDay, moveInDate: l.moveInDate }, outYmd)
      boundary = period ? period.month : outYmd.slice(0, 7)
    }
    const after = l.paymentRecords.filter(r => r.targetMonth > boundary)
    if (after.length === 0) continue
    const sum = after.reduce((s, r) => s + r.actualAmount, 0)
    if (sum <= 0) continue
    const refunded = !!(l.checkoutProrationUndo && typeof l.checkoutProrationUndo === 'object'
      && 'refund' in l.checkoutProrationUndo)
    rows.push({
      property: l.property?.name ?? '', room: l.room?.roomNo ?? '', name: l.tenant?.name ?? '',
      outYmd, boundary, sum, refunded,
      detail: after.map(r => `${r.targetMonth} ${r.actualAmount.toLocaleString()}`).join(' , '),
    })
  }

  rows.sort((a, b) => b.sum - a.sum)
  console.log(`퇴실 완료 계약 ${leases.length}건 검사 · 미환불 선납 후보 ${rows.length}건`)
  if (rows.length > 0) {
    const total = rows.reduce((s, r) => s + r.sum, 0)
    console.log(`합계 ${total.toLocaleString()}원\n`)
    for (const r of rows) {
      console.log(`  ${r.room} ${r.name} · 퇴실 ${r.outYmd} · 경계월 ${r.boundary} · ${r.sum.toLocaleString()}원`)
      console.log(`    ${r.detail} · 환불 확정 ${r.refunded ? '있음(덜 돌려준 건)' : '없음(정산 자체를 안 한 건)'}`)
    }
  }
  await prisma.$disconnect()

}

main().catch(e => { console.error(e); process.exit(1) })
