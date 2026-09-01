// 퇴실 보증금 정산 감사(오류신고 249b5652 재발 감지) — 읽기 전용.
//
// 2026-09-01 재정의(운영자 승인). 퇴실 처리에 '나중에 반환'이 생겨 반환 기록 없는 퇴실이
// 정당한 대기 상태가 됐다. 그래서 이 그물은 두 층으로 판정한다.
//   대기(유예 안) — 퇴실 후 DEPOSIT_RETURN_GRACE_DAYS 이내. 목록만 보이고 통과한다.
//     실무 그물은 홈 알림(보증금 반환 대기)이 상시로 맡는다.
//   위반(유예 밖) — 유예를 넘긴 건. exit 1. 출력만 하고 통과하면 그물이 아니다(G-4).
// 판정 축은 계약 보증금이 아니라 **기준액**(lib/depositPending 정본)이다 — 계약만 있고 받은 적
// 없는(인수 후) 계약은 정산할 돈 자체가 없어 recordDepositReturn 도 거절한다.
//
// 사용: npx tsx --env-file=.env.local scripts/check-deposit-settlement.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { depositBasisOf, DEPOSIT_RETURN_GRACE_DAYS } from '../lib/depositPending'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', depositRefunds: { none: {} } },
    select: {
      id: true, propertyId: true, depositAmount: true, moveInDate: true, moveOutDate: true,
      tenant: { select: { name: true } }, room: { select: { roomNo: true } },
    },
    orderBy: { moveOutDate: 'desc' },
  })
  // 이 스크립트의 클라이언트는 소프트삭제 자동 필터(lib/prisma 익스텐션)가 없는 직결이다 —
  // deletedAt 을 손으로 걸러야 한다. 안 거르면 청소비 이관으로 지워진 옛 보증금 기록(정다솜
  // 503호 20,000원, 2026-08-01 이관)까지 세어 이미 정리된 건을 미반환으로 울린다.
  const paid = leases.length === 0 ? [] : await prisma.paymentRecord.groupBy({
    by: ['leaseTermId'], where: { leaseTermId: { in: leases.map(l => l.id) }, isDeposit: true, deletedAt: null },
    _sum: { actualAmount: true },
  })
  const paidOf = new Map(paid.map(g => [g.leaseTermId, g._sum.actualAmount ?? 0]))
  const props = await prisma.property.findMany({ select: { id: true, acquisitionDate: true, prevOwnerCutoffDate: true } })
  const cutoffOf = new Map(props.map(pr => [pr.id, pr.prevOwnerCutoffDate ?? pr.acquisitionDate ?? null]))

  const today = Date.now()
  const waiting: string[] = []
  const overdue: string[] = []
  for (const l of leases) {
    const cutoff = cutoffOf.get(l.propertyId) ?? null
    const { basis } = depositBasisOf({
      received: paidOf.get(l.id) ?? 0,
      contract: l.depositAmount,
      preAcquisition: !!(cutoff && l.moveInDate && l.moveInDate < cutoff),
    })
    if (basis <= 0) continue   // 정산할 돈이 없다 — 기록이 없는 것이 정상이다
    const days = l.moveOutDate ? Math.floor((today - l.moveOutDate.getTime()) / 86400000) : null
    const line = `${l.tenant?.name ?? '?'} ${l.room?.roomNo ?? '?'}호 기준액 ${basis.toLocaleString()}원 퇴실 ${l.moveOutDate?.toISOString().slice(0, 10) ?? '날짜 없음'} (${days ?? '?'}일 경과) lease=${l.id.slice(0, 8)}`
    // 퇴실일이 없으면 경과를 못 재니 보수적으로 위반으로 올린다 — 조용한 통과가 더 나쁘다.
    if (days === null || days > DEPOSIT_RETURN_GRACE_DAYS) overdue.push(line)
    else waiting.push(line)
  }

  if (waiting.length > 0) {
    console.log(`반환 대기(유예 ${DEPOSIT_RETURN_GRACE_DAYS}일 이내) ${waiting.length}건 — 홈 알림이 조르는 중:`)
    for (const w of waiting) console.log(`  ${w}`)
  }
  if (overdue.length === 0) {
    console.log(`보증금 정산 누락 없음 — 유예 넘긴 미반환 0건 (반환 기록 없는 퇴실 ${leases.length}건 검사).`)
  } else {
    console.log(`유예 ${DEPOSIT_RETURN_GRACE_DAYS}일 넘긴 보증금 미반환 ${overdue.length}건:`)
    for (const o of overdue) console.log(`  ${o}`)
    console.log('실제 반환 여부를 확인하고 입주자 카드의 보증금 항목에서 소급 기록할 것.')
    process.exitCode = 1
  }
  await prisma.$disconnect()
}
void main()
