'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'

async function getPropertyId(): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

export type ContractListRow = {
  id: string
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  viewUrl: string
  tenantId: string
  tenantName: string
  roomNo: string | null
  status: string | null
}

// 영업장 전체 계약서 파일 — 통합 페이지(/contracts)용. 입주자·호실 정보 조인.
export async function getAllContractFiles(): Promise<ContractListRow[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.contractFile.findMany({
    where: { propertyId },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, fileName: true, source: true, signedAt: true, driveFileId: true,
      tenant: { select: { id: true, name: true } },
      leaseTerm: { select: { status: true, room: { select: { roomNo: true } } } },
    },
  })
  return rows.map(r => ({
    id: r.id,
    fileName: r.fileName,
    source: r.source as 'GENERATED' | 'UPLOADED',
    signedAt: r.signedAt,
    viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
    tenantId: r.tenant.id,
    tenantName: r.tenant.name,
    roomNo: r.leaseTerm?.room?.roomNo ?? null,
    status: r.leaseTerm?.status ?? null,
  }))
}
