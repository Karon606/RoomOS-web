// 축 통일 전후 대조 — 홈 알림·패널 배지가 링크 축에서 계약 축으로 옮길 때 **지금 화면에 뜨는
// 건의 판정이 바뀌는지**를 실DB로 확인한다. 읽기 전용, 화면 노출 건의 변화가 있으면 exit 1.
//
// 왜 있나(2026-09-06). 서명 증거가 두 군데 있고 화면 셋이 섞어 읽고 있었다(37건 중 15건 갈림,
// knowledge/sign-evidence-axes.md). 축을 계약 쪽으로 통일하는데, 잠복 15건의 해석이 바뀌는 것은
// 의도이고 **지금 눈에 보이는 건이 바뀌는 것은 사고**다. 그 둘을 갈라 증명한다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { signStageSlots } from '../lib/disposalSignGate'
import { signAlertDue } from '../lib/disposalSignGate'
import { paperDocsOf, leaseSignSlots, linkSignSlots } from '../lib/signDocuments'
import { isContractIssued, issuingLeaseId } from '../lib/contractIssue'

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const files = await db.contractFile.findMany({ select: { leaseTermId: true, createdAt: true } })
  const refs = files.flatMap(f => f.leaseTermId ? [{ leaseTermId: f.leaseTermId, createdAt: f.createdAt }] : [])
  const links = await db.contractShareLink.findMany({
    where: { OR: [{ signedAt: { not: null } }, { disposalSignedAt: { not: null } }] },
    select: {
      id: true, createdAt: true, signedAt: true, disposalSignedAt: true, docSignedAt: true,
      submittedAt: true, expiresAt: true, lockedAt: true, leaseTermId: true, templateSnapshot: true,
      tenant: { select: { name: true } },
      leaseTerm: {
        select: {
          parentLeaseTermId: true, signatureImageUrl: true, signatureSignedAt: true,
          disposalSignatureImageUrl: true, disposalSignatureSignedAt: true, documentSignatures: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const shownChanged: string[] = []
  let latent = 0, shown = 0
  for (const l of links) {
    const docs = paperDocsOf(l.templateSnapshot)
    const before = signStageSlots({ slots: linkSignSlots(docs, l) })
    const after = signStageSlots({ slots: leaseSignSlots(docs, l.leaseTerm) })

    // 이 링크가 지금 홈 알림에 뜨는가(alerts.ts 의 게이트를 그대로 재현한다).
    const signalAt = l.signedAt ?? l.disposalSignedAt
    const issued = signalAt ? isContractIssued(signalAt, issuingLeaseId(l.leaseTermId, l.leaseTerm.parentLeaseTermId), refs) : true
    const due = signAlertDue({
      disposalEnabled: docs.some(d => d.key === 'disposal'),
      hasContractSignature: !!l.signedAt, hasDisposalSignature: !!l.disposalSignedAt,
      submitted: !!l.submittedAt, linkDead: !!l.lockedAt || l.expiresAt <= new Date(),
    })
    const visible = !!signalAt && !issued && due && before !== 'none'

    if (before === after) continue
    if (visible) { shown++; shownChanged.push(`${l.createdAt.toISOString().slice(0, 10)} ${l.tenant.name} | ${before} -> ${after}`) }
    else latent++
  }

  console.log(`[축 통일 전후] 링크 ${links.length}건 · 판정이 바뀌는 것 ${latent + shown}건`)
  console.log(`  잠복(지금 화면에 안 뜸) ${latent}건 — 의도된 교정이다`)
  console.log(`  노출(지금 화면에 뜸) ${shown}건 — 0이어야 한다`)
  for (const s of shownChanged) console.error(`  - ${s}`)
  await db.$disconnect()
  process.exit(shown > 0 ? 1 : 0)
}
main()
