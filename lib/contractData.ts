// 계약서 렌더 데이터(ContractData) 조립 공유 헬퍼 — 운영자 출력 페이지와 원격 서명 링크 발급(스냅샷)이 공용.
// 인증은 하지 않는다. 호출자가 검증된 propertyId 를 넘겨야 한다(운영자 경로 requirePropertyAccess 이후 호출).
import 'server-only'
import prisma from '@/lib/prisma'
import { buildDriveThumbnailUrl, driveImageDataUrl } from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate,
  DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent,
} from '@/lib/contract'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

export type ContractData = {
  template: ContractTemplate           // 입실자 오버라이드 우선, 없으면 영업장 공통
  hasOverride: boolean                 // 오버라이드 사용 여부 — '원본으로' 버튼 활성화 판단용
  businessInfo: BusinessInfo
  phone: string | null                 // 영업장 전화 — v2.0 §26 헤더/푸터 메타
  stampImageUrl: string | null         // 인쇄에 쓰일 큰 사이즈
  logoImageUrl: string | null          // 영업장 로고 (헤더 좌측)
  refundClauseInContract: boolean      // 계약서에 환불 조항(공정위 고정 문구) 자동 표시 여부
  disposalConsent: DisposalConsentTemplate   // 잔여 소지품 임의처분 동의서 (계약서와 함께 출력)
  tenant: {
    id: string
    name: string
    birthdate: string | null   // YYYY-MM-DD
    gender: string             // '남' | '여' | ''
    job: string | null
    smoking: boolean             // 흡연 여부 — 계약서 흡연란 기본값 (고객관리에서 설정)
    primaryPhone: string | null
    emergencyContacts: Array<{ name: string; phone: string; relation: string | null }>
  }
  lease: {
    id: string
    moveInDate: string | null
    expectedMoveOut: string | null
    rentAmount: number
    depositAmount: number
    cleaningFee: number
    dueDay: string | null               // 매월 납부일 ('14' | '말' 등)
    roomNo: string | null
    registrationStatus: '신고' | '미신고' | '면제'
    signatureImageUrl: string | null   // #8 이전에 받은 앱서명(dataURL) — 출력 시 재표시
    disposalSignatureImageUrl: string | null   // 동의서 별도 서명(dataURL) — 출력 시 재표시
  } | null
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남', FEMALE: '여', UNKNOWN: '',
}
const REGISTRATION_LABEL: Record<string, '신고' | '미신고' | '면제'> = {
  REGISTERED: '신고', NOT_REPORTED: '미신고', EXEMPTED: '면제',
}

export async function buildContractData(tenantId: string, propertyId: string): Promise<ContractData | null> {
  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        leaseTerms: {
          // 퇴실 예정(CHECKOUT_PENDING)도 아직 거주 중 → 계약서·동의서 호실 등 채워지도록 포함
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: { room: { select: { roomNo: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        contractTemplate: true, businessInfo: true,
        stampDriveFileId: true, logoDriveFileId: true,
        phone: true,
        refundClauseInContract: true, disposalConsentTemplate: true,
      },
    }),
  ])

  if (!tenant) return null

  const lease = tenant.leaseTerms[0] ?? null
  const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                       ?? tenant.contacts.find(c => !c.isEmergency)
  const emergencyContacts = tenant.contacts
    .filter(c => c.isEmergency)
    .map(c => ({
      name: '', // TenantContact에 별도 이름 없음 — 사용자가 출력 페이지에서 직접 보강
      phone: c.contactValue,
      relation: c.emergencyRelation ?? null,
    }))

  // 영업장 공통 템플릿
  const baseTemplate = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
  // 입실자별 오버라이드 (있으면 그것을 우선 사용)
  const override = lease?.contractOverride as ContractTemplate | null | undefined
  const template = override ?? baseTemplate

  return {
    template,
    hasOverride: !!override,
    businessInfo: (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO,
    phone: property?.phone ?? null,
    // 도장은 인쇄 품질 기준 큰 사이즈 (= width 800px) 썸네일을 받아 max 24mm 슬롯에 object-fit:contain
    stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
    // 로고는 헤더 좌측 14mm 높이 슬롯 — 인쇄 화질 위해 width 600px 썸네일
    logoImageUrl: property?.logoDriveFileId ? buildDriveThumbnailUrl(property.logoDriveFileId, 600) : null,
    refundClauseInContract: property?.refundClauseInContract ?? true,
    disposalConsent: resolveDisposalConsent(property?.disposalConsentTemplate),
    tenant: {
      id: tenant.id,
      name: tenant.name,
      birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
      gender: GENDER_LABEL[tenant.gender] ?? '',
      job: tenant.job,
      smoking: (tenant as { smoking?: boolean }).smoking ?? false,
      primaryPhone: primaryContact?.contactValue ?? null,
      emergencyContacts,
    },
    lease: lease ? {
      id: lease.id,
      moveInDate: lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null,
      expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      rentAmount: lease.rentAmount,
      depositAmount: lease.depositAmount,
      cleaningFee: lease.cleaningFee,
      dueDay: lease.dueDay,
      roomNo: lease.room?.roomNo ?? null,
      registrationStatus: REGISTRATION_LABEL[lease.registrationStatus] ?? '미신고',
      signatureImageUrl: (lease as { signatureImageUrl?: string | null }).signatureImageUrl ?? null,
      disposalSignatureImageUrl: (lease as { disposalSignatureImageUrl?: string | null }).disposalSignatureImageUrl ?? null,
    } : null,
  }
}
