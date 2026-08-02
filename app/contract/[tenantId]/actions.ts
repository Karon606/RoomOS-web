'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getMyRole } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { type ContractTemplate } from '@/lib/contract'
import { buildContractData } from '@/lib/contractData'

// ContractData 타입·조립 로직은 lib/contractData.ts 로 이동(원격 서명 링크 스냅샷과 공유).
// 기존 소비처(ContractView 등)의 import 경로 유지를 위해 타입만 재수출.
export type { ContractData } from '@/lib/contractData'

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

export async function getContractData(tenantId: string) {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()
  return buildContractData(tenantId, propertyId)
}

// ── 입실자별 본문 오버라이드 저장/리셋 ─────────────────────────────

export async function saveContractOverride(
  leaseTermId: string,
  template: ContractTemplate,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    if (!template?.title?.trim()) return { ok: false, error: '계약서 제목이 비어 있습니다.' }
    // 본인 영업장 lease만 허용
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractOverride: template as unknown as object },
    })
    revalidatePath(`/contract`)
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

export async function resetContractOverride(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractOverride: { set: null } },
    })
    revalidatePath(`/contract`)
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '초기화에 실패했습니다.' }
  }
}

// 계약서 화면에서 흡연 여부를 바꾸면 입실자(고객정보)에 바로 저장 — 고객정보가 단일 출처.
export async function setTenantSmoking(
  tenantId: string,
  smoking: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const t = await prisma.tenant.findFirst({ where: { id: tenantId, propertyId }, select: { id: true } })
    if (!t) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    await prisma.tenant.update({ where: { id: tenantId }, data: { smoking } })
    revalidatePath('/contract')
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}
