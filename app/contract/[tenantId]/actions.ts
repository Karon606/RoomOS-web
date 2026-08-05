'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getMyRole } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { type ContractTemplate } from '@/lib/contract'
import { buildContractData } from '@/lib/contractData'
import {
  type ContractFieldOverridePatch,
  CONTRACT_FIELD_ERROR, deriveContractLeaseFields, normalizeContractFieldOverrides,
} from '@/lib/contractFieldOverrides'

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
// 서명이 확정된 계약인가 — 확정이면 본문을 못 고친다(운영자 규칙 2026-08-04).
// 네 칸 중 하나라도 있으면 잠금이다. OR 로 넓게 잡는 이유 셋.
//   1) 이미지와 시각 중 한쪽만 남는 반쪽 상태에서도 잠긴다 — 결손에 대해 안전한 쪽으로 실패한다
//   2) 동의서만 서명된 상태도 잠근다. 두 서명 다 계약서와 동의서가 함께 그려진 화면을 보고 한 것이다
//   3) 실측상 넓힘의 비용이 0 이다 — 반쪽 상태도 동의서만 서명된 건도 지금 0건이다
// '제출까지'로 잡지 않는 이유 — 제출은 원격 링크 전용이고 대면 서명에는 그 단계가 없다.
// 실측에서 서명만 하고 제출을 안 한 링크가 다섯 중 둘이었고 그 둘 다 발급까지 끝났다.
const SIGNED_LOCK_MSG = '서명이 완료된 계약서는 본문을 고칠 수 없습니다. 내용을 바꾸려면 재서명을 받아야 합니다.'
type SigCols = {
  signatureImageUrl: string | null
  signatureSignedAt: Date | null
  disposalSignatureImageUrl: string | null
  disposalSignatureSignedAt: Date | null
}
const isSignatureLocked = (l: SigCols) =>
  !!l.signatureImageUrl || !!l.signatureSignedAt || !!l.disposalSignatureImageUrl || !!l.disposalSignatureSignedAt

const FIELD_LOCK_MSG = '서명이 완료된 계약서라 표시값을 고칠 수 없습니다. 바꾸려면 재서명을 받아야 합니다.'

// 아직 서명이 안 들어온 활성 링크를 닫는다 — 계약서 내용을 고쳤으면 입주자가 보고 있는 것은
// 낡은 스냅샷이다(/sign 은 발급 시점 스냅샷만 그린다). 그대로 두면 운영자가 고친 적 없는
// 내용으로 서명이 들어온다. 닫힌 링크는 만료 전이면 reopen 으로 되돌릴 수 있다(contractShare.ts).
// 이미 서명·제출이 들어온 링크는 건드리지 않는다 — 그건 기록이지 대기 중인 요청이 아니다.
async function closeStaleUnsignedLinks(leaseTermId: string): Promise<number> {
  const res = await prisma.contractShareLink.updateMany({
    where: {
      leaseTermId,
      signedAt: null, submittedAt: null, closedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { closedAt: new Date() },
  })
  return res.count
}

// 서명을 지웠을 때 닫아야 할 링크 — 아직 열려 있는 것 전부다. 서명이 이미 들어온 링크도 닫는다.
// 지운 서명의 출처가 계속 열려 있으면 입주자가 다시 들어가 서명할 수 있고, 운영자 화면에는
// 방금 지운 서명이 되살아난 것처럼 보인다.
// **제출(submittedAt)된 링크는 건드리지 않는다.** 제출본은 일부러 closedAt 을 비워 두는데
// (종 알림의 '정식 계약서 발급' 리마인더가 closedAt: null 조건이다, 2026-07-23 운영자 결정)
// 여기서 닫으면 발급 전 리마인더가 조용히 사라진다.
async function closeOpenLinks(leaseTermId: string): Promise<number> {
  const res = await prisma.contractShareLink.updateMany({
    where: { leaseTermId, closedAt: null, submittedAt: null, expiresAt: { gt: new Date() } },
    data: { closedAt: new Date() },
  })
  return res.count
}

// 저장된 서명 지우기 — 화면 X 버튼이 로컬 state 만 지워서, 잘못 받은 서명을 되돌릴 길이 없었다.
// 새로고침하면 서버 값이 그대로 되살아난다(운영자 긴급 요청 2026-08-05).
export async function clearContractSignature(
  leaseTermId: string,
  target: 'contract' | 'disposal',
): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: { id: true, signatureImageUrl: true, signatureSignedAt: true, disposalSignatureImageUrl: true, disposalSignatureSignedAt: true },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    const isContract = target === 'contract'
    const targetHas = isContract
      ? !!lease.signatureImageUrl || !!lease.signatureSignedAt
      : !!lease.disposalSignatureImageUrl || !!lease.disposalSignatureSignedAt
    if (!targetHas) return { ok: true, closedLinks: 0 }   // 지울 것이 없다 — 멱등
    // 지운 뒤에도 남는 서명이 있는가. 하나도 안 남으면 서명 시점 본문 격리본도 함께 지운다
    // (schema 주석 "서명 네 칸과 생사를 같이 한다"). 격리본만 남으면 서명 없는 계약이
    // 서명 시점 본문을 주장하게 된다.
    const otherRemains = isContract
      ? !!lease.disposalSignatureImageUrl || !!lease.disposalSignatureSignedAt
      : !!lease.signatureImageUrl || !!lease.signatureSignedAt
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: {
        ...(isContract
          ? { signatureImageUrl: null, signatureSignedAt: null }
          : { disposalSignatureImageUrl: null, disposalSignatureSignedAt: null }),
        ...(otherRemains ? {} : { signedContractSnapshot: Prisma.DbNull }),
      },
    })
    const closedLinks = await closeOpenLinks(leaseTermId)
    revalidatePath('/contract')
    return { ok: true, closedLinks }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '서명 삭제에 실패했습니다.' }
  }
}

// 계약서 표시값 오버라이드 저장 — 정보 표의 값만 덮는다.
// **원천 컬럼에는 쓰지 않는다.** 수납·청구 산식은 이 값을 영원히 모른다(운영자 승인 2026-08-05).
export async function saveContractFieldOverride(
  leaseTermId: string,
  patch: ContractFieldOverridePatch,
): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, signatureImageUrl: true, signatureSignedAt: true,
        disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        moveInDate: true, expectedMoveOut: true, rentAmount: true, depositAmount: true,
        cleaningFee: true, dueDay: true, registrationStatus: true,
        contractFieldOverrides: true, room: { select: { roomNo: true } },
      },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    if (isSignatureLocked(lease)) return { ok: false, error: FIELD_LOCK_MSG }
    const { value, invalidKeys } = normalizeContractFieldOverrides(
      lease.contractFieldOverrides, patch, deriveContractLeaseFields(lease),
    )
    if (invalidKeys.length) return { ok: false, error: CONTRACT_FIELD_ERROR[invalidKeys[0]] }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      // Json 칸을 비울 때 { set: null } 을 쓰면 안 된다. Prisma 7 은 그 객체를 **값으로** 저장해
      // 컬럼에 {"set": null} 이 들어간다(실측 2026-08-05). 비우기는 Prisma.DbNull 이 정본이다.
      data: { contractFieldOverrides: value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue) },
    })
    const closedLinks = await closeStaleUnsignedLinks(leaseTermId)
    revalidatePath('/contract')
    return { ok: true, closedLinks }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

// 표시값 전체를 자동값으로 되돌린다 — 저장·복원이 같은 잠금·같은 링크 규칙을 쓴다.
export async function resetContractFieldOverrides(
  leaseTermId: string,
): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: { id: true, signatureImageUrl: true, signatureSignedAt: true, disposalSignatureImageUrl: true, disposalSignatureSignedAt: true },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    if (isSignatureLocked(lease)) return { ok: false, error: FIELD_LOCK_MSG }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractFieldOverrides: Prisma.DbNull },
    })
    const closedLinks = await closeStaleUnsignedLinks(leaseTermId)
    revalidatePath('/contract')
    return { ok: true, closedLinks }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '초기화에 실패했습니다.' }
  }
}

export async function saveContractOverride(
  leaseTermId: string,
  template: ContractTemplate,
): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    if (!template?.title?.trim()) return { ok: false, error: '계약서 제목이 비어 있습니다.' }
    // 본인 영업장 lease만 허용
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true, signatureImageUrl: true, signatureSignedAt: true, disposalSignatureImageUrl: true, disposalSignatureSignedAt: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    if (isSignatureLocked(lease)) return { ok: false, error: SIGNED_LOCK_MSG }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractOverride: template as unknown as object },
    })
    // 본문을 고쳤으면 아직 서명 안 된 링크는 낡은 스냅샷이다 — 표시값 편집과 같은 클래스다.
    const closedLinks = await closeStaleUnsignedLinks(leaseTermId)
    revalidatePath(`/contract`)
    return { ok: true, closedLinks }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

export async function resetContractOverride(leaseTermId: string): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true, signatureImageUrl: true, signatureSignedAt: true, disposalSignatureImageUrl: true, disposalSignatureSignedAt: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    // 공통 템플릿으로 되돌리는 것도 서명한 본문을 갈아치우는 행위다. 하나만 잠그면 다른 하나로 같은 일이 된다.
    if (isSignatureLocked(lease)) return { ok: false, error: SIGNED_LOCK_MSG }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      // { set: null } 은 Json 칸을 비우지 못하고 {"set": null} 을 값으로 넣는다(실측 2026-08-05).
      // 그 값이 들어가면 계약서 본문이 통째로 그 객체로 읽혀 제목도 조항도 사라진다.
      data: { contractOverride: Prisma.DbNull },
    })
    const closedLinks = await closeStaleUnsignedLinks(leaseTermId)
    revalidatePath(`/contract`)
    return { ok: true, closedLinks }
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
