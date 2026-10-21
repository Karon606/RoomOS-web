import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import type { RentReceiptFields } from '@/lib/rentReceiptPdf'
import { kstYmdStr } from '@/lib/kstDate'
import {
  loadRentReceiptIssueContext, buildRentReceiptPreview, issueRentReceiptsInTx, trashUploaded, signRentReceiptUndo,
  receiptRequestTag, rentReceiptIssueErrorMessage,
} from '@/lib/rentReceiptIssue'
import { assertNotFuture } from '@/lib/completionDate'

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
  /** 화면이 누를 때마다 정하는 요청 id — 응답이 유실된 뒤 같은 요청을 다시 보내면 앞서 낸 장을 그대로 돌려준다(멱등). */
  requestId?: string
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

    // 발행일은 미래일 수 없다(운영자 확정 2026-09-17 — "미래로 할 필요는 없을 듯, 필요하면 발급
    // 전에 수동으로 바꾸면 되니까"). 화면 maxDate 와 두 겹이고, 정본은 lib/completionDate 다.
    // **그리기 전에** 막는다 — 미리보기도 같은 문을 지나야 미래 날짜가 찍힌 종이가 아예 안 나온다.
    // 미래를 허용하면 발행번호(YYYYMMDD-NNN)까지 앞날로 채번되어 원장 순서가 뒤집힌다.
    if (!assertNotFuture(body.fields.issueDate).ok) {
      return NextResponse.json({ ok: false, error: `발급일이 미래입니다(${body.fields.issueDate}). 아직 발급하지 않은 서류는 그 날짜로 기록할 수 없습니다.` }, { status: 400 })
    }

    const tenant = await prisma.tenant.findFirst({ where: { id: body.tenantId, propertyId }, select: { id: true, name: true } })
    if (!tenant) return NextResponse.json({ ok: false, error: '입실자를 찾을 수 없습니다.' }, { status: 404 })

    // 영업장 머리말·도장·로고 — 묶음 발급과 같은 정본(lib/rentReceiptIssue)이 읽는다.
    const loaded = await loadRentReceiptIssueContext(propertyId)
    if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status })
    const ctx = loaded.ctx
    // 발급일 기본값은 KST — UTC 로 자르면 KST 00~09 시에 어제 날짜로 발급된다
    const fields = { ...body.fields, issueDate: body.fields.issueDate || kstYmdStr() }

    // **미리보기에는 번호를 찍지 않는다.** 종전에는 미리보기·보내기에도 같은 번호가 나가서
    // 소비되지 않은 채 종이로 건네지고, 그 뒤 실제 발급본이 같은 번호를 가졌다(E페이즈 조사 2026-08-03).
    // 실제 채번은 정본(issueRentReceiptsInTx)이 저장 트랜잭션 안에서 한다 — 동시 발급 경합도 거기서 막는다.
    if (body.preview) {
      const previewBytes = await buildRentReceiptPreview(ctx, fields)
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

    // 한 장 발급 = 길이 1 인 묶음. 채번·PDF·업로드·저장은 정본 한 길이고, 묶음 발급도 달마다 이 길을 지난다.
    const uploaded: string[] = []
    let record
    try {
      const [row] = await prisma.$transaction(tx => issueRentReceiptsInTx(tx, ctx, [{
        tenantId: tenant.id, tenantName: tenant.name, leaseTermId, fields,
        nameStyle: body.nameStyle ?? null, targetMonth: body.targetMonth ?? null,
      }], uploaded, receiptRequestTag(body.requestId)), { timeout: 25_000, maxWait: 10_000 })   // 기본 maxWait 2초는 바쁜 연결에서 P2028
      record = row
    } catch (err) {
      await trashUploaded(uploaded)
      const msg = rentReceiptIssueErrorMessage(err)
      if (msg) return NextResponse.json({ ok: false, error: msg }, { status: 409 })
      throw err
    }

    return NextResponse.json({
      ok: true,
      file: {
        id: record.id,
        driveFileId: record.driveFileId,
        fileName: record.fileName,
        issuedAt: record.issuedAt,
        targetMonth: record.targetMonth,
        receiptNo: record.receiptNo,
        viewUrl: `https://drive.google.com/file/d/${record.driveFileId}/view`,
      },
      // 적용취소 토큰(§16). 운영에서 서명 키가 없으면 null 이고 화면이 적용취소를 숨긴다.
      undo: signRentReceiptUndo(propertyId, [record]),
    })
  } catch (err) {
    console.error('[/api/rent-receipt/generate] failed:', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? '입실료 납부 확인서 PDF 생성 실패' },
      { status: 500 },
    )
  }
}
