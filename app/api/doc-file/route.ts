// 저장된 서류를 같은 도메인으로 스트리밍 — 모바일 '공유'(첨부) 용.
// 클라이언트가 이 바이트를 Blob/File 로 받아 navigator.share({ files }) 로 메일/메시지에 첨부.
//
// Content-Type 은 **바이트가 정한다**(lib/docMime). 종전에는 application/pdf 를 박아서
// 스캔 업로드본(JPEG)이 깨진 PDF 로 내려갔다(긴급 신고 2026-08-25, 419호). 판정 정본이
// 화이트리스트 밖을 전부 octet-stream 으로 떨어뜨리므로 html·svg 헤더가 만들어지지 않는다 —
// 저장 파일은 업로드된 것이라 내용이 신뢰 대상이 아니고, 인라인 렌더 면을 열면 안 된다.
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { downloadDriveBytes } from '@/lib/google-drive'
import { sniffDocMime } from '@/lib/docMime'

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
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

    // 이 영업장 소유의 서류인지 검증 (계약서·입실료확인서·실거주확인서·사업자등록증)
    //
    // 네 번째 가지는 **그 영업장 자기 등록증 하나뿐**이다(2026-09-16, 서류 시트 동봉).
    // where 에 `id: propertyId` 를 함께 걸어, 다른 영업장 등록증의 Drive ID 를 넣어도 안 열린다 —
    // 권한 면이 넓어지는 것이 아니라 '내 영업장 내 파일' 한 칸이 느는 것이다.
    // /doc/[fileId] 도 **같은 날 같은 가지를 함께** 받았다. 한쪽만 늘리면 파일은 내려오는데
    // 보기 화면이 404 가 나거나 그 반대가 된다.
    const owned =
      (await prisma.contractFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } })) ||
      (await prisma.rentReceiptFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null)) ||
      (await prisma.residenceCertFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null)) ||
      (await prisma.property.findFirst({ where: { id: propertyId, bizCertDriveFileId: id }, select: { id: true } }).catch(() => null))
    if (!owned) return NextResponse.json({ error: '서류를 찾을 수 없습니다.' }, { status: 404 })

    const bytes = await downloadDriveBytes(id)
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': sniffDocMime(bytes),
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류' }, { status: 500 })
  }
}
