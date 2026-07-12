'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireEdit } from '@/lib/role'

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

export type ResidenceCertListRow = {
  id: string
  fileName: string
  issuedAt: Date
  viewUrl: string
  driveFileId: string
  tenantId: string
  tenantName: string
  roomNo: string | null
  status: string | null
}

// 영업장 전체 실거주 확인서 발급 파일 — 목록 페이지용.
export async function getAllResidenceCertFiles(): Promise<ResidenceCertListRow[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.residenceCertFile.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, fileName: true, issuedAt: true, driveFileId: true,
      tenant: { select: { id: true, name: true } },
      leaseTerm: { select: { status: true, room: { select: { roomNo: true } } } },
    },
  })
  return rows.map(r => ({
    id: r.id,
    fileName: r.fileName,
    issuedAt: r.issuedAt,
    viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
    driveFileId: r.driveFileId,
    tenantId: r.tenant.id,
    tenantName: r.tenant.name,
    roomNo: r.leaseTerm?.room?.roomNo ?? null,
    status: r.leaseTerm?.status ?? null,
  }))
}

export type IssuableTenant = { tenantId: string; tenantName: string; roomNo: string | null }

// 발급 대상 — 현재 거주중(ACTIVE) 입실자. 호실 오름차순.
export async function getIssuableTenants(): Promise<IssuableTenant[]> {
  const propertyId = await getPropertyId()
  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: 'ACTIVE' },
    orderBy: [{ moveInDate: 'desc' }],
    select: {
      tenant: { select: { id: true, name: true } },
      room: { select: { roomNo: true } },
    },
  })
  // 입실자 중복 제거(여러 ACTIVE lease 가능성 대비) — 첫 항목 유지
  const seen = new Set<string>()
  const out: IssuableTenant[] = []
  for (const l of leases) {
    if (seen.has(l.tenant.id)) continue
    seen.add(l.tenant.id)
    out.push({ tenantId: l.tenant.id, tenantName: l.tenant.name, roomNo: l.room?.roomNo ?? null })
  }
  out.sort((a, b) => (a.roomNo ?? '').localeCompare(b.roomNo ?? '', 'ko', { numeric: true }) || a.tenantName.localeCompare(b.tenantName, 'ko'))
  return out
}

export async function deleteResidenceCertFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { trashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.residenceCertFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    // 소프트삭제 — Drive 휴지통 + deletedAt. 적용취소는 restoreResidenceCertFile.
    try { await trashInDrive(file.driveFileId) } catch { /* Drive 정리 실패 무시 */ }
    await prisma.residenceCertFile.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/residence-certs')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

export async function restoreResidenceCertFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { untrashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.residenceCertFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    try { await untrashInDrive(file.driveFileId) } catch { /* Drive 복구 실패 무시 */ }
    await prisma.residenceCertFile.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/residence-certs')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복구에 실패했습니다.' }
  }
}
