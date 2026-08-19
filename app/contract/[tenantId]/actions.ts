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
import { maskForeignRegNo } from '@/lib/foreignRegNo'
import {
  type ContractFieldOverridePatch,
  CONTRACT_FIELD_ERROR, deriveContractLeaseFields, normalizeContractFieldOverrides,
} from '@/lib/contractFieldOverrides'
import {
  buildVoidedVersion, hasVoidableVersion, parseContractVersionArchive, restoredFieldsFrom,
} from '@/lib/contractVersion'

// ContractData 타입·조립 로직은 lib/contractData.ts 로 이동(원격 서명 링크 스냅샷과 공유).
// 기존 소비처(ContractView 등)의 import 경로 유지를 위해 타입만 재수출.
export type { ContractData } from '@/lib/contractData'

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

export async function getContractData(tenantId: string, leaseTermId?: string | null) {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  const role = await getMyRole()
  if (!canReadScope(role, 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()
  const data = await buildContractData(tenantId, propertyId, leaseTermId)
  // 신원번호를 볼 수 없는 역할에는 마스킹을 그린다. 칸을 생년월일로 되돌리지 않는 이유는,
  // 그러면 화면과 실제 인쇄물이 서로 다른 서류가 되어 무엇이 나갔는지 화면으로 알 수 없어서다.
  if (data && data.tenant.foreignRegNo && !canReadScope(role, 'identity')) {
    return { ...data, tenant: { ...data.tenant, foreignRegNo: maskForeignRegNo(data.tenant.foreignRegNo) } }
  }
  return data
}

// ── 입실자별 본문 오버라이드 저장/리셋 ─────────────────────────────
// 서명이 확정된 계약인가 — 확정이면 본문을 못 고친다(운영자 규칙 2026-08-04).
// 네 칸 중 하나라도 있으면 잠금이다. OR 로 넓게 잡는 이유 셋.
//   1) 이미지와 시각 중 한쪽만 남는 반쪽 상태에서도 잠긴다 — 결손에 대해 안전한 쪽으로 실패한다
//   2) 동의서만 서명된 상태도 잠근다. 두 서명 다 계약서와 동의서가 함께 그려진 화면을 보고 한 것이다
//   3) 실측상 넓힘의 비용이 0 이다 — 반쪽 상태도 동의서만 서명된 건도 지금 0건이다
// '제출까지'로 잡지 않는 이유 — 제출은 원격 링크 전용이고 대면 서명에는 그 단계가 없다.
// 실측에서 서명만 하고 제출을 안 한 링크가 다섯 중 둘이었고 그 둘 다 발급까지 끝났다.
// 안내는 **실제 잠금 조건과 실제로 열려 있는 길**을 말해야 한다(신고 63cd1049).
// 종전 문구는 "서명란의 X 버튼으로 저장된 서명을 지우면" 이라고 단수로 말했는데, 잠금은 네 칸 OR 이라
// 계약서·동의서 두 서명이 다 있으면 X 하나로는 안 풀린다. 운영자는 그 말대로 지웠는데도 안 풀리는
// 화면을 보고 발급본을 지웠고, 그것은 잠금과 아무 상관이 없는 조작이었다.
// 지금은 한 번에 푸는 길이 화면에 있다 — 계약서 화면 툴바의 '이 계약서 폐기'.
const SIGNED_LOCK_MSG = "서명이 완료된 계약서는 본문을 고칠 수 없습니다. 내용을 바꾸려면 계약서 화면 툴바의 '이 계약서 폐기' 로 이 버전을 폐기하고 다시 작성한 뒤 서명을 다시 받아 주세요. 지금까지 받은 서명과 발급본은 폐기 기록으로 남습니다."
type SigCols = {
  signatureImageUrl: string | null
  signatureSignedAt: Date | null
  disposalSignatureImageUrl: string | null
  disposalSignatureSignedAt: Date | null
}
const isSignatureLocked = (l: SigCols) =>
  !!l.signatureImageUrl || !!l.signatureSignedAt || !!l.disposalSignatureImageUrl || !!l.disposalSignatureSignedAt

// 위 SIGNED_LOCK_MSG 와 같은 이유로 같은 길을 가리킨다 — 성명 표기도 이 잠금에 걸린다.
const FIELD_LOCK_MSG = "서명이 완료된 계약서라 표시값을 고칠 수 없습니다. 내용을 바꾸려면 계약서 화면 툴바의 '이 계약서 폐기' 로 이 버전을 폐기하고 다시 작성한 뒤 서명을 다시 받아 주세요. 지금까지 받은 서명과 발급본은 폐기 기록으로 남습니다."

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

// 서명을 지웠는데 **다른 서명이 아직 남아 있을 때** 닫는 링크 — 살아 있는 것 전부다.
// 서명이 이미 들어온 링크도 닫는다.
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

// ── 버전 폐기 정본 ──────────────────────────────────────────────────
//
// 서명 네 칸과 격리본을 비우는 **유일한 문**이다. 비우기 전에 그 값들을 lease.contractVersionArchive
// 로 옮겨 담고, 이 계약의 발급본에는 폐기 도장(voidedAt)만 찍는다 — 파일도 Drive 원본도
// issuedSnapshot 도 건드리지 않는다(긴급 신고 63cd1049, 2026-08-19).
//
// 왜 서명 지우기와 한 몸인가(2026-08-10 판단을 그대로 옮긴다). 전량 삭제냐 부분 삭제냐는 조작의
// 이름일 뿐이고, 결과가 '서명 0' 이면 남은 근거도 같기 때문이다. 결과가 서명 0 이 되는 갈래를
// 전부 여기로 모으지 않으면 증거 파괴 경로가 하나 남는다.
//
// 링크는 **제출본·만료본까지** 전부 닫는다(종전 closeAllLinks 를 흡수했다). 갈리는 지점이 둘이고
// 둘 다 '남은 서명이 하나도 없다'에서 나온다.
//  1) submittedAt 을 안 가린다. 제출본을 남겨 두는 2026-07-23 결정은 '그 서명으로 발급할 일이
//     남아 있다'가 전제인데, 폐기하면 발급할 서명 자체가 없다. 그대로 두면 종 알림이 존재하지
//     않는 서명의 '정식 계약서 발급'을 영원히 재촉한다(운영자 승인 2026-08-06).
//  2) 만료 여부를 안 가린다. 링크 수명이 24시간이라 폐기 시점에는 대개 이미 만료돼 있는데,
//     그 알림의 조건은 closedAt: null 하나뿐이라(dashboard/alerts.ts) 만료로는 안 꺼진다.
//     만료 조건을 남기면 이 폐기가 사실상 아무 링크도 닫지 못한다.
// 닫기는 closedAt 만 세운다. signedAt·templateSnapshot 같은 서명 증거는 절대 지우지 않는다 —
// 그건 '그때 이런 내용에 서명이 들어왔다'는 사실의 기록이고, 잠금과는 별개다.
async function voidVersion(
  leaseTermId: string,
  propertyId: string,
  userId: string | null,
  reason: string,
): Promise<{ closedLinks: number; voidedFiles: number }> {
  const at = new Date()
  return prisma.$transaction(async tx => {
    const lease = await tx.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, signatureImageUrl: true, signatureSignedAt: true,
        disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        signedContractSnapshot: true, contractFieldOverrides: true, contractOverride: true,
        contractVersionArchive: true,
      },
    })
    if (!lease) throw new Error('대상 계약을 찾을 수 없습니다.')
    // 이미 폐기된 부에는 다시 찍지 않는다 — 도장은 그 버전이 폐기된 시각이지 마지막 폐기 시각이 아니다.
    // 소프트삭제된 부에도 찍는다. 그 부도 이 버전으로 나간 종이라, 삭제를 되돌리면 폐기본이어야 한다.
    const files = await tx.contractFile.findMany({
      where: { leaseTermId, propertyId, voidedAt: null },
      select: { id: true },
    })
    const links = await tx.contractShareLink.findMany({
      where: { leaseTermId, closedAt: null },
      select: { id: true },
    })
    const entry = buildVoidedVersion({
      lease,
      fileIds: files.map(f => f.id),
      closedLinkIds: links.map(l => l.id),
      voidedAt: at, voidedBy: userId, reason,
    })
    const archive = [...parseContractVersionArchive(lease.contractVersionArchive), entry]
    await tx.leaseTerm.update({
      where: { id: leaseTermId },
      data: {
        signatureImageUrl: null, signatureSignedAt: null,
        disposalSignatureImageUrl: null, disposalSignatureSignedAt: null,
        // Json 칸 비우기는 Prisma.DbNull 이 정본이다({ set: null } 은 값으로 저장된다, 2026-08-05 실측).
        signedContractSnapshot: Prisma.DbNull,
        contractVersionArchive: archive as unknown as Prisma.InputJsonValue,
      },
    })
    if (files.length) {
      await tx.contractFile.updateMany({ where: { id: { in: files.map(f => f.id) } }, data: { voidedAt: at } })
    }
    if (links.length) {
      await tx.contractShareLink.updateMany({ where: { id: { in: links.map(l => l.id) } }, data: { closedAt: at } })
    }
    return { closedLinks: links.length, voidedFiles: files.length }
  })
}

/**
 * 이 버전을 폐기하고 새로 작성 — 잠긴 계약서를 현재 값으로 다시 쓸 수 있게 하는 정식 진입로.
 *
 * 종전에는 이 길이 아예 없었다. 운영자는 발급본을 지웠는데 그것은 잠금 사슬의 어느 고리도 아니고,
 * 유일한 해제 수단인 서명 삭제는 증거를 파괴한다. 폐기는 증거를 남기고 잠금만 푼다.
 */
export async function voidContractVersion(
  leaseTermId: string,
): Promise<{ ok: true; closedLinks: number; voidedFiles: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, signatureImageUrl: true, signatureSignedAt: true,
        disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        signedContractSnapshot: true,
      },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    // 폐기할 것이 없다 — 서명도 격리본도 없는 계약서는 지금 그냥 작성 중이다(멱등).
    if (!hasVoidableVersion(lease)) return { ok: true, closedLinks: 0, voidedFiles: 0 }
    const res = await voidVersion(leaseTermId, propertyId, userId ?? null, '이 계약서 폐기')
    revalidatePath('/contract')
    revalidatePath('/tenants')
    revalidatePath('/contracts')
    return { ok: true, ...res }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '폐기에 실패했습니다.' }
  }
}

/**
 * 폐기 적용취소 — 마지막 폐기 이력을 그대로 되돌린다(서명 네 칸·격리본·오버라이드·발급본 도장·링크).
 *
 * 그 사이 새 서명이 들어왔으면 거부한다. 되살리면 방금 받은 서명이 덮여 사라지고,
 * 그때는 되돌릴 것이 없다 — 적용취소가 새로운 손실을 만드는 것이 가장 나쁘다.
 */
export async function restoreContractVersion(
  leaseTermId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, signatureImageUrl: true, signatureSignedAt: true,
        disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        signedContractSnapshot: true, contractVersionArchive: true,
      },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    const archive = parseContractVersionArchive(lease.contractVersionArchive)
    const entry = archive[archive.length - 1]
    if (!entry) return { ok: false, error: '되돌릴 폐기 기록이 없습니다.' }
    if (hasVoidableVersion(lease)) {
      return { ok: false, error: '이 계약에 새 서명이 이미 들어와 있어 폐기를 되돌릴 수 없습니다.' }
    }
    const f = restoredFieldsFrom(entry)
    const rest = archive.slice(0, -1)
    await prisma.$transaction(async tx => {
      await tx.leaseTerm.update({
        where: { id: leaseTermId },
        data: {
          signatureImageUrl: f.signatureImageUrl,
          signatureSignedAt: f.signatureSignedAt,
          disposalSignatureImageUrl: f.disposalSignatureImageUrl,
          disposalSignatureSignedAt: f.disposalSignatureSignedAt,
          signedContractSnapshot: f.signedContractSnapshot == null
            ? Prisma.DbNull : (f.signedContractSnapshot as Prisma.InputJsonValue),
          contractFieldOverrides: f.contractFieldOverrides == null
            ? Prisma.DbNull : (f.contractFieldOverrides as Prisma.InputJsonValue),
          contractOverride: f.contractOverride == null
            ? Prisma.DbNull : (f.contractOverride as Prisma.InputJsonValue),
          contractVersionArchive: rest.length ? (rest as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      })
      if (entry.fileIds.length) {
        await tx.contractFile.updateMany({ where: { id: { in: entry.fileIds }, propertyId }, data: { voidedAt: null } })
      }
      // 폐기 직전 상태로 정확히 되돌린다 — 만료·제출 여부를 따지지 않는다. 그 판정은 입주자에게
      // 링크를 다시 열어 주는 reopenContractShareLink 의 것이고, 여기는 되돌리기다.
      if (entry.closedLinkIds.length) {
        await tx.contractShareLink.updateMany({ where: { id: { in: entry.closedLinkIds }, propertyId }, data: { closedAt: null } })
      }
    })
    revalidatePath('/contract')
    revalidatePath('/tenants')
    revalidatePath('/contracts')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// 저장된 서명 지우기 — 화면 X 버튼이 로컬 state 만 지워서, 잘못 받은 서명을 되돌릴 길이 없었다.
// 새로고침하면 서버 값이 그대로 되살아난다(운영자 긴급 요청 2026-08-05).
// target 'all' 은 재서명 진입로다 — 네 칸을 한 번에 지워 본문·표시값·계약일 잠금을 통째로 푼다.
// 서명이 하나도 안 남는 갈래는 전부 위 voidVersion 을 탄다(증거는 이력으로 남고 잠금만 풀린다).
export async function clearContractSignature(
  leaseTermId: string,
  target: 'contract' | 'disposal' | 'all',
): Promise<{ ok: true; closedLinks: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, signatureImageUrl: true, signatureSignedAt: true,
        disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        signedContractSnapshot: true,
      },
    })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    // 전량 삭제 — 서명 네 칸과 서명 시점 본문 격리본이 함께 사라진다. 격리본만 남으면 서명 없는
    // 계약이 서명 시점 본문을 주장하게 되고, 그건 검사 축 G2 가 위반으로 잡는 상태다.
    // 사라지는 것은 lease 의 칸이고 값 자체는 폐기 이력으로 옮겨 간다(voidVersion).
    if (target === 'all') {
      if (!hasVoidableVersion(lease)) return { ok: true, closedLinks: 0 }   // 지울 것이 없다 — 멱등
      const { closedLinks } = await voidVersion(leaseTermId, propertyId, userId ?? null, '재서명 받기')
      revalidatePath('/contract')
      revalidatePath('/tenants')
      revalidatePath('/contracts')
      return { ok: true, closedLinks }
    }
    const isContract = target === 'contract'
    const targetHas = isContract
      ? !!lease.signatureImageUrl || !!lease.signatureSignedAt
      : !!lease.disposalSignatureImageUrl || !!lease.disposalSignatureSignedAt
    if (!targetHas) return { ok: true, closedLinks: 0 }   // 지울 것이 없다 — 멱등
    // 지운 뒤에도 남는 서명이 있는가. 하나도 안 남으면 그 버전 자체가 사라지는 것이라 폐기와 결과가
    // 같다 — 격리본까지 비우고 증거는 폐기 이력으로 옮긴다(voidVersion). 격리본만 남으면
    // 서명 없는 계약이 서명 시점 본문을 주장하게 되고, 그건 검사 축 G2 가 위반으로 잡는 상태다.
    const otherRemains = isContract
      ? !!lease.disposalSignatureImageUrl || !!lease.disposalSignatureSignedAt
      : !!lease.signatureImageUrl || !!lease.signatureSignedAt
    if (!otherRemains) {
      const { closedLinks } = await voidVersion(leaseTermId, propertyId, userId ?? null, '서명 지우기')
      revalidatePath('/contract')
      revalidatePath('/tenants')
      revalidatePath('/contracts')
      return { ok: true, closedLinks }
    }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: isContract
        ? { signatureImageUrl: null, signatureSignedAt: null }
        : { disposalSignatureImageUrl: null, disposalSignatureSignedAt: null },
    })
    // 남은 서명이 있으므로 2026-07-23 규칙대로 살아 있는 링크만 닫는다(제출본은 발급 리마인더가 산다).
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
