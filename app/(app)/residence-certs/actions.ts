'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { asDocNameStyle, documentName } from '@/lib/documentName'
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

export type ResidenceCertListRow = {
  id: string
  fileName: string
  issuedAt: Date
  viewUrl: string
  driveFileId: string
  tenantId: string
  tenantName: string
  /** 그 종이에 찍힌 이름 — 파일 이름이 이 값을 쓴다(영문으로 낸 서류는 파일도 영문이어야 한다). */
  docName: string
  /** 발급 당시 성명 표기 — 파일 이름을 그 종이와 같은 표기로 맞춘다. 옛 발급본은 null(한글). */
  nameStyle: 'ko' | 'en' | 'native' | null
  // 이 발급본이 어느 계약의 것인가 — '다시 작성'이 같은 계약으로 돌아가려면 필요하다.
  // 계약이 끊긴 옛 발급본은 null 이고, 그때는 지목 없이 종전 추론으로 연다.
  leaseTermId: string | null
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
      id: true, fileName: true, issuedAt: true, driveFileId: true, leaseTermId: true, nameStyle: true,
      tenant: { select: { id: true, name: true, englishName: true, nativeName: true } },
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
    // 파일 이름은 종이에 찍힌 그 이름을 쓴다. 종전에는 서류 종류만 표기를 따르고 사람 이름은
    // 늘 한글이라, 영문으로 낸 서류가 '아라파트 에야신_Proof of Residence.pdf' 로 나갔다
    // (2026-08-31 운영자 지적).
    docName: documentName(r.tenant, asDocNameStyle(r.nameStyle)),
    nameStyle: asDocNameStyle(r.nameStyle) ?? null,
    leaseTermId: r.leaseTermId,
    roomNo: r.leaseTerm?.room?.roomNo ?? null,
    status: r.leaseTerm?.status ?? null,
  }))
}

export type IssuableTenant = { tenantId: string; tenantName: string; roomNo: string | null; status: string }

// 발급 대상 — 거주중(ACTIVE)·퇴실 예정(CHECKOUT_PENDING)·비거주(NON_RESIDENT) 입실자. 호실 오름차순.
// 비거주 등록자도 실거주확인서 발급이 필요하고(신고 ace54135), 퇴실 예정자는 아직 거주 중이라 포함한다(운영자 승인 2026-07-22).
// 발급 목록 노출은 공실 집계(lib/vacancy)와 무관하다.
export async function getIssuableTenants(): Promise<IssuableTenant[]> {
  const propertyId = await getPropertyId()
  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    orderBy: [{ moveInDate: 'desc' }],
    select: {
      status: true,
      tenant: { select: { id: true, name: true } },
      room: { select: { roomNo: true } },
    },
  })
  // 입실자 중복 제거(여러 lease 가능성 대비) — 발급 상세(getResidenceCertData)와 **문자 그대로 같은**
  // 규칙을 쓴다(lib/documentLease 정본). 거주·비거주 계약을 동시에 가진 입실자의 배지가 '비거주'로
  // 잘못 붙지 않게 한다. 목록과 상세가 다른 계약을 고르면 배지와 발급 내용이 갈린다.
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
