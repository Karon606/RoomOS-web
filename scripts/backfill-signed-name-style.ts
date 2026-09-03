// 서명 시점 표기를 링크 스냅샷에서 박제로 옮겨 적는 백필 — 기본은 예행, --apply 로만 적용.
//
// 왜 필요한가(신고 2026-09-04, 413호). signedContractSnapshot 에 nameStyle 칸이 생기기 전에
// 서명된 계약은 그 값이 없다. 그래서 수정을 배포해도 여전히 오버라이드나 'ko' 로 읽힌다.
//
// **이것은 추정이 아니라 기록 낭독이다.** 근거는 그 서명을 만든 링크의 templateSnapshot 이고,
// 원격 화면은 DB 를 다시 안 읽으므로 그 JSON 이 곧 입주자가 눈으로 보고 손으로 서명한 종이다.
import prisma from '../lib/prisma'
import { asDocNameStyle } from '../lib/documentName'

const apply = process.argv.includes('--apply')

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { signatureSignedAt: { not: null } },
    select: { id: true, signedContractSnapshot: true, signatureSignedAt: true,
      room: { select: { roomNo: true } }, tenant: { select: { name: true } } },
  })
  const plan: { id: string; who: string; style: string; name: string }[] = []
  for (const l of leases) {
    const snap = l.signedContractSnapshot as Record<string, unknown> | null
    if (!snap) continue                       // 박제 자체가 없으면 얹을 자리가 없다
    if (snap.nameStyle !== undefined) continue // 이미 있으면 손대지 않는다
    // 이 서명을 만든 링크 — 서명 시각 이전에 나간 것 중 가장 최근.
    const link = await prisma.contractShareLink.findFirst({
      where: { leaseTermId: l.id, signedAt: { not: null } },
      orderBy: { signedAt: 'desc' },
      select: { templateSnapshot: true },
    })
    const ts = link?.templateSnapshot as { lease?: { nameStyle?: unknown }; tenant?: { name?: unknown } } | null
    const style = asDocNameStyle(ts?.lease?.nameStyle)
    if (!style) continue                      // 근거가 없으면 지어내지 않는다
    const printed = typeof ts?.tenant?.name === 'string' ? ts.tenant.name : ''
    plan.push({ id: l.id, who: `${l.room?.roomNo ?? '-'}호 ${l.tenant?.name}`, style, name: printed })
  }
  console.log(`\n서명 완료 ${leases.length}건 중 링크 근거로 표기를 채울 수 있는 것 ${plan.length}건\n`)
  for (const p of plan) console.log(`  ${p.who.padEnd(24)} nameStyle=${p.style.padEnd(6)} 인쇄명=${p.name}`)
  if (!apply) { console.log('\n예행이다. 적용하려면 --apply 를 붙인다.'); return }
  for (const p of plan) {
    const l = await prisma.leaseTerm.findUnique({ where: { id: p.id }, select: { signedContractSnapshot: true } })
    const snap = (l?.signedContractSnapshot ?? {}) as Record<string, unknown>
    await prisma.leaseTerm.update({
      where: { id: p.id },
      data: { signedContractSnapshot: { ...snap, nameStyle: p.style, printedName: p.name || null } },
    })
  }
  console.log(`\n적용 완료 ${plan.length}건`)
}
main().finally(() => prisma.$disconnect())
