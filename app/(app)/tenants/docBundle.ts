'use server'

// 입주자 한 사람의 '서류 보내기' 후보 조회 — 행 규칙은 lib/docBundle 정본이 정하고 여기는 읽어 넘긴다.
// 규칙과 조회를 가른 이유는 실데이터 대조·회귀 케이스가 화면과 같은 함수를 통과하게 하려는 것이다.
//
// 조회 범위 — 이 영업장, 이 사람, deletedAt null. 발급 대상 상태(CONTRACT_ISSUE_STATUSES)의 계약만
// 연다(투어 단계 계약에는 뽑을 종이가 없다). 파일은 종류마다 최신순으로 넘기고 정본이 계약별 최신을 고른다.

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { CONTRACT_ISSUE_STATUSES } from '@/lib/leaseStatus'
import { buildDocBundle, type DocBundleFile, type TenantDocBundle } from '@/lib/docBundle'
import { currentIssueIds } from '@/lib/contractCurrentIssue'

export async function getTenantDocBundle(tenantId: string): Promise<TenantDocBundle | null> {
  const { propertyId } = await requirePropertyAccess()
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, propertyId }, select: { name: true } })
  if (!tenant) return null

  const [leases, contractRows, receiptRows, certRows] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { tenantId, propertyId, status: { in: CONTRACT_ISSUE_STATUSES } },
      select: {
        id: true, status: true, moveInDate: true, depositAmount: true, parentLeaseTermId: true,
        room: { select: { roomNo: true } },
      },
    }),
    prisma.contractFile.findMany({
      where: { tenantId, propertyId, deletedAt: null, driveFileId: { not: '' } },
      orderBy: [{ createdAt: 'desc' }],
      // 폐기본·구버전·파생 판본을 가리려면 판정 축을 함께 읽어야 한다. 종전에는 voidedAt 을
      // select 조차 안 해서 **폐기된 계약서가 그 사람의 계약서로 발송 후보에 올랐다.**
      select: {
        id: true, driveFileId: true, leaseTermId: true, signedAt: true, source: true,
        createdAt: true, voidedAt: true, supersededAt: true, issuePurpose: true,
      },
    }),
    prisma.rentReceiptFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true, kind: true },
    }),
    prisma.residenceCertFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      select: { driveFileId: true, leaseTermId: true, issuedAt: true },
    }),
  ])

  const representativeIds = new Set(currentIssueIds(contractRows).values())

  const receipt = (kind: 'rent' | 'deposit'): DocBundleFile[] => receiptRows
    .filter(r => (kind === 'deposit' ? r.kind === 'deposit' : r.kind !== 'deposit'))
    .map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null }))

  return buildDocBundle({
    tenantName: tenant.name,
    leases: leases.map(l => ({
      id: l.id, status: l.status, moveInDate: l.moveInDate, depositAmount: l.depositAmount,
      parentLeaseTermId: l.parentLeaseTermId, roomNo: l.room?.roomNo ?? null,
    })),
    // 계약서 행은 **대표 한 부**만 후보다(lib/contractCurrentIssue 정본). 폐기본을 보내는 일도,
    // 제출용·번역본이 실계약 자리에 서는 일도 여기서 막힌다. 화면 둘과 같은 판정을 쓴다.
    contracts: contractRows.filter(r => representativeIds.has(r.id)).map(r => ({
      driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.signedAt,
      note: r.source === 'UPLOADED' ? '스캔본' : null,
    })),
    rents: receipt('rent'),
    deposits: receipt('deposit'),
    certs: certRows.map(r => ({ driveFileId: r.driveFileId, leaseTermId: r.leaseTermId, at: r.issuedAt, note: null })),
    now: new Date(),
  })
}
