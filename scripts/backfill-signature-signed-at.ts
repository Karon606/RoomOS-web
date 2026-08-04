// 서명 시각 백필 — 계약일이 '오늘'로 찍히던 결함의 과거분 정리 (2026-08-04, 운영자 승인).
//
// LeaseTerm 에 서명 시각 칸이 없어서 발급 때마다 오늘이 계약일로 박혔다. 칸을 새로 냈으니
// 이미 서명이 있는 건들의 시각을 근거 있는 값으로 채운다. 안 채우면 그 건들은 재발급 때
// 여전히 오늘로 나간다 — 근본 수정만 하고 과거를 두면 결함이 절반만 닫힌다.
//
// 근거는 둘이고 신뢰도가 다르다.
//   1) 원격 — ContractShareLink.signedAt. 서명 이미지와 같은 트랜잭션에서 쓰인 값이라 신뢰도 최상
//   2) 대면 — 그 lease 의 GENERATED ContractFile 중 가장 이른 createdAt. 발급 시각이지 서명 시각은
//      아니지만, 대면 흐름은 같은 세션에서 서명하고 곧바로 발급하므로 **날짜 단위로는 일치**한다.
//      화면은 날짜만 쓰므로 충분하다. 시각 단위 정밀도는 없다는 것을 알고 쓴다.
//
// 이미 값이 있는 행은 절대 덮지 않는다. 기본은 미리보기이고 --apply 로만 쓴다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const leases = await prisma.leaseTerm.findMany({
    where: {
      OR: [{ signatureImageUrl: { not: null } }, { disposalSignatureImageUrl: { not: null } }],
    },
    select: {
      id: true, signatureImageUrl: true, disposalSignatureImageUrl: true,
      signatureSignedAt: true, disposalSignatureSignedAt: true,
      tenant: { select: { name: true } },
    },
  })

  type Plan = { id: string; who: string; sig?: Date; disposal?: Date; via: string }
  const plans: Plan[] = []

  for (const l of leases) {
    // 이미 둘 다 채워졌으면 건너뛴다
    const needSig = !!l.signatureImageUrl && !l.signatureSignedAt
    const needDisposal = !!l.disposalSignatureImageUrl && !l.disposalSignatureSignedAt
    if (!needSig && !needDisposal) continue

    const link = await prisma.contractShareLink.findFirst({
      where: { leaseTermId: l.id, signedAt: { not: null } },
      orderBy: { signedAt: 'desc' },
      select: { signedAt: true, disposalSignedAt: true },
    })

    if (link?.signedAt) {
      plans.push({
        id: l.id, who: l.tenant?.name ?? '?', via: '원격 링크',
        ...(needSig ? { sig: link.signedAt } : {}),
        ...(needDisposal ? { disposal: link.disposalSignedAt ?? link.signedAt } : {}),
      })
      continue
    }

    const file = await prisma.contractFile.findFirst({
      where: { leaseTermId: l.id, source: 'GENERATED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    if (!file) continue   // 근거가 없으면 채우지 않는다. 지어내지 않는다
    plans.push({
      id: l.id, who: l.tenant?.name ?? '?', via: '발급본 생성 시각',
      ...(needSig ? { sig: file.createdAt } : {}),
      ...(needDisposal ? { disposal: file.createdAt } : {}),
    })
  }

  console.log(`서명 보유 lease ${leases.length}건 · 채울 대상 ${plans.length}건${APPLY ? '' : ' (미리보기)'}`)
  for (const p of plans) {
    const parts = [p.sig && `계약서 ${p.sig.toISOString()}`, p.disposal && `동의서 ${p.disposal.toISOString()}`].filter(Boolean)
    console.log(`  - ${p.who} (${p.via}) ${parts.join(' · ')}`)
  }
  const skipped = leases.filter(l =>
    (!!l.signatureImageUrl && !l.signatureSignedAt) || (!!l.disposalSignatureImageUrl && !l.disposalSignatureSignedAt))
    .filter(l => !plans.some(p => p.id === l.id))
  if (skipped.length) {
    console.log(`\n근거가 없어 건너뛴 ${skipped.length}건 (그대로 둔다)`)
    for (const l of skipped) console.log(`  - ${l.tenant?.name ?? '?'}`)
  }

  if (!APPLY) {
    console.log('\n--apply 를 붙이면 실제로 씁니다.')
    await prisma.$disconnect(); return
  }
  for (const p of plans) {
    await prisma.leaseTerm.update({
      where: { id: p.id },
      data: { ...(p.sig ? { signatureSignedAt: p.sig } : {}), ...(p.disposal ? { disposalSignatureSignedAt: p.disposal } : {}) },
    })
  }
  const left = await prisma.leaseTerm.count({ where: { signatureImageUrl: { not: null }, signatureSignedAt: null } })
  console.log(`\n적용 완료 ${plans.length}건 · 아직 시각 없는 서명 ${left}건`)
  await prisma.$disconnect()
}

main()
