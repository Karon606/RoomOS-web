import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
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
