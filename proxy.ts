import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isInternalPath } from '@/lib/auth/returnTo'

export async function proxy(request: NextRequest) {
  // 서버 컴포넌트((app)/layout)가 현재 경로를 읽어 세션 만료 시 딥링크 복귀(returnTo)에 쓰도록
  // 요청 헤더에 실어 전달. set()이라 클라이언트가 보낸 위조 x-pathname 은 덮어써서 무시된다.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // 진입 라우팅 fast-path — '/'·'/login' 의 페이지 레벨 redirect() 는 루트 loading.tsx 가
  // 셸을 먼저 flush 한 뒤라 HTTP 307 이 아니라 200 + meta-refresh(클라이언트 재이동)로 내려간다.
  // 그 결과 콜드 부트가 문서 로드 3번 체인(/ → /login → 대시보드)이 되고, 떠나는 문서의
  // 스플래시가 드로잉 중간 프레임에서 얼어붙은 채 다음 문서를 기다리는 동안 화면에 잔류
  // ('멈춘 것 같은 화면·컨투어 잔상', 2026-06-12 사용자 보고). 여기서 진짜 307 로 즉시 보내
  // 단일 문서 로드로 만든다. 페이지 레벨 인증 체크는 안전망으로 유지.
  const { pathname, searchParams } = request.nextUrl
  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url))
    // 세션 갱신 쿠키를 리디렉트 응답에도 유지
    supabaseResponse.cookies.getAll().forEach(c => res.cookies.set(c.name, c.value, c))
    return res
  }
  if (pathname === '/' || pathname === '/login') {
    if (user) {
      const raw = searchParams.get('returnTo')
      // 내부 경로만 허용 — 절대 URL·'//host'·'/\\'·제어문자는 오픈 리디렉트라 무시(lib/auth/returnTo)
      const returnTo = isInternalPath(raw) ? raw : null
      const hasProperty = !!request.cookies.get('selected_property_id')?.value
      return redirectTo(returnTo || (hasProperty ? '/dashboard' : '/property-select'))
    }
    if (pathname === '/') return redirectTo('/login')
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}