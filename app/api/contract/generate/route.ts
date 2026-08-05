import { NextResponse } from 'next/server'
import { kstYmdStr } from '@/lib/kstDate'
import { resolveSignedBody } from '@/lib/contract'
import { cookies } from 'next/headers'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, buildDriveThumbnailUrl, driveImageDataUrl } from '@/lib/google-drive'
import { buildContractPrintHtml, getPretendardBase64, type PrintContractData } from '@/lib/contractPrintHtml'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent,
} from '@/lib/contract'
import { contractLeaseFields } from '@/lib/contractFieldOverrides'

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

export async function POST(req: Request) {
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
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    // 우선순위 ACTIVE > CHECKOUT_PENDING > RESERVED > NON_RESIDENT (실제 거주 계약을 우선 채움).
    // 우선순위가 같으면 moveInDate 최신(위 orderBy 로 이미 desc 정렬됨). 실거주 확인서 정본과 같은 식이다.
    const LEASE_PRIORITY: Record<string, number> = { ACTIVE: 0, CHECKOUT_PENDING: 1, RESERVED: 2, NON_RESIDENT: 3 }
    const lease = [...tenant.leaseTerms]
      .sort((a, b) => (LEASE_PRIORITY[a.status] ?? 99) - (LEASE_PRIORITY[b.status] ?? 99))[0] ?? null
    // 본문 선택은 resolveSignedBody 한 곳이 정한다(lib/contract.ts). 서명이 끝난 계약은 박제본을 읽으므로
    // 영업장 공통 템플릿을 고쳐도 안 바뀐다. 화면(contractData)과 같은 함수를 쓴다.
    const body_ = resolveSignedBody(lease, property)
    const template = body_.template

    const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                         ?? tenant.contacts.find(c => !c.isEmergency)

    // 계약일은 서버가 다시 정한다. 화면이 잠겨도 이 API 를 직접 부르면 아무 날짜나 들어오고,
    // 그 값이 계약번호·파일명·보관 레코드까지 결정하기 때문이다.
    // 서명이 있으면 서명 시각이 곧 계약일이고, 서명 전에만 화면이 보낸 값을 신뢰한다.
    // 미리보기는 저장되는 것이 없으므로 화면 값을 그대로 쓴다 — 서명 전 날짜를 바꿔가며 확인하는 용도다.
    let signDate = body.signDate
    let disposalSignDate = body.signDate
    if (!body.preview && lease?.id) {
      const link = await prisma.contractShareLink.findFirst({
        where: { leaseTermId: lease.id, signedAt: { not: null } },
        orderBy: { signedAt: 'desc' },
        select: { signedAt: true, disposalSignedAt: true },
      })
      const signedAt = link?.signedAt ?? lease.signatureSignedAt ?? null
      const disposalAt = link?.disposalSignedAt ?? lease.disposalSignatureSignedAt ?? null
      if (signedAt) signDate = kstYmdStr(signedAt)
      disposalSignDate = disposalAt ? kstYmdStr(disposalAt) : signDate
    }

    // 표시 형식: YYYY-MM-DD → YYYY년 M월 D일
    const ymdLabel = (v: string) => {
      const [yy, mm, dd] = v.split('-').map(Number)
      return Number.isFinite(yy) ? `${yy}년 ${mm}월 ${dd}일` : v
    }
    const signDateLabel = ymdLabel(signDate)
    const disposalSignDateLabel = ymdLabel(disposalSignDate)

    // Pretendard variable woff2 base64 — 한글 폰트 보장 (모듈 캐시)
    const pretendardBase64 = await getPretendardBase64()

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

    let reserved: { id: string; no: string } | null = null
    if (!body.preview) {
      for (let attempt = 0; attempt < 5 && !reserved; attempt++) {
        const issued = await prisma.contractFile.count({ where: { propertyId, contractNo: { not: null } } })
        const no = `${signDate.replace(/-/g, '')}-${String(issued + 1 + attempt).padStart(3, '0')}`
        try {
          const row = await prisma.contractFile.create({
            data: {
              propertyId, tenantId: tenant.id, leaseTermId: lease?.id ?? null,
              driveFileId: '', fileName: '', source: 'GENERATED', contractNo: no,
              signedAt: new Date(`${signDate}T00:00:00`),
            },
            select: { id: true },
          })
          reserved = { id: row.id, no }
        } catch { /* 유니크 충돌 — 다음 번호로 재시도 */ }
      }
      if (!reserved) return NextResponse.json({ ok: false, error: '계약번호 채번에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 409 })
    }
    const contractNo = reserved?.no ?? '미리보기'

    const printData: PrintContractData = {
      template,
      businessInfo: body_.businessInfo ?? EMPTY_BUSINESS_INFO,
      phone: property?.phone ?? null,
      contractNo,
      logoImageUrl: property?.logoDriveFileId ? buildDriveThumbnailUrl(property.logoDriveFileId, 600) : null,
      stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
      refundClauseInContract: body_.refundClauseInContract,
      disposalConsent: resolveDisposalConsent(body_.disposalConsent),
      disposalSignatureImageDataUrl: body.disposalSignatureImageDataUrl?.startsWith('data:image/') ? body.disposalSignatureImageDataUrl : null,
      pretendardBase64,
      tenant: {
        name: tenant.name,
        birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
        gender: GENDER_LABEL[tenant.gender] ?? '',
        job: tenant.job,
        primaryPhone: primaryContact?.contactValue ?? null,
      },
      // 표시값은 화면과 같은 함수로 조립한다(lib/contractFieldOverrides). 금액·날짜는 여전히 DB 가
      // 단일 출처다 — 클라이언트가 보낸 금액을 믿으면 이 API 를 직접 불러 아무 금액이나 발급할 수 있다.
      lease: lease ? contractLeaseFields(lease) : null,
      smoking: body.smoking,
      emergencyContactText: body.emergencyContactText,
      signDate: signDateLabel,
      disposalSignDate: disposalSignDateLabel,
      signatureName: body.signatureName,
      signatureImageDataUrl: body.signatureImageDataUrl,
    }

    const html = buildContractPrintHtml(printData)

    // 1) Chromium 실행해 HTML → PDF
    // PDF 생성에는 WebGL 불필요 → swiftshader 스킵해서 cold start 단축
    chromium.setGraphicsMode = false
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 }, // A4 96dpi @ 2x
      executablePath: await chromium.executablePath(),
      headless: true,
    })
    let pdfBuffer: Buffer
    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 })
      // 폰트 로딩까지 확실하게 대기
      await page.evaluateHandle('document.fonts.ready')
      const baseOpts = { format: 'A4' as const, printBackground: true, preferCSSPageSize: false }
      const baseMargin = { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }  // 상하좌우 동일(대칭) — 좌우 14mm 는 표 우측 테두리 잘림 방지
      const countPdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
      // 각 서류(.paper: 계약서 + (옵션)동의서)는 1물리페이지에 들어가야 함 → 의도한 페이지 수.
      // 동의서는 page-break-before 로 항상 새 장이므로 '한 장 강제'가 아니라 '서류별 한 장' 이 목표.
      const expectedPages = Math.max(1, (html.match(/<div class="paper/g) || []).length)

      // 1차: scale 1(원본) 렌더 → 페이지 수 판정 (조항 적으면 의도대로, 많으면 하단이 다음 장으로 넘침)
      let scale = 1
      const fullPdf = Buffer.from(await page.pdf({ ...baseOpts, margin: baseMargin }))  // 원본(100%) 보관 — 축소로도 못 맞추면 되돌릴 기준
      let renderedPdf = fullPdf
      let pageCount = countPdfPages(renderedPdf)
      // 살짝 넘치면(하단 조금 잘림) 한 장에 맞게 부드럽게 축소(최대 ~12%, 하한 0.88 = 가독성 바닥).
      while (pageCount > expectedPages && scale > 0.88) {
        scale = Math.round((scale - 0.04) * 100) / 100
        renderedPdf = Buffer.from(await page.pdf({ ...baseOpts, margin: baseMargin, scale }))
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
        const footerTemplate =
          `<style>@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,${pretendardBase64}) format('woff2-variations');font-weight:45 920}*{margin:0;padding:0}</style>` +
          `<div style="font-family:'Pretendard',sans-serif;font-size:8pt;color:#6B5D4F;width:100%;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">` +
          `<span style="font-variant-numeric:tabular-nums"><span class="pageNumber"></span> / <span class="totalPages"></span></span>` +
          `<span>${bizNameEsc}</span></div>`
        pdfBuffer = Buffer.from(await page.pdf({
          ...baseOpts,
          margin: baseMargin,   // 상하좌우 동일(대칭) — 푸터는 14mm 하단 여백 안에 렌더
          scale,   // 축소맞춤 적용분 유지 (각 서류가 자기 페이지에 들어가도록)
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',   // 머리말 없음 (1p 본문 헤더와 중복 방지)
          footerTemplate,
        }))
      } else {
        pdfBuffer = renderedPdf
      }
    } finally {
      await browser.close().catch(() => {})
    }

    // 미리보기/인쇄 모드 — Drive 저장·DB 기록·서명 영구저장 없이 PDF 바이트만 반환.
    // (Safari 의 '프린트 → PDF 저장' 백지 버그 우회: 화면 '인쇄' 버튼이 이 서버 PDF 를 새 탭으로 연다.)
    if (body.preview) {
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="contract-preview.pdf"',
          'Cache-Control': 'no-store',
        },
      })
    }

    // 2) Drive 업로드
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `계약서_${safeTenantName}_${signDate.replace(/-/g, '')}_${Date.now()}.pdf`
    // 3) 예약해 둔 자리를 채운다. 업로드가 실패하면 그 자리를 지운다(보상 삭제).
    let record
    try {
      const { fileId } = await uploadToDrive(pdfBuffer, fileName, 'application/pdf')
      record = await prisma.contractFile.update({
        where: { id: reserved!.id },
        data: { driveFileId: fileId, fileName },
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
    console.error('[/api/contract/generate] failed:', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? '계약서 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
