// 퇴실 보증금 정산 누락 감사(오류신고 249b5652 재발 감지) — 읽기 전용.
// CHECKED_OUT 인데 계약상 보증금 > 0 이면서 DepositRefund 가 한 건도 없는 계약을 나열한다.
// 사용: node --env-file=.env.local scripts/check-deposit-settlement.mjs
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', depositAmount: { gt: 0 } },
    include: { tenant: true, room: true, depositRefunds: true },
    orderBy: { moveOutDate: 'desc' },
  })
  const missing = leases.filter(l => l.depositRefunds.length === 0)
  if (missing.length === 0) {
    console.log(`정산 누락 없음 — 보증금 있는 퇴실 계약 ${leases.length}건 모두 반환·미반환 기록 보유.`)
  } else {
    console.log(`보증금 정산 기록 없는 퇴실 계약 ${missing.length}건:`)
    for (const l of missing) {
      console.log(`  ${l.tenant?.name ?? '?'} ${l.room?.roomNo ?? '?'}호 보증금 ${l.depositAmount.toLocaleString()}원 퇴실 ${l.moveOutDate?.toISOString().slice(0, 10) ?? '날짜 없음'} lease=${l.id.slice(0, 8)}`)
    }
    console.log('각 건은 실제 반환 여부를 확인 후 입주자 카드(수정 폼 상태 변경 또는 재무 보증금 탭)에서 소급 기록할 것.')
    // 실패로 알린다 — 출력만 하고 exit 0 이면 훅에 물려도 통과만 하는 그물이 된다(G-4 2026-08-03).
    process.exitCode = 1
  }
  await prisma.$disconnect()
}
main()
