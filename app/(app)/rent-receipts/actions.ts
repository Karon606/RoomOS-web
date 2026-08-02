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

export type RentReceiptListRow = {
  id: string
  fileName: string
  issuedAt: Date
  viewUrl: string
  driveFileId: string
  tenantId: string
  tenantName: string
  roomNo: string | null
  status: string | null
  kind: 'rent' | 'deposit'   // 서류 종류 — 파일명 접두 추론이 아닌 컬럼 정본
}

export async function getAllRentReceiptFiles(): Promise<RentReceiptListRow[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.rentReceiptFile.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, fileName: true, kind: true, issuedAt: true, driveFileId: true,
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
    kind: r.kind === 'deposit' ? 'deposit' as const : 'rent' as const,
  }))
}

export type IssuableTenant = { tenantId: string; tenantName: string; roomNo: string | null }

// kind='deposit' 이면 예약 확정(RESERVED)도 대상 — 보증금은 입주 전에 받고 그 자리에서 영수증을 준다.
// 이용료 확인서는 기존대로 거주중만(입주 전엔 낼 이용료가 없다).
export async function getIssuableTenants(kind: 'rent' | 'deposit' = 'rent'): Promise<IssuableTenant[]> {
  const propertyId = await getPropertyId()
  const leases = await prisma.leaseTerm.findMany({
    // 퇴실 예정자도 발급 대상이다 — 목록에 없으면 이름 검색조차 안 된다
    where: { propertyId, status: kind === 'deposit' ? { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'] } : { in: ['ACTIVE', 'CHECKOUT_PENDING'] } },
    orderBy: [{ moveInDate: 'desc' }],
    select: { tenant: { select: { id: true, name: true } }, room: { select: { roomNo: true } } },
  })
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

export async function deleteRentReceiptFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { trashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.rentReceiptFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    // 소프트삭제 — Drive 휴지통 + deletedAt. 적용취소는 restoreRentReceiptFile.
    try { await trashInDrive(file.driveFileId) } catch { /* Drive 정리 실패 무시 */ }
    await prisma.rentReceiptFile.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/rent-receipts')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

export async function restoreRentReceiptFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const { untrashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.rentReceiptFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    try { await untrashInDrive(file.driveFileId) } catch { /* Drive 복구 실패 무시 */ }
    await prisma.rentReceiptFile.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/rent-receipts')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복구에 실패했습니다.' }
  }
}
