import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { safeReturnTo } from '@/lib/auth/returnTo'
import { ensureAppUser, identityFromAuthUser } from '@/lib/auth/ensureAppUser'

// OAuth(Google)과 이메일 인증 링크가 돌아오는 자리. 코드를 세션으로 바꾸고 앱 users 행을 보장한다(정본 ensureAppUser).
//
// 코드를 먼저 교환한다(2026-11-04 운영자 승인 '추천대로'). 종전에는 '이미 로그인돼 있으면 통과' 지름길이 먼저라,
// 다른 계정(이메일 계정) 세션이 살아 있으면 Google 코드를 버리고 그 계정으로 돌아갔다(구관기 님 05:03 Google 코드 미교환).
// 교환이 실패했을 때만 기존 세션을 본다. 안드로이드 뒤로가기로 이미 쓴 코드를 들고 다시 들어온 경우(#18)는
// 교환이 실패하고 세션은 그대로라 그 세션으로 통과한다(교환 실패는 세션을 지우지 않는다, auth-js _exchangeCodeForSession).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // 오픈 리다이렉트 방어 — returnTo 는 내부 상대경로만 허용
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  // 백 트랩 신호 — 랜딩 페이지에서 popstate 1회 소비해 google.com/accounts 노출 차단(2026-05-30).
  const toApp = () => NextResponse.redirect(`${origin}${returnTo}${returnTo.includes('?') ? '&' : '?'}_fa=1`)

  const supabase = await createClient()
  // 지금 세션(있으면). 교환이 실패했을 때만 쓴다. 교환보다 앞에서 이것으로 갈라 버리면 종전 결함이 돌아온다.
  const { data: { user: existingUser } } = await supabase.auth.getUser()

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await ensureAppUser(identityFromAuthUser(data.user), { refreshProfile: true })
      return toApp()
    }
  }

  if (existingUser) return toApp()

  return NextResponse.redirect(`${origin}/login?error=callback_failed`)
}
