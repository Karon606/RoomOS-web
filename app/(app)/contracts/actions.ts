'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

export type ContractListRow = {
  id: string
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  viewUrl: string
  driveFileId: string
  tenantId: string
  tenantName: string
  roomNo: string | null
  status: string | null
}

// 거주 중 성격의 lease 상태 — 이 중 하나라도 있으면 입주자는 '거주중'.
const RESIDING_STATUSES = new Set(['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'])

// 입주자의 '대표 lease' — 거주성 lease가 있으면 그것, 없으면 최신(보통 퇴실/취소).
// 계약서 파일이 lease에 연결돼 있지 않을 때(업로드 스캔본 등) 분류·호실 판정에 사용.
function effectiveLease<T extends { status: string }>(leases: T[]): T | null {
  if (!leases.length) return null
  return leases.find(l => RESIDING_STATUSES.has(l.status)) ?? leases[0]
}

// 영업장 전체 계약서 파일 — 통합 페이지(/contracts)용. 입주자·호실 정보 조인.
export async function getAllContractFiles(): Promise<ContractListRow[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.contractFile.findMany({
    where: { driveFileId: { not: '' }, propertyId, deletedAt: null },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, fileName: true, source: true, signedAt: true, driveFileId: true,
      tenant: {
        select: {
          id: true, name: true,
          // 파일이 lease에 연결 안 됐을 때(업로드본) 입주자 상태로 분류하기 위한 폴백.
          leaseTerms: {
            select: { status: true, room: { select: { roomNo: true } } },
            orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          },
        },
      },
      leaseTerm: { select: { status: true, room: { select: { roomNo: true } } } },
    },
  })
  return rows.map(r => {
    // 파일에 직접 연결된 lease 우선, 없으면 입주자의 대표 lease로 폴백(퇴실 분류 누락 방지).
    const lease = r.leaseTerm ?? effectiveLease(r.tenant.leaseTerms)
    return {
      id: r.id,
      fileName: r.fileName,
      source: r.source as 'GENERATED' | 'UPLOADED',
      signedAt: r.signedAt,
      viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
      driveFileId: r.driveFileId,
      tenantId: r.tenant.id,
      tenantName: r.tenant.name,
      roomNo: lease?.room?.roomNo ?? null,
      status: lease?.status ?? null,
    }
  })
}
