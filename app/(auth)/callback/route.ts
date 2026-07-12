import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { safeReturnTo } from '@/lib/auth/returnTo'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // 오픈 리다이렉트 방어 — returnTo 는 내부 상대경로만 허용
  const returnTo = safeReturnTo(searchParams.get('returnTo'))

  const supabase = await createClient()

  // #18 안드로이드 뒤로가기로 /callback 재진입 시, 이미 사용된 code를 재교환하면
  // PKCE 실패로 세션이 무효화돼 로그아웃되는 문제 방지 — 이미 인증된 세션이면 그냥 통과.
  const { data: { user: existingUser } } = await supabase.auth.getUser()
  if (existingUser) {
    // 백 트랩 신호 — 랜딩 페이지에서 popstate 1회 소비해 google.com/accounts 노출 차단(2026-05-30).
    return NextResponse.redirect(`${origin}${returnTo}${returnTo.includes('?') ? '&' : '?'}_fa=1`)
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const { id, email, user_metadata } = data.user

      await prisma.user.upsert({
        where:  { id },
        create: {
          id,
          email:     email!,
          name:      user_metadata?.full_name ?? null,
          avatarUrl: user_metadata?.avatar_url ?? null,
        },
        update: {
          name:      user_metadata?.full_name ?? null,
          avatarUrl: user_metadata?.avatar_url ?? null,
        },
      })

      return NextResponse.redirect(`${origin}${returnTo}${returnTo.includes('?') ? '&' : '?'}_fa=1`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`)
}