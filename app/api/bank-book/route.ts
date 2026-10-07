// 통장사본(국문·영문)을 같은 도메인으로 스트리밍 — 환경설정 미리보기와 상담 도구 '보내기'가 함께 쓴다.
//
// /api/biz-cert 와 같은 축이다. 파일 ID 를 인자로 받지 않는다 — 이 요청을 보낸 사람이 접근할 수 있는
// **그 영업장의** 통장사본 하나만 lang 으로 골라 내려준다. 임의 Drive ID 를 끼워 넣을 자리가 없어야
// 멀티테넌트에서 새지 않는다.
//
// 사업자등록증과 다른 점은 하나다. 예금주·계좌번호가 찍힌 서류라 입금 계좌(bankAccount)와 같은
// money 읽기 스코프로 끊는다 — 금액 읽기가 막힌 역할(제한 스태프)에게는 파일도 안 나간다.
// 도장과 같은 이유로 Drive 공개 권한은 붙이지 않는다. 링크만 알면 열리는 상태로 두면 안 된다.
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { downloadDriveBytes } from '@/lib/google-drive'
import { resolveStoredDocMime } from '@/lib/propertyDocMime'
import { PROPERTY_DOCS } from '@/lib/propertyDocs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    // 언어 구분이 지도 밖이면 칼럼을 고를 수 없다 — 인증보다 먼저 거절한다(입력 모양의 문제다).
    const lang = new URL(req.url).searchParams.get('lang')
    if (lang !== 'ko' && lang !== 'en') {
      return NextResponse.json({ error: '언어 구분이 올바르지 않습니다.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })
    const access = await getPropertyAccess()
    if (!access) return NextResponse.json({ error: '접근 권한 없음' }, { status: 403 })
    if (!canReadScope(access.role, 'money')) return NextResponse.json({ error: '접근 권한 없음' }, { status: 403 })

    // 칼럼 이름은 종류 지도가 정본이다(환경설정 업로드·상담 도구와 같은 지도).
    const spec = PROPERTY_DOCS[lang === 'ko' ? 'bankbook_ko' : 'bankbook_en']
    const property = await prisma.property.findUnique({
      where: { id: access.propertyId },
      select: {
        bankBookKoDriveFileId: true, bankBookKoMimeType: true,
        bankBookEnDriveFileId: true, bankBookEnMimeType: true,
      },
    })
    const driveFileId = property?.[spec.idCol]
    if (!driveFileId) {
      return NextResponse.json({ error: '통장사본이 등록되어 있지 않습니다.' }, { status: 404 })
    }

    const bytes = await downloadDriveBytes(driveFileId)
    const mime = resolveStoredDocMime(bytes, property?.[spec.mimeCol])

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
