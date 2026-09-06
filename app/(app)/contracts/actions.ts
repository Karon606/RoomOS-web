'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { asDocNameStyle, documentName } from '@/lib/documentName'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { isContractIssued, issuingLeaseId } from '@/lib/contractIssue'
import { isDerivedPurpose, effectiveIssuePurpose } from '@/lib/contractPurpose'
import { signStageSlots, type SignStage } from '@/lib/disposalSignGate'
import { paperDocsOf, leaseSignSlots } from '@/lib/signDocuments'
import { issuedPrintedName } from '@/lib/contractPrintedFacts'

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

export type ContractListRow = {
  id: string
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  createdAt: Date
  viewUrl: string
  driveFileId: string
  tenantId: string
  tenantName: string
  /** 그 종이에 찍힌 이름 — 파일 이름이 이 값을 쓴다(영문으로 낸 서류는 파일도 영문이어야 한다). */
  docName: string
  /** 발급 당시 성명 표기 — 파일 이름을 그 종이와 같은 표기로 맞춘다. 옛 발급본은 null(한글). */
  nameStyle: 'ko' | 'en' | 'native' | null
  roomNo: string | null
  status: string | null
  // 계약번호 — 사람이 부를 수 있는 유일한 이름. 스캔본과 번호 도입(2026-08-03) 이전 발급본은 null 이다.
  contractNo: string | null
  // 같은 계약의 발급본을 묶는 축. 한 사람이 계약을 둘 가질 수 있으므로 사람이 아니라 계약이 기준이다.
  leaseTermId: string | null
  // 폐기된 버전의 발급본인가 — 삭제가 아니라 도장이라 목록에 계속 남고 [폐기됨] 배지가 붙는다.
  voidedAt: Date | null
  // 이 부가 나온 뒤 그 계약의 서명이 다음 판본으로 넘어갔는가(구버전). 폐기와 다르다.
  supersededAt: Date | null
  // 발급 목적 — null 이 곧 실계약이다(lib/contractPurpose 정본). 대표본 판정이 이 값을 본다.
  issuePurpose: string | null
  // 여러 판본 만들기가 꺼진 영업장에서 화면이 접을 행인가 — 숨김이지 삭제가 아니다.
  hidden: boolean
}

// 거주 중 성격의 lease 상태 — 이 중 하나라도 있으면 입주자는 '거주중'.
// 비거주도 넣는다. 방에 살지 않을 뿐 임대료를 내는 살아 있는 계약이라, 빼면 그 사람의 계약서 파일이
// 퇴실자 쪽으로 분류되고 호실 폴백도 안 잡힌다.
const RESIDING_STATUSES = new Set(['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'])

// 입주자의 '대표 lease' — 거주성 lease가 있으면 그것, 없으면 최신(보통 퇴실/취소).
// 계약서 파일이 lease에 연결돼 있지 않을 때(업로드 스캔본 등) 분류·호실 판정에 사용.
function effectiveLease<T extends { status: string }>(leases: T[]): T | null {
  if (!leases.length) return null
  return leases.find(l => RESIDING_STATUSES.has(l.status)) ?? leases[0]
}

// 영업장 전체 계약서 파일 — 통합 페이지(/contracts)용. 입주자·호실 정보 조인.
export async function getAllContractFiles(): Promise<ContractListRow[]> {
  const propertyId = await getPropertyId()
  // 형제 화면(입주자 정보 계약서 칸)과 같은 규칙 — 토글이 꺼져 있으면 파생 판본을 감춘다.
  // 감지망·발급 대기·종 알림 쪽 쿼리에는 이 필터가 들어가면 안 된다(그쪽은 억제 로직이다).
  const property = await prisma.property.findUnique({
    where: { id: propertyId }, select: { multiContractVersions: true },
  })
  const multiVersion = property?.multiContractVersions === true
  const rows = await prisma.contractFile.findMany({
    where: { driveFileId: { not: '' }, propertyId, deletedAt: null },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    // issuedSnapshot 은 여기서 읽지 않는다 — 서명 dataURL 두 장이 들어 있어 목록 응답이 통째로 무거워진다.
    // 발급 상세(getContractIssuedSnapshot)에서 한 건씩만 읽는다.
    select: {
      id: true, fileName: true, source: true, signedAt: true, createdAt: true, nameStyle: true, issuedSnapshot: true,
      driveFileId: true, contractNo: true, leaseTermId: true, voidedAt: true,
      supersededAt: true, issuePurpose: true, purposeOverride: true,
      tenant: {
        select: {
          id: true, name: true, englishName: true, nativeName: true,
          // 파일이 lease에 연결 안 됐을 때(업로드본) 입주자 상태로 분류하기 위한 폴백.
          leaseTerms: {
            select: { status: true, room: { select: { roomNo: true } } },
            orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          },
        },
      },
      leaseTerm: { select: { status: true, room: { select: { roomNo: true } } } },
    },
  })
  return rows.map(r => {
    // 파일에 직접 연결된 lease 우선, 없으면 입주자의 대표 lease로 폴백(퇴실 분류 누락 방지).
    const lease = r.leaseTerm ?? effectiveLease(r.tenant.leaseTerms)
    return {
      id: r.id,
      fileName: r.fileName,
      source: r.source as 'GENERATED' | 'UPLOADED',
      signedAt: r.signedAt,
      createdAt: r.createdAt,
      viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
      driveFileId: r.driveFileId,
      tenantId: r.tenant.id,
      tenantName: r.tenant.name,
      // 파일 이름은 종이에 찍힌 그 이름을 쓴다 — 종전에는 서류 종류만 표기를 따랐다.
      // 박제가 있으면 그 문자열이 정본이다. 개명·오타 정정이 이미 나간 부의 성명을 소급해
      // 바꾸면 그 목록은 증거가 아니라 지금 상태의 사영이 된다.
      docName: issuedPrintedName(r.issuedSnapshot) ?? documentName(r.tenant, asDocNameStyle(r.nameStyle)),
      nameStyle: asDocNameStyle(r.nameStyle) ?? null,
      roomNo: lease?.room?.roomNo ?? null,
      status: lease?.status ?? null,
      contractNo: r.contractNo,
      leaseTermId: r.leaseTermId,
      voidedAt: r.voidedAt,
      supersededAt: r.supersededAt,
      issuePurpose: effectiveIssuePurpose(r),
      hidden: !multiVersion && isDerivedPurpose(effectiveIssuePurpose(r)),
    }
  })
}

export type PendingIssueRow = {
  linkId: string
  tenantId: string
  // 이 링크가 어느 계약의 것인가 — 서명이 지워져 일반 화면으로 보낼 때 그 계약을 지목한다.
  leaseTermId: string
  tenantName: string
  roomNo: string | null
  signedAt: Date
  submitted: boolean
  // 이 계약에 서명이 **지금도** 남아 있는가(lease 서명 4칸 중 하나라도). signedAt 은 과거 사실이라
  // 서명을 지워도 남는다 — 그것만 보고 ?share= 로 보내면 옛 스냅샷에 갇힌다(502호 2026-08-10).
  signatureLive: boolean
  // 계약서만 서명되고 동의서가 빈 반쪽 상태인가. 이 줄을 '완료'로 읽고 발급하면 동의서 장이
  // 서명란이 빈 채로 나간다(신고 2026-09-03, 413호).
  disposalMissing: boolean
  // 서명이 어디까지 왔는가. 반쪽 줄에 '발급' 버튼이 서면 그것이 곧 413호 사고의 재료다.
  stage: SignStage
}

// 서명은 받았는데 계약서 파일이 아직 없는 계약 — /contracts 의 '발급 대기' 섹션용.
//
// 본 목록(getAllContractFiles)은 ContractFile 기준이라, 서명만 끝나고 발급 전인 계약은 한 줄도
// 나오지 않았다. 서명 제출 푸시가 이 화면으로 보내는 탓에 운영자가 데이터 유실로 오인했다
// (오류신고 d41eea8c — 502호 8/6 서명, 519호 8/8 서명, 둘 다 ContractFile 0건).
//
// 판정은 lib/contractIssue 정본을 쓴다. 홈 알림('원격 서명 완료 · 계약서 발급 필요')과 같은 규칙이어야
// 종은 울리는데 목록은 침묵하는 어긋남이 안 생긴다. 규칙을 여기서 다시 짜면 그 순간 두 화면이 갈라진다.
export async function getPendingIssueContracts(): Promise<PendingIssueRow[]> {
  const propertyId = await getPropertyId()
  const [links, files] = await Promise.all([
    // 만료(expiresAt) 조건은 절대 넣지 않는다. 링크 수명이 24시간이라 발급 시점엔 대개 이미 만료라,
    // 만료를 거르면 502호처럼 서명이 끝난 계약이 또 안 보인다(오류신고 d41eea8c 재발 지점).
    // closedAt: null 만 본다 — 운영자가 링크를 닫은 것은 계약 무산이라 대기에서 빠지는 게 맞다.
    prisma.contractShareLink.findMany({
      // 반쪽은 어느 쪽이 먼저 오든 반쪽이다(2026-09-04). 계약서 서명만 보면 동의서만 서명한
      // 계약이 이 목록에 못 들어와 화면 어디에도 안 나온다.
      where: { propertyId, closedAt: null, OR: [{ signedAt: { not: null } }, { disposalSignedAt: { not: null } }] },
      orderBy: { signedAt: 'desc' },
      select: {
        id: true, signedAt: true, disposalSignedAt: true, submittedAt: true, leaseTermId: true,
        // 링크 스냅샷이 기준이다 — 라이브 설정을 보면 서류를 새로 켜는 순간 과거 계약 전부가
        // 소급으로 반쪽이 된다. 홈 알림·계약서 패널과 같은 축이어야 세 화면이 한 답을 말한다.
        templateSnapshot: true,
        tenant: { select: { id: true, name: true } },
        leaseTerm: {
          select: {
            room: { select: { roomNo: true } },
            signatureImageUrl: true, signatureSignedAt: true,
            disposalSignatureImageUrl: true, disposalSignatureSignedAt: true, documentSignatures: true,
            // 딸린 계약이면 발급할 종이는 부모 것이다 — 대기 한 줄이 부모를 가리켜야 발급이 된다.
            parentLeaseTermId: true,
            parentLeaseTerm: { select: { room: { select: { roomNo: true } } } },
          },
        },
      },
    }),
    // driveFileId: { not: '' } 는 필수다. 발급이 실패해도 예약 행이 잠깐 존재할 수 있는데,
    // 그 빈 행을 계약서로 세면 대기가 거짓으로 해소돼 발급 안 된 계약이 화면에서 사라진다.
    prisma.contractFile.findMany({
      where: { driveFileId: { not: '' }, propertyId, deletedAt: null },
      select: { leaseTermId: true, createdAt: true },
    }),
  ])

  // 링크 축이 아니라 lease 축으로 본다 — 서명을 지우면 링크 기록은 남지만 종이는 없다.
  // 발급 대기의 물음은 "지금 발급하면 이 종이에 서명이 다 찍히는가"라 **계약 축**이다.
  // 여기는 처음부터 계약을 읽고 있었는데 손으로 조립했다. 정본으로 옮겨 세 화면이 같은
  // 함수를 부르게 한다 — 조립이 흩어져 있으면 축이 다시 갈린다(knowledge/sign-evidence-axes.md).
  const sigSlots = (l: { templateSnapshot: unknown; leaseTerm: {
    signatureImageUrl: string | null; signatureSignedAt: Date | null
    disposalSignatureImageUrl: string | null; disposalSignatureSignedAt: Date | null
    documentSignatures?: unknown } }) => leaseSignSlots(paperDocsOf(l.templateSnapshot), l.leaseTerm)

  const rows: PendingIssueRow[] = []
  const seenLease = new Set<string>()
  for (const l of links) {
    const signalAt = l.signedAt ?? l.disposalSignedAt
    if (!signalAt) continue
    // 딸린 계약의 대기는 부모 한 줄로 선다 — 그 계약의 종이가 부모 합본이기 때문이다.
    // 지목·해소 판정·중복 제거가 전부 이 한 값을 본다(lib/contractIssue 정본).
    const issueLeaseId = issuingLeaseId(l.leaseTermId, l.leaseTerm.parentLeaseTermId)
    if (isContractIssued(signalAt, issueLeaseId, files)) continue
    // 같은 계약에 링크를 여러 번 냈으면 최신 하나만 — 목록에 같은 방이 두 줄로 서는 것을 막는다.
    // orderBy signedAt desc 라 먼저 만나는 것이 최신이다.
    if (seenLease.has(issueLeaseId)) continue
    seenLease.add(issueLeaseId)
    rows.push({
      // 토큰은 절대 내보내지 않는다 — 클라이언트로 새면 누구나 서명 화면을 열 수 있다. linkId 만 준다.
      linkId: l.id,
      tenantId: l.tenant.id,
      leaseTermId: issueLeaseId,
      tenantName: l.tenant.name,
      roomNo: (l.leaseTerm.parentLeaseTermId ? l.leaseTerm.parentLeaseTerm?.room?.roomNo : l.leaseTerm.room?.roomNo) ?? null,
      signedAt: signalAt,
      submitted: l.submittedAt != null,
      signatureLive: !!(l.leaseTerm.signatureImageUrl || l.leaseTerm.signatureSignedAt
        || l.leaseTerm.disposalSignatureImageUrl || l.leaseTerm.disposalSignatureSignedAt),
      disposalMissing: signStageSlots({ slots: sigSlots(l) }) === 'partial' && !!(l.leaseTerm.signatureImageUrl || l.leaseTerm.signatureSignedAt),
      stage: signStageSlots({ slots: sigSlots(l) }),
    })
  }
  return rows
}
