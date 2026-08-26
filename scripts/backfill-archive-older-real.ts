// 실계약 2부 이상인 계약 정리 — 가장 최근 것만 실계약으로 두고 나머지를 보관용으로 내린다.
//   예행: npx tsx --env-file=.env.local scripts/backfill-archive-older-real.ts
//   적용: npx tsx --env-file=.env.local scripts/backfill-archive-older-real.ts --apply
//
// 왜 필요한가. 실계약 중복 발급에 아무 검사가 없던 동안(2026-08-26 이전) 한 계약에 유효
// 실계약이 둘 이상 쌓였다. 그 상태는 "어느 종이가 계약인가"에 앱이 두 답을 갖는 것이라
// 표시 문제가 아니라 증빙 문제다.
//
// **판정 기준은 운영자 지시다(2026-08-26)** — "기본적으로 가장 최근 계약서가 실계약이라고
// 생각하면 돼". 앱의 대표 판정(currentIssueFor)도 같은 자를 쓴다(createdAt 최신). 즉 이 백필은
// 화면이 이미 대표로 보여 주던 그 부를 실계약으로 굳히고, 나머지의 지위만 사실에 맞춘다.
//
// 이 백필은 홀로 서지 않는다. 생성 경로는 이미 막혔고(발급·스캔 두 자리에서 승낙 없이는
// 실계약 2부가 안 생긴다), 재발은 감지망 축 ⓔ 가 센다. 셋이 한 벌이다.
//
// 발급 시점 증거(issuePurpose)는 건드리지 않는다. 지위만 purposeOverride 로 옮기고 이력을 남긴다.
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { withEffectivePurpose, contractPurposeOf, parsePurposeLog, archivePurposeLogEntry } from '../lib/contractPurpose'
import { isRepresentativeCandidate } from '../lib/contractCurrentIssue'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const all = await prisma.contractFile.findMany({
    where: { deletedAt: null, driveFileId: { not: '' }, leaseTermId: { not: null } },
    select: {
      id: true, contractNo: true, fileName: true, source: true, signedAt: true, createdAt: true,
      leaseTermId: true, voidedAt: true, issuePurpose: true, purposeOverride: true, purposeLog: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { status: true, room: { select: { roomNo: true } } } },
    },
  })

  const groups = new Map<string, typeof all>()
  for (const r of all) {
    const g = groups.get(r.leaseTermId!) ?? []
    g.push(r)
    groups.set(r.leaseTermId!, g)
  }

  let planned = 0
  const at = new Date()
  for (const [, files] of groups) {
    const live = files.filter(f => isRepresentativeCandidate(withEffectivePurpose(f)))
    if (live.length < 2) continue
    // 가장 최근 = createdAt 최신. 앱의 대표 판정과 같은 자다(둘이 갈리면 화면과 데이터가 어긋난다).
    const sorted = [...live].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const keep = sorted[0]
    const demote = sorted.slice(1)
    const head = files[0]
    console.log(`\n--- ${head.leaseTerm?.room?.roomNo ?? '?'}호 ${head.tenant.name} · ${head.leaseTerm?.status}`)
    console.log(`    남길 실계약  ${keep.contractNo ?? '(번호없음)'} ${keep.source} 서명 ${keep.signedAt.toISOString().slice(0, 10)} 생성 ${keep.createdAt.toISOString().slice(0, 10)}`)
    for (const d of demote) {
      console.log(`    보관용으로   ${d.contractNo ?? '(번호없음)'} ${d.source} 서명 ${d.signedAt.toISOString().slice(0, 10)} 생성 ${d.createdAt.toISOString().slice(0, 10)}`)
      planned++
      if (!APPLY) continue
      const log = parsePurposeLog(d.purposeLog)
      log.push(archivePurposeLogEntry({
        from: contractPurposeOf(d.purposeOverride ?? d.issuePurpose),
        by: null, at, sourceFileId: keep.id,
      }))
      await prisma.contractFile.update({
        where: { id: d.id },
        data: { purposeOverride: '보관용', purposeLog: log as unknown as Prisma.InputJsonValue },
      })
    }
  }

  console.log(`\n${APPLY ? '적용' : '예행'} — 보관용으로 내릴 계약서 ${planned}건`)
  if (!APPLY && planned > 0) console.log('적용하려면 --apply 를 붙여 다시 실행하세요.')
  await prisma.$disconnect()
}

main()
