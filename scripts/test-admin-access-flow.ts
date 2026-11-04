// 스테이음 관리자 페이지(가입자·승인·권한) 통합 회귀 + 카드 진리표. 실제 관문(lib/auth/access)과 관리자 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.admin-flow.json scripts/test-admin-access-flow.ts
//
// 고정하는 것(2026-11-04 운영자 승인 '추천대로').
//   · 카드 진리표: 본인·환경 설정 관리자는 버튼 없음, 대기는 [거절][승인], 거절은 [다시 승인] + 관리 '대기로', 승인됨은 관리만
//     (대기로 · 구분선 아래 승인 취소·권한 주기), DB 관리자는 관리 '권한 회수'만. 서버 거부 판정 adminChangeBlock 과 한 벌.
//   · 권한·상태 쓰기는 감사 기록(admin_audit_logs)과 한 트랜잭션, 적용취소는 쓴 직후 그대로일 때만 쓰기 전 전부로.
//   · 본인·환경 설정 관리자·관리자 계정 상태 변경 거부, 관리자가 아니면 액션 자체가 막힌다.
import { execFileSync } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import path from 'node:path'
import { cardActions, adminChangeBlock, parseAdminUserUndo, grantImpact, ACTION_LABEL } from '../lib/adminAccess'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = randomBytes(32).toString('base64')   // 적용취소 서명 키(위조 거부를 본다)
process.env.SUPER_ADMIN_EMAILS = 'env-admin@example.test'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const ok = (name: string, cond: boolean) => eq(name, cond, true)
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

// ── 1. 카드 진리표(순수) ───────────────────────────────────────
{
  const row = (status: 'PENDING' | 'APPROVED' | 'REJECTED', o: Partial<{ dbAdmin: boolean; envAdmin: boolean; isSelf: boolean }> = {}) =>
    cardActions({ status, dbAdmin: false, envAdmin: false, isSelf: false, ...o })
  const none = { primary: [], manage: [], danger: [] }
  eq('본인 카드는 버튼 없음', row('APPROVED', { isSelf: true, dbAdmin: true }), none)
  eq('본인 대기 카드도 버튼 없음', row('PENDING', { isSelf: true }), none)
  eq('환경 설정 관리자는 버튼 없음', row('APPROVED', { envAdmin: true }), none)
  eq('대기: 거절·승인', row('PENDING'), { primary: ['reject', 'approve'], manage: [], danger: [] })
  eq('거절: 다시 승인 + 관리 대기로', row('REJECTED'), { primary: ['reapprove'], manage: ['toPending'], danger: [] })
  eq('승인됨: 관리만(대기로 · 승인 취소·권한 주기)', row('APPROVED'), { primary: [], manage: ['toPending'], danger: ['revokeApproval', 'grantAdmin'] })
  eq('DB 관리자: 관리 권한 회수만', row('APPROVED', { dbAdmin: true }), { primary: [], manage: ['revokeAdmin'], danger: [] })
  eq('DB 관리자는 대기여도 상태 버튼 없음', row('PENDING', { dbAdmin: true }), { primary: [], manage: ['revokeAdmin'], danger: [] })
  // 화면에 서는 동작은 서버가 통과시키는 동작이다(같은 판정)
  for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as const) {
    for (const dbAdmin of [false, true]) for (const envAdmin of [false, true]) for (const isSelf of [false, true]) {
      const a = cardActions({ status, dbAdmin, envAdmin, isSelf })
      for (const k of [...a.primary, ...a.manage, ...a.danger]) {
        const kind = k === 'grantAdmin' ? 'grant' : k === 'revokeAdmin' ? 'revoke' : 'status'
        eq(`화면 동작은 서버 통과 ${status}/${dbAdmin}/${envAdmin}/${isSelf}/${k}`, adminChangeBlock(kind, { isSelf, dbAdmin, envAdmin }), null)
      }
    }
  }
  ok("권한 낱말은 '스테이음 관리자'", ACTION_LABEL.grantAdmin === '스테이음 관리자 권한 주기' && ACTION_LABEL.revokeAdmin === '스테이음 관리자 권한 회수')
  const imp = grantImpact({ propertyCount: 3, signupCount: 8 }).map(i => i.label).join('|')
  ok('영향 목록에 실제 건수와 멤버 관리 안내', /영업장 3곳/.test(imp) && /가입자 8명/.test(imp) && /환경설정 > 멤버 관리/.test(imp))
  eq('꼴이 틀린 토큰은 null', parseAdminUserUndo({ v: 1, userId: 'x' }), null)
}

// ── 2. 통합(PGlite) ───────────────────────────────────────────
async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const A = await import('@/app/admin/actions')
  const g = globalThis as unknown as { __AF: { claims: Record<string, unknown> | null; codes: Record<string, unknown>; exchanged: string[] } }
  g.__AF = { claims: null, codes: {}, exchanged: [] }
  const as = (id: string, email: string) => { g.__AF.claims = { sub: id, email } }

  const ADMIN = randomUUID(), ENVA = randomUUID(), P1 = randomUUID(), A1 = randomUUID(), R1 = randomUUID(), OUT = randomUUID()
  await prisma.user.createMany({ data: [
    { id: ADMIN, email: 'admin@example.test', isSuperAdmin: true, status: 'APPROVED' },
    { id: ENVA, email: 'env-admin@example.test', status: 'APPROVED' },
    { id: P1, email: 'p1@example.test', realName: '대기 일', status: 'PENDING' },
    { id: A1, email: 'a1@example.test', status: 'APPROVED', approvedAt: new Date('2026-10-01T00:00:00Z'), approvedBy: ADMIN },
    { id: R1, email: 'r1@example.test', status: 'REJECTED' },
    { id: OUT, email: 'out@example.test', status: 'APPROVED' },
  ] })
  const snap = async (id: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true, isSuperAdmin: true, approvedAt: true, approvedBy: true } })
    return { ...u, approvedAt: u.approvedAt?.toISOString() ?? null }
  }
  const audits = async (id: string) => (await prisma.adminAuditLog.findMany({ where: { targetUserId: id }, orderBy: { createdAt: 'asc' } })).map(a => a.action)

  // 관리자가 아니면 액션이 막힌다(관문이 첫 DB 호출 전)
  as(OUT, 'out@example.test')
  let threw = ''
  try { await A.setSuperAdmin(P1, true) } catch (e) { threw = String((e as Error).message) }
  eq('관리자 아닌 계정의 권한 주기는 관문이 막는다', threw, 'cr-flow redirect /dashboard')
  threw = ''
  try { await A.getSignups() } catch (e) { threw = String((e as Error).message) }
  eq('관리자 아닌 계정은 가입자 목록도 못 읽는다', threw, 'cr-flow redirect /dashboard')
  eq('막힌 시도는 아무것도 안 쓴다', [await snap(P1), await audits(P1)], [{ status: 'PENDING', isSuperAdmin: false, approvedAt: null, approvedBy: null }, []])

  as(ADMIN, 'admin@example.test')
  const list = await A.getSignups()
  eq('목록은 환경 설정 관리자를 표시한다', list.users.find(u => u.id === ENVA)?.envAdmin, true)
  eq('목록은 영업장 수를 센다', list.propertyCount, 0)

  // 본인·환경 설정 관리자 거부
  eq('본인 권한 회수 거부', await A.setSuperAdmin(ADMIN, false), { ok: false, error: '본인 계정은 여기서 바꿀 수 없습니다.' })
  eq('본인 상태 변경 거부', await A.setUserStatus(ADMIN, 'REJECTED'), { ok: false, error: '본인 계정은 여기서 바꿀 수 없습니다.' })
  eq('환경 설정 관리자 거부', (await A.setUserStatus(ENVA, 'REJECTED')).ok, false)
  eq('거부는 감사 기록도 없다', [await audits(ADMIN), await audits(ENVA)], [[], []])

  // 권한 주기(대기 계정이면 자동 승인) · 감사 기록 · 적용취소 왕복
  const g1 = await A.setSuperAdmin(P1, true)
  ok('권한 주기 통과', g1.ok)
  const s1 = await snap(P1)
  eq('주면 관리자 + 자동 승인(승인자 기록)', [s1.isSuperAdmin, s1.status, s1.approvedBy, !!s1.approvedAt], [true, 'APPROVED', ADMIN, true])
  eq('감사 기록 GRANT', await audits(P1), ['GRANT_SUPER_ADMIN'])
  const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { targetUserId: P1 } })
  eq('감사 기록 전후 값과 누가', [log.actorId, (log.before as { isSuperAdmin: boolean }).isSuperAdmin, (log.after as { isSuperAdmin: boolean }).isSuperAdmin], [ADMIN, false, true])
  const undo1 = g1.ok ? g1.undo : null
  ok('적용취소 토큰에 서명', !!undo1?.sig)
  eq('이미 관리자면 다시 주기 거부', await A.setSuperAdmin(P1, true), { ok: false, error: '이미 스테이음 관리자입니다.' })
  eq('관리자 계정 상태 변경 거부', (await A.setUserStatus(P1, 'REJECTED')).ok, false)
  // 위조 토큰
  eq('서명이 틀린 토큰 거부', await A.undoAdminUserChange({ ...J(undo1!), before: { ...undo1!.before, status: 'APPROVED' } }), { ok: false, error: '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.' })
  eq('서명 없는 토큰 거부', await A.undoAdminUserChange({ ...J(undo1!), sig: undefined }), { ok: false, error: '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.' })
  eq('적용취소 통과', await A.undoAdminUserChange(J(undo1!)), { ok: true })
  eq('쓰기 전 전부로(대기·승인 칸 비움·관리자 아님)', await snap(P1), { status: 'PENDING', isSuperAdmin: false, approvedAt: null, approvedBy: null })
  eq('감사 기록 UNDO', await audits(P1), ['GRANT_SUPER_ADMIN', 'UNDO'])
  eq('두 번 누르면 거부', await A.undoAdminUserChange(J(undo1!)), { ok: false, error: '그사이 이 계정의 권한이나 상태가 다시 바뀌어 되돌리지 않았습니다. 지금 상태를 확인해 주세요.' })

  // 승인됨 계정: 주고 회수, 그사이 바뀌면 거부
  const g2 = await A.setSuperAdmin(A1, true)
  const s2 = await snap(A1)
  eq('승인된 계정은 승인 시각·승인자를 그대로 둔다', [s2.isSuperAdmin, s2.approvedAt, s2.approvedBy], [true, '2026-10-01T00:00:00.000Z', ADMIN])
  const r2 = await A.setSuperAdmin(A1, false)
  eq('회수 통과 · 감사 REVOKE', [r2.ok, await audits(A1)], [true, ['GRANT_SUPER_ADMIN', 'REVOKE_SUPER_ADMIN']])
  eq('그사이 회수됐으면 주기 적용취소 거부', (await A.undoAdminUserChange(J(g2.ok ? g2.undo! : null)!)).ok, false)
  eq('회수 적용취소는 통과(다시 관리자)', [(await A.undoAdminUserChange(J(r2.ok ? r2.undo! : null)!)).ok, (await snap(A1)).isSuperAdmin], [true, true])
  await A.setSuperAdmin(A1, false)
  eq('관리자 아님에 회수 거부', await A.setSuperAdmin(A1, false), { ok: false, error: '스테이음 관리자가 아닙니다.' })

  // 상태 변경 왕복
  const st1 = await A.setUserStatus(R1, 'APPROVED')
  eq('다시 승인 · 감사 SET_STATUS', [(await snap(R1)).status, await audits(R1)], ['APPROVED', ['SET_STATUS']])
  eq('상태 적용취소는 거절로', [(await A.undoAdminUserChange(J(st1.ok ? st1.undo! : null)!)).ok, (await snap(R1)).status], [true, 'REJECTED'])
  eq('알 수 없는 상태 거부', (await A.setUserStatus(R1, 'NOPE' as never)).ok, false)
  // 남의 토큰을 본인에게 쓰는 것도 거부(관리자 본인 행)
  const forged = { ...J(st1.ok ? st1.undo! : null)!, userId: ADMIN }
  eq('본인 행 토큰 거부', (await A.undoAdminUserChange(forged)).ok, false)

  await server.stop()
  await pg.close()
  console.log(`\n관리자 접근 흐름: 통과 ${pass} · 실패 ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
