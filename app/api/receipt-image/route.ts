// 영수증 사진을 같은 도메인으로 스트리밍 — 로그인 + 영업장 소유 검증 (D페이즈 2026-08-03).
//
// 왜 생겼나
//   지출 영수증과 대기 영수증 사진이 Drive 공개 읽기로 올라가고, 그 공개 URL 이 DB 에 그대로
//   저장돼 화면 <img> 가 직접 물고 있었다. 링크만 알면 로그인 없이 카드 전표·거래처 상호·
//   사업자 정보가 담긴 사진이 무만료로 열렸다. 서류 PDF 56건 사고와 같은 클래스다.
//   서류(/api/doc-file)와 달리 여기는 화면이 공개 URL 을 실제로 쓰고 있어서 권한만 걷으면
//   화면이 깨진다. 그래서 프록시를 먼저 놓고 저장된 URL 을 옮긴 뒤 권한을 걷었다.
//
// 소유 검증은 **레코드 기준**이다 — 이 영업장의 지출·대기 영수증이 참조하는 파일 ID 여야만 준다.
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { downloadDriveBytes, sniffImageMime } from '@/lib/google-drive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })
    const access = await getPropertyAccess()
    if (!access) return NextResponse.json({ error: '접근 권한 없음' }, { status: 403 })
    const propertyId = access.propertyId

    const id = new URL(req.url).searchParams.get('id')
    if (!id || !/^[\w-]{10,200}$/.test(id)) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

    // 이 영업장의 레코드가 참조하는 파일인지 — 임의 Drive ID 로 남의 파일을 끌어오지 못하게 한다
    const owned =
      (await prisma.expense.findFirst({
        where: { propertyId, OR: [{ receiptUrl: { contains: id } }, { receiptUrls: { contains: id } }] },
        select: { id: true },
      })) ||
      (await prisma.pendingReceipt.findFirst({
        where: { propertyId, OR: [{ driveFileId: id }, { imageUrl: { contains: id } }] },
        select: { id: true },
      }))
    if (!owned) return NextResponse.json({ error: '영수증을 찾을 수 없습니다.' }, { status: 404 })

    const bytes = await downloadDriveBytes(id)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': sniffImageMime(bytes),
        // private — 공유 캐시(CDN·프록시)에 남으면 인증을 거친 의미가 없다
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류' }, { status: 500 })
  }
}
