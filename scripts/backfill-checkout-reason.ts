// 퇴실 확정 기록에서 빠진 사유를 예정 때 고른 값으로 채우는 1회 백필 — 기본은 예행, --apply 로만 적용.
//
// 왜 백필인가(2026-09-06). 생성 경로는 이미 고쳐졌다 — 커밋 cbac5f8b(2026-09-02 14:25 KST)가
// "퇴실 예정 때 고른 사유를 퇴실 처리가 이어받는다"를 봉합했고, 남은 다섯 건의 퇴실 확정 로그는
// 전부 그 배포 **이전**이다(가장 최근이 문정현 09-02 03:32 UTC). 즉 코드 문제가 아니라 옛 데이터다.
//
// **추정이 아니라 기록 낭독이다.** 이어받을 사유는 예정 행에 그대로 남아 있고, 판정은 화면·서버·
// 정합 감사가 쓰는 같은 정본(lib/checkoutReason 의 inheritableCheckoutReason)이 결정론적으로
// 돌려준다. 감사 문구 자체가 운영자에게 "상태 이력에서 퇴실 행의 사유를 적어 주세요"라고 시키는데,
// 이 스크립트는 그 손일을 같은 값으로 대신할 뿐이다. 가공하지 않는다.
//
// 감사 규칙을 조정해 숨기는 안은 오답이다. 규칙 7 에는 시점 컷오프가 없고 "수정 이전 건"을 알
// 방법도 없으며, 컷오프를 넣어도 표·카드의 퇴실 사유는 영영 빈 채 남는다.
import prisma from '../lib/prisma'
import { inheritableCheckoutReason } from '../lib/checkoutReason'

const apply = process.argv.includes('--apply')

async function main() {
  // 대상 산출은 정합 감사 규칙 7 과 **같은 판정**이다. 다르면 백필 뒤에도 감사가 계속 운다.
  const checkedOut = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT' },
    select: {
      id: true, tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      statusLogs: {
        where: { deletedAt: null },
        orderBy: { changedAt: 'desc' },
        take: 10,
        select: { id: true, toStatus: true, reason: true, changedAt: true },
      },
    },
  })
  const plan: { logId: string; who: string; reason: string; at: string }[] = []
  for (const l of checkedOut) {
    const idx = l.statusLogs.findIndex(r => r.toStatus === 'CHECKED_OUT')
    if (idx < 0 || (l.statusLogs[idx].reason ?? '').trim()) continue
    const inherited = inheritableCheckoutReason(l.statusLogs.slice(idx + 1))
    if (!inherited) continue
    plan.push({
      logId: l.statusLogs[idx].id,
      who: `${l.room?.roomNo ?? '-'}호 ${l.tenant.name}`,
      reason: inherited,
      at: l.statusLogs[idx].changedAt.toISOString().slice(0, 16).replace('T', ' '),
    })
  }
  console.log(`\n퇴실 확정 ${checkedOut.length}건 중 사유가 빠진 것 ${plan.length}건\n`)
  for (const p of plan) console.log(`  ${p.who.padEnd(22)} ${p.at}  사유 '${p.reason}' 을 확정 행에 적는다`)
  if (!apply) { console.log('\n예행이다. 적용하려면 --apply 를 붙인다.'); return }
  for (const p of plan) {
    await prisma.tenantStatusLog.update({ where: { id: p.logId }, data: { reason: p.reason } })
  }
  console.log(`\n적용 완료 ${plan.length}건`)
}
main().finally(() => prisma.$disconnect())
