// proxy.ts 진입 리디렉트 행동 그물. 실제 proxy 를 가짜 Supabase 인증 서버(로컬) 위에서 부른다. 실패 시 exit 1.
// 실행: npx tsx scripts/test-proxy-entry-redirect.ts
//
// 왜(2026-11-04, 구관기 님 이메일 가입 재현). 로그인 상태의 '/'·'/login' 요청을 앱으로 307 보내는 지름길이 그 페이지 위에서
// 부른 서버 액션(POST + Next-Action)까지 보냈다. 비밀번호 로그인 직후 같은 페이지의 syncUserToDB 가 /property-select 로 튕겨
// 실행되지 않았고(200 application/json), 클라이언트는 'unexpected response' 를 던져 가입 폼이 일반 오류를 띄웠다. 앱 users 행이 안 생겼다.
// 고정: 문서 요청(GET·HEAD)만 보낸다. 액션 POST 는 로그인 상태여도 통과한다.
import http from 'node:http'
import { NextRequest } from 'next/server'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

const USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'repro@example.test', app_metadata: { provider: 'email' }, user_metadata: {} }

function sessionCookie(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated' })}.sig`
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: USER }
  return 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/auth/v1/user')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(USER)); return }
    res.writeHead(404); res.end('{}')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  const { proxy } = await import('../proxy')

  // 쿠키 이름은 @supabase/ssr 기본(sb-<호스트 첫 마디>-auth-token)이다. 호스트가 127.0.0.1 이라 'sb-127-auth-token'.
  const cookie = `sb-127-auth-token=${sessionCookie()}`
  const run = async (method: string, path: string, headers: Record<string, string>) => {
    const res = await proxy(new NextRequest(`http://localhost:3000${path}`, { method, headers }))
    return [res.status, res.headers.get('location')?.replace('http://localhost:3000', '') ?? null]
  }
  const action = { 'next-action': '40deadbeef', accept: 'text/x-component', 'content-type': 'text/plain;charset=UTF-8' }

  eq('로그인 상태 GET /login 은 앱으로 307', await run('GET', '/login', { cookie }), [307, '/property-select'])
  eq('로그인 상태 GET / 는 앱으로 307', await run('GET', '/', { cookie }), [307, '/property-select'])
  eq('로그인 상태 HEAD /login 도 307', await run('HEAD', '/login', { cookie }), [307, '/property-select'])
  eq('returnTo 내부 경로로', await run('GET', '/login?returnTo=%2Frooms', { cookie }), [307, '/rooms'])
  eq('returnTo 외부 주소는 무시', await run('GET', '/login?returnTo=%2F%2Fevil.com', { cookie }), [307, '/property-select'])
  eq('로그인 직후 /login 위 서버 액션 POST 는 통과(실행된다)', await run('POST', '/login', { cookie, ...action }), [200, null])
  eq('로그인 직후 / 위 서버 액션 POST 도 통과', await run('POST', '/', { cookie, ...action }), [200, null])
  eq('세션 없는 GET /login 은 통과', await run('GET', '/login', {}), [200, null])
  eq('세션 없는 서버 액션 POST 는 통과', await run('POST', '/login', action), [200, null])

  server.close()
  console.log(`\nproxy 진입 리디렉트: 통과 ${pass} · 실패 ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
