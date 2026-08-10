'use server'

// 계약서 원격 서명 링크 — 발급(getOrCreate)·닫기·다시 열기·상태 조회·PDF 발급 전 드리프트 비교 (운영자 전용).
// 발급 시점 렌더 데이터를 templateSnapshot 으로 고정하고, 원격 화면(/sign/[token])은 스냅샷만 렌더한다.

import { randomBytes } from 'crypto'
import { kstYmdStr } from '@/lib/kstDate'
import { headers } from 'next/headers'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { buildContractData, type ContractData } from '@/lib/contractData'
import { isContractIssued } from '@/lib/contractIssue'
import { driveImageDataUrl } from '@/lib/google-drive'

const SHARE_TTL_MS = 24 * 60 * 60 * 1000   // 발급 후 24시간 만료

export type ContractShareLinkInfo = {
  id: string
  url: string
  expiresAt: string           // ISO
  signedAt: string | null
  disposalSignedAt: string | null
  closedAt: string | null
  lockedAt: string | null
  submittedAt: string | null   // 제출 확정 — 이후 링크는 서버가 막는다(getActiveLink)
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
  disposalSignedAt: Date | null; closedAt: Date | null; lockedAt: Date | null; submittedAt: Date | null
}, url: string): ContractShareLinkInfo {
  return {
    id: link.id,
    url,
    expiresAt: link.expiresAt.toISOString(),
    signedAt: link.signedAt ? link.signedAt.toISOString() : null,
    disposalSignedAt: link.disposalSignedAt ? link.disposalSignedAt.toISOString() : null,
    closedAt: link.closedAt ? link.closedAt.toISOString() : null,
    lockedAt: link.lockedAt ? link.lockedAt.toISOString() : null,
    // 제출 시각을 안 내려보내서 운영자 배지가 죽은 링크를 '서명 완료 · 남은 시간'으로 표시했다
    submittedAt: link.submittedAt ? link.submittedAt.toISOString() : null,
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
    // 서명이 이미 저장된 계약에는 새 링크를 안 내준다. 내주면 입주자가 새 스냅샷에 다시 서명하고,
    // 계약 하나에 서로 다른 내용의 서명 두 벌이 생긴다. 어느 쪽이 진짜인지 화면도 서버도 말할 수 없다.
    // 추가 조회 없이 스냅샷 값으로 판정한다 — buildContractData 가 서명 네 칸을 이미 담아 왔다.
    const snapLease = snapshot.lease
    if (snapLease.signatureImageUrl || snapLease.signatureSignedDate
      || snapLease.disposalSignatureImageUrl || snapLease.disposalSignatureSignedDate) {
      return { ok: false, error: '이미 서명이 저장된 계약입니다. 내용을 바꿔 다시 받으려면 계약서 화면에서 서명을 지운 뒤 요청해 주세요. 받은 서명으로 발급하려면 서명본 계약서 발급을 이용하세요.' }
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } })
    const propertyName = property?.name ?? ''

    // 활성 링크 재사용(getOrCreate) — 같은 계약(leaseTermId)만. 계약이 바뀌었으면 새 스냅샷으로 새 링크.
    // Serializable 트랜잭션으로 find+create 를 묶는다 — 발급 연타 시 둘 다 '없음'을 보고 활성 링크가
    // 2개 생기던 경합 차단(적대검증 P2). 부분 유니크 제약은 자연 만료 후 재발급을 막아 부적합.
    const leaseTermId = snapshot.lease.id
    const link = await prisma.$transaction(async tx => {
      const existing = await tx.contractShareLink.findFirst({
        // submittedAt 이 빠져 있어, 제출 완료 후 24시간 안에 '서명 요청 다시 보내기'를 누르면
        // 이미 죽은 URL 이 그대로 다시 발송됐다. 입주자는 '더 이상 열 수 없습니다'만 본다.
        // 서버 게이트(getActiveLink)는 submittedAt 을 보는데 여기만 안 봤다(2026-08-02 조사).
        where: { tenantId, propertyId, leaseTermId, closedAt: null, lockedAt: null, submittedAt: null, expiresAt: { gt: new Date() } },
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
        where: { driveFileId: { not: '' }, propertyId, leaseTermId: link.leaseTermId, deletedAt: null },
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

// 계약서 종이에 실제로 인쇄되는 값만 뽑은 사영 — 드리프트 비교는 이 객체끼리 통으로 한다.
// 비교할 필드를 손으로 나열하면 축이 늘 때마다 여기를 잊는다. 실제로 입실자 인적사항(성명·생년월일·
// 성별·연락처·흡연·비상연락망)과 전입신고가 통째로 빠져 있어서, 서명 뒤에 그 값들이 바뀌어도
// 발급 경고가 뜨지 않았다. 한 사람 이름이 바뀐 계약서가 아무 말 없이 나가던 구멍이다.
// 값이 undefined 면 '이 데이터에 그 축이 없다'는 뜻이고, 스냅샷 쪽이 그러면 비교에서 빠진다(아래 참조).
function printedFacts(d: Partial<ContractData>): Record<string, unknown> {
  const t = d.tenant
  const l = d.lease
  return {
    'tenant.name': t?.name,
    'tenant.birthdate': t?.birthdate,
    'tenant.gender': t?.gender,
    'tenant.primaryPhone': t?.primaryPhone,
    'tenant.smoking': t?.smoking,
    // 비상연락망은 배열이라 통비교 — 번호가 바뀌어도, 한 줄이 늘거나 줄어도 잡힌다.
    'tenant.emergencyContacts': t?.emergencyContacts ? JSON.stringify(t.emergencyContacts) : undefined,
    'lease.rentAmount': l?.rentAmount,
    'lease.depositAmount': l?.depositAmount,
    'lease.cleaningFee': l?.cleaningFee,
    'lease.dueDay': l?.dueDay,
    'lease.moveInDate': l?.moveInDate,
    'lease.expectedMoveOut': l?.expectedMoveOut,
    'lease.roomNo': l?.roomNo,
    'lease.registrationStatus': l?.registrationStatus,
    template: d.template ? JSON.stringify(d.template) : undefined,
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
    // 만료 조건을 뺐다 — 만료된 링크의 차이가 아예 감지되지 않던 구멍(E페이즈 조사 2026-08-03).
    // 실측 김민정 건이 서명 당시 157,000 인데 현재 470,000 이었고 링크가 만료돼 경고가 안 떴다.
    const link = await prisma.contractShareLink.findFirst({
      where: { tenantId, propertyId, signedAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { templateSnapshot: true },
    })
    if (!link) return { ok: true, drift: false }

    const current = await buildContractData(tenantId, propertyId)
    const snap = link.templateSnapshot as unknown as ContractData
    if (!current || !current.lease || !snap.lease) return { ok: true, drift: true }

    // 인쇄 사실 사영끼리 통비교 — 계약서에 찍히는 값이 하나라도 다르면 드리프트다.
    const snapFacts = printedFacts(snap)
    const curFacts = printedFacts(current)
    // **스냅샷 쪽 값이 undefined 인 축은 비교를 생략한다.** 이 사영이 생기기 전에 만들어진 스냅샷은
    // 나중에 추가된 축(전입신고 등)의 키가 아예 없다. 없는 값을 '달라졌다'로 읽으면 바뀐 적 없는
    // 계약에 경고가 뜨고, 경고는 한 번이라도 거짓이면 그 다음부터 아무도 안 읽는다.
    const drift = Object.keys(curFacts).some(k => snapFacts[k] !== undefined && snapFacts[k] !== curFacts[k])
    return { ok: true, drift }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '비교에 실패했습니다.' }
  }
}


// 서명본 스냅샷 조회 — 계약서를 **입주자가 서명한 시점의 내용**으로 발급하기 위한 경로.
//
// 종전에는 /sign 은 스냅샷을 보여주고 계약서 PDF 는 발급 시점 DB 로 다시 조립했다.
// 그 사이 계약이 바뀌면 **서명은 A 에 했는데 B 짜리 계약서가 나간다.**
// 실측 520호 김민정 — 1주일(157,000)에 서명했는데 그 뒤 1개월(470,000)로 전환됐다.
// 운영자 확인 2026-08-03 — "1주일짜리는 그거대로 저장되고 1달짜리는 별개로 진행되는거지.
// 즉 각각 남는 구조가 맞아". 서명본은 그 스냅샷으로 발급하고, 새 내용은 새 서명을 받는다.
export async function getSignedSnapshot(tenantId: string, linkId: string): Promise<ContractData | null> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const link = await prisma.contractShareLink.findFirst({
    where: { id: linkId, tenantId, propertyId, signedAt: { not: null } },
    select: { templateSnapshot: true, signedAt: true, disposalSignedAt: true, leaseTerm: { select: { signatureImageUrl: true, disposalSignatureImageUrl: true } } },
  })
  if (!link) return null
  const snap = link.templateSnapshot as unknown as ContractData
  // 서명 이미지는 스냅샷에 없다(서명은 그 뒤에 들어온다) — lease 에 저장된 원본을 얹는다.
  // 서명 시각도 같이 얹는다. 스냅샷은 링크를 만든 시점이라 서명 시각을 알 수 없고,
  // 이 값이 있어야 계약일이 '오늘'이 아니라 실제 서명한 날로 고정된다.
  //
  // ⚠ 네 값 모두 **lease 안**이다(ContractData.lease 타입 정의). 종전에는 이미지 두 개만
  // 최상위에 얹어, 화면(ContractView 가 data.lease.signatureImageUrl 을 읽는다)에는 스냅샷의
  // 옛 값(= 링크 발급 시점이라 항상 null)이 그려졌다. 서명을 받았는데 서명란이 빈 채로 열리고
  // 버튼이 '발급' 이 아니라 '서명 요청' 으로 뜨던 것이 그것이다(신고 9facb682, 8/3 be789f4 부터).
  // 최상위에 얹지 마라 — ContractData 에 없는 필드라 아무도 안 읽고, 캐스트가 그 사실을 가린다.
  const lease: ContractData['lease'] = snap.lease ? {
    ...snap.lease,
    signatureImageUrl: link.leaseTerm?.signatureImageUrl ?? null,
    disposalSignatureImageUrl: link.leaseTerm?.disposalSignatureImageUrl ?? null,
    signatureSignedDate: link.signedAt ? kstYmdStr(new Date(link.signedAt)) : null,
    disposalSignatureSignedDate: link.disposalSignedAt ? kstYmdStr(new Date(link.disposalSignedAt)) : null,
  } : null
  // 로고·도장은 **읽는 순간에** 다시 해석한다. 8/8 이전에 만들어진 스냅샷은 두 값이 Drive 썸네일
  // 외부 URL 이라(로고 12건·도장 7건) 브라우저가 못 받아 서명본 화면에서 빈칸으로 보인다.
  // 발급 PDF 는 route 가 매번 driveImageDataUrl 로 다시 만드니 영향이 없지만, 화면은 스냅샷을 그대로 그린다.
  // 저장값은 건드리지 않는다 — 스냅샷은 '서명 시점의 사실' 이고, 로고·도장은 그 사실이 아니라 표시 자산이다.
  const images = await resolveSnapshotImages(snap, propertyId)
  // as 캐스트를 걷었다 — 위 어긋남을 6일 동안 숨긴 것이 이 캐스트다.
  return { ...snap, ...images, lease }
}

// 스냅샷의 로고·도장이 data URL 이 아니면 현재 영업장 설정에서 바이트로 다시 만든다.
// 실패하면 null 이다(화면이 죽는 것보다 로고 없이 뜨는 편이 낫다). 둘 다 이미 data URL 이면 조회조차 안 한다.
async function resolveSnapshotImages(
  snap: ContractData, propertyId: string,
): Promise<Pick<ContractData, 'logoImageUrl' | 'stampImageUrl'>> {
  const stale = (v: string | null | undefined) => !!v && !v.startsWith('data:')
  if (!stale(snap.logoImageUrl) && !stale(snap.stampImageUrl)) {
    return { logoImageUrl: snap.logoImageUrl ?? null, stampImageUrl: snap.stampImageUrl ?? null }
  }
  try {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { logoDriveFileId: true, stampDriveFileId: true },
    })
    const [logo, stamp] = await Promise.all([
      stale(snap.logoImageUrl) && property?.logoDriveFileId ? driveImageDataUrl(property.logoDriveFileId) : Promise.resolve(null),
      stale(snap.stampImageUrl) && property?.stampDriveFileId ? driveImageDataUrl(property.stampDriveFileId) : Promise.resolve(null),
    ])
    return {
      logoImageUrl: stale(snap.logoImageUrl) ? logo : (snap.logoImageUrl ?? null),
      stampImageUrl: stale(snap.stampImageUrl) ? stamp : (snap.stampImageUrl ?? null),
    }
  } catch (e) {
    console.error('[contractShare] 서명본 로고·도장 재해석 실패:', e)
    return {
      logoImageUrl: stale(snap.logoImageUrl) ? null : (snap.logoImageUrl ?? null),
      stampImageUrl: stale(snap.stampImageUrl) ? null : (snap.stampImageUrl ?? null),
    }
  }
}
