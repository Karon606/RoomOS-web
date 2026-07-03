import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  // 인증 게이트 — 로그인 사용자만(유료 네이버 API 비용 보호)
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) return NextResponse.json({ items: [] }, { status: 401 })

  const { searchParams } = req.nextUrl
  const query = searchParams.get('query') ?? ''

  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json({ items: [] })
  }

  if (!query.trim()) {
    return NextResponse.json({ items: [] })
  }

  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=10&sort=comment`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      return NextResponse.json({ items: [] })
    }

    const json = await res.json()
    return NextResponse.json({ items: json.items ?? [] })
  } catch {
    return NextResponse.json({ items: [] })
  }
}
