// 사업자등록증 사본을 같은 도메인으로 스트리밍 — 환경설정 미리보기와 상담 도구 '보내기'가 함께 쓴다.
//
// 파일 ID 를 인자로 받지 않는다. 이 요청을 보낸 사람이 접근할 수 있는 **그 영업장의** 등록증
// 하나만 내려준다 — 임의 Drive ID 를 끼워 넣을 자리가 아예 없어야 멀티테넌트에서 새지 않는다
// (/api/receipt-image 는 레코드로 소유를 검증하는데, 여기는 대상이 영업장당 한 건이라 더 좁게 잠근다).
//
// 도장과 같은 이유로 Drive 공개 권한은 붙이지 않는다 — 상호·대표자·소재지가 한 장에 모인 서류라
// 링크만 알면 열리는 상태로 두면 안 된다.
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { downloadDriveBytes, sniffImageMime } from '@/lib/google-drive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })
    const access = await getPropertyAccess()
    if (!access) return NextResponse.json({ error: '접근 권한 없음' }, { status: 403 })

    const property = await prisma.property.findUnique({
      where: { id: access.propertyId },
      select: { bizCertDriveFileId: true, bizCertMimeType: true },
    })
    if (!property?.bizCertDriveFileId) {
      return NextResponse.json({ error: '사업자등록증이 등록되어 있지 않습니다.' }, { status: 404 })
    }

    const bytes = await downloadDriveBytes(property.bizCertDriveFileId)
    // 저장된 mime 이 정본이다(업로드 마무리에서 Drive 판정값을 박아 둔다). 그 이전 저장분이나
    // 빈 값이면 바이트로 되짚는다 — 형식을 모른 채 내려보내면 첨부가 확장자 없는 파일이 된다.
    const mime = property.bizCertMimeType
      || (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === '%PDF' ? 'application/pdf' : sniffImageMime(bytes))

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        // private — 공유 캐시(CDN·프록시)에 남으면 인증을 거친 의미가 없다
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류' }, { status: 500 })
  }
}
