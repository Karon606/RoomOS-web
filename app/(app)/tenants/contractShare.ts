'use server'

// 계약서 원격 서명 링크 — 발급(getOrCreate)·닫기·다시 열기·상태 조회·PDF 발급 전 드리프트 비교 (운영자 전용).
// 발급 시점 렌더 데이터를 templateSnapshot 으로 고정하고, 원격 화면(/sign/[token])은 스냅샷만 렌더한다.

import { randomBytes } from 'crypto'
import { kstYmdStr } from '@/lib/kstDate'
import { headers } from 'next/headers'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { buildContractData, type ContractData } from '@/lib/contractData'
// 인쇄 사실 사영(15축)은 lib 정본을 쓴다 — 발급본 박제(ContractFile.issuedSnapshot)와 같은 축이어야 한다.
import { printedFacts } from '@/lib/contractPrintedFacts'
import { isContractIssued } from '@/lib/contractIssue'
import { isCurrentSignatureLink } from '@/lib/contractVersion'
import { driveImageDataUrl } from '@/lib/google-drive'
import { formatForeignRegNo } from '@/lib/foreignRegNo'
import { readStoredForeignRegNo } from '@/lib/pii'
import { fmtRoomNo } from '@/lib/roomNo'
import { parseContractFieldOverrides } from '@/lib/contractFieldOverrides'
import { asDocNameStyle } from '@/lib/documentName'
import { signStageSlots, type SignStage } from '@/lib/disposalSignGate'
import { paperDocsOf, leaseSignSlots, badgeSignSummary, parseDocumentSignatures } from '@/lib/signDocuments'
import { asSignLang, signLangForNationality, type SignLang } from '@/lib/signGuideText'
import { isForeignForDocuments } from '@/lib/documentName'

const SHARE_TTL_MS = 24 * 60 * 60 * 1000   // 발급 후 24시간 만료

/**
 * 링크 스냅샷에 담기 전에 평문 신원번호를 지운다.
 *
 * templateSnapshot 은 24시간짜리 공개 링크가 여는 JSON 이다. 여기에 번호가 들어가면
 * 토큰 하나가 곧 외국인등록번호 유출이 되고, 링크가 닫혀도 DB 에는 평문이 영구히 남는다.
 * hasForeignRegNo 는 남긴다 — 시도 한도(3회)와 발급 확인창이 그 값을 보고 판정한다.
 * /sign 은 렌더할 때 서버가 다시 복호해 끼운다(app/sign/[token]/page.tsx).
 */
function withoutPlainPii(d: ContractData): ContractData {
  return { ...d, tenant: { ...d.tenant, foreignRegNo: null } }
}

/** 스냅샷을 화면·인쇄에 쓰기 직전에 평문을 다시 끼운다. 저장된 값은 건드리지 않는다. */
async function injectForeignRegNo(d: ContractData, tenantId: string): Promise<ContractData> {
  if (!d.tenant?.hasForeignRegNo) return d
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, foreignRegNoEnc: true },
  })
  const plain = tenant ? readStoredForeignRegNo(tenant.foreignRegNoEnc, tenant.id) : null
  return { ...d, tenant: { ...d.tenant, foreignRegNo: plain ? formatForeignRegNo(plain) : null } }
}

export type ContractShareLinkInfo = {
  id: string
  url: string
  expiresAt: string           // ISO
  signedAt: string | null
  disposalSignedAt: string | null
  closedAt: string | null
  lockedAt: string | null
  submittedAt: string | null   // 제출 확정 — 이후 링크는 서버가 막는다(getActiveLink)
  // 이 링크가 나간 종이에 동의서 절이 붙는가(발급 시점 스냅샷 기준).
  // 배지가 반쪽 서명을 '서명 완료'라고 부르지 않으려면 이 값이 있어야 한다(신고 2026-09-03, 413호).
  // 판정 축이 라이브가 아니라 스냅샷인 이유는 제출 게이트와 같다 — 입주자가 본 화면이 기준이다.
  disposalEnabled: boolean
  // 서명 진행 — **계약 축**이다. "지금 발급하면 이 종이에 서명이 다 찍히는가"가 배지의 물음이다.
  // 종전에는 배지가 링크 행(signedAt·disposalSignedAt)을 읽었는데, 그것은 그 링크에서 벌어진 일만
  // 적어서 서명을 두 링크에 나눠 받은 계약을 반쪽이라 불렀다(실측 15/37건).
  // 서명 이미지는 dataURL 이라 클라이언트로 안 내려보낸다 — 서버가 판정해 결과만 준다.
  signStage: SignStage
  // 반쪽일 때 무엇이 서명됐는지. 완료·대기면 null 이고 배지가 스스로 말한다.
  signSummary: string | null
  // 이 링크의 안내 언어(스냅샷 박제값). 문자 조립과 패널 표시가 읽는다. 옛 링크는 ko 로 읽힌다.
  lang: SignLang
  // 이 링크의 계약(leaseTerm)에 서명이 **지금도** 남아 있는가.
  // signedAt 은 '그때 서명이 들어왔다'는 과거 사실이라 서명을 지워도 영원히 남는다. 진입로가 그것만
  // 보고 ?share= 서명본 화면으로 보내면, 서명을 지운 계약이 옛 스냅샷에 영구히 갇힌다(502호 2026-08-10).
  signatureLive: boolean
}

// lease 서명 4칸 중 하나라도 있으면 **볼 서명본이 있다**. 링크가 서명본을 가리킬지 일반 화면을
// 가리킬지를 이 함수가 정한다 — 진입로마다 제 규칙을 두면 어떤 문은 서명본으로, 어떤 문은 일반
// 화면으로 갈린다.
//
// **링크 재발급 차단은 이 판정을 쓰지 않는다**(2026-08-31). 그쪽은 계약서 서명만 본다. 동의서에만
// 서명하고 계약서를 안 한 상태는 볼 종이는 있어도 서명이 끝난 계약은 아니기 때문이다.
type LeaseSigCols = {
  signatureImageUrl: string | null
  signatureSignedAt: Date | null
  disposalSignatureImageUrl: string | null
  disposalSignatureSignedAt: Date | null
}
/** 서명이 하나도 없는 계약. '아직 안 읽었다'와 '읽었더니 비었다'를 코드에서 가른다. */
const EMPTY_LEASE_SIG = {
  signatureImageUrl: null, signatureSignedAt: null,
  disposalSignatureImageUrl: null, disposalSignatureSignedAt: null, documentSignatures: null,
} as const

function isSignatureLive(l: (LeaseSigCols & { documentSignatures?: unknown }) | null | undefined): boolean {
  if (!l) return false
  return !!(l.signatureImageUrl || l.signatureSignedAt || l.disposalSignatureImageUrl || l.disposalSignatureSignedAt)
    // 추가 서류 서명도 '볼 서명본'이다 — 빼면 커스텀만 서명된 계약의 진입로가 일반 화면으로 간다.
    || Object.keys(parseDocumentSignatures(l.documentSignatures)).length > 0
}

// 요청 헤더로 현재 origin 조립 — 프록시 뒤(Vercel)에서는 x-forwarded-* 우선
async function buildShareUrl(token: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}/sign/${token}`
}

/**
 * 받던 서명을 이어서 새 링크로 보낸다 — 유효기간만 갱신한다(운영자 신고 09da7f29).
 *
 * **새 링크의 스냅샷은 옛 링크 것 그대로다.** 이것이 이 설계의 핵심이고 결함이 아니라 정의다.
 * 입주자가 이미 서명한 종이가 그 JSON 이고, 서명 시점 격리본(signedContractSnapshot)도 그
 * 내용으로 굳어 있다. 새로 조립하면 남은 서명이 다른 내용 위에 놓이는데, 격리본은 첫 서명에서
 * 한 번만 굳고 재동결되지 않으므로 **증거와 화면이 갈린다.**
 *
 * "그 사이 바뀐 임대료가 반영 안 된다"는 이 갈래의 결함이 아니다. 바뀐 내용으로 받고 싶으면
 * 그것이 곧 폐기 갈래이고, 화면이 내용 변경을 감지해 그쪽을 권한다.
 *
 * 서명 자국(signedAt·disposalSignedAt)도 승계한다. /sign 화면이 링크 자국을 보고 lease 의
 * 서명 이미지를 끼워 그리므로, 입주자는 자기 서명이 이미 놓인 화면을 열고 남은 칸에만 서명한다.
 * 화면 코드는 한 줄도 안 고친다.
 *
 * 옛 링크는 닫는다. **자기가 만든 링크를 닫는 것이 아니라 옛 링크를 닫는 것**이라 "만드는
 * 트랜잭션이 닫는 액션을 부르지 않는다"는 규칙과 충돌하지 않는다. 표시값 편집의 부수효과로
 * 반쪽 링크가 조용히 닫히던 것과도 다르다 — 여기는 운영자의 명시 조작이고 자국이 새 링크로
 * 옮겨 가 가시성이 보존된다.
 */
export async function renewContractShareLink(tenantId: string, namedLeaseTermId?: string | null): Promise<
  | { ok: true; link: ContractShareLinkInfo; phone: string | null; propertyName: string }
  | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requirePropertyAccess()
    const old = await prisma.contractShareLink.findFirst({
      where: {
        tenantId, propertyId, closedAt: null, submittedAt: null,
        ...(namedLeaseTermId ? { leaseTermId: namedLeaseTermId } : {}),
        OR: [{ signedAt: { not: null } }, { disposalSignedAt: { not: null } }, { docSignedAt: { not: Prisma.DbNull } }],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!old) return { ok: false, error: '이어받을 서명 링크가 없습니다. 새로 요청해 주세요.' }

    const link = await prisma.$transaction(async tx => {
      await tx.contractShareLink.update({ where: { id: old.id }, data: { closedAt: new Date() } })
      return tx.contractShareLink.create({
        data: {
          token: randomBytes(32).toString('base64url'),
          propertyId, tenantId, leaseTermId: old.leaseTermId,
          // 스냅샷 통째 승계 — 새로 조립하지 않는다(위 주석).
          templateSnapshot: old.templateSnapshot as object,
          // 받아 둔 서명의 자국도 함께 옮긴다. 이것이 "이미 받은 서명을 새 링크에서 어떻게
          // 보여줄지"의 답이다. 추가 서류 자국(docSignedAt)도 같은 이유로 승계한다 — 빠지면
          // 그 서류만 서명한 반쪽 링크가 새 링크에서 '서명 전'으로 읽힌다.
          signedAt: old.signedAt, disposalSignedAt: old.disposalSignedAt,
          docSignedAt: old.docSignedAt ?? undefined,
          expiresAt: new Date(Date.now() + SHARE_TTL_MS),
          createdBy: userId,
        },
      })
    }, { isolationLevel: 'Serializable' })

    // 배지 진행은 계약 축이라 lease 서명 칸이 필요하다. 이어받은 링크는 자국을 승계하지만
    // **종이에 실제로 찍히는 것은 계약에 쌓인 이미지**라 그쪽을 읽어야 답이 맞다.
    const [leaseSig, tenant, property] = await Promise.all([
      prisma.leaseTerm.findUnique({
        where: { id: old.leaseTermId },
        select: {
          signatureImageUrl: true, signatureSignedAt: true,
          disposalSignatureImageUrl: true, disposalSignatureSignedAt: true, documentSignatures: true,
        },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
      }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }),
    ])
    const primary = tenant?.contacts.find(c => c.isPrimary && !c.isEmergency) ?? tenant?.contacts.find(c => !c.isEmergency)
    return {
      ok: true,
      link: serializeLink(link, await buildShareUrl(link.token), true, leaseSig ?? EMPTY_LEASE_SIG),
      phone: primary?.contactValue ?? null,
      propertyName: property?.name ?? '',
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '링크를 다시 만들지 못했습니다.' }
  }
}

/**
 * 이 계약이 받아 둔 서명이 어디까지인가 — 계약 축. 발급 직전에 조립한 ContractData 로 판정한다.
 *
 * 종전에는 계약서·동의서 두 칸을 손으로 조립했고 동의서 사용 여부는 모르면 켜진 것으로
 * 봤다(보수적 기본). 정본 슬롯으로 옮기며 그 종이의 실제 서류 목록(disposalConsent·
 * signDocuments)을 읽는다 — 추가 서류에만 서명이 있는 계약도 '받던 서명'이다. 안 세면
 * 그 계약에 새 스냅샷 링크가 나가 증거(격리본)와 화면이 갈린다(2026-08-31 잠복 클래스).
 */
function stageOf(snapshot: {
  disposalConsent?: { enabled?: boolean }
  signDocuments?: unknown
  lease: {
    signatureImageUrl?: string | null; signatureSignedDate?: string | null
    disposalSignatureImageUrl?: string | null; disposalSignatureSignedDate?: string | null
    documentSignatures?: unknown
  } | null
}) {
  const l = snapshot.lease
  return signStageSlots({
    slots: leaseSignSlots(paperDocsOf(snapshot), {
      signatureImageUrl: l?.signatureImageUrl, signatureSignedAt: l?.signatureSignedDate,
      disposalSignatureImageUrl: l?.disposalSignatureImageUrl, disposalSignatureSignedAt: l?.disposalSignatureSignedDate,
      documentSignatures: l?.documentSignatures,
    }),
  })
}

/**
 * 계약 축 판정에 필요한 서명 칸. **기본값 없는 필수 인자**라 호출부가 안 들여오면 타입이 막는다.
 *
 * 종전에는 배지가 링크 행만 보고 진행을 셌다. 그 축을 바꾸면서 "어느 호출부는 계약을 읽고
 * 어느 호출부는 안 읽는" 갈림이 다시 생기지 않게, 인자를 옵셔널로 두지 않았다.
 */
type LeaseSignCols = LeaseSigCols & { documentSignatures?: unknown }

function serializeLink(link: {
  id: string; token: string; expiresAt: Date; signedAt: Date | null
  disposalSignedAt: Date | null; closedAt: Date | null; lockedAt: Date | null; submittedAt: Date | null
  templateSnapshot?: unknown
}, url: string, signatureLive: boolean, lease: LeaseSignCols): ContractShareLinkInfo {
  const snapDc = (link.templateSnapshot as { disposalConsent?: { enabled?: boolean } } | null)?.disposalConsent
  const slots = leaseSignSlots(paperDocsOf(link.templateSnapshot), lease)
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
    disposalEnabled: snapDc?.enabled === true,
    signStage: signStageSlots({ slots }),
    signSummary: badgeSignSummary(slots),
    lang: asSignLang((link.templateSnapshot as { signLang?: unknown } | null)?.signLang) ?? 'ko',
    signatureLive,
  }
}

// 발급 — 활성 링크가 있으면 재사용(getOrCreate, 중복 발급 방지). 재발급이 필요한 상태(만료·닫힘·잠김)면 새로 만든다.
//
// leaseTermId 는 계약 지목이다(2026-08-13, 1인 다호실). 화면이 601호 창고 계약서를 열어 놓고 서명
// 요청을 보내면 그 계약의 스냅샷이 나가야 한다. 종전에는 인자가 없어 서버가 제 추론으로 509호
// 거주 계약을 골랐고, 입주자는 자기가 보고 있다고 믿는 것과 다른 계약서에 서명하게 됐다.
// 없으면 종전 추론 그대로다 — 기존 호출부(계약서 파일 칸의 주 버튼)는 글자 하나 안 바뀐다.
export async function issueContractShareLink(tenantId: string, namedLeaseTermId?: string | null, lang?: string): Promise<
  | { ok: true; link: ContractShareLinkInfo; phone: string | null; propertyName: string }
  // 받던 서명이 있어 화면이 선택창을 열어야 하는 상태. 거절이되 막다른 길이 아니다.
  | { ok: false; code: 'SIGN_IN_PROGRESS'; error: string }
  | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requirePropertyAccess()

    const snapshot = await buildContractData(tenantId, propertyId, namedLeaseTermId)
    if (!snapshot) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    if (!snapshot.tenant.birthdate) return { ok: false, error: '생년월일이 등록되어 있지 않습니다. 입주자 정보에서 먼저 입력해 주세요.' }
    if (!snapshot.lease) return { ok: false, error: '진행 중인 계약이 없어 링크를 발급할 수 없습니다.' }
    /**
     * 서명이 이미 저장된 계약에는 새 링크를 안 내준다. 내주면 입주자가 새 스냅샷에 다시 서명하고,
     * 계약 하나에 서로 다른 내용의 서명 두 벌이 생긴다. 어느 쪽이 진짜인지 아무도 말할 수 없다.
     *
     * **판정은 계약서 서명만 본다** (2026-08-31 긴급 봉합). 종전에는 폐기 동의서 서명까지 네 칸을
     * 함께 봐서, 입주자가 동의서에만 서명하고 계약서를 안 한 채 링크가 만료되면 다시 보낼 길이
     * 통째로 막혔다. 화면은 '등록된 계약서가 없습니다'라고 하면서 동시에 '이미 서명이 저장된
     * 계약입니다'라고 거절했다 — 지울 서명도, 발급할 서명본도 없는 막다른 상태다(404호 실측).
     *
     * 동의서는 계약서에 딸린 별개 종이다. 그것만 받아 둔 상태는 '서명이 끝난 계약'이 아니다.
     * 새 링크로 다시 받으면 동의서 서명도 그 자리에서 함께 갱신되므로 두 벌이 생기지도 않는다.
     */
    // 완료(모든 서류에 서명)면 종전대로 거절한다. 그 상태에서 새 링크를 내주면 계약 하나에
    // 서로 다른 내용의 서명 두 벌이 생긴다.
    //
    // **반쪽이면 거절 대신 선택창을 연다**(운영자 신고 09da7f29, 2026-09-05).
    // "기 진행중인 계약서를 유지하면서 링크를 새로 생성하고 유효기간을 갱신하는 방법과
    // 작성중인 계약서를 폐기하고 완전 새로 작성하는 방법을 선택할 수 있게."
    //
    // 이 문이 잠복 결함도 함께 닫는다. 위 2026-08-31 봉합 이후 동의서만 서명된 계약은 이
    // 가드를 그냥 통과해 **새 스냅샷** 링크가 나갔는데, signedContractSnapshot 은 첫 서명에서
    // 굳어 재동결되지 않으므로 입주자가 새 내용에 서명해도 증거는 옛 내용으로 남았다.
    if (stageOf(snapshot) !== 'none') {
      if (stageOf(snapshot) === 'complete') {
        return { ok: false, error: '이미 서명이 저장된 계약입니다. 내용을 바꿔 다시 받으려면 계약서 화면에서 서명을 지운 뒤 요청해 주세요. 받은 서명으로 발급하려면 서명본 계약서 발급을 이용하세요.' }
      }
      return {
        ok: false,
        code: 'SIGN_IN_PROGRESS',
        error: '받던 서명이 있습니다. 이어서 받을지 폐기하고 새로 작성할지 정해 주세요.',
      }
    }

    // 딸린 계약에는 제 서명 링크를 내주지 않는다(2026-08-13 다호실 2단계). 그 계약의 종이는 부모
    // 합본 한 장이라, 여기서 링크를 내면 같은 사람이 같은 방을 두 번 서명하고 발급은 부모로만 된다.
    // 스냅샷에 담기지 않는 사실이라 한 번 더 묻는다 — 발급 API 도 같은 판정을 제 자리에서 다시 본다.
    const subCheck = await prisma.leaseTerm.findUnique({
      where: { id: snapshot.lease.id },
      select: { parentLeaseTermId: true, parentLeaseTerm: { select: { room: { select: { roomNo: true } } } } },
    })
    if (subCheck?.parentLeaseTermId) {
      const where = subCheck.parentLeaseTerm?.room?.roomNo ? `${fmtRoomNo(subCheck.parentLeaseTerm.room.roomNo, '')} 계약` : '메인 계약'
      return { ok: false, error: `이 계약은 다른 계약의 추가 계약이라 따로 서명받지 않습니다. ${where}의 계약서에 이 호실이 함께 인쇄됩니다.` }
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } })
    const propertyName = property?.name ?? ''

    // 안내 언어 확정 — 화이트리스트를 지난 운영자 선택이 먼저고, 없으면 국적 기본값이다.
    // **여기서 확정해 스냅샷에 박제한다**(표기 박제와 같은 규칙 2026-09-04). 발급 후 무엇이
    // 바뀌어도 이 링크의 안내 언어는 안 바뀌고, 이어받기는 스냅샷 통째 승계라 저절로 따라온다.
    const signLang: SignLang = asSignLang(lang) ?? signLangForNationality(snapshot.tenant.nationality)

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
      if (existing) {
        const existingLang = asSignLang((existing.templateSnapshot as { signLang?: unknown } | null)?.signLang) ?? 'ko'
        if (existingLang === signLang) return existing
        // 다른 언어를 골랐으면 그 링크를 닫고 새 스냅샷으로 새로 만든다. 안 닫으면 운영자는
        // 베트남어를 골라 보냈는데 입주자는 영어 화면을 보는, 표기 사고(413호)와 같은 클래스의
        // 조용한 갈림이 된다. 이 갈래는 위 stageOf 가드를 지나 서명 0 상태라 닫아도 잃는 것이 없다.
        await tx.contractShareLink.update({ where: { id: existing.id }, data: { closedAt: new Date() } })
      }
      // 링크가 나가는 순간 표기는 사실이 된다(2026-09-04). 자동 해석은 나중에 답이 바뀐다 —
      // 같은 계약에서 다른 서류를 발급하면 lastDocNameStyle 이 덮어쓰고, 그 값은 서열에서
      // 사람 단위 값과 국적 추정보다 위다. 그러면 **입주자가 보고 있는 링크는 영문인데
      // 운영자 화면만 한글로 뒤집힌다.** 그 갈림이 "영문으로 보냈는데 한글이 됐다"의 정체다.
      //
      // **이미 고른 값이 있으면 안 건드린다** — 운영자의 선택을 자동값으로 덮지 않는다.
      // saveContractFieldOverride 를 부르면 안 된다. 그 액션은 closeStaleUnsignedLinks 를
      // 부르므로 방금 만든 링크를 자기가 닫는다.
      const cur = await tx.leaseTerm.findUnique({ where: { id: leaseTermId }, select: { contractFieldOverrides: true } })
      const curOv = parseContractFieldOverrides(cur?.contractFieldOverrides)
      if (asDocNameStyle(curOv.nameStyle) === undefined && snapshot.lease?.nameStyle) {
        await tx.leaseTerm.update({
          where: { id: leaseTermId },
          data: { contractFieldOverrides: { ...curOv, nameStyle: snapshot.lease.nameStyle } },
        })
      }
      return tx.contractShareLink.create({
        data: {
          token: randomBytes(32).toString('base64url'),
          propertyId, tenantId, leaseTermId,
          templateSnapshot: { ...(withoutPlainPii(snapshot) as unknown as Record<string, unknown>), signLang } as unknown as object,
          expiresAt: new Date(Date.now() + SHARE_TTL_MS),
          createdBy: userId,
        },
      })
    }, { isolationLevel: 'Serializable' })
    // signatureLive 는 false 로 고정한다 — 바로 위 가드가 lease 서명 네 칸이 비어 있음을 이미 증명했다.
    // 서명 칸은 빈 것으로 넘긴다 — 바로 위 가드가 lease 서명 네 칸이 비어 있음을 이미 증명했다.
    // 추측이 아니라 증명된 사실이라 EMPTY 상수를 쓴다(리터럴 true 를 금지하는 것과 같은 이유).
    return { ok: true, link: serializeLink(link, await buildShareUrl(link.token), false, EMPTY_LEASE_SIG), phone: snapshot.tenant.primaryPhone, propertyName }
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
  | { ok: true; link: ContractShareLinkInfo | null; phone: string | null; propertyName: string; needsIssue: boolean; hasForeignRegNo: boolean
      // 발급 피커의 초기 선택. 서버가 국적으로 계산한다 — 화면마다 제 규칙을 두면 갈린다.
      defaultSignLang: SignLang; foreignForDocuments: boolean }
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
        // 서명 네 칸을 같이 읽는다 — 진입로가 signedAt(과거 사실)만 보고 서명본 화면으로 보내지 않게.
        include: {
          leaseTerm: {
            select: {
              signatureImageUrl: true, signatureSignedAt: true,
              disposalSignatureImageUrl: true, disposalSignatureSignedAt: true, documentSignatures: true,
            },
          },
        },
      }),
      prisma.tenant.findFirst({
        where: { id: tenantId, propertyId },
        // 등록 여부만 읽는다(암호문도 마스킹도 화면에 필요 없다) — 발급 확인창이 이 값을 본다.
        select: { foreignRegNoEnc: true, nationality: true, contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
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
      link: link ? serializeLink(link, await buildShareUrl(link.token), isSignatureLive(link.leaseTerm), link.leaseTerm ?? EMPTY_LEASE_SIG) : null,
      phone: primaryContact?.contactValue ?? null,
      propertyName: property?.name ?? '',
      needsIssue,
      hasForeignRegNo: !!tenant.foreignRegNoEnc,
      defaultSignLang: signLangForNationality(tenant.nationality),
      foreignForDocuments: isForeignForDocuments({ nationality: tenant.nationality, hasForeignRegNo: !!tenant.foreignRegNoEnc }),
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
// leaseTermId 는 계약 지목이다 — 발급 직전 비교이므로 발급과 **같은 계약**을 봐야 한다. 지목이 있으면
// 그 계약의 서명 링크만 후보로 삼는다. 없으면 종전 그대로(사람의 최신 서명 링크)라 기존 호출은 불변이다.
export async function checkContractShareDrift(tenantId: string, leaseTermId?: string | null): Promise<
  | { ok: true; drift: boolean }
  | { ok: false; error: string }
> {
  try {
    const { propertyId } = await requirePropertyAccess()
    // 만료 조건을 뺐다 — 만료된 링크의 차이가 아예 감지되지 않던 구멍(E페이즈 조사 2026-08-03).
    // 실측 김민정 건이 서명 당시 157,000 인데 현재 470,000 이었고 링크가 만료돼 경고가 안 떴다.
    const link = await prisma.contractShareLink.findFirst({
      where: { tenantId, propertyId, signedAt: { not: null }, ...(leaseTermId ? { leaseTermId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        templateSnapshot: true, signedAt: true, disposalSignedAt: true,
        leaseTerm: { select: { signatureSignedAt: true, disposalSignatureSignedAt: true } },
      },
    })
    if (!link) return { ok: true, drift: false }
    // **지금 lease 에 남아 있는 서명을 만든 링크만** 비교 기준이다(lib/contractVersion 정본).
    // 링크의 signedAt 은 과거 사실이라 버전을 폐기해도 남는다. 그것을 기준으로 삼으면 폐기 후
    // 이름을 고쳐 재서명한 발급에서 이미 무효인 링크와 대조해 허위 경고가 뜨고, 그 경고가 권하는
    // '재서명 받기' 를 누르면 방금 받은 서명이 폐기된다 — 경고가 스스로 사고를 만든다.
    if (!isCurrentSignatureLink(link, link.leaseTerm)) return { ok: true, drift: false }

    const current = await buildContractData(tenantId, propertyId, leaseTermId)
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
//
// signatureLive 를 함께 돌려준다 — 서명이 지워진 뒤에도 이 화면은 열린다(링크 URL 은 남으므로).
// 그때 화면이 스스로 잠기지 않게 하려면 '지금 서명이 있는가'를 화면이 알아야 한다(2026-08-10).
export async function getSignedSnapshot(tenantId: string, linkId: string): Promise<
  { data: ContractData; signatureLive: boolean } | null
> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const link = await prisma.contractShareLink.findFirst({
    where: { id: linkId, tenantId, propertyId, signedAt: { not: null } },
    select: {
      templateSnapshot: true, signedAt: true, disposalSignedAt: true,
      leaseTerm: {
        select: {
          signatureImageUrl: true, signatureSignedAt: true,
          disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
        },
      },
    },
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
  // 신원번호는 스냅샷에 없다(저장 전에 지운다) — 읽는 순간 서버가 복호해 끼운다. 로고·도장과 같은 자리다.
  const data = await injectForeignRegNo({ ...snap, ...images, lease }, tenantId)
  return { data, signatureLive: isSignatureLive(link.leaseTerm) }
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
