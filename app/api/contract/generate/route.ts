import { NextResponse } from 'next/server'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'
import { resolveSignedBody } from '@/lib/contract'
import { cookies } from 'next/headers'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, driveImageDataUrl } from '@/lib/google-drive'
import { buildContractPrintHtml, getPretendardBase64, type PrintContractData } from '@/lib/contractPrintHtml'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent,
} from '@/lib/contract'
import { contractLeaseFields } from '@/lib/contractFieldOverrides'
import { pickDocumentLease } from '@/lib/documentLease'
import { contractSubLeases, contractSubLeaseAddendum } from '@/lib/contractData'
import { documentName } from '@/lib/documentName'
// 인쇄 사실 사영(15축) 정본 — 드리프트 비교(contractShare)와 발급본 박제가 같은 축을 쓴다.
import { printedFacts } from '@/lib/contractPrintedFacts'
import { formatForeignRegNo } from '@/lib/foreignRegNo'
import { foreignRegNoFact, readStoredForeignRegNo } from '@/lib/pii'

// puppeteer + chromium은 nodejs runtime 필수 (edge 불가).
// Vercel: 메모리/콜드스타트 고려해 maxDuration 60s (Pro 기본 한도).
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

// 캡처 시각은 클라이언트가 준다. 형식만 보고 값은 그대로 믿는다 — 미래 시각을 막을 근거가 없고
// (기기 시계가 앞선 것뿐일 수 있다) 서명 후 계약일은 어차피 아래 resolveSignDates 가 서버에서 다시 정한다.
function parseCapturedAt(v?: string): Date | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t) : null
}

const GENDER_LABEL: Record<string, string> = { MALE: '남', FEMALE: '여', UNKNOWN: '' }

type Body = {
  tenantId: string
  /**
   * 어느 계약의 계약서인가. 화면이 그리고 있는 그 계약을 그대로 실어 보낸다(2026-08-13, 1인 다호실).
   *
   * 없으면 종전 추론 그대로다 — 하위 호환이 이 인자의 유일한 계약 조건이다. 종전에는 화면이
   * ?leaseTermId= 로 601호 창고 계약서를 열어 놓고 발급을 누르면, 이 API 가 제 추론으로 509호
   * 거주 계약을 골라 **화면과 다른 내용의 PDF** 를 만들어 보관했다. 계약번호·파일명·박제까지
   * 그 계약으로 남으므로 종이와 기록이 통째로 갈리는 자리였다.
   */
  leaseTermId?: string | null
  signDate: string                  // YYYY-MM-DD — 서명 전에만 신뢰한다. 서명 후에는 서버가 다시 확정한다(아래 resolveSignDates)
  signatureName: string
  signatureImageDataUrl: string     // base64 PNG dataURL
  disposalSignatureImageDataUrl?: string  // 잔여 소지품 임의처분 동의서 별도 서명 (선택)
  signatureCapturedAt?: string      // 이번 화면에서 방금 받은 서명의 캡처 시각(ISO). 기존 서명 재사용이면 없다
  disposalSignatureCapturedAt?: string
  smoking: '비흡연' | '흡연'
  emergencyContactText: string
  preview?: boolean                 // true 면 Drive 저장·DB 기록 없이 PDF 바이트만 반환(인쇄/미리보기용)
}

// setContent 대기 상한. 종전 30초는 maxDuration 60초를 거의 다 먹어 재시도할 여유가 없었다.
const SET_CONTENT_TIMEOUT_MS = 15000

// 단계별 소요(ms) — 실패했을 때 "어디서 시간을 썼는지" 를 알 수 있는 유일한 지문이다.
// 종전에는 TimeoutError 한 줄만 남아 폰트인지 Drive 인지 렌더인지 구분할 수 없었다(신고 0aed3bdd).
// 개인정보는 넣지 않는다 — 단계 이름과 숫자뿐이다.
type Timings = Record<string, number>
async function step<T>(t: Timings, key: string, fn: () => Promise<T>): Promise<T> {
  const at = Date.now()
  try { return await fn() } finally { t[key] = Date.now() - at }
}

export async function POST(req: Request) {
  // 예약한 계약번호 자리 — 최상위 catch 가 보상 삭제하려면 try 밖에 있어야 한다(아래 catch 주석).
  let reserved: { id: string; no: string } | null = null
  // 진단용 계측 — catch 에서도 읽어야 하므로 try 밖에 둔다.
  const timings: Timings = {}
  const startedAt = Date.now()
  let pdfCalls = 0
  let renderRetried = false
  let isPreview = false
  const logTimings = (result: string) => console.log('[contract/generate]', JSON.stringify({
    result, preview: isPreview, pdfCalls, retried: renderRetried,
    total: Date.now() - startedAt, ...timings,
  }))
  try {
    // 인증
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: '인증이 필요합니다.' }, { status: 401 })
    const cookieStore = await cookies()
    const propertyId = cookieStore.get('selected_property_id')?.value
    if (!propertyId) return NextResponse.json({ ok: false, error: '영업장이 선택되지 않았습니다.' }, { status: 400 })
    await requireEdit()

    const body = (await req.json()) as Body
    isPreview = body.preview === true
    if (!body.tenantId) return NextResponse.json({ ok: false, error: 'tenantId 필요' }, { status: 400 })
    // 서명 없이도 생성 허용 — 서명란은 '(서명)' 자리표시로 출력(출력 후 직접 서명·스캔 첨부 케이스).

    // 데이터 모음 — getContractData 와 동일하지만 서버 액션 의존성 끊고 직접 조회
    const [tenant, property] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: body.tenantId, propertyId },
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
            // 방 설정(nonResidentVacant)까지 읽는다 — 화면(buildContractData)과 같은 입력이라야
            // 추가 호실 특약 판정이 종이와 화면에서 갈리지 않는다.
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
          refundClauseInContract: true, disposalConsentTemplate: true,
        },
      }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    // 선택 규칙은 lib/documentLease 정본 하나다 — 화면(buildContractData)과 같은 함수·같은 인자다.
    // 지목은 위 where(발급 대상 상태) 안에서만 찾으므로 남의 계약 id 를 실어도 통하지 않는다.
    const lease = pickDocumentLease(tenant.leaseTerms, body.leaseTermId)
    // 본문 선택은 resolveSignedBody 한 곳이 정한다(lib/contract.ts). 서명이 끝난 계약은 박제본을 읽으므로
    // 영업장 공통 템플릿을 고쳐도 안 바뀐다. 화면(contractData)과 같은 함수를 쓴다.
    const body_ = resolveSignedBody(lease, property)
    const template = body_.template

    const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                         ?? tenant.contacts.find(c => !c.isEmergency)

    // 표시값은 화면과 같은 함수로 조립한다(lib/contractFieldOverrides). 성명 표기도 그 안에 있다 —
    // 클라이언트가 보낸 이름을 믿으면 이 API 를 직접 불러 아무 이름으로나 발급할 수 있다.
    // 딸린 계약은 제 계약서를 갖지 않는다 — 그 종이는 부모 합본 한 장이다(2026-08-13 다호실 2단계).
    // 미리보기도 함께 막는다. 미리보기로 나온 PDF 를 그대로 보내면 그것이 곧 두 번째 계약서다.
    // 화면·패널이 이 경로를 안 내주지만 API 를 직접 부르면 통하므로 서버가 다시 본다.
    if (lease?.parentLeaseTermId) {
      const parent = tenant.leaseTerms.find(l => l.id === lease.parentLeaseTermId)
      const where = parent?.room?.roomNo ? `${parent.room.roomNo}호 계약서` : '메인 계약의 계약서'
      return NextResponse.json({
        ok: false,
        error: `이 계약은 다른 계약의 추가 계약이라 따로 발급하지 않습니다. ${where}에 이 호실이 함께 인쇄됩니다.`,
      }, { status: 409 })
    }

    const leaseFields = lease ? contractLeaseFields(lease) : null
    // 합본 계약서의 종속 호실 — 화면과 같은 정본(lib/contractData) 하나다. 여기서 손으로 다시
    // 세면 종이와 화면이 다른 행을 그리고, 그 차이는 발급하고 나서야 보인다.
    const subLeases = contractSubLeases(tenant.leaseTerms, lease?.id)
    // 추가 호실 특약도 화면과 같은 정본이 판정한다(lib/contractData). 서명이 끝난 계약은
    // 그때 박제된 것을 그대로 쓰므로, 이미 서명한 종이에 절이 새로 생기지 않는다.
    const subLeaseAddendum = contractSubLeaseAddendum(tenant.leaseTerms, lease?.id, body_)
    const printedTenantName = documentName(tenant, leaseFields?.nameStyle)
    // 외국인등록번호는 여기서 한 번 복호해 종이(대체 칸)와 박제(마스킹 + 지문) 둘 다에 쓴다.
    const foreignRegNo = readStoredForeignRegNo(tenant.foreignRegNoEnc, tenant.id)

    // 계약일은 서버가 다시 정한다. 화면이 잠겨도 이 API 를 직접 부르면 아무 날짜나 들어오고,
    // 그 값이 계약번호·파일명·보관 레코드까지 결정하기 때문이다.
    // 서명이 있으면 서명 시각이 곧 계약일이고, 서명 전에만 화면이 보낸 값을 신뢰한다.
    // 미리보기는 저장되는 것이 없으므로 화면 값을 그대로 쓴다 — 서명 전 날짜를 바꿔가며 확인하는 용도다.
    let signDate = body.signDate
    let disposalSignDate = body.signDate
    // 발급본 박제에 쓸 값 — 위 계약일 계산과 같은 출처를 읽되 계산 자체는 건드리지 않는다.
    // 방금 받은 서명(capturedAt)이 있으면 그것이 이 종이에 실제로 찍힌 서명의 시각이다.
    let issuedSignatureAt: Date | null = null
    let issuedDisposalAt: Date | null = null
    let issuedShareLinkId: string | null = null
    if (!body.preview && lease?.id) {
      const link = await prisma.contractShareLink.findFirst({
        where: { leaseTermId: lease.id, signedAt: { not: null } },
        orderBy: { signedAt: 'desc' },
        select: { id: true, signedAt: true, disposalSignedAt: true },
      })
      const signedAt = link?.signedAt ?? lease.signatureSignedAt ?? null
      const disposalAt = link?.disposalSignedAt ?? lease.disposalSignatureSignedAt ?? null
      if (signedAt) signDate = kstYmdStr(signedAt)
      disposalSignDate = disposalAt ? kstYmdStr(disposalAt) : signDate
      issuedShareLinkId = link?.id ?? null
      issuedSignatureAt = parseCapturedAt(body.signatureCapturedAt) ?? signedAt
      issuedDisposalAt = parseCapturedAt(body.disposalSignatureCapturedAt) ?? disposalAt
    }

    // 표시 형식: YYYY-MM-DD → YYYY년 M월 D일
    const ymdLabel = (v: string) => {
      const [yy, mm, dd] = v.split('-').map(Number)
      return Number.isFinite(yy) ? `${yy}년 ${mm}월 ${dd}일` : v
    }
    const signDateLabel = ymdLabel(signDate)
    const disposalSignDateLabel = ymdLabel(disposalSignDate)

    // Pretendard variable woff2 base64 — 한글 폰트 보장 (모듈 캐시)
    const pretendardBase64 = await step(timings, 'font', () => getPretendardBase64())

    // 계약번호 No. YYYYMMDD-NNN (영업장별 일련, v2.0 §26) — 입실료 납부확인서와 동일 패턴.
    //
    // 미리보기에는 번호를 찍지 않는다. 종전에는 미리보기·보내기에도 같은 번호가 나가서 소비되지 않은 채
    // 종이로 건네지고 그 뒤 실제 발급본이 같은 번호를 가졌다(E페이즈 조사 2026-08-03).
    // 스캔 업로드본은 번호가 없다 — 종전에는 그것까지 세어 다음 앱 발급본의 번호가 건너뛰었다.
    // 실제 채번은 아래 저장 트랜잭션 안에서 한다.
    // 저장 발급이면 번호를 **먼저 예약**한다. PDF 렌더(puppeteer)가 무거워 트랜잭션 안에 둘 수 없으므로,
    // 자리(레코드)를 먼저 잡아 유니크로 번호를 확보하고 업로드 후 파일 정보를 채운다.
    // 실패하면 그 자리를 지운다 — 보상 삭제가 없어 주인 없는 행이 남던 문제도 함께 막는다.
    // 앱이 서명 시점 본문을 모르는 계약(종이 스캔·과거 발급본)은 새 발급본을 만들지 않는다.
    // 미리보기는 막지 않는다 — 무엇이 보관돼 있는지 확인할 길은 있어야 한다.
    if (body_.blockIssue && !body.preview) {
      return NextResponse.json({
        ok: false,
        error: '이 계약은 서명 시점 본문 기록이 없습니다. 보관된 계약서를 열어 보시고, 새 계약서가 필요하면 재서명을 받아 주세요.',
      }, { status: 409 })
    }

    if (!body.preview) {
      for (let attempt = 0; attempt < 5 && !reserved; attempt++) {
        const issued = await prisma.contractFile.count({ where: { propertyId, contractNo: { not: null } } })
        const no = `${signDate.replace(/-/g, '')}-${String(issued + 1 + attempt).padStart(3, '0')}`
        try {
          const row = await prisma.contractFile.create({
            data: {
              propertyId, tenantId: tenant.id, leaseTermId: lease?.id ?? null,
              driveFileId: '', fileName: '', source: 'GENERATED', contractNo: no,
              // 서명일은 '날짜'다 — 오프셋 없는 T00:00:00 은 실행 환경 타임존으로 읽혀
              // KST 기기에서 하루 앞선 값이 박혔다. 저장 정본은 ymdToDbDate(UTC 자정).
              signedAt: ymdToDbDate(signDate),
            },
            select: { id: true },
          })
          reserved = { id: row.id, no }
        } catch { /* 유니크 충돌 — 다음 번호로 재시도 */ }
      }
      if (!reserved) return NextResponse.json({ ok: false, error: '계약번호 채번에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 409 })
    }
    const contractNo = reserved?.no ?? '미리보기'

    // 로고·도장 모두 바이트 임베드 — 외부 URL 이면 헤드리스가 못 받아 이미지가 빈칸으로 나온다(신고 e7c09f2d).
    const [logoImageUrl, stampImageUrl] = await step(timings, 'driveImages', () => Promise.all([
      property?.logoDriveFileId ? driveImageDataUrl(property.logoDriveFileId) : Promise.resolve(null),
      property?.stampDriveFileId ? driveImageDataUrl(property.stampDriveFileId) : Promise.resolve(null),
    ]))

    const printData: PrintContractData = {
      template,
      businessInfo: body_.businessInfo ?? EMPTY_BUSINESS_INFO,
      phone: property?.phone ?? null,
      contractNo,
      logoImageUrl,
      stampImageUrl,
      refundClauseInContract: body_.refundClauseInContract,
      disposalConsent: resolveDisposalConsent(body_.disposalConsent),
      disposalSignatureImageDataUrl: body.disposalSignatureImageDataUrl?.startsWith('data:image/') ? body.disposalSignatureImageDataUrl : null,
      pretendardBase64,
      tenant: {
        name: printedTenantName,
        birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
        // 등록번호가 있으면 종이의 생년월일 칸을 이 번호가 대체한다. 값은 서버가 직접 복호한다 —
        // 클라이언트가 보낸 번호를 믿으면 이 API 를 직접 불러 아무 번호나 인쇄할 수 있다.
        foreignRegNo: foreignRegNo ? formatForeignRegNo(foreignRegNo) : null,
        gender: GENDER_LABEL[tenant.gender] ?? '',
        job: tenant.job,
        primaryPhone: primaryContact?.contactValue ?? null,
      },
      // 금액·날짜는 여전히 DB 가 단일 출처다 — 클라이언트가 보낸 금액을 믿으면 이 API 를 직접 불러
      // 아무 금액이나 발급할 수 있다.
      lease: leaseFields,
      // 합본 — 이 계약에 딸린 계약의 호실·임료. 화면(buildContractData)과 같은 함수·같은 정렬이라
      // 종이와 화면이 다른 행을 그릴 수 없다. 종속이 없으면 빈 배열이고 인쇄물은 종전과 같다.
      subLeases,
      subLeaseAddendum,
      smoking: body.smoking,
      emergencyContactText: body.emergencyContactText,
      signDate: signDateLabel,
      disposalSignDate: disposalSignDateLabel,
      signatureName: body.signatureName,
      // 동의서 서명(위)과 같은 규칙 — data:image/ 가 아니면 안 그린다. 종전에는 계약서 서명만
      // 무검증이라 임의 문자열이 src 로 들어갔고, 그것이 외부 URL 이면 헤드리스가 받으러 나간다.
      signatureImageDataUrl: body.signatureImageDataUrl?.startsWith('data:image/') ? body.signatureImageDataUrl : '',
    }

    const html = buildContractPrintHtml(printData)

    // 1) Chromium 실행해 HTML → PDF
    //
    // 대기 조건은 'load' 다. 이 문서는 외부 참조가 0 건이라(폰트·로고·도장·서명 전부 data URL)
    // networkidle0 은 지킬 것이 없으면서, 단일 프로세스 크로미움이 한 번 삐끗하면 30초를 통째로
    // 태우고 지문 없는 TimeoutError 만 남겼다(신고 0aed3bdd, 간헐 실패 4회).
    // 외부 참조가 0 이라는 사실은 scripts/check-print-selfcontained.ts 축 1 이 지킨다.
    // 글꼴이 실제로 적용됐는지는 그 다음 줄의 document.fonts.ready 가 따로 보장한다.
    const renderPdf = async (attempt: number): Promise<Buffer> => {
      // 재시도 회차는 키를 나눠 남긴다 — 1차에서 몇 초를 태웠는지가 진단의 핵심이다.
      const k = (name: string) => attempt === 1 ? name : `${name}_r${attempt}`
      // PDF 생성에는 WebGL 불필요 → swiftshader 스킵해서 cold start 단축
      chromium.setGraphicsMode = false
      const browser = await step(timings, k('launch'), async () => puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 }, // A4 96dpi @ 2x
        executablePath: await chromium.executablePath(),
        headless: true,
      }))
      try {
        const page = await browser.newPage()
        await step(timings, k('setContent'), () => page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS }))
        // 폰트 로딩까지 확실하게 대기
        await step(timings, k('fontsReady'), () => page.evaluateHandle('document.fonts.ready'))
        const baseOpts = { format: 'A4' as const, printBackground: true, preferCSSPageSize: false }
        const baseMargin = { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }  // 상하좌우 동일(대칭) — 좌우 14mm 는 표 우측 테두리 잘림 방지
        // page.pdf 호출 수 — 축소맞춤 루프가 몇 바퀴 돌았는지가 곧 렌더 시간의 대부분이다.
        const printPdf = async (opts: Parameters<typeof page.pdf>[0]) => { pdfCalls++; return Buffer.from(await page.pdf(opts)) }
        const countPdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
        // 각 서류(.paper: 계약서 + (옵션)동의서)는 1물리페이지에 들어가야 함 → 의도한 페이지 수.
        // 동의서는 page-break-before 로 항상 새 장이므로 '한 장 강제'가 아니라 '서류별 한 장' 이 목표.
        const expectedPages = Math.max(1, (html.match(/<div class="paper/g) || []).length)

        // 1차: scale 1(원본) 렌더 → 페이지 수 판정 (조항 적으면 의도대로, 많으면 하단이 다음 장으로 넘침)
        let scale = 1
        const fullPdf = await printPdf({ ...baseOpts, margin: baseMargin })  // 원본(100%) 보관 — 축소로도 못 맞추면 되돌릴 기준
        let renderedPdf = fullPdf
        let pageCount = countPdfPages(renderedPdf)
        // 살짝 넘치면(하단 조금 잘림) 한 장에 맞게 부드럽게 축소(최대 ~12%, 하한 0.88 = 가독성 바닥).
        while (pageCount > expectedPages && scale > 0.88) {
          scale = Math.round((scale - 0.04) * 100) / 100
          renderedPdf = await printPdf({ ...baseOpts, margin: baseMargin, scale })
          pageCount = countPdfPages(renderedPdf)
        }
        // 축소(≥88%)로도 의도 페이지 수에 못 맞추면 = 내용이 매우 많음 → 글씨가 작아지는 손해만 보고
        // 어차피 다중 페이지가 됨. 이럴 땐 원본(100%)으로 되돌려 '읽기 좋은 크기 + 여러 장'으로 출력한다.
        // (운영자가 조항을 많이 적어도 글씨는 절대 88% 미만으로 작아지지 않음. 섹션은 page-break-inside:avoid 로 통째 유지.)
        if (pageCount > expectedPages) {
          scale = 1
          renderedPdf = fullPdf
          pageCount = countPdfPages(renderedPdf)
        }

        if (pageCount > 1) {
          // 다중 페이지 — v2.0 §26·v2.0 §26: 꼬리말에 페이지번호(좌) + 영업장명(우).
          // 단일 페이지는 페이지번호 생략(v2.0 §26). @sparticuz chromium 한글폰트 없음 → 꼬리말에도 Pretendard 임베드.
          const bizNameEsc = (printData.businessInfo.name || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          // 폰트를 못 구했으면 @font-face 를 넣지 않는다 — 빈 src 는 로딩 실패로 대기를 만든다(본문 쪽과 같은 규칙).
          const footerFontCss = pretendardBase64
            ? `@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,${pretendardBase64}) format('woff2-variations');font-weight:45 920}`
            : ''
          const footerTemplate =
            `<style>${footerFontCss}*{margin:0;padding:0}</style>` +
            `<div style="font-family:'Pretendard',sans-serif;font-size:8pt;color:#6B5D4F;width:100%;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">` +
            `<span style="font-variant-numeric:tabular-nums"><span class="pageNumber"></span> / <span class="totalPages"></span></span>` +
            `<span>${bizNameEsc}</span></div>`
          return await printPdf({
            ...baseOpts,
            margin: baseMargin,   // 상하좌우 동일(대칭) — 푸터는 14mm 하단 여백 안에 렌더
            scale,   // 축소맞춤 적용분 유지 (각 서류가 자기 페이지에 들어가도록)
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',   // 머리말 없음 (1p 본문 헤더와 중복 방지)
            footerTemplate,
          })
        }
        return renderedPdf
      } finally {
        await browser.close().catch(() => {})
      }
    }

    // 1회 재시도. 실패의 정체가 '단일 프로세스 크로미움이 가끔 삐끗한다' 라서, 같은 입력을 새 프로세스로
    // 한 번만 더 그려 보는 것이 유일하게 근거 있는 대응이다(브라우저는 위 finally 가 이미 닫았다).
    // 15초 x 2회 + 렌더·업로드가 maxDuration 60초 예산 안에 들어간다. 두 번 다 실패하면 그냥 실패한다.
    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderPdf(1)
    } catch (e) {
      renderRetried = true
      console.warn('[/api/contract/generate] 렌더 1차 실패 — 1회 재시도:', (e as Error).message)
      pdfBuffer = await renderPdf(2)
    }

    // 미리보기/인쇄 모드 — Drive 저장·DB 기록·서명 영구저장 없이 PDF 바이트만 반환.
    // (Safari 의 '프린트 → PDF 저장' 백지 버그 우회: 화면 '인쇄' 버튼이 이 서버 PDF 를 새 탭으로 연다.)
    if (body.preview) {
      logTimings('ok')
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="contract-preview.pdf"',
          'Cache-Control': 'no-store',
        },
      })
    }

    // 2) Drive 업로드
    // 파일 이름은 표기 선택(printedTenantName)을 따라가지 않는다 — 보관·검색의 열쇠라 고객 정보의
    // 이름 하나로 고정한다. 화면의 미리보기 파일명(ContractView.pdfFileName)도 같은 규칙이다.
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `계약서_${safeTenantName}_${signDate.replace(/-/g, '')}_${Date.now()}.pdf`
    // 발급본 박제 — 이 종이가 무엇을 인쇄했는지의 증거. 값은 방금 이 PDF 를 그릴 때 쓴 것 그대로다.
    // DB 를 다시 읽으면 그 사이 바뀐 값이 들어와 종이와 기록이 갈린다.
    //
    // lease 의 서명 네 칸에 얹어 두면 서명을 지울 때 이미 발급한 계약서의 증거까지 함께 사라진다
    // (502호 2026-08-10 — 8/6 서명 이미지 소실). 그래서 발급본 자기 자신이 들고 있는다.
    //
    // 축은 lib/contractPrintedFacts 정본 하나다. 드리프트 비교와 같은 15축이어야
    // "발급 때 경고가 없었는데 기록에는 다르게 남는" 상태가 생기지 않는다.
    // 비상연락망은 그 사영의 정의대로 등록된 비상연락처 목록이다(화면에서 손으로 고친 한 줄 텍스트가
    // 아니라 그 줄의 원천). 흡연은 이 종이에 실제로 찍힌 값을 쓴다.
    const issuedSnapshot = {
      v: 1,
      issuedAt: new Date().toISOString(),
      bodySource: body_.source,
      shareLinkId: issuedShareLinkId,
      signature: {
        contractImage: printData.signatureImageDataUrl || null,
        contractSignedAt: issuedSignatureAt ? issuedSignatureAt.toISOString() : null,
        disposalImage: printData.disposalSignatureImageDataUrl,
        disposalSignedAt: issuedDisposalAt ? issuedDisposalAt.toISOString() : null,
      },
      facts: printedFacts({
        tenant: {
          name: printData.tenant.name,
          birthdate: printData.tenant.birthdate,
          // 박제에는 평문을 남기지 않는다. 마스킹 + HMAC 지문이라 "이 종이에 어떤 번호가 찍혔는가" 는
          // 지문 대조로 답할 수 있고, 기록만 털린 사람이 번호를 복원할 길은 없다.
          foreignRegNoFact: foreignRegNoFact(foreignRegNo),
          gender: printData.tenant.gender,
          primaryPhone: printData.tenant.primaryPhone,
          smoking: body.smoking === '흡연',
          emergencyContacts: tenant.contacts
            .filter(c => c.isEmergency)
            .map(c => ({ name: '', phone: c.contactValue, relation: c.emergencyRelation ?? null })),
        },
        lease: printData.lease,
        subLeases: printData.subLeases,
        template: printData.template,
        subLeaseAddendum: printData.subLeaseAddendum,
      }),
    }

    // 3) 예약해 둔 자리를 채운다. 업로드가 실패하면 그 자리를 지운다(보상 삭제).
    // 박제는 파일 정보와 **같은 문**으로 넣는다 — 나중에 따로 쓰는 경로를 두면 그것이 곧 갱신 경로가 된다.
    let record
    try {
      const { fileId } = await step(timings, 'upload', () => uploadToDrive(pdfBuffer, fileName, 'application/pdf'))
      record = await prisma.contractFile.update({
        where: { id: reserved!.id },
        data: { driveFileId: fileId, fileName, issuedSnapshot: issuedSnapshot as unknown as object },
        select: { id: true, driveFileId: true, fileName: true, signedAt: true, contractNo: true },
      })
    } catch (e) {
      await prisma.contractFile.delete({ where: { id: reserved!.id } }).catch(() => {})
      throw e
    }

    // #8 서명 이미지를 lease에 영구 저장 — 다음에 계약서 출력 에디터를 열면 이 서명을 불러와 표시·재인쇄.
    // 서명 없이 생성한 경우(빈 값)는 기존 저장 서명을 지우지 않도록 유효 이미지일 때만 갱신.
    if (lease?.id) {
      if (body.signatureImageDataUrl?.startsWith('data:image/')) {
        // 캡처 시각이 함께 왔을 때만 시각을 갱신한다. 기존 저장 서명을 재사용한 재발급이
        // 과거 서명일을 오늘로 밀어버리면 안 된다 — 그게 이번 결함의 뿌리다.
        const at = parseCapturedAt(body.signatureCapturedAt)
        // 서명과 같은 update 문 안에서 그때의 본문을 박제한다. 값은 이 PDF 를 실제로 렌더할 때 쓴 것
        // 그대로다 — DB 를 다시 읽으면 그 사이 바뀐 값이 들어와 종이와 기록이 갈린다.
        // 이미 박제본이 있으면 덮지 않는다. 재발급이 첫 서명의 기록을 갈아치우면 격리가 무의미하다.
        const needSnapshot = at && !lease.signedContractSnapshot
        await prisma.leaseTerm.update({
          where: { id: lease.id },
          data: {
            signatureImageUrl: body.signatureImageDataUrl,
            ...(at ? { signatureSignedAt: at } : {}),
            ...(needSnapshot ? { signedContractSnapshot: {
              origin: 'IN_PERSON', capturedAt: at.toISOString(),
              template: template as unknown as object,
              refundClauseInContract: printData.refundClauseInContract,
              disposalConsent: printData.disposalConsent as unknown as object,
              businessInfo: printData.businessInfo as unknown as object,
              // 이 종이에 실제로 붙은 특약을 함께 동결한다. 안 담으면 서명 뒤 재발급에서
              // 박제본이 특약을 모르고(null) 절이 통째로 사라진다.
              subLeaseAddendum: (printData.subLeaseAddendum ?? null) as unknown as object,
            } } : {}),
          },
        })
      }
      // 동의서(잔여 소지품 임의처분) 서명도 영구 저장 — 계약서 서명과 **같은 규칙**으로.
      //
      // 종전에는 이 한 줄만 무조건 덮어써서(`: null`), 원격 서명으로 받아둔 동의서 서명이 있는 상태에서
      // 운영자가 동의서 서명 없이 계약서를 재발급하면 조용히 소실됐다. 되돌리기도 없었다.
      // 발급된 PDF 자체는 ContractFile 로 남지만(그건 지워지지 않는다), lease 의 서명 원본이 사라져
      // 다음 재발급부터는 서명 없는 계약서가 나온다. 유효한 이미지일 때만 갱신한다(2026-08-03).
      // 컬럼 미적용(마이그레이션 전) 환경에서도 PDF 생성·계약서 서명 저장이 깨지지 않게 best-effort.
      if (body.disposalSignatureImageDataUrl?.startsWith('data:image/')) {
        try {
          await prisma.leaseTerm.update({
            where: { id: lease.id },
            data: {
              disposalSignatureImageUrl: body.disposalSignatureImageDataUrl,
              ...(parseCapturedAt(body.disposalSignatureCapturedAt) ? { disposalSignatureSignedAt: parseCapturedAt(body.disposalSignatureCapturedAt)! } : {}),
            },
          })
        } catch (e) {
          console.error('[contract/generate] 동의서 서명 저장 실패 (SQL 미적용 가능):', e)
        }
      }
    }

    logTimings('ok')
    return NextResponse.json({
      ok: true,
      file: {
        id: record.id,
        driveFileId: record.driveFileId,
        fileName: record.fileName,
        signedAt: record.signedAt,
        viewUrl: `https://drive.google.com/file/d/${record.driveFileId}/view`,
      },
    })
  } catch (err) {
    // 예약한 번호 자리를 반드시 지운다. 종전에는 Drive 업로드 실패에만 보상 삭제가 있어,
    // 그 앞 단계(PDF 렌더)에서 실패하면 파일 없는 행이 번호만 물고 남았다 — 감지망의
    // '번호만 예약되고 파일이 안 붙은 계약서' 가 그것이고, 다음 발급의 번호도 건너뛴다(신고 e7c09f2d).
    if (reserved) await prisma.contractFile.delete({ where: { id: reserved.id } }).catch(() => {})
    logTimings('fail')
    console.error('[/api/contract/generate] failed:', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? '계약서 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
