import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, buildDriveThumbnailUrl } from '@/lib/google-drive'
import { buildContractPrintHtml, getPretendardBase64, type PrintContractData } from '@/lib/contractPrintHtml'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE,
} from '@/lib/contract'

// puppeteer + chromium은 nodejs runtime 필수 (edge 불가).
// Vercel: 메모리/콜드스타트 고려해 maxDuration 60s (Pro 기본 한도).
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

const GENDER_LABEL: Record<string, string> = { MALE: '남', FEMALE: '여', UNKNOWN: '' }
const REGISTRATION_LABEL: Record<string, string> = { REGISTERED: '신고', NOT_REPORTED: '미신고', EXEMPTED: '면제' }

type Body = {
  tenantId: string
  signDate: string                  // YYYY-MM-DD
  signatureName: string
  signatureImageDataUrl: string     // base64 PNG dataURL
  smoking: '비흡연' | '흡연'
  emergencyContactText: string
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
    if (!body.signatureImageDataUrl?.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: '서명 이미지가 비어 있습니다.' }, { status: 400 })
    }

    // 데이터 모음 — getContractData 와 동일하지만 서버 액션 의존성 끊고 직접 조회
    const [tenant, property] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: body.tenantId, propertyId },
        include: {
          contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED'] } },
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
        },
      }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    const lease = tenant.leaseTerms[0] ?? null
    const baseTemplate = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
    const override = lease?.contractOverride as ContractTemplate | null | undefined
    const template = override ?? baseTemplate

    const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                         ?? tenant.contacts.find(c => !c.isEmergency)

    // sign date 표시 형식: YYYY-MM-DD → YYYY년 M월 D일
    const [y, m, dd] = body.signDate.split('-').map(Number)
    const signDateLabel = Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : body.signDate

    // Pretendard variable woff2 base64 — 한글 폰트 보장 (모듈 캐시)
    const pretendardBase64 = await getPretendardBase64()

    // 계약번호 No. YYYYMMDD-NNN (영업장별 일련, §20.8) — 입실료 납부확인서와 동일 패턴.
    // 작성일(signDate) 기준 날짜 + 이번 영업장의 누적 계약서 건수+1.
    const contractSeq = (await prisma.contractFile.count({ where: { propertyId } })) + 1
    const contractNo = `${body.signDate.replace(/-/g, '')}-${String(contractSeq).padStart(3, '0')}`

    const printData: PrintContractData = {
      template,
      businessInfo: (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO,
      phone: property?.phone ?? null,
      contractNo,
      logoImageUrl: property?.logoDriveFileId ? buildDriveThumbnailUrl(property.logoDriveFileId, 600) : null,
      stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
      pretendardBase64,
      tenant: {
        name: tenant.name,
        birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
        gender: GENDER_LABEL[tenant.gender] ?? '',
        job: tenant.job,
        primaryPhone: primaryContact?.contactValue ?? null,
      },
      lease: lease ? {
        moveInDate: lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null,
        expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
        rentAmount: lease.rentAmount,
        depositAmount: lease.depositAmount,
        cleaningFee: lease.cleaningFee,
        roomNo: lease.room?.roomNo ?? null,
        registrationStatus: REGISTRATION_LABEL[lease.registrationStatus] ?? '미신고',
      } : null,
      smoking: body.smoking,
      emergencyContactText: body.emergencyContactText,
      signDate: signDateLabel,
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
      // 좌우 14mm 는 표 우측 테두리 잘림 방지.
      // 1차: 머리말/꼬리말 없이 렌더 → 페이지 수 판정 (조항 적으면 1p, 많으면 다중 페이지 §20.10b)
      const firstPdf = Buffer.from(await page.pdf({
        ...baseOpts,
        margin: { top: '10mm', right: '14mm', bottom: '10mm', left: '14mm' },
      }))
      const pageCount = (firstPdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

      if (pageCount > 1) {
        // 다중 페이지 — §20.10b·§20.9: 꼬리말에 페이지번호(좌) + 영업장명(우).
        // 단일 페이지는 페이지번호 생략(§20.9). @sparticuz chromium 한글폰트 없음 → 꼬리말에도 Pretendard 임베드.
        const bizNameEsc = (printData.businessInfo.name || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const footerTemplate =
          `<style>@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,${pretendardBase64}) format('woff2-variations');font-weight:45 920}*{margin:0;padding:0}</style>` +
          `<div style="font-family:'Pretendard',sans-serif;font-size:8pt;color:#6B5D4F;width:100%;padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">` +
          `<span style="font-variant-numeric:tabular-nums"><span class="pageNumber"></span> / <span class="totalPages"></span></span>` +
          `<span>${bizNameEsc}</span></div>`
        pdfBuffer = Buffer.from(await page.pdf({
          ...baseOpts,
          margin: { top: '10mm', right: '14mm', bottom: '14mm', left: '14mm' },
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',   // 머리말 없음 (1p 본문 헤더와 중복 방지)
          footerTemplate,
        }))
      } else {
        pdfBuffer = firstPdf
      }
    } finally {
      await browser.close().catch(() => {})
    }

    // 2) Drive 업로드
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `계약서_${safeTenantName}_${body.signDate.replace(/-/g, '')}_${Date.now()}.pdf`
    const { fileId } = await uploadToDrive(pdfBuffer, fileName, 'application/pdf')

    // 3) ContractFile 레코드 생성
    const record = await prisma.contractFile.create({
      data: {
        propertyId,
        tenantId: tenant.id,
        leaseTermId: lease?.id ?? null,
        driveFileId: fileId,
        fileName,
        source: 'GENERATED',
        signedAt: new Date(`${body.signDate}T00:00:00`),
      },
      select: { id: true, driveFileId: true, fileName: true, signedAt: true },
    })

    // #8 서명 이미지를 lease에 영구 저장 — 다음에 계약서 출력 에디터를 열면 이 서명을 불러와 표시·재인쇄
    if (lease?.id) {
      await prisma.leaseTerm.update({
        where: { id: lease.id },
        data: { signatureImageUrl: body.signatureImageDataUrl },
      })
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
