// 영업장 관문(lib/auth/propertyAccess load) 행동 그물. 클레임·쿠키·DB 를 대역으로 두고 관문을 실제로 불러 역할·통과를 본다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.access-gate.json scripts/test-property-access.ts
//
// 왜(2026-10-15 비품 전환 2단계 검수 R2). 역할 판정 함수(resolvePropertyRole)의 진리표는 있었지만, 관문이 그 함수에 무엇을
// 넘기는지는 글자 대조로만 지켰다. 넘기는 값에 무엇을 '더하는' 상승 역주입(승인 계정을 슈퍼관리자로, DB 표식을 env 승격으로)은
// 글자 대조도 진리표도 못 봤다(검수 inj1·inj2). 관문을 통째로 돌려 결과를 고정한다.
process.env.SUPER_ADMIN_EMAILS = 'boss@example.com'
import { getPropertyAccess } from '../lib/auth/propertyAccess'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}
type U = { id: string; email: string | null; isSuperAdmin: boolean; status: string }
const g = globalThis as unknown as { __AG: { claims: { sub?: string; email?: string } | null; cookie: string | null; users: U[]; roles: { userId: string; propertyId: string; role: string }[]; props: { id: string; ownerId: string | null }[] } }
const P = 'prop-1', OWNER = 'u-owner'
const user = (id: string, o: Partial<U> = {}): U => ({ id, email: `${id}@example.com`, isSuperAdmin: false, status: 'APPROVED', ...o })
async function as(u: U, opts: { role?: string; claimEmail?: string | null; owner?: boolean; cookie?: string | null } = {}) {
  g.__AG = {
    claims: { sub: u.id, ...(opts.claimEmail === null ? {} : { email: opts.claimEmail ?? u.email ?? undefined }) },
    cookie: opts.cookie === undefined ? P : opts.cookie,
    users: [u],
    roles: opts.role ? [{ userId: u.id, propertyId: P, role: opts.role }] : [],
    props: [{ id: P, ownerId: opts.owner ? u.id : OWNER }],
  }
  const a = await getPropertyAccess()
  return a ? { role: a.role, superAdmin: a.isSuperAdmin } : null
}

;(async () => {
  // 역할 줄이 있는 갈래
  eq('일반 멤버 STAFF 는 STAFF', await as(user('u1'), { role: 'STAFF' }), { role: 'STAFF', superAdmin: false })
  eq('제한 스태프는 제한 스태프', await as(user('u2'), { role: 'LIMITED_STAFF' }), { role: 'LIMITED_STAFF', superAdmin: false })
  eq('env 슈퍼관리자(클레임 이메일) + 낮은 줄은 소유자', await as(user('boss', { email: 'boss@example.com' }), { role: 'STAFF' }), { role: 'OWNER', superAdmin: true })
  eq('DB 슈퍼관리자 표식은 역할 줄을 올리지 않는다(inj2)', await as(user('u3', { isSuperAdmin: true }), { role: 'STAFF' }), { role: 'STAFF', superAdmin: false })
  eq('소유주라도 역할 줄이 있으면 그 줄', await as(user('u4'), { role: 'MANAGER', owner: true }), { role: 'MANAGER', superAdmin: false })
  eq('승인 대기 멤버는 막힌다', await as(user('u5', { status: 'PENDING' }), { role: 'STAFF' }), null)
  eq('env 슈퍼관리자는 승인 대기여도 통과', await as(user('boss', { email: 'boss@example.com', status: 'PENDING' }), { role: 'STAFF' }), { role: 'OWNER', superAdmin: true })
  // 클레임 이메일이 없고 사용자 행 이메일만 env 슈퍼관리자인 사람(검수 M1). 역할 줄 갈래는 클레임 이메일만 본다(지금 동작).
  eq('역할 줄 갈래는 클레임 이메일만 본다(사용자 행 이메일은 승격 안 함)', await as(user('boss', { email: 'boss@example.com' }), { role: 'STAFF', claimEmail: null }), { role: 'STAFF', superAdmin: false })
  // 역할 줄이 없는 갈래
  eq('줄 없는 소유주는 소유자', await as(user('u6'), { owner: true }), { role: 'OWNER', superAdmin: false })
  eq('승인됐지만 줄도 소유도 없는 사용자는 접근 없음(inj1)', await as(user('u7')), null)
  eq('줄 없는 env 슈퍼관리자는 소유자', await as(user('boss', { email: 'boss@example.com' })), { role: 'OWNER', superAdmin: true })
  eq('줄 없는 갈래는 사용자 행 이메일로도 env 승격', await as(user('boss', { email: 'boss@example.com' }), { claimEmail: null }), { role: 'OWNER', superAdmin: true })
  eq('줄 없는 DB 슈퍼관리자는 소유자', await as(user('u8', { isSuperAdmin: true })), { role: 'OWNER', superAdmin: true })
  eq('줄 없는 승인 대기 사용자는 막힌다', await as(user('u9', { status: 'PENDING' }), { owner: true }), null)
  // 쿠키·로그인
  eq('영업장 쿠키가 없으면 막힌다', await as(user('u1'), { role: 'STAFF', cookie: null }), null)
  g.__AG = { claims: null, cookie: P, users: [], roles: [], props: [{ id: P, ownerId: OWNER }] }
  eq('로그인 안 했으면 막힌다', await getPropertyAccess(), null)
  console.log(`[영업장 관문 행동] 통과 ${pass} / 실패 ${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
