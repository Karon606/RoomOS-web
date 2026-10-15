// 영업장 관문(lib/auth/propertyAccess) 행동 그물 전용 대역. react cache·쿠키·리다이렉트·supabase 클레임·prisma 를 갈아끼운다.
// scripts/tsconfig.access-gate.json 이 각 모듈을 이 파일로 가리킨다. 앱 코드는 이 파일을 import 하지 않는다.
// 하네스가 globalThis.__AG 에 로그인 클레임·쿠키·사용자·역할 줄·영업장 행을 넣고 관문을 부른다.
type AgUser = { id: string; email: string | null; isSuperAdmin: boolean; status: string }
type AgState = {
  claims: { sub?: string; email?: string } | null
  cookie: string | null
  users: AgUser[]
  roles: { userId: string; propertyId: string; role: string }[]
  props: { id: string; ownerId: string | null }[]
}
const st = () => (globalThis as unknown as { __AG: AgState }).__AG

// react: 요청마다 한 번 계산하는 cache 는 그물에서는 매번 계산한다(장면마다 상태가 바뀐다).
export function cache<T>(fn: T): T { return fn }
// next/headers
export async function cookies() { return { get: (k: string) => (k === 'selected_property_id' && st().cookie ? { value: st().cookie } : undefined) } }
// next/navigation
export function redirect(to: string): never { throw new Error(`ag redirect ${to}`) }
// @/lib/supabase/server
export async function createClient() { return { auth: { getClaims: async () => ({ data: { claims: st().claims } }) } } }
// @/lib/prisma
const prisma = {
  userPropertyRole: {
    findUnique: async ({ where }: { where: { userId_propertyId: { userId: string; propertyId: string } } }) => {
      const k = where.userId_propertyId
      const r = st().roles.find(x => x.userId === k.userId && x.propertyId === k.propertyId)
      return r ? { role: r.role } : null
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const u = st().users.find(x => x.id === where.id)
      return u ? { isSuperAdmin: u.isSuperAdmin, email: u.email, status: u.status } : null
    },
  },
  property: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const p = st().props.find(x => x.id === where.id)
      return p ? { ownerId: p.ownerId } : null
    },
  },
}
export default prisma
