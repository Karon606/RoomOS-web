'use server'

// 계약서 원격 서명 링크 — 발급(getOrCreate)·닫기·다시 열기·상태 조회·PDF 발급 전 드리프트 비교 (운영자 전용).
// 발급 시점 렌더 데이터를 templateSnapshot 으로 고정하고, 원격 화면(/sign/[token])은 스냅샷만 렌더한다.

import { randomBytes } from 'crypto'
import { headers } from 'next/headers'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { buildContractData, type ContractData } from '@/lib/contractData'
import { isContractIssued } from '@/lib/contractIssue'

const SHARE_TTL_MS = 24 * 60 * 60 * 1000   // 발급 후 24시간 만료

export type ContractShareLinkInfo = {
  id: string
  url: string
  expiresAt: string           // ISO
  signedAt: string | null
  disposalSignedAt: string | null
  closedAt: string | null
  lockedAt: string | null
}

// 요청 헤더로 현재 origin 조립 — 프록시 뒤(Vercel)에서는 x-forwarded-* 우선
async function buildShareUrl(token: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}/sign/${token}`
}

function serializeLink(link: {
  id: string; token: string; expiresAt: Date; signedAt: Date | null
  disposalSignedAt: Date | null; closedAt: Date | null; lockedAt: Date | null
}, url: string): ContractShareLinkInfo {
  return {
    id: link.id,
    url,
    expiresAt: link.expiresAt.toISOString(),
    signedAt: link.signedAt ? link.signedAt.toISOString() : null,
    disposalSignedAt: link.disposalSignedAt ? link.disposalSignedAt.toISOString() : null,
    closedAt: link.closedAt ? link.closedAt.toISOString() : null,
    lockedAt: link.lockedAt ? link.lockedAt.toISOString() : null,
  }
}

// 발급 — 활성 링크가 있으면 재사용(getOrCreate, 중복 발급 방지). 재발급이 필요한 상태(만료·닫힘·잠김)면 새로 만든다.
export async function issueContractShareLink(tenantId: string): Promise<
  | { ok: true; link: ContractShareLinkInfo; phone: string | null; propertyName: string }
  | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requirePropertyAccess()

    const snapshot = await buildContractData(tenantId, propertyId)
    if (!snapshot) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    if (!snapshot.tenant.birthdate) return { ok: false, error: '생년월일이 등록되어 있지 않습니다. 고객 정보에서 먼저 입력해 주세요.' }
    if (!snapshot.lease) return { ok: false, error: '진행 중인 계약이 없어 링크를 발급할 수 없습니다.' }

    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } })
    const propertyName = property?.name ?? ''

    // 활성 링크 재사용(getOrCreate) — 같은 계약(leaseTermId)만. 계약이 바뀌었으면 새 스냅샷으로 새 링크.
    // Serializable 트랜잭션으로 find+create 를 묶는다 — 발급 연타 시 둘 다 '없음'을 보고 활성 링크가
    // 2개 생기던 경합 차단(적대검증 P2). 부분 유니크 제약은 자연 만료 후 재발급을 막아 부적합.
    const leaseTermId = snapshot.lease.id
    const link = await prisma.$transaction(async tx => {
      const existing = await tx.contractShareLink.findFirst({
        where: { tenantId, propertyId, leaseTermId, closedAt: null, lockedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) return existing
      return tx.contractShareLink.create({
        data: {
          token: randomBytes(32).toString('base64url'),
          propertyId, tenantId, leaseTermId,
          templateSnapshot: snapshot as unknown as object,
          expiresAt: new Date(Date.now() + SHARE_TTL_MS),
          createdBy: userId,
        },
      })
    }, { isolationLevel: 'Serializable' })
    return { ok: true, link: serializeLink(link, await buildShareUrl(link.token)), phone: snapshot.tenant.primaryPhone, propertyName }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '링크 발급에 실패했습니다.' }
  }
}

// 상태 조회 — 최신 링크 1건(상태 무관) + 문자 발송에 필요한 주 연락처·영업장명
// needsIssue — 원격 서명은 받았는데 계약서 파일이 아직 없는 상태(홈 알림 '계약서 발급 필요'와 같은 판정).
// 화면에서 다시 계산하지 않고 서버가 lib/contractIssue 정본으로 내려준다. 규칙을 두 곳에 두면
// 홈 알림은 떠 있는데 패널은 아무 말도 안 하는 식으로 어긋난다.
export async function getContractShareState(tenantId: string): Promise<
  | { ok: true; link: ContractShareLinkInfo | null; phone: string | null; propertyName: string; needsIssue: boolean }
  | { ok: false; error: string }
> {
  try {
    // requireEdit — 링크 상태 조회가 토큰(URL)과 주 연락처를 반환하므로 발급 권한과 동일 게이트.
    // 일반 멤버(제한 스태프 포함)가 토큰을 얻어 /sign 스냅샷의 금액을 열람하는 우회 차단(적대검증 P2).
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const [link, tenant, property] = await Promise.all([
      prisma.contractShareLink.findFirst({
        where: { tenantId, propertyId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.findFirst({
        where: { id: tenantId, propertyId },
        select: { contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
      }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }),
    ])
    if (!tenant) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                         ?? tenant.contacts.find(c => !c.isEmergency)
    // 서명이 들어온 링크에 대해서만 발급 여부를 따진다(그 외에는 물어볼 것이 없다)
    let needsIssue = false
    if (link?.signedAt && !link.closedAt) {
      const files = await prisma.contractFile.findMany({
        where: { propertyId, leaseTermId: link.leaseTermId, deletedAt: null },
        select: { leaseTermId: true, createdAt: true },
      })
      needsIssue = !isContractIssued(link.signedAt, link.leaseTermId, files)
    }
    return {
      ok: true,
      link: link ? serializeLink(link, await buildShareUrl(link.token)) : null,
      phone: primaryContact?.contactValue ?? null,
      propertyName: property?.name ?? '',
      needsIssue,
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '상태 조회에 실패했습니다.' }
  }
}

// 링크 닫기 — 입주자 접근 차단. 만료 전에는 reopen 으로 적용취소 가능.
export async function closeContractShareLink(linkId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const link = await prisma.contractShareLink.findFirst({ where: { id: linkId, propertyId }, select: { id: true, closedAt: true } })
    if (!link) return { ok: false, error: '링크를 찾을 수 없습니다.' }
    if (link.closedAt) return { ok: true }   // 이미 닫힘 — 멱등
    await prisma.contractShareLink.update({ where: { id: linkId }, data: { closedAt: new Date() } })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '링크 닫기에 실패했습니다.' }
  }
}

// 닫기 적용취소 — 만료 전 + 잠기지 않은 링크만 다시 연다.
export async function reopenContractShareLink(linkId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const link = await prisma.contractShareLink.findFirst({
      where: { id: linkId, propertyId },
      select: { id: true, closedAt: true, lockedAt: true, expiresAt: true },
    })
    if (!link) return { ok: false, error: '링크를 찾을 수 없습니다.' }
    if (link.lockedAt) return { ok: false, error: '잠긴 링크는 다시 열 수 없습니다. 새로 발급해 주세요.' }
    if (link.expiresAt <= new Date()) return { ok: false, error: '만료된 링크는 다시 열 수 없습니다. 새로 발급해 주세요.' }
    if (!link.closedAt) return { ok: true }   // 이미 열림 — 멱등
    await prisma.contractShareLink.update({ where: { id: linkId }, data: { closedAt: null } })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '링크 다시 열기에 실패했습니다.' }
  }
}

// PDF 발급 전 드리프트 비교 — 원격 서명이 들어온 활성 링크의 스냅샷과 현재 렌더 데이터의 핵심 값이 다른지.
// 경고 판단용일 뿐 발급(실시간 데이터)은 막지 않는다.
export async function checkContractShareDrift(tenantId: string): Promise<
  | { ok: true; drift: boolean }
  | { ok: false; error: string }
> {
  try {
    const { propertyId } = await requirePropertyAccess()
    const link = await prisma.contractShareLink.findFirst({
      where: {
        tenantId, propertyId,
        signedAt: { not: null }, closedAt: null, lockedAt: null, expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { templateSnapshot: true },
    })
    if (!link) return { ok: true, drift: false }

    const current = await buildContractData(tenantId, propertyId)
    const snap = link.templateSnapshot as unknown as ContractData
    if (!current || !current.lease || !snap.lease) return { ok: true, drift: true }

    const drift =
      snap.lease.rentAmount !== current.lease.rentAmount ||
      snap.lease.depositAmount !== current.lease.depositAmount ||
      snap.lease.moveInDate !== current.lease.moveInDate ||
      snap.lease.roomNo !== current.lease.roomNo ||
      JSON.stringify(snap.template) !== JSON.stringify(current.template)
    return { ok: true, drift }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '비교에 실패했습니다.' }
  }
}
