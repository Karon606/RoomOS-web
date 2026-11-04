// 스테이음 관리자·가입 흐름 하네스 전용 supabase 서버 클라이언트 대역. 앱 코드는 절대 이 파일을 import 하지 않는다.
// scripts/tsconfig.admin-flow.json 이 '@/lib/supabase/server' 를 이 파일로 가리킨다.
// 하네스가 globalThis.__AF 에 로그인 클레임·코드 교환 결과를 넣고 실제 관문(lib/auth/access)과 액션을 부른다.
type AfUser = { id: string; email: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }
type AfState = {
  claims: Record<string, unknown> | null
  /** 코드 → 교환 결과 사용자(없으면 실패). 교환하면 claims 가 그 사용자로 갈아끼워진다. */
  codes: Record<string, AfUser>
  exchanged: string[]
}
const st = () => (globalThis as unknown as { __AF: AfState }).__AF

export async function createClient() {
  return {
    auth: {
      getClaims: async () => ({ data: { claims: st().claims } }),
      getUser: async () => {
        const c = st().claims
        return { data: { user: c ? { id: c.sub, email: c.email, user_metadata: c.user_metadata ?? {}, app_metadata: c.app_metadata ?? {} } : null } }
      },
      exchangeCodeForSession: async (code: string) => {
        st().exchanged.push(code)
        const u = st().codes[code]
        if (!u) return { data: { user: null, session: null }, error: { message: 'invalid flow state' } }
        delete st().codes[code]   // 한 번 쓴 코드는 다시 못 쓴다(PKCE)
        st().claims = { sub: u.id, email: u.email, user_metadata: u.user_metadata ?? {}, app_metadata: u.app_metadata ?? {} }
        return { data: { user: u, session: {} }, error: null }
      },
      signOut: async () => { st().claims = null; return { error: null } },
    },
  }
}
