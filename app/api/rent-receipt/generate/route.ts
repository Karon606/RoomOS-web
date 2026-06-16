import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, downloadDriveBytes } from '@/lib/google-drive'
import { buildRentReceiptPdf, type RentReceiptFields } from '@/lib/rentReceiptPdf'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

type Body = {
  tenantId: string
  leaseTermId: string | null
  fields: RentReceiptFields
  preview?: boolean
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

    const [tenant, property] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: body.tenantId, propertyId }, select: { id: true, name: true } }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, phone: true, businessInfo: true, stampDriveFileId: true, logoDriveFileId: true } }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    let stampBytes: Uint8Array | null = null
    if (property?.stampDriveFileId) {
      try { stampBytes = new Uint8Array(await downloadDriveBytes(property.stampDriveFileId)) } catch { stampBytes = null }
    }
    let logoBytes: Uint8Array | null = null
    if (property?.logoDriveFileId) {
      try { logoBytes = new Uint8Array(await downloadDriveBytes(property.logoDriveFileId)) } catch { logoBytes = null }
    }

    // 브랜드 헤더 — 영업장 사업자 정보 (§20.5)
    const biz = (property?.businessInfo as { name?: string; registrationNo?: string; ceoName?: string; address?: string } | null) ?? {}
    const businessName = biz.name || property?.name || ''
    const bizLine1 = [biz.registrationNo ? `사업자등록번호 ${biz.registrationNo}` : null, biz.ceoName ? `대표 ${biz.ceoName}` : null].filter(Boolean).join(' · ')
    const bizLine2 = [biz.address, property?.phone ? `T. ${property.phone}` : null].filter(Boolean).join(' · ')
    const issueDate = body.fields.issueDate || new Date().toISOString().slice(0, 10)
    // 발행번호 = 발행일-발행순서 (영업장별 일련, §20.8). count+1 = 이번 발급분.
    const seq = (await prisma.rentReceiptFile.count({ where: { propertyId } })) + 1
    const receiptNo = `${issueDate.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`

    const pdfBytes = await buildRentReceiptPdf(body.fields, { businessName, bizLine1, bizLine2, receiptNo }, logoBytes, stampBytes)

    if (body.preview) {
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="rent-receipt-preview.pdf"',
          'Cache-Control': 'no-store',
        },
      })
    }

    let leaseTermId: string | null = null
    if (body.leaseTermId) {
      const lease = await prisma.leaseTerm.findFirst({ where: { id: body.leaseTermId, propertyId }, select: { id: true } })
      leaseTermId = lease?.id ?? null
    }

    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `입실료납부확인서_${safeTenantName}_${issueDate.replace(/-/g, '')}_${Date.now()}.pdf`
    const { fileId } = await uploadToDrive(Buffer.from(pdfBytes), fileName, 'application/pdf')

    const record = await prisma.rentReceiptFile.create({
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
    console.error('[/api/rent-receipt/generate] failed:', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? '입실료 납부 확인서 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
