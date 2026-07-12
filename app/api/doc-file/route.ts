// 저장된 서류(Drive PDF)를 같은 도메인으로 스트리밍 — 모바일 '공유'(첨부) 용.
// 클라이언트가 이 바이트를 Blob/File 로 받아 navigator.share({ files }) 로 메일/메시지에 첨부.
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { downloadDriveBytes } from '@/lib/google-drive'

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

    // 이 영업장 소유의 서류인지 검증 (계약서·입실료확인서·실거주확인서)
    const owned =
      (await prisma.contractFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } })) ||
      (await prisma.rentReceiptFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null)) ||
      (await prisma.residenceCertFile.findFirst({ where: { driveFileId: id, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null))
    if (!owned) return NextResponse.json({ error: '서류를 찾을 수 없습니다.' }, { status: 404 })

    const bytes = await downloadDriveBytes(id)
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류' }, { status: 500 })
  }
}
