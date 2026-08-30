import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, downloadDriveBytes } from '@/lib/google-drive'
import { fillResidenceCertSeoul, type ResidenceCertFields } from '@/lib/residenceCertOverlay'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'

// pdf-lib 는 가볍고 빠름 — puppeteer 불필요. nodejs runtime(Buffer·googleapis) 필요.
export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

type Body = {
  tenantId: string
  leaseTermId: string | null
  fields: ResidenceCertFields
  /**
   * 이 종이에 찍힌 성명 표기 — 목록에서 다시 보낼 때 파일 이름을 같은 표기로 맞추는 데 쓴다.
   *
   * 화면이 이미 표기가 적용된 이름을 fields 에 담아 보내므로 서버는 그 선택을 알 길이 없었다.
   * 그래서 목록 화면이 파일 이름을 늘 한글로 조립했고, 영문 발급본이 '이름만 로마자이고
   * 서류명은 한글'로 다시 나갔다(2026-08-30). 안 실어 보내면 한글로 읽는다.
   */
  nameStyle?: 'ko' | 'en' | 'native' | null
  preview?: boolean   // true 면 Drive 저장 없이 PDF 바이트만 반환(인쇄 미리보기)
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

    // 본인 영업장 입실자만 — 도장은 클라가 아니라 서버 DB 기준으로 결정(주입 방지)
    const [tenant, property] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: body.tenantId, propertyId }, select: { id: true, name: true } }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { stampDriveFileId: true } }),
    ])
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    // 도장 원본 바이트(투명 PNG 보존) — 없으면 도장 없이 발급
    let stampBytes: Uint8Array | null = null
    if (property?.stampDriveFileId) {
      try { stampBytes = new Uint8Array(await downloadDriveBytes(property.stampDriveFileId)) }
      catch { stampBytes = null }
    }

    // 원본 양식 위에 데이터·도장 overlay
    const pdfBytes = await fillResidenceCertSeoul(body.fields, stampBytes)

    // 인쇄 미리보기 — 저장 없이 PDF 바로 반환
    if (body.preview) {
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="residence-cert-preview.pdf"',
          'Cache-Control': 'no-store',
        },
      })
    }

    // 묶인 lease 가 본인 영업장인지 검증
    let leaseTermId: string | null = null
    if (body.leaseTermId) {
      const lease = await prisma.leaseTerm.findFirst({ where: { id: body.leaseTermId, propertyId }, select: { id: true } })
      leaseTermId = lease?.id ?? null
    }

    const issueDate = body.fields.issueDate || kstYmdStr()   // 발급일 기본값은 KST — UTC 로 자르면 KST 00~09 시에 어제 날짜로 발급된다
    const safeTenantName = tenant.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'tenant'
    const fileName = `실거주확인서_${safeTenantName}_${issueDate.replace(/-/g, '')}_${Date.now()}.pdf`
    const { fileId } = await uploadToDrive(Buffer.from(pdfBytes), fileName, 'application/pdf')

    const record = await prisma.residenceCertFile.create({
      data: {
        propertyId,
        tenantId: tenant.id,
        leaseTermId,
        driveFileId: fileId,
        fileName,
        nameStyle: body.nameStyle ?? null,
        // 발급일은 '날짜'다 — 오프셋 없는 T00:00:00 은 실행 환경 타임존으로 읽혀 KST 기기에서
        // 하루 앞선 값이 박혔다. 저장 정본은 ymdToDbDate(UTC 자정), 읽기는 lib/fmtDate 와 짝.
        issuedAt: ymdToDbDate(issueDate),
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
