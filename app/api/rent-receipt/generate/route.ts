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
      prisma.property.findUnique({ where: { id: propertyId }, select: { stampDriveFileId: true } }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    let stampBytes: Uint8Array | null = null
    if (property?.stampDriveFileId) {
      try { stampBytes = new Uint8Array(await downloadDriveBytes(property.stampDriveFileId)) }
      catch { stampBytes = null }
    }

    const pdfBytes = await buildRentReceiptPdf(body.fields, stampBytes)

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

    const issueDate = body.fields.issueDate || new Date().toISOString().slice(0, 10)
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `월세영수증_${safeTenantName}_${issueDate.replace(/-/g, '')}_${Date.now()}.pdf`
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
      { ok: false, error: (err as Error).message ?? '월세 영수증 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
