'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { asDocNameStyle } from '@/lib/documentName'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireEdit } from '@/lib/role'
import { documentLeaseRank } from '@/lib/documentLease'

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
  /** 발급 당시 성명 표기 — 파일 이름을 그 종이와 같은 표기로 맞춘다. 옛 발급본은 null(한글). */
  nameStyle: 'ko' | 'en' | 'native' | null
  // 이 발급본이 어느 계약의 것인가 — '다시 작성'이 같은 계약으로 돌아가려면 필요하다.
  // 계약이 끊긴 옛 발급본은 null 이고, 그때는 지목 없이 종전 추론으로 연다.
  leaseTermId: string | null
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
      id: true, fileName: true, kind: true, issuedAt: true, driveFileId: true, leaseTermId: true, nameStyle: true,
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
    nameStyle: asDocNameStyle(r.nameStyle) ?? null,
    leaseTermId: r.leaseTermId,
    roomNo: r.leaseTerm?.room?.roomNo ?? null,
    status: r.leaseTerm?.status ?? null,
    kind: r.kind === 'deposit' ? 'deposit' as const : 'rent' as const,
  }))
}

export type IssuableTenant = { tenantId: string; tenantName: string; roomNo: string | null; status: string }

// kind='deposit' 이면 예약 확정(RESERVED)도 대상 — 보증금은 입주 전에 받고 그 자리에서 영수증을 준다.
// 비거주(NON_RESIDENT)도 두 종류 모두 대상이다 — 방을 쓰지 않아도 이용료·보증금은 실제로 오간다.
export async function getIssuableTenants(kind: 'rent' | 'deposit' = 'rent'): Promise<IssuableTenant[]> {
  const propertyId = await getPropertyId()
  const leases = await prisma.leaseTerm.findMany({
    // 퇴실 예정자도 발급 대상이다 — 목록에 없으면 이름 검색조차 안 된다
    where: { propertyId, status: kind === 'deposit' ? { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT'] } : { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    orderBy: [{ moveInDate: 'desc' }],
    select: { status: true, tenant: { select: { id: true, name: true } }, room: { select: { roomNo: true } } },
  })
  // 중복 제거 전 정렬 — 발급 상세(getRentReceiptData)와 **문자 그대로 같은** 규칙을 쓴다
  // (lib/documentLease 정본). 거주·비거주 계약을 함께 가진 입실자의 배지가 '비거주'로 잘못 붙는 것을
  // 막는다. Array.sort 는 안정 정렬이라 우선순위가 같은 계약끼리는 위 orderBy 순서가 그대로 남는다.
  const ranked = [...leases].sort((a, b) => documentLeaseRank(a.status) - documentLeaseRank(b.status))
  const seen = new Set<string>()
  const out: IssuableTenant[] = []
  for (const l of ranked) {
    if (seen.has(l.tenant.id)) continue
    seen.add(l.tenant.id)
    out.push({ tenantId: l.tenant.id, tenantName: l.tenant.name, roomNo: l.room?.roomNo ?? null, status: l.status })
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
