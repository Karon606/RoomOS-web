import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, buildDriveThumbnailUrl } from '@/lib/google-drive'
import {
  buildResidenceCertPrintHtml, getPretendardBase64,
  type ResidenceCertFields, type PrintResidenceCertData,
} from '@/lib/residenceCertPrintHtml'

// puppeteer + chromium은 nodejs runtime 필수.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Body = {
  tenantId: string
  leaseTermId: string | null
  fields: ResidenceCertFields
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: '인증이 필요합니다.' }, { status: 401 })
    const cookieStore = await cookies()
    const propertyId = cookieStore.get('selected_property_id')?.value
    if (!propertyId) return NextResponse.json({ ok: false, error: '영업장이 선택되지 않았습니다.' }, { status: 400 })
    await requireEdit()

    const body = (await req.json()) as Body
    if (!body.tenantId || !body.fields) return NextResponse.json({ ok: false, error: '필수 데이터 누락' }, { status: 400 })

    // 본인 영업장 입실자만 — 도장 이미지는 클라가 아니라 서버 DB 기준으로 결정(주입 방지)
    const [tenant, property] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: body.tenantId, propertyId }, select: { id: true, name: true } }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { stampDriveFileId: true } }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    // 묶인 lease 가 본인 영업장인지 검증
    let leaseTermId: string | null = null
    if (body.leaseTermId) {
      const lease = await prisma.leaseTerm.findFirst({ where: { id: body.leaseTermId, propertyId }, select: { id: true } })
      leaseTermId = lease?.id ?? null
    }

    const pretendardBase64 = await getPretendardBase64()
    const printData: PrintResidenceCertData = {
      ...body.fields,
      stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
      pretendardBase64,
    }
    const html = buildResidenceCertPrintHtml(printData)

    chromium.setGraphicsMode = false
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
    let pdfBuffer: Buffer
    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 })
      await page.evaluateHandle('document.fonts.ready')
      const pdfUint8 = await page.pdf({
        format: 'A4',
        margin: { top: '12mm', right: '14mm', bottom: '12mm', left: '14mm' },
        printBackground: true,
        preferCSSPageSize: false,
      })
      pdfBuffer = Buffer.from(pdfUint8)
    } finally {
      await browser.close().catch(() => {})
    }

    const issueDate = body.fields.issueDate || new Date().toISOString().slice(0, 10)
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `실거주확인서_${safeTenantName}_${issueDate.replace(/-/g, '')}_${Date.now()}.pdf`
    const { fileId } = await uploadToDrive(pdfBuffer, fileName, 'application/pdf')

    const record = await prisma.residenceCertFile.create({
      data: {
        propertyId,
        tenantId: tenant.id,
        leaseTermId,
        driveFileId: fileId,
        fileName,
        issuedAt: new Date(`${issueDate}T00:00:00`),
      },
      select: { id: true, driveFileId: true, fileName: true, issuedAt: true },
    })

    return NextResponse.json({
      ok: true,
      file: {
        id: record.id,
        driveFileId: record.driveFileId,
        fileName: record.fileName,
        issuedAt: record.issuedAt,
        viewUrl: `https://drive.google.com/file/d/${record.driveFileId}/view`,
      },
    })
  } catch (err) {
    console.error('[/api/residence-cert/generate] failed:', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? '실거주 확인서 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
