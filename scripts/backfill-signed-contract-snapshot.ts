// 서명 시점 본문 백필 — 격리 칸의 과거분 (2026-08-04, 운영자 승인).
//
// 영업장 공통 계약서 본문을 고치면 서명이 끝난 계약서 내용이 소급해서 바뀌었다. 칸을 새로 냈으니
// 이미 서명이 있는 건들을 근거 있는 값으로 채운다. 안 채우면 그 건들은 재발급 때 여전히 현재 본문으로 나간다.
//
// 두 갈래이고 근거의 성질이 다르다.
//   A) 원격 — ContractShareLink.templateSnapshot. **입주자가 눈으로 읽고 손으로 서명한 것이 그 JSON 이다**
//      (원격 화면은 DB 를 다시 안 읽는다). 본문을 그대로 복원한다
//   B) 대면 — 서명 당시 본문 기록이 어디에도 없다. **본문을 지어내지 않는다.**
//      발급본 PDF 에서 텍스트를 꺼내는 것은 복원이 아니라 재구성이다 — 2단 조판으로 읽기 순서가
//      깨지고, 자리표시자가 이미 치환돼 있고, 불릿·줄바꿈이 조판으로 바뀌어 조항 경계를 못 되살린다.
//      대신 증거가 어디 있는지만 가리킨다. 그 계약은 앱이 새 발급본을 만들지 못하게 된다
//
// 이미 값이 있는 행은 절대 덮지 않는다. 기본은 미리보기이고 --apply 로만 쓴다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

type Snap = { template?: unknown; refundClauseInContract?: boolean; disposalConsent?: unknown; businessInfo?: unknown }

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  // Json 칸의 null 은 where 로 거르지 않는다 — DbNull 과 JsonNull 구분 때문에 조용히 0건이 된다.
  // 전부 읽고 코드에서 거른다. 대상이 수십 건이라 비용이 문제되지 않는다.
  const leases = await prisma.leaseTerm.findMany({
    select: {
      id: true, signatureImageUrl: true, signatureSignedAt: true,
      disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
      signedContractSnapshot: true,
      tenant: { select: { name: true } },
    },
  })
  const signed = leases.filter(l =>
    !l.signedContractSnapshot &&
    (l.signatureImageUrl || l.signatureSignedAt || l.disposalSignatureImageUrl || l.disposalSignatureSignedAt))

  type Plan = { id: string; who: string; via: string; value: object }
  const plans: Plan[] = []
  const skipped: string[] = []

  for (const l of signed) {
    const link = await prisma.contractShareLink.findFirst({
      where: { leaseTermId: l.id, NOT: { signedAt: null } },
      orderBy: { signedAt: 'desc' },
      select: { signedAt: true, templateSnapshot: true },
    })
    const snap = link?.templateSnapshot as Snap | null
    if (link?.signedAt && snap?.template) {
      plans.push({
        id: l.id, who: l.tenant?.name ?? '?', via: '원격 링크 스냅샷',
        value: {
          origin: 'REMOTE_LINK', capturedAt: link.signedAt.toISOString(),
          template: snap.template as object,
          refundClauseInContract: snap.refundClauseInContract ?? true,
          disposalConsent: (snap.disposalConsent ?? null) as object,
          businessInfo: (snap.businessInfo ?? null) as object,
        },
      })
      continue
    }
    const file = await prisma.contractFile.findFirst({
      where: { leaseTermId: l.id, source: 'GENERATED', deletedAt: null, NOT: { driveFileId: '' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    })
    if (!file) { skipped.push(l.tenant?.name ?? '?'); continue }
    plans.push({
      id: l.id, who: l.tenant?.name ?? '?', via: '발급본 PDF 포인터',
      value: {
        origin: 'LEGACY_PDF',
        capturedAt: (l.signatureSignedAt ?? file.createdAt).toISOString(),
        sourceContractFileId: file.id,
      },
    })
  }

  console.log(`서명 보유 lease ${signed.length}건 · 채울 대상 ${plans.length}건${APPLY ? '' : ' (미리보기)'}`)
  for (const p of plans) console.log(`  - ${p.who} (${p.via})`)
  if (skipped.length) {
    console.log(`\n근거가 없어 건너뛴 ${skipped.length}건 (그대로 둔다)`)
    for (const n of skipped) console.log(`  - ${n}`)
  }

  if (!APPLY) { console.log('\n--apply 를 붙이면 실제로 씁니다.'); await prisma.$disconnect(); return }
  for (const p of plans) {
    await prisma.leaseTerm.update({ where: { id: p.id }, data: { signedContractSnapshot: p.value } })
  }
  const after = await prisma.leaseTerm.findMany({
    select: { signatureSignedAt: true, signedContractSnapshot: true },
  })
  const left = after.filter(l => l.signatureSignedAt && !l.signedContractSnapshot).length
  console.log(`\n적용 완료 ${plans.length}건 · 아직 격리 안 된 서명 ${left}건`)
  await prisma.$disconnect()
}

main()
