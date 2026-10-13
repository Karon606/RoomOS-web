// 현금영수증 흐름 하네스 전용 next/cache·next/headers·next/navigation·supabase 서버 클라이언트 대역.
// 요청 컨텍스트 없이 서버 액션을 직접 부르면 revalidatePath·cookies 가 던진다. 하네스가 보는 것은 DB
// 결과뿐이라 이 함수들은 아무것도 안 한다. 앱 코드는 절대 이 파일을 import 하지 않는다.
export function revalidatePath(): void {}
export function revalidateTag(): void {}
export function unstable_cache<T>(fn: T): T { return fn }
export async function cookies() { return { get: () => undefined, set: () => {}, getAll: () => [] } }
export async function headers() { return new Map() }
export function redirect(to: string): never { throw new Error(`cr-flow redirect ${to}`) }
export function notFound(): never { throw new Error('cr-flow notFound') }
export async function createClient() {
  return { auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } }
}
