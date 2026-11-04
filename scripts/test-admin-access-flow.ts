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
import { cardActions, adminChangeBlock, parseAdminUserUndo, grantImpact, ACTION_LABEL, memberJoinState, memberInviteToast } from '../lib/adminAccess'

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
  // 4단계 같은 판정: 승인된 계정은 바로, 대기는 승인 뒤, 거절은 못 들어온다
  eq('멤버 판정 진리표', [memberJoinState('APPROVED'), memberJoinState('PENDING'), memberJoinState('REJECTED'), memberJoinState('PENDING', true)], ['ready', 'waiting', 'blocked', 'ready'])
  ok('대기 계정 초대 토스트는 들어오는 때를 말한다', /승인 전 계정이라 승인되면 바로 들어옵니다/.test(memberInviteToast('waiting')) && memberInviteToast('ready') === '멤버가 추가되었습니다.')
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

  // ── 2단계: 앱 users 행 보장 · 콜백 · 대기 화면 재확인 · 자기 영업장 만들기 ──
  const { getAccessContext } = await import('@/lib/auth/access')
  const { GET: callback } = await import('@/app/(auth)/callback/route')
  const { syncUserToDB } = await import('@/app/(auth)/login/actions')
  const { checkMyAccess } = await import('@/app/pending/actions')
  const { createProperty } = await import('@/app/property-select/actions')
  const { NextRequest } = await import('next/server')
  const cb = async (q: string) => {
    const res = await callback(new NextRequest(`http://localhost:3000/callback?${q}`))
    return (res.headers.get('location') ?? '').replace('http://localhost:3000', '')
  }

  // 행 없는 이메일 신원이 관문에 오면 행이 생기고(대기) 관리자 목록에 선다. 메타데이터의 실명·연락처를 회수한다.
  const ORPH = randomUUID()
  g.__AF.claims = { sub: ORPH, email: 'orphan@example.test', app_metadata: { provider: 'email' }, user_metadata: { real_name: '구관기 사례', phone: '010-0000-0000' } }
  const ctxO = await getAccessContext()
  eq('행 없는 신원: 관문이 대기로 본다', ctxO?.status, 'PENDING')
  const rowO = await prisma.user.findUnique({ where: { id: ORPH } })
  eq('행 없는 신원: 관문이 행을 만든다(대기·실명·연락처)', [rowO?.status, rowO?.realName, rowO?.phone, rowO?.isSuperAdmin], ['PENDING', '구관기 사례', '010-0000-0000', false])
  as(ADMIN, 'admin@example.test')
  ok('관리자 목록에 선다', (await A.getSignups()).users.some(u => u.id === ORPH))
  // 이미 있는 행은 덮지 않는다(상태·관리자 표식·실명 불변)
  await prisma.user.update({ where: { id: ORPH }, data: { status: 'REJECTED' } })
  g.__AF.claims = { sub: ORPH, email: 'orphan@example.test', user_metadata: { real_name: '다른 이름' } }
  await getAccessContext()
  const rowO2 = await prisma.user.findUniqueOrThrow({ where: { id: ORPH } })
  eq('관문은 있는 행을 안 덮는다', [rowO2.status, rowO2.realName], ['REJECTED', '구관기 사례'])
  // 같은 이메일의 다른 행이 있으면 만들지 않고 대기로 본다
  g.__AF.claims = { sub: randomUUID(), email: 'p1@example.test' }
  eq('같은 이메일 다른 id 는 행 없이 대기', (await getAccessContext())?.status, 'PENDING')
  eq('같은 이메일 행은 하나', await prisma.user.count({ where: { email: 'p1@example.test' } }), 1)

  // 초대코드(메타데이터) 자동 승인은 관문에서도 한 번만
  await prisma.inviteCode.create({ data: { code: 'STAYEXT09', maxUses: 5, autoApprove: true } })
  const INV = randomUUID()
  g.__AF.claims = { sub: INV, email: 'inv@example.test', user_metadata: { invite_code: 'stayext09' } }
  eq('초대코드 메타데이터: 관문에서 바로 승인', (await getAccessContext())?.status, 'APPROVED')
  await getAccessContext()
  eq('초대코드는 한 번만 센다', (await prisma.inviteCode.findUniqueOrThrow({ where: { code: 'STAYEXT09' } })).usedCount, 1)

  // 로그인 직후 동기화도 같은 정본(넘긴 칸 반영)
  const SYN = randomUUID()
  g.__AF.claims = { sub: SYN, email: 'syn@example.test', user_metadata: { full_name: 'Syn G' } }
  await syncUserToDB({ realName: '동기화', address: '서울' })
  const rowS = await prisma.user.findUniqueOrThrow({ where: { id: SYN } })
  eq('동기화: 행 생성·이름·넘긴 칸', [rowS.status, rowS.name, rowS.realName, rowS.address], ['PENDING', 'Syn G', '동기화', '서울'])

  // 콜백: 코드를 먼저 교환한다
  const GU = randomUUID()
  g.__AF.claims = null
  g.__AF.codes = { c1: { id: GU, email: 'google@example.test', user_metadata: { full_name: '구글 사람', avatar_url: 'https://x/a.png' }, app_metadata: { provider: 'google' } } }
  eq('세션 없음 + 코드: 교환하고 앱으로', await cb('code=c1&returnTo=%2Fproperty-select'), '/property-select?_fa=1')
  eq('교환한 계정의 행(대기·구글 이름)', (await prisma.user.findUnique({ where: { id: GU } }))?.name, '구글 사람')
  eq('같은 세션 + 이미 쓴 코드: 교환 실패지만 세션으로 통과(뒤로가기)', await cb('code=c1'), '/property-select?_fa=1')
  eq('그 세션은 그대로', g.__AF.claims?.sub, GU)
  const GU2 = randomUUID()
  g.__AF.codes = { c2: { id: GU2, email: 'google2@example.test', user_metadata: { full_name: '다른 구글' } } }
  eq('다른 계정 세션 + 새 코드: 교환해서 갈아끼운다', await cb('code=c2'), '/property-select?_fa=1')
  eq('세션이 새 계정으로 바뀌고 행이 생긴다', [g.__AF.claims?.sub, !!(await prisma.user.findUnique({ where: { id: GU2 } }))], [GU2, true])
  g.__AF.claims = null
  eq('세션 없음 + 틀린 코드: 로그인으로', await cb('code=nope'), '/login?error=callback_failed')
  eq('오픈 리다이렉트 방어', (await cb('code=zzz&returnTo=%2F%2Fevil.com')), '/login?error=callback_failed')

  // 대기 화면 재확인 → 승인 → 앱 → 자기 영업장 만들기(구관기 님 사례: 직원이 아니라 따로 운영할 사람)
  g.__AF.claims = { sub: GU, email: 'google@example.test' }
  eq('대기 화면 재확인: 대기', await checkMyAccess(), 'PENDING')
  // (createProperty 는 오류를 결과로 돌려준다. 하네스 redirect 대역은 digest 가 없어 결과 문장으로 온다)
  eq('승인 전에는 영업장 개설이 대기 화면으로', await createProperty('구관기 하우스'), { ok: false, error: 'cr-flow redirect /pending' })
  eq('막힌 개설은 영업장을 안 만든다', await prisma.property.count({ where: { ownerId: GU } }), 0)
  as(ADMIN, 'admin@example.test')
  const apGU = await A.setUserStatus(GU, 'APPROVED')
  ok('관리자 승인', apGU.ok)
  g.__AF.claims = { sub: GU, email: 'google@example.test' }
  eq('대기 화면 재확인: 승인(화면이 넘어간다)', await checkMyAccess(), 'APPROVED')
  const cp = await createProperty('구관기 하우스')
  ok('승인된 신규 사용자는 자기 영업장을 만든다', cp.ok)
  const own = cp.ok ? await prisma.property.findUnique({ where: { id: cp.propertyId }, select: { ownerId: true } }) : null
  const ownRole = cp.ok ? await prisma.userPropertyRole.findUnique({ where: { userId_propertyId: { userId: GU, propertyId: cp.propertyId } } }) : null
  eq('그 영업장의 소유자·OWNER 역할', [own?.ownerId, ownRole?.role], [GU, 'OWNER'])
  // 이미 있는 행을 로그인 동기화·콜백이 다시 지나도 상태·관리자 표식·승인 칸은 그대로(이름·사진만 고친다)
  const before = await snap(GU)
  g.__AF.claims = { sub: GU, email: 'google@example.test', user_metadata: { full_name: '구글 사람2' } }
  await syncUserToDB()
  g.__AF.codes = { c3: { id: GU, email: 'google@example.test', user_metadata: { full_name: '구글 사람3' } } }
  await cb('code=c3')
  eq('다시 로그인해도 승인 상태 그대로', await snap(GU), before)
  eq('이름은 고친다', (await prisma.user.findUniqueOrThrow({ where: { id: GU } })).name, '구글 사람3')
  await prisma.user.update({ where: { id: GU }, data: { isSuperAdmin: true } })
  await syncUserToDB()
  eq('관리자 표식도 안 덮는다', (await prisma.user.findUniqueOrThrow({ where: { id: GU } })).isSuperAdmin, true)
  await prisma.user.update({ where: { id: GU }, data: { isSuperAdmin: false } })
  g.__AF.claims = null
  eq('로그아웃 상태 재확인', await checkMyAccess(), 'SIGNED_OUT')

  // ── 4단계: 승인 + 내 영업장 직원으로도 추가 ──
  as(ADMIN, 'admin@example.test')
  const PADM = randomUUID(), POTHER = randomUUID()
  await prisma.property.create({ data: { id: PADM, name: '제기 하우스', ownerId: ADMIN } })
  await prisma.property.create({ data: { id: POTHER, name: '남의 하우스', ownerId: OUT } })
  eq('승인 창에 내가 소유한 영업장만', (await A.getSignups()).myProperties.map(p => p.name), ['제기 하우스'])
  const W1 = randomUUID(), W2 = randomUUID()
  await prisma.user.createMany({ data: [
    { id: W1, email: 'w1@example.test', status: 'PENDING' },
    { id: W2, email: 'w2@example.test', status: 'REJECTED' },
  ] })
  const roleOf = async (uid: string, pid: string) => (await prisma.userPropertyRole.findUnique({ where: { userId_propertyId: { userId: uid, propertyId: pid } } }))?.role ?? null
  // 기본(끔): 승인만
  const ap1 = await A.approveUser(W1, null)
  eq('끈 채 승인: 승인만, 역할 줄 없음', [ap1.ok, (await snap(W1)).status, await roleOf(W1, PADM)], [true, 'APPROVED', null])
  eq('감사 APPROVE', await audits(W1), ['APPROVE'])
  eq('승인 적용취소: 대기로', [(await A.undoAdminUserChange(J(ap1.ok ? ap1.undo! : null)!)).ok, (await snap(W1)).status], [true, 'PENDING'])
  // 켬: 승인 + 직원 추가 한 트랜잭션, 적용취소 한 벌
  const ap2 = await A.approveUser(W1, { propertyId: PADM, role: 'STAFF' })
  eq('켠 채 승인: 승인 + 스태프 역할', [ap2.ok, (await snap(W1)).status, await roleOf(W1, PADM)], [true, 'APPROVED', 'STAFF'])
  eq('토큰에 역할 줄', ap2.ok ? ap2.undo?.role : null, { propertyId: PADM, before: null, after: 'STAFF' })
  eq('함께 적용취소: 역할 줄도 걷힌다', [(await A.undoAdminUserChange(J(ap2.ok ? ap2.undo! : null)!)).ok, (await snap(W1)).status, await roleOf(W1, PADM)], [true, 'PENDING', null])
  // 그사이 역할이 바뀌면 거부
  const ap3 = await A.approveUser(W1, { propertyId: PADM, role: 'MANAGER' })
  await prisma.userPropertyRole.update({ where: { userId_propertyId: { userId: W1, propertyId: PADM } }, data: { role: 'STAFF' } })
  eq('그사이 역할이 바뀌면 적용취소 거부(무변경)', [(await A.undoAdminUserChange(J(ap3.ok ? ap3.undo! : null)!)).ok, (await snap(W1)).status, await roleOf(W1, PADM)], [false, 'APPROVED', 'STAFF'])
  // 막힘
  eq('이미 승인된 계정 승인 거부', (await A.approveUser(W1, null)).ok, false)
  const beforeW2 = await snap(W2)
  eq('남의 영업장에는 못 넣는다', await A.approveUser(W2, { propertyId: POTHER, role: 'STAFF' }), { ok: false, error: '내가 소유한 영업장에만 직원으로 넣을 수 있습니다.' })
  eq('소유자 역할은 못 넣는다', await A.approveUser(W2, { propertyId: PADM, role: 'OWNER' }), { ok: false, error: '넣을 수 없는 역할입니다.' })
  eq('막힌 승인은 무변경', [await snap(W2), await roleOf(W2, PADM), await roleOf(W2, POTHER)], [beforeW2, null, null])
  // 이미 구성원이면 역할은 그대로(승인만)
  await prisma.userPropertyRole.create({ data: { userId: W2, propertyId: PADM, role: 'MANAGER' } })
  const ap4 = await A.approveUser(W2, { propertyId: PADM, role: 'STAFF' })
  eq('이미 구성원: 역할 그대로, 토큰에 역할 없음', [ap4.ok, await roleOf(W2, PADM), ap4.ok ? ap4.undo?.role ?? null : 'x'], [true, 'MANAGER', null])
  eq('거절 계정 다시 승인 적용취소는 거절로', [(await A.undoAdminUserChange(J(ap4.ok ? ap4.undo! : null)!)).ok, (await snap(W2)).status, await roleOf(W2, PADM)], [true, 'REJECTED', 'MANAGER'])

  // ── 5단계: 초대코드 쓰기 셋의 적용취소 ──
  as(ADMIN, 'admin@example.test')
  const ic = await A.createInviteCode({ code: 'undo-me', maxUses: 3 })
  eq('발급', ic, { ok: true, code: 'UNDO-ME' })
  eq('발급 적용취소: 안 쓴 코드는 지운다', [await A.undoCreateInviteCode('UNDO-ME'), await prisma.inviteCode.count({ where: { code: 'UNDO-ME' } })], [{ ok: true }, 0])
  await A.createInviteCode({ code: 'USED-ONE', maxUses: 3 })
  await prisma.inviteCode.update({ where: { code: 'USED-ONE' }, data: { usedCount: 1 } })
  eq('누가 쓴 코드는 발급 적용취소 거부', [(await A.undoCreateInviteCode('USED-ONE')).ok, await prisma.inviteCode.count({ where: { code: 'USED-ONE' } })], [false, 1])
  const used = await prisma.inviteCode.findUniqueOrThrow({ where: { code: 'USED-ONE' } })
  await A.toggleInviteCode(used.id, false)
  eq('켜고 끄기 적용취소(직전 값)', [(await prisma.inviteCode.findUniqueOrThrow({ where: { id: used.id } })).isActive, (await A.toggleInviteCode(used.id, true)).ok, (await prisma.inviteCode.findUniqueOrThrow({ where: { id: used.id } })).isActive], [false, true, true])
  const del = await A.deleteInviteCode(used.id)
  eq('삭제', [del.ok, await prisma.inviteCode.count({ where: { code: 'USED-ONE' } })], [true, 0])
  const rs = await A.restoreInviteCode(J(del.ok ? del.snap : null)!)
  const back = await prisma.inviteCode.findUnique({ where: { code: 'USED-ONE' } })
  eq('삭제 적용취소: 같은 id·사용 수 그대로 되살림', [rs.ok, back?.id, back?.usedCount, back?.maxUses], [true, used.id, 1, 3])
  eq('같은 코드가 있으면 되살림 거부', (await A.restoreInviteCode(J(del.ok ? del.snap : null)!)).ok, false)
  as(OUT, 'out@example.test')
  threw = ''
  try { await A.restoreInviteCode(J(del.ok ? del.snap : null)!) } catch (e) { threw = String((e as Error).message) }
  eq('관리자 아니면 되살림도 관문이 막는다', threw, 'cr-flow redirect /dashboard')

  // ── 3단계: 알림(가입 대기 → 스테이음 관리자, 참여 요청 → 소유자) · 대기 건수 ──
  const webpush = (await import('web-push')).default
  const vk = webpush.generateVAPIDKeys()
  process.env.VAPID_PRIVATE_KEY = vk.privateKey
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vk.publicKey   // 하네스는 운영 아님 → sendToSubscriptions 가 실제로 안 보내고 내역만 남는다
  const STAFF = randomUUID(), JOINER = randomUUID()
  await prisma.user.createMany({ data: [
    { id: STAFF, email: 'staff@example.test', status: 'APPROVED' },
    { id: JOINER, email: 'joiner@example.test', realName: '참여자', status: 'APPROVED' },
  ] })
  const sub = (userId: string) => ({ userId, endpoint: `https://push.example.test/${userId}`, p256dh: 'k', auth: 'a' })
  await prisma.pushSubscription.createMany({ data: [ADMIN, ENVA, OUT, STAFF, GU, P1].map(sub) })
  const pushedTo = async (title: string) => (await prisma.pushHistory.findMany({ where: { title }, select: { userId: true, url: true, body: true } }))
  const NEWU = randomUUID()
  g.__AF.claims = { sub: NEWU, email: 'newbie@example.test', user_metadata: { real_name: '새 가입자' } }
  await getAccessContext()
  const sp = await pushedTo('가입 승인 요청')
  eq('가입 대기 푸시는 스테이음 관리자(DB·env)에게만', sp.map(x => x.userId).sort(), [ADMIN, ENVA].sort())
  eq('푸시 문장·이동', [sp[0]?.body, sp[0]?.url], ['새 가입자 님이 가입했습니다 · 승인 대기', '/admin/users'])
  await getAccessContext()
  eq('이미 있는 행이면 다시 안 보낸다', (await pushedTo('가입 승인 요청')).length, 2)
  const AUTO = randomUUID()
  g.__AF.claims = { sub: AUTO, email: 'auto@example.test', user_metadata: { invite_code: 'STAYEXT09' } }
  await getAccessContext()
  eq('초대코드로 바로 승인된 가입은 안 보낸다', (await pushedTo('가입 승인 요청')).length, 2)
  // 참여 요청: GU 의 영업장(구관기 하우스)에 STAFF 역할 하나를 두고, 참여자가 코드로 요청
  const gp = cp.ok ? cp.propertyId : ''
  await prisma.property.update({ where: { id: gp }, data: { joinCode: 'JOIN01' } })
  await prisma.userPropertyRole.create({ data: { userId: STAFF, propertyId: gp, role: 'STAFF' } })
  await prisma.userPropertyRole.create({ data: { userId: P1, propertyId: gp, role: 'OWNER' } })   // 대기 계정 소유자 역할(받으면 안 된다)
  const { requestJoinByCode } = await import('@/app/property-select/actions')
  g.__AF.claims = { sub: JOINER, email: 'joiner@example.test' }
  eq('참여 요청 통과', (await requestJoinByCode('join01')).ok, true)
  const jp = await pushedTo('영업장 참여 요청')
  eq('참여 요청 푸시는 승인된 소유자에게만(스태프·대기 계정 제외)', jp.map(x => x.userId), [GU])
  eq('참여 요청 문장·이동', [jp[0]?.body, jp[0]?.url], ['참여자 님이 구관기 하우스 참여를 요청했습니다', '/settings?tab=members'])
  // 대기 건수 정본: 대기이고 관리자 아님(관리자는 상태가 뜻이 없다)
  const { countPendingSignups } = await import('@/lib/adminSignups')
  const pend = await prisma.user.findMany({ where: { status: 'PENDING', isSuperAdmin: false }, select: { email: true } })
  eq('대기 건수 = 대기·관리자 아님·env 관리자 아님', await countPendingSignups(), pend.filter(p => p.email !== 'env-admin@example.test').length)

  await server.stop()
  await pg.close()
  console.log(`\n관리자 접근 흐름: 통과 ${pass} · 실패 ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
