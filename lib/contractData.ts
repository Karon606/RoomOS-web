// 계약서 렌더 데이터(ContractData) 조립 공유 헬퍼 — 운영자 출력 페이지와 원격 서명 링크 발급(스냅샷)이 공용.
// 인증은 하지 않는다. 호출자가 검증된 propertyId 를 넘겨야 한다(운영자 경로 requirePropertyAccess 이후 호출).
import 'server-only'
import { kstYmdStr } from '@/lib/kstDate'
import prisma from '@/lib/prisma'
import { driveImageDataUrl } from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate,
  type SubLeaseAddendum, type ResolvedBody,
  DEFAULT_CONTRACT_TEMPLATE, resolveSubLeaseAddendum, resolveShortStayAddendum, resolveEarlyCheckoutAddendum, resolveDisposalConsent,
  resolveRoomScheduleAddendum,
  resolveSignedBody,
} from '@/lib/contract'
import { contractLeaseFields, parseContractFieldOverrides, type ContractLeaseRow } from '@/lib/contractFieldOverrides'
import { type DocNameStyle, DEFAULT_DOC_NAME_STYLE, documentName, asDocNameStyle, docNameStyles, resolveDocNameStyle } from '@/lib/documentName'
import { formatForeignRegNo } from '@/lib/foreignRegNo'
import { readStoredForeignRegNo } from '@/lib/pii'
import { CONTRACT_ISSUE_STATUSES } from '@/lib/leaseStatus'
import { pickDocumentLease } from '@/lib/documentLease'
import { parseRoomSchedule, hasRoomSchedule, roomScheduleText } from '@/lib/roomSchedule'
import { parseShortStayPolicy, shortStayRateTable } from '@/lib/shortStay'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

/**
 * 합본 계약서의 종속 호실 한 줄 — 이 계약에 딸린 계약의 호실과 그 방 임료.
 *
 * 왜 금액을 여기 싣는가. 종이가 '509호 김상혁'만 말하고 601호 창고를 말하지 않으면, 그 사람이
 * 매달 내는 52만원의 근거가 계약서 어디에도 없다. 계약은 둘이지만 종이는 한 장이어야 한다
 * (운영자 오더 2026-08-13). 청구·수납은 여전히 계약별로 따로다 — 합쳐지는 것은 종이뿐이다.
 */
export type ContractSubLease = { id: string; roomNo: string | null; rentAmount: number }

/**
 * 이 계약에 딸린 계약들을 계약서 행으로 뽑는다. 종속이 없으면 빈 배열이고, 그때 렌더는
 * 이 기능 전과 **바이트 단위로 같다**(호출부가 빈 배열에 아무것도 안 그린다).
 *
 * 표시값은 본 계약과 같은 정본(contractLeaseFields)을 쓴다 — 종속분만 원천 컬럼을 직접 읽으면
 * 같은 종이 안에서 한 행은 오버라이드를 따르고 한 행은 안 따르는 상태가 된다.
 * 호실 오름차순으로 세운다. 조회 정렬(입주일 desc)을 그대로 쓰면 날짜를 고칠 때마다 종이의
 * 행 순서가 바뀌고, 그러면 박제 축(lease.subLeases)이 내용 변화 없이 드리프트로 잡힌다.
 */
export function contractSubLeases<T extends ContractLeaseRow & { id: string; parentLeaseTermId: string | null }>(
  leases: T[], parentLeaseId: string | undefined,
): ContractSubLease[] {
  if (!parentLeaseId) return []
  return leases
    .filter(l => l.parentLeaseTermId === parentLeaseId)
    .map(l => {
      const f = contractLeaseFields(l)
      return { id: l.id, roomNo: f.roomNo, rentAmount: f.rentAmount }
    })
    .sort((a, b) => (a.roomNo ?? '').localeCompare(b.roomNo ?? '', 'ko'))
}

/**
 * 이 계약서에 추가 호실 특약(보관 용도)을 붙일지 판정한다. 화면·발급 API 가 같이 쓰는 정본이다 —
 * 두 곳이 각자 조건을 들고 있으면 화면에는 있고 종이에는 없는 절이 생긴다.
 *
 * 조건은 둘이 함께 참일 때다.
 *   ① 딸린 계약의 상태가 NON_RESIDENT — 그 방에 살지 않고 쓰기만 하는 계약이다.
 *   ② 그 방이 거주용이 아닌 방(Room.nonResidentVacant=false) — 창고·사무실처럼 점유로 세는 방이다.
 * 601호 창고가 정확히 이 조건이고, 주소지만 유지하는 비거주나 미래 거주 예정 방은 ②에서 자연히 빠진다.
 *
 * 서명이 끝난 계약(박제본)은 그때 붙어 있던 것을 그대로 쓴다. 지금 조건으로 다시 판정하면
 * 나중에 창고를 딸았다는 이유만으로 이미 서명한 종이의 본문이 늘어난다.
 */
export function contractSubLeaseAddendum<
  T extends { parentLeaseTermId: string | null; status: string; room?: { nonResidentVacant: boolean } | null },
>(leases: T[], parentLeaseId: string | undefined, body: ResolvedBody, saved?: unknown): SubLeaseAddendum | null {
  if (body.source === 'SNAPSHOT') return body.subLeaseAddendum
  if (!parentLeaseId) return null
  const storage = leases.some(l =>
    l.parentLeaseTermId === parentLeaseId && l.status === 'NON_RESIDENT' && l.room?.nonResidentVacant === false)
  // 문안은 영업장 저장값이 정한다(2026-08-29). 인자를 안 주면 종전대로 기본 문안 —
  // 호출부가 늘 때 문안이 조용히 비는 것보다, 지금 문안이 그대로 나오는 쪽이 안전하다.
  return storage ? resolveSubLeaseAddendum(saved) : null
}

/**
 * 요금 절 — 단기 계약이면 단기 특약, 일반 계약이면 조기 퇴실 절. **둘은 배타적이다.**
 *
 * 함께 서면 같은 계약에 요금 규칙이 두 벌 있게 된다. 단기 계약에 "1개월 전에 나가면 단기
 * 요금표를 적용한다"를 붙이면 이미 단기 요금인 계약에 같은 말을 또 하는 것이고, 일반 계약에
 * 단기 특약을 붙이면 주 단위 계약이라고 선언하게 된다.
 *
 * 단기 정책이 꺼진 영업장에는 어느 것도 안 붙는다 — 적용할 요금표가 없는데 그것을 가리키는
 * 조항만 종이에 남으면, 받는 사람이 확인할 길이 없는 문장이 된다.
 *
 * 서명이 끝난 계약은 그때 붙어 있던 것을 그대로 쓴다(추가 호실 특약과 같은 규칙).
 */
export function contractRateAddendum(
  lease: { isShortTerm?: boolean } | null | undefined,
  body: ResolvedBody,
  policyEnabled: boolean,
  saved: { shortStay?: unknown; earlyCheckout?: unknown },
): SubLeaseAddendum | null {
  if (body.source === 'SNAPSHOT') return body.rateAddendum
  if (!lease || !policyEnabled) return null
  return lease.isShortTerm
    ? resolveShortStayAddendum(saved.shortStay)
    : resolveEarlyCheckoutAddendum(saved.earlyCheckout)
}

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
    nativeName: string | null    // 고객 정보의 현지 표기 이름. 없거나 서류가 못 그리는 글자면 선택지에서 빠진다
    // 국적. 종이에는 안 찍힌다 — 원격 서명 화면이 '본국 표기 이름' 칸을 그릴지 가르는 데만 쓴다.
    // 내국인(실측 79명)의 서명 화면은 이 기능 전과 완전히 같아야 하고, 그 판정 기준을 고객 정보 폼
    // (국적이 대한민국이면 칸 숨김)과 다르게 두면 같은 칸이 두 화면에서 다른 규칙으로 뜬다.
    nationality: string | null
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
  // 이 계약에 딸린 계약들(합본 계약서). 종속이 없으면 빈 배열이고 화면·인쇄는 아무 행도 안 그린다.
  subLeases: ContractSubLease[]
  // 추가 호실 특약(보관 용도). 창고류 방이 딸린 계약서에만 채워지고, 아니면 null 이라
  // 렌더가 절을 하나도 안 붙인다(그 경우의 종이는 이 기능 전과 문자 단위로 같다).
  // template 안에 넣지 않는 이유는 lib/contract 의 상수 주석에 있다(박제 축 드리프트).
  subLeaseAddendum: SubLeaseAddendum | null
  /** 요금 절 — 단기 특약 또는 조기 퇴실(배타적). 단기 정책이 꺼진 영업장은 null. */
  rateAddendum: SubLeaseAddendum | null
  /** 그 방 월세로 찍은 단기 요금표 — 절 안의 {{단기요금표}} 를 채운다. 없으면 빈 문자열. */
  shortStayRateTable: string
  // 거주 호실 일정 문장 — 기간마다 다른 방에 머무는 계약에만 채워진다(lib/roomSchedule).
  // 없으면 null 이고 렌더가 절을 안 붙인다.
  roomScheduleText: string | null
  // 그 절의 문안 — 영업장이 환경설정에서 고친 것(2026-08-31). null 이면 이 영업장은 안 쓴다.
  // 문장 자체는 위 roomScheduleText 가 {{일정}} 자리에 들어간다.
  roomScheduleAddendum: SubLeaseAddendum | null
}

const kstOrNull = (d?: Date | null) => (d ? kstYmdStr(new Date(d)) : null)

const GENDER_LABEL: Record<string, string> = {
  MALE: '남', FEMALE: '여', UNKNOWN: '',
}
/**
 * @param leaseTermId 계약 지목(선택). 그 사람의 발급 대상 계약 중 하나를 이름으로 고른다.
 *   없거나 이 사람의 발급 대상이 아니면 **종전 추론을 그대로** 쓴다 — 기존 링크·기존 호출은
 *   글자 하나 안 바뀐다(하위 호환이 이 인자의 유일한 계약 조건이다).
 *   계약이 둘인 사람(509호 거주 + 601호 창고)에게 추론은 늘 거주 계약을 고르므로, 창고 계약서를
 *   뽑을 길이 아예 없었다. 이 인자가 그 길이다.
 */
/**
 * 계약서에 적을 거주 호실 일정 문장 — 일정을 쓰는 계약에만 선다.
 *
 * 화면(buildContractData)과 발급 API 가 **같은 함수**를 쓴다. 종이와 화면이 다른 일정을
 * 적으면 안 된다. 일정에 실린 방이 이 사람의 계약 목록 밖일 수 있어(임시 방은 남의 방이다)
 * 방 이름을 따로 조회한다.
 */
export async function contractRoomScheduleText(
  lease: { roomSchedule?: unknown } | null | undefined,
  propertyId: string,
): Promise<string | null> {
  const schedule = parseRoomSchedule(lease?.roomSchedule)
  if (!hasRoomSchedule(schedule)) return null
  const rooms = await prisma.room.findMany({
    where: { propertyId, id: { in: schedule.map(e => e.roomId) } },
    select: { id: true, roomNo: true },
  })
  return roomScheduleText(schedule, id => rooms.find(r => r.id === id)?.roomNo ?? null)
}

export async function buildContractData(tenantId: string, propertyId: string, leaseTermId?: string | null): Promise<ContractData | null> {
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
          where: { status: { in: CONTRACT_ISSUE_STATUSES } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          // 방 설정(nonResidentVacant)까지 읽는다 — 추가 호실 특약을 붙일지 가르는 입력이다.
          include: { room: { select: { roomNo: true, nonResidentVacant: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        contractTemplate: true, businessInfo: true,
        stampDriveFileId: true, logoDriveFileId: true,
        phone: true,
        refundClauseInContract: true, disposalConsentTemplate: true, subLeaseAddendum: true,
        roomScheduleAddendum: true,
        shortStayPolicy: true, shortStayAddendum: true, earlyCheckoutAddendum: true,
      },
    }),
  ])

  if (!tenant) return null

  // 선택 규칙은 lib/documentLease 정본 하나다(계약서·실거주 확인서·납부 확인서 공용).
  // 지목이 있으면 그 계약. 위 where 안에서만 찾으므로 남의 계약 id 를 넣어도 통하지 않고,
  // 못 찾으면 조용히 종전 추론으로 떨어진다(막지 않는다 — 옛 URL 이 404 가 되면 그게 회귀다).
  const lease = pickDocumentLease(tenant.leaseTerms, leaseTermId)

  const scheduleText = await contractRoomScheduleText(lease, propertyId)

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
  // 단기 정책 — 요금 절을 붙일지 가르고, 절 안의 요금표 숫자를 만든다.
  const shortPolicy = parseShortStayPolicy(property?.shortStayPolicy)
  const override = lease?.contractOverride as ContractTemplate | null | undefined
  // 표시값은 오버라이드를 얹은 값 하나로만 내려간다. 화면·서명 링크 스냅샷·드리프트 비교·서명본이
  // 전부 이 값을 쓰므로 종이와 기록이 갈릴 수 없다(lib/contractFieldOverrides 가 정본).
  const fields = lease ? contractLeaseFields(lease) : null
  const fieldOverrides = lease ? parseContractFieldOverrides(lease.contractFieldOverrides) : {}
  /**
   * 성명 표기 — 저장된 값이 있으면 그것, 없으면 **앞 서류가 고른 표기를 이어받는다.**
   *
   * 운영자 요구다(2026-08-29) — "계약서를 영어로 발급하면 거주확인서도 영어로 발급을 해야하거든".
   * 납부 확인서·실거주 확인서는 이미 이어받는데 계약서만 빠져 있었다. 발급 순서에서 두 번째라
   * (보증금 영수증 → 계약서 → 납부 확인서 → 실거주 확인서) 앞의 선택이 여기서 끊기면 뒤로도 안 간다.
   *
   * **서명이 끝난 계약은 이어받지 않는다.** 표기를 안 고른 채 한글로 서명받은 계약에 나중에
   * 이어받기가 걸리면, 입주자가 서명한 종이와 화면이 갈린다. 그 계약은 저장된 값(없으면 한글)
   * 그대로다 — 서명 시점의 사실을 나중 규칙이 덮지 않는다.
   */
  const nameStyleSource = {
    name: tenant.name,
    englishName: tenant.englishName ?? null,
    nativeName: tenant.nativeName ?? null,
  }
  const signedAlready = !!(lease as { signatureSignedAt?: Date | null } | null)?.signatureSignedAt
  const inherited = asDocNameStyle((lease as { lastDocNameStyle?: unknown } | null)?.lastDocNameStyle)
  const nameStyle = signedAlready
    ? (fields?.nameStyle ?? DEFAULT_DOC_NAME_STYLE)
    : resolveDocNameStyle({
      saved: fields?.nameStyle,
      siblings: inherited ? [inherited] : [],
      nationality: tenant.nationality,
      available: docNameStyles(nameStyleSource),
    })

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
      nativeName: tenant.nativeName,
      nationality: tenant.nationality,
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
    // 발급 대상 상태(CONTRACT_ISSUE_STATUSES) 안에서만 찾는다 — 끝난 종속 계약은 종이에 안 실린다.
    subLeases: contractSubLeases(tenant.leaseTerms, lease?.id),
    // 특약 판정도 같은 목록을 본다 — 행이 실리는 계약과 특약이 말하는 계약이 갈릴 수 없다.
    subLeaseAddendum: contractSubLeaseAddendum(tenant.leaseTerms, lease?.id, body, property?.subLeaseAddendum),
    roomScheduleAddendum: resolveRoomScheduleAddendum((property as { roomScheduleAddendum?: unknown } | null)?.roomScheduleAddendum),
    rateAddendum: contractRateAddendum(lease, body, shortPolicy.enabled,
      { shortStay: property?.shortStayAddendum, earlyCheckout: property?.earlyCheckoutAddendum }),
    shortStayRateTable: shortStayRateTable(shortPolicy, lease?.rentAmount ?? 0) ?? '',
    // 호실 일정 — 이 계약의 방 이름은 그 사람의 다른 계약 목록에서 찾는다(같은 영업장이라
    // 일정에 실린 방이 그 목록 밖일 수 있어 방 조회를 따로 한다).
    roomScheduleText: scheduleText,
  }
}
