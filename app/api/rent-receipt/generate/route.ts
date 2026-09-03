import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { uploadToDrive, downloadDriveBytes } from '@/lib/google-drive'
import { buildRentReceiptPdf, type RentReceiptFields } from '@/lib/rentReceiptPdf'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

type Body = {
  tenantId: string
  leaseTermId: string | null
  fields: RentReceiptFields
  /**
   * 이 종이에 찍힌 성명 표기 — 목록에서 다시 보낼 때 파일 이름을 같은 표기로 맞추는 데 쓴다.
   *
   * 화면이 이미 표기가 적용된 이름을 fields 에 담아 보내므로 서버는 그 선택을 알 길이 없었다.
   * 그래서 목록 화면이 파일 이름을 늘 한글로 조립했고, 영문 발급본이 '이름만 로마자이고
   * 서류명은 한글'로 다시 나갔다(2026-08-30). 안 실어 보내면 한글로 읽는다.
   */
  nameStyle?: 'ko' | 'en' | 'native' | null
  /**
   * 이 종이가 증명하는 납부의 귀속월 'YYYY-MM'(화면의 anchorMonth).
   *
   * `fields.targetMonth` 는 '2026년 9월분' 같은 **표시 문자열**이고 운영자가 고칠 수 있어
   * 판정의 근거로 못 쓴다. 기계가 읽을 값을 따로 싣는다. 보증금 영수증은 월 축이 없어 안 싣는다.
   */
  targetMonth?: string | null
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
      // 인감 누락은 법적 서류에서 무효 주장의 빌미다. 조용히 삼키지 않는다(E페이즈 2026-08-03).
      try { stampBytes = new Uint8Array(await downloadDriveBytes(property.stampDriveFileId)) } catch (e) {
        console.error('[generate] 도장 내려받기 실패', e)
        return NextResponse.json({ ok: false, error: '도장 이미지를 불러오지 못했습니다. 잠시 후 다시 시도하거나 설정에서 도장을 다시 등록해 주세요.' }, { status: 502 })
      }
    }
    let logoBytes: Uint8Array | null = null
    if (property?.logoDriveFileId) {
      try { logoBytes = new Uint8Array(await downloadDriveBytes(property.logoDriveFileId)) } catch { logoBytes = null }
    }

    // 브랜드 헤더 — 영업장 사업자 정보 (v2.0 §26)
    const biz = (property?.businessInfo as { name?: string; registrationNo?: string; ceoName?: string; address?: string } | null) ?? {}
    const businessName = biz.name || property?.name || ''
    const bizLine1 = [biz.registrationNo ? `사업자등록번호 ${biz.registrationNo}` : null, biz.ceoName ? `대표 ${biz.ceoName}` : null].filter(Boolean).join(' · ')
    const bizLine2 = [biz.address, property?.phone ? `T. ${property.phone}` : null].filter(Boolean).join(' · ')
    const issueDate = body.fields.issueDate || kstYmdStr()   // 발급일 기본값은 KST — UTC 로 자르면 KST 00~09 시에 어제 날짜로 발급된다
    // 발행번호 = 발행일-발행순서 (영업장별 일련, v2.0 §26).
    //
    // **미리보기에는 번호를 찍지 않는다.** 종전에는 미리보기·보내기에도 같은 번호가 나가서
    // 소비되지 않은 채 종이로 건네지고, 그 뒤 실제 발급본이 같은 번호를 가졌다(E페이즈 조사 2026-08-03).
    // 실제 채번은 아래 저장 트랜잭션 안에서 한다 — 동시 발급 경합도 거기서 막는다.
    if (body.preview) {
      const previewBytes = await buildRentReceiptPdf(
        body.fields, { businessName, bizLine1, bizLine2, receiptNo: '미리보기' }, logoBytes, stampBytes)
      return new NextResponse(Buffer.from(previewBytes), {
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
    // 종류 — kind 컬럼이 분류 정본, 파일명 접두는 사람이 파일만 보고도 알아보게 하는 보조 표기
    const receiptKind = body.fields.kind === 'deposit' ? 'deposit' : 'rent'
    const docPrefix = receiptKind === 'deposit' ? '보증금영수증' : '입실료납부확인서'
    const fileName = `${docPrefix}_${safeTenantName}_${issueDate.replace(/-/g, '')}_${Date.now()}.pdf`
    // 채번 + 저장을 한 트랜잭션으로 — 동시 발급 시 두 건이 같은 번호를 받던 경합을 막는다.
    // (propertyId, receiptNo) 유니크가 DB 레벨 최종 방어선이다.
    // 이 시점에는 아직 PDF 에 번호가 없으므로, 번호를 확정한 뒤 PDF 를 만들고 업로드한다.
    const record = await prisma.$transaction(async tx => {
      const issued = await tx.rentReceiptFile.count({ where: { propertyId, receiptNo: { not: null } } })
      const receiptNo = `${issueDate.replace(/-/g, '')}-${String(issued + 1).padStart(3, '0')}`
      const pdf = await buildRentReceiptPdf(body.fields, { businessName, bizLine1, bizLine2, receiptNo }, logoBytes, stampBytes)
      const { fileId } = await uploadToDrive(Buffer.from(pdf), fileName, 'application/pdf')
      return tx.rentReceiptFile.create({
        data: {
          propertyId,
          tenantId: tenant.id,
          leaseTermId,
          driveFileId: fileId,
          fileName,
          nameStyle: body.nameStyle ?? null,
          kind: receiptKind,
          // 귀속월은 rent 만 — 보증금 영수증은 월 개념이 없다(화면도 스테퍼를 안 그린다).
          // 형식이 어긋나면 안 적는다. 틀린 축이 박히면 stale 판정이 조용히 어긋난다.
          targetMonth: receiptKind === 'rent' && /^\d{4}-\d{2}$/.test(body.targetMonth ?? '') ? body.targetMonth : null,
          receiptNo,
          // 발급일은 '날짜'다 — 오프셋 없는 T00:00:00 은 실행 환경 타임존으로 읽혀 KST 기기에서
          // 하루 앞선 값이 박혔다. 저장 정본은 ymdToDbDate(UTC 자정), 읽기는 lib/fmtDate 와 짝.
          issuedAt: ymdToDbDate(issueDate),
        },
        select: { id: true, driveFileId: true, fileName: true, issuedAt: true, receiptNo: true },
      })
    }, { timeout: 30_000 })

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
