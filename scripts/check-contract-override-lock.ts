// 서명이 끝난 계약의 본문이 뒤에 바뀌었는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-04).
//
// [본문 편집]과 [공통 템플릿으로]가 서명 유무를 안 보고 열려 있었다. 화면에도 서버에도 가드가 없어
// 서명받은 내용과 다른 계약서로 갈아치울 수 있었다(운영자 신고). 잠금을 넣었으니 그 잠금이
// 다시 사라지는지를 지킨다.
//
// **언제 바뀌었나는 판정할 수 없다.** contractOverride 가 바뀐 시각이 DB 에 없고, updatedAt 은
// 임대료 변경·퇴실 정산에도 밀려서 근거가 못 된다(계약서 6/29 발급인데 값이 7/1 인 lease 가 실재한다).
// 그래서 시각이 아니라 **결과**로 판정한다 — 서명본 스냅샷이 '그 사람이 서명한 본문'의 사본이므로,
// 지금 override 가 그것과 다르다는 사실만으로 서명 후 변경이 증명된다. 순서를 몰라도 결론이 난다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type Snapshot = { template?: unknown; lease?: unknown }

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  // ── 축 G2·G3·G4 — 서명 시점 본문 격리 ────────────────────────────
  // 공통 템플릿을 고쳐도 서명이 끝난 계약서가 안 바뀌어야 한다(운영자 오더 "절대로").
  const leases = await prisma.leaseTerm.findMany({
    select: {
      id: true, signatureImageUrl: true, signatureSignedAt: true,
      disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
      signedContractSnapshot: true, contractOverride: true,
      tenant: { select: { name: true } },
    },
  })
  const fileIds = new Set((await prisma.contractFile.findMany({
    where: { deletedAt: null }, select: { id: true },
  })).map(f => f.id))

  for (const l of leases) {
    const who = l.tenant?.name ?? '?'
    const hasSig = !!(l.signatureImageUrl || l.signatureSignedAt || l.disposalSignatureImageUrl || l.disposalSignatureSignedAt)
    const snap = l.signedContractSnapshot as { origin?: string; template?: unknown; sourceContractFileId?: string } | null

    // G2 — 서명이 있으면 격리본이 반드시 있다. 없으면 그 계약은 다음 발급에서 현재 본문으로 나간다.
    if (hasSig && !snap) {
      violations.push(`${who} 의 서명에 본문 격리본이 없다 — 공통 템플릿이 바뀌면 재발급본이 서명 당시와 달라진다`)
      continue
    }
    if (!snap) continue

    // G3 — 본문 담은 격리본은 origin 과 template 이 짝이 맞아야 한다.
    const bodyOrigins = ['REMOTE_LINK', 'IN_PERSON']
    if (bodyOrigins.includes(snap.origin ?? '') && !snap.template) {
      violations.push(`${who} 의 격리본이 ${snap.origin} 인데 본문이 없다 — 박제가 반쪽만 됐다`)
    }
    // G4 — 본문 없는 격리본은 가리키는 증거 파일이 실재해야 한다. 허공을 가리키면 증거가 없는 것이다.
    if (!bodyOrigins.includes(snap.origin ?? '')) {
      if (!snap.sourceContractFileId || !fileIds.has(snap.sourceContractFileId)) {
        violations.push(`${who} 의 격리본이 가리키는 계약서 파일이 없다 — 서명 원본의 증거가 사라졌다`)
      }
    }
  }

  const links = await prisma.contractShareLink.findMany({
    where: { NOT: { signedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      leaseTermId: true, templateSnapshot: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { contractOverride: true } },
    },
  })

  // 한 lease 에 링크가 여럿이면 가장 최근 서명본이 기준이다
  const seen = new Set<string>()
  let checked = 0
  for (const k of links) {
    if (!k.leaseTermId || seen.has(k.leaseTermId)) continue
    seen.add(k.leaseTermId)
    const snapTemplate = (k.templateSnapshot as Snapshot | null)?.template
    if (snapTemplate === undefined) continue
    checked++
    const now = JSON.stringify(snapTemplate)

    // 축 G1 — 이 lease 가 개별 수정본을 갖고 있는데 그 값이 서명본과 다르다.
    //   override 가 null 이면 후보에서 빠진다 — 영업장 공통 템플릿이 바뀌어 생긴 드리프트는
    //   이 축에 섞이지 않는다. 이 축은 **본문 편집이라는 행위만** 본다.
    const ov = k.leaseTerm?.contractOverride
    if (ov != null && JSON.stringify(ov) !== now) {
      violations.push(`${k.tenant?.name ?? '?'} 의 계약서 본문이 서명본과 다르다 — 서명 후 본문 편집이 일어났다`)
    }

  }

  await prisma.$disconnect()

  console.log(`[본문 잠금·격리] 서명 계약 ${leases.filter(l => !!l.signedContractSnapshot).length}건 격리됨 · 서명본 ${checked}건 대조 / 위반 ${violations.length}건`)
  if (violations.length) {
    console.error(`\n[본문 잠금] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  서명이 완료된 계약서는 본문을 고칠 수 없다. 내용을 바꾸려면 재서명을 받는다.')
    process.exit(1)
  }
}

main()
