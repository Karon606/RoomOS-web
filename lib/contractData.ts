// 계약서 렌더 데이터(ContractData) 조립 공유 헬퍼 — 운영자 출력 페이지와 원격 서명 링크 발급(스냅샷)이 공용.
// 인증은 하지 않는다. 호출자가 검증된 propertyId 를 넘겨야 한다(운영자 경로 requirePropertyAccess 이후 호출).
import 'server-only'
import { kstYmdStr } from '@/lib/kstDate'
import prisma from '@/lib/prisma'
import { driveImageDataUrl } from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate,
  DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent,
  resolveSignedBody,
} from '@/lib/contract'
import { contractLeaseFields, parseContractFieldOverrides } from '@/lib/contractFieldOverrides'
import { type DocNameStyle, DEFAULT_DOC_NAME_STYLE, documentName } from '@/lib/documentName'
import { formatForeignRegNo } from '@/lib/foreignRegNo'
import { readStoredForeignRegNo } from '@/lib/pii'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

export type ContractData = {
  template: ContractTemplate           // 입실자 오버라이드 우선, 없으면 영업장 공통
  hasOverride: boolean                 // 오버라이드 사용 여부 — '원본으로' 버튼 활성화 판단용
  // 표시값 오버라이드(금액·날짜·호실 등)를 쓰고 있는가 — 툴바 배지·자동값 복원 판단용.
  // 본문 오버라이드(hasOverride)와 별개다. 이쪽은 조항이 아니라 정보 표의 값이다.
  hasFieldOverrides: boolean
  businessInfo: BusinessInfo
  phone: string | null                 // 영업장 전화 — v2.0 §26 헤더/푸터 메타
  stampImageUrl: string | null         // 인쇄에 쓰일 큰 사이즈
  logoImageUrl: string | null          // 영업장 로고 (헤더 좌측)
  refundClauseInContract: boolean      // 계약서에 환불 조항(공정위 고정 문구) 자동 표시 여부
  disposalConsent: DisposalConsentTemplate   // 잔여 소지품 임의처분 동의서 (계약서와 함께 출력)
  tenant: {
    id: string
    // **이 계약서에 실제로 찍히는 성명이다.** 표기 선택(lease.nameStyle)이 이미 적용돼 있으므로
    // 화면·PDF·원격 서명 스냅샷·인쇄 사실 사영(printedFacts)이 전부 같은 문자열을 본다.
    // 원천 두 칸은 아래 koreanName·englishName 이고, 선택 UI 만 그 둘을 읽는다.
    name: string
    koreanName: string           // 고객 정보의 이름 그대로 — 표기를 한글로 되돌렸을 때의 값
    englishName: string | null   // 고객 정보의 영문 이름. 없으면 선택 UI 자체를 안 그린다
    nameStyle: DocNameStyle      // 지금 고른 표기(lease 표시값에서 옴, 계약이 없으면 기본값)
    birthdate: string | null   // YYYY-MM-DD
    /**
     * 이 계약서의 생년월일 칸에 대신 찍을 외국인등록번호(하이픈 표기). 없으면 null 이고 종전대로 생년월일이 찍힌다.
     *
     * **평문이다.** 이 값을 담은 채로 어디에 저장하면 안 된다.
     *   - 원격 서명 링크 스냅샷: contractShare 가 null 로 지우고, /sign 은 렌더할 때 서버가 다시 복호해 끼운다.
     *   - 발급본 박제: 마스킹 + HMAC 지문만 남긴다(lib/pii foreignRegNoFact).
     * 권한이 없는 역할에는 호출부(getContractData)가 마스킹으로 바꿔 내려보낸다.
     */
    foreignRegNo: string | null
    /** 등록번호가 등록돼 있는가. 평문을 지운 스냅샷에서도 남아, 링크 시도 한도와 발급 확인창이 이 값을 본다. */
    hasForeignRegNo: boolean
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
    // 성명 표기 선택. 표시값 오버라이드와 같은 칸에 살아서 서명 잠금·되돌리기·링크 닫힘이
    // 이미 걸려 있고, 이 스냅샷이 그대로 /sign 화면과 서명본 발급으로 간다.
    nameStyle: DocNameStyle
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

  // 외국인등록번호는 여기서 딱 한 번 복호한다. 이 함수의 반환값은 평문을 품으므로,
  // 저장하는 호출부(원격 서명 링크 스냅샷)는 담기 전에 지워야 한다(contractShare).
  const foreignRegNo = readStoredForeignRegNo(tenant.foreignRegNoEnc, tenant.id)

  // 본문 선택은 resolveSignedBody 한 곳이 정한다. 서명이 끝난 계약은 박제본을 읽으므로
  // 영업장 공통 템플릿을 고쳐도 안 바뀐다. 규칙을 여기서 복제하면 발급 API 와 갈린다.
  const body = resolveSignedBody(lease, property)
  const override = lease?.contractOverride as ContractTemplate | null | undefined
  // 표시값은 오버라이드를 얹은 값 하나로만 내려간다. 화면·서명 링크 스냅샷·드리프트 비교·서명본이
  // 전부 이 값을 쓰므로 종이와 기록이 갈릴 수 없다(lib/contractFieldOverrides 가 정본).
  const fields = lease ? contractLeaseFields(lease) : null
  const fieldOverrides = lease ? parseContractFieldOverrides(lease.contractFieldOverrides) : {}
  // 계약이 없으면 선택을 담아 둘 자리가 없다 — 기본(한글)으로 그린다.
  const nameStyle = fields?.nameStyle ?? DEFAULT_DOC_NAME_STYLE

  return {
    template: body.template,
    hasOverride: !!override,
    hasFieldOverrides: Object.keys(fieldOverrides).length > 0,
    businessInfo: body.businessInfo ?? EMPTY_BUSINESS_INFO,
    phone: property?.phone ?? null,
    // 도장은 인쇄 품질 기준 큰 사이즈 (= width 800px) 썸네일을 받아 max 24mm 슬롯에 object-fit:contain
    stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
    // 로고도 도장과 같이 바이트를 심는다. Drive 썸네일 URL 은 302 리디렉트 + 공개 권한이 필요한데,
    // PDF 를 그리는 헤드리스 크로미움에는 쿠키가 없어 못 받는다. 그러면 setContent 의 networkidle0
    // 이 영영 안 와서 30초 타임아웃으로 발급 자체가 실패한다(긴급 신고 e7c09f2d).
    // D페이즈(2026-08-03)에 도장만 바꾸고 로고가 남아 있던 같은 클래스의 미완 수정이다.
    logoImageUrl: property?.logoDriveFileId ? await driveImageDataUrl(property.logoDriveFileId) : null,
    refundClauseInContract: body.refundClauseInContract,
    disposalConsent: resolveDisposalConsent(body.disposalConsent),
    tenant: {
      id: tenant.id,
      // 성명 표기는 표시값과 같은 층에서 온다 — 화면·PDF·스냅샷이 한 값을 보게 하려는 것이고,
      // 그래서 서명 잠금·되돌리기·링크 닫힘 규칙을 따로 배선하지 않아도 그대로 따라온다.
      name: documentName(tenant, nameStyle),
      koreanName: tenant.name,
      englishName: tenant.englishName,
      nameStyle,
      birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
      foreignRegNo: foreignRegNo ? formatForeignRegNo(foreignRegNo) : null,
      hasForeignRegNo: !!tenant.foreignRegNoEnc,
      gender: GENDER_LABEL[tenant.gender] ?? '',
      job: tenant.job,
      smoking: (tenant as { smoking?: boolean }).smoking ?? false,
      primaryPhone: primaryContact?.contactValue ?? null,
      emergencyContacts,
    },
    lease: lease && fields ? {
      id: lease.id,
      ...fields,
      signatureImageUrl: (lease as { signatureImageUrl?: string | null }).signatureImageUrl ?? null,
      disposalSignatureImageUrl: (lease as { disposalSignatureImageUrl?: string | null }).disposalSignatureImageUrl ?? null,
      // KST 로 자르는 것은 서버 몫이다. 클라이언트가 UTC 로 자르면 자정 근처에서 하루 어긋난다.
      signatureSignedDate: kstOrNull((lease as { signatureSignedAt?: Date | null }).signatureSignedAt),
      disposalSignatureSignedDate: kstOrNull((lease as { disposalSignatureSignedAt?: Date | null }).disposalSignatureSignedAt),
    } : null,
  }
}
