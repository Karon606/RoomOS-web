// 계약서 렌더 데이터(ContractData) 조립 공유 헬퍼 — 운영자 출력 페이지와 원격 서명 링크 발급(스냅샷)이 공용.
// 인증은 하지 않는다. 호출자가 검증된 propertyId 를 넘겨야 한다(운영자 경로 requirePropertyAccess 이후 호출).
import 'server-only'
import { kstYmdStr } from '@/lib/kstDate'
import prisma from '@/lib/prisma'
import { buildDriveThumbnailUrl, driveImageDataUrl } from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate,
  DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent,
  resolveSignedBody,
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
    // 그 서명을 받은 날(KST, YYYY-MM-DD). 있으면 계약일이 이 값으로 고정된다.
    signatureSignedDate: string | null
    disposalSignatureSignedDate: string | null
  } | null
}

const kstOrNull = (d?: Date | null) => (d ? kstYmdStr(new Date(d)) : null)

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
          // 비거주 등록자·퇴실 예정자도 발급 대상이다. 비거주는 방에 살지 않을 뿐 임대료를 내는
          // 계약이고(lib/leaseStatus.ts 의 BILLABLE_STATUSES), 돈을 받는 관계에는 근거 문서가 있어야 한다.
          // 실거주 확인서는 신고 ace54135 로 이미 같은 판단을 받았는데 계약서만 안 따라왔다(케이스 정정의 재발).
          // 같은 입주자가 거주·비거주 계약을 같은 방에 동시 보유할 수 있어(tenants/actions.ts 공존 허용)
          // 단순 take 1 이 아니라 넉넉히 조회한 뒤 JS 에서 우선순위로 고른다.
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
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

  // 우선순위 ACTIVE > CHECKOUT_PENDING > RESERVED > NON_RESIDENT (실제 거주 계약을 우선 채움).
  // 우선순위가 같으면 moveInDate 최신(위 orderBy 로 이미 desc 정렬됨). 실거주 확인서 정본과 같은 식이다.
  const LEASE_PRIORITY: Record<string, number> = { ACTIVE: 0, CHECKOUT_PENDING: 1, RESERVED: 2, NON_RESIDENT: 3 }
  const lease = [...tenant.leaseTerms]
    .sort((a, b) => (LEASE_PRIORITY[a.status] ?? 99) - (LEASE_PRIORITY[b.status] ?? 99))[0] ?? null
  const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                       ?? tenant.contacts.find(c => !c.isEmergency)
  const emergencyContacts = tenant.contacts
    .filter(c => c.isEmergency)
    .map(c => ({
      name: '', // TenantContact에 별도 이름 없음 — 사용자가 출력 페이지에서 직접 보강
      phone: c.contactValue,
      relation: c.emergencyRelation ?? null,
    }))

  // 본문 선택은 resolveSignedBody 한 곳이 정한다. 서명이 끝난 계약은 박제본을 읽으므로
  // 영업장 공통 템플릿을 고쳐도 안 바뀐다. 규칙을 여기서 복제하면 발급 API 와 갈린다.
  const body = resolveSignedBody(lease, property)
  const override = lease?.contractOverride as ContractTemplate | null | undefined

  return {
    template: body.template,
    hasOverride: !!override,
    businessInfo: body.businessInfo ?? EMPTY_BUSINESS_INFO,
    phone: property?.phone ?? null,
    // 도장은 인쇄 품질 기준 큰 사이즈 (= width 800px) 썸네일을 받아 max 24mm 슬롯에 object-fit:contain
    stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
    // 로고는 헤더 좌측 14mm 높이 슬롯 — 인쇄 화질 위해 width 600px 썸네일
    logoImageUrl: property?.logoDriveFileId ? buildDriveThumbnailUrl(property.logoDriveFileId, 600) : null,
    refundClauseInContract: body.refundClauseInContract,
    disposalConsent: resolveDisposalConsent(body.disposalConsent),
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
      // KST 로 자르는 것은 서버 몫이다. 클라이언트가 UTC 로 자르면 자정 근처에서 하루 어긋난다.
      signatureSignedDate: kstOrNull((lease as { signatureSignedAt?: Date | null }).signatureSignedAt),
      disposalSignatureSignedDate: kstOrNull((lease as { disposalSignatureSignedAt?: Date | null }).disposalSignatureSignedAt),
    } : null,
  }
}
