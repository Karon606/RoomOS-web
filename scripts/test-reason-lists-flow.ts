// 사유 목록 통합 회귀. 실제 설정·이력 수정·보증금 미반환 저장·이름 변경·적용취소를 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-reason-lists-flow.ts
// 관문 대역만 사유 하네스 전용이다(사용자 id 가 uuid 라 상태 전환이 이력 행을 만든다, scripts/reason-flow-access-stub).
//
// 왜 통합인가(2026-10-22 운영자 승인). 저장 규약 진리표(test-reason-lists)는 순수 함수만 본다. 서버 경로가 그 규약을 실제로
// 거치는지(목록 밖 글은 '기타 · 글', 체크하면 목록 추가), 이름 변경이 상태 이력을 toStatus·영업장으로 나눠 따라가고
// '기타 · 글' 을 안 건드리는지, 적용취소가 행을 바이트까지 되돌리는지, 남의 영업장 행을 못 건드리는지는 실제 쓰기를 돌려야 보인다.
// 대역·운영 DB 차단은 구매처·쇼핑몰 하네스(scripts/test-expense-channel-flow.ts)와 같은 판이다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  // 외래키는 빼되(부모 없는 대역 행을 만든다) 재고 원장의 지우기 사슬(ON DELETE CASCADE)은 살린다. 운영에서 카드를 지우면
  // 위치 연결·점검·임시저장이, 점검을 지우면 위치 내역이 함께 지워진다. 그 사슬 없이 되살리면 하네스만 유니크에 걸린다.
  const KEEP = /ALTER TABLE "(stock_checks|stock_check_drafts|tracked_item_locations|stock_check_locations)" ADD CONSTRAINT/
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s) || KEEP.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  // 소켓 다리의 확장 프로토콜 응답 정렬(2026-10-15 후속 검수 1, 참고 4·E2 장면의 25P02 흔들림 원인).
  // 트리거로 일부러 실패시키는 쿼리에서 PGlite 는 ErrorResponse 뒤에 ReadyForQuery 를 바로 내고, Sync 에서 하나를 더 낸다
  // (실측 응답 'EZ' 다음 'Z', 한 번에 넘겨도 'EZZ'). 두 Z 가 따로 도착하면 node-postgres 는 둘째 Z 를 다음 쿼리(ROLLBACK)의
  // 끝으로 받아 응답 짝이 하나씩 밀린다. 그러면 Prisma 는 ROLLBACK 이 끝났다고 믿고 돌아오는데 세션은 아직 실패한 트랜잭션
  // 안이라, 그 틈의 직접 SQL(트리거 지우기)이 25P02 로 죽고, 지나가도 뒤 쿼리들이 앞 쿼리의 응답을 받는다(탐침 실측).
  // 실제 서버처럼 Sync(또는 Flush·단순 쿼리·종료)까지 모아 한 번에 넘기고, 응답에서 바로 이어진 ReadyForQuery 를 하나로 접어
  // 한 번에 보낸다. 시작·SSL 패킷(타입 바이트 없음)은 그대로 넘긴다.
  {
    const raw = pg.execProtocolRawStream.bind(pg)
    let pending = new Uint8Array(0)
    const ENDS = new Set([0x53 /* Sync */, 0x48 /* Flush */, 0x51 /* Query */, 0x58 /* Terminate */])
    const walk = (buf: Uint8Array, at: (type: number, start: number, end: number) => void) => {
      let k = 0
      while (k + 5 <= buf.length) {
        const len = ((buf[k + 1] << 24) | (buf[k + 2] << 16) | (buf[k + 3] << 8) | buf[k + 4]) >>> 0
        if (len < 4 || k + 1 + len > buf.length) break
        at(buf[k], k, k + 1 + len); k += 1 + len
      }
      return k
    }
    ;(pg as unknown as { execProtocolRawStream: typeof raw }).execProtocolRawStream = async (msg, opts) => {
      if (pending.length === 0 && msg.length > 0 && msg[0] === 0) return raw(msg, opts)
      const buf = new Uint8Array(pending.length + msg.length)
      buf.set(pending); buf.set(msg, pending.length)
      let lastType = -1
      const done = walk(buf, t => { lastType = t })
      if (done !== buf.length || !ENDS.has(lastType)) { pending = buf; return }
      pending = new Uint8Array(0)
      const outs: Uint8Array[] = []
      await raw(buf, { ...opts, onRawData: (d: Uint8Array) => { outs.push(d.slice()) } })
      const all = new Uint8Array(outs.reduce((n, d) => n + d.length, 0))
      let o = 0; for (const d of outs) { all.set(d, o); o += d.length }
      const keep: [number, number][] = []
      let prevType = -1
      const end = walk(all, (t, s, e) => { if (!(t === 0x5a && prevType === 0x5a)) keep.push([s, e]); prevType = t })
      const fixed = new Uint8Array(keep.reduce((n, [s, e]) => n + (e - s), 0) + (all.length - end))
      let w = 0; for (const [s, e] of keep) { fixed.set(all.subarray(s, e), w); w += e - s }
      fixed.set(all.subarray(end), w)
      if (fixed.length) opts?.onRawData?.(fixed)
    }
  }
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()
  // 직접 SQL(트리거 만들기·지우기)은 세션이 트랜잭션 밖일 때만 넣는다. 같은 PGlite 세션을 소켓과 나눠 쓰기 때문이다.
  // 위 응답 정렬이 있으면 서버 액션이 돌아온 뒤 세션은 늘 비어 있다. 아니면 응답 짝이 어긋난 것이라 여기서 바로 멈춘다.
  const directSql = async (sql: string) => {
    if (pg.isInTransaction()) throw new Error('하네스: 직접 SQL 을 넣으려는데 세션이 아직 트랜잭션 안이다(소켓 응답 짝 어긋남)')
    await pg.exec(sql)
  }


  void directSql
  const prisma = (await import('@/lib/prisma')).default
  const settings = await import('@/app/(app)/settings/actions')
  const rooms = await import('@/app/(app)/rooms/actions')
  const tenants = await import('@/app/(app)/tenants/actions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const tenantIn = async (pid: string, name: string) => (await prisma.tenant.create({ data: { propertyId: pid, name } })).id as string
  const leaseOf = async (pid: string, tenantId: string, status: string, depositAmount = 0) =>
    (await prisma.leaseTerm.create({ data: { propertyId: pid, tenantId, status: status as never, depositAmount } })).id as string
  const T1 = await tenantIn(P1, '가'), T2 = await tenantIn(P2, '나')
  const L1 = await leaseOf(P1, T1, 'CANCELLED'), L2 = await leaseOf(P2, T2, 'CANCELLED')
  const log = async (pid: string, tenantId: string, leaseTermId: string, fromStatus: string, toStatus: string, reason: string | null) =>
    (await prisma.tenantStatusLog.create({ data: { propertyId: pid, tenantId, leaseTermId, fromStatus: fromStatus as never, toStatus: toStatus as never, reason, changedById: null } })).id as string
  const listOf = async (pid: string, f: 'cancelReasons' | 'checkoutReasons' | 'withholdReasons') =>
    (await prisma.property.findUnique({ where: { id: pid }, select: { cancelReasons: true, checkoutReasons: true, withholdReasons: true } }))?.[f] ?? null
  const reasonOf = async (id: string) => (await prisma.tenantStatusLog.findUnique({ where: { id } }))?.reason ?? null
  const allLogs = async () => JSON.stringify(await prisma.tenantStatusLog.findMany({ orderBy: { id: 'asc' } }))
  g.__CR_FLOW_PID = P1

  // ── 1. 조회·추가·못 넣는 이름 ───────────────────────────────────────────────
  {
    eq('칸이 비면 기본값(종전 상수 - 기타)', await settings.getCancelReasons(), ['변심', '가격부담', '호실 사이즈', '다른 곳으로 결정', '연락 두절', '일정 변경'])
    eq('기타는 목록에 못 넣는다', (await settings.addCancelReason('기타')).ok, false)
    eq('기타 · 글 꼴도 못 넣는다', (await settings.addCancelReason('기타 · 공실')).ok, false)
    eq('시스템 라벨도 못 넣는다', (await settings.addCheckoutReason('단기 자동 전환')).ok, false)
    eq('못 넣는 이름 뒤 칸은 그대로(null)', [await listOf(P1, 'cancelReasons'), await listOf(P1, 'checkoutReasons')], [null, null])
    eq('보통 이름은 끝에 붙는다', (await settings.addWithholdReason('열쇠 분실')).ok, true)
    eq('미반환 목록', await listOf(P1, 'withholdReasons'), '인수 승계 보증금,청소비,원상복구비,계약 위반,열쇠 분실')
    eq('남의 영업장 칸은 그대로', await listOf(P2, 'withholdReasons'), null)
    eq('이름 변경으로도 기타를 못 만든다', (await settings.renameOption('cancelReasons', '변심', '기타')).ok, false)
    eq('청소비 이름 변경은 막힌다', (await settings.renameOption('withholdReasons', '청소비', '청소 비용')).ok, false)
  }

  // ── 2. 상태 이력 사유 수정: 저장 규약 ──────────────────────────────────────
  const A = await log(P1, T1, L1, 'RESERVED', 'CANCELLED', null)
  {
    const r1 = await rooms.updateStatusLogReason(A, '기타 · 선예약자 계약')
    eq('체크 안 하면 기타 · 글', [r1.ok, await reasonOf(A), await listOf(P1, 'cancelReasons')], [true, '기타 · 선예약자 계약', null])
    const r2 = await rooms.updateStatusLogReason(A, '기타 · 공실 없음', { addToList: true })
    eq('체크하면 맨 글자 + 목록 끝', [r2.ok, await reasonOf(A), await listOf(P1, 'cancelReasons')], [true, '공실 없음', '변심,가격부담,호실 사이즈,다른 곳으로 결정,연락 두절,일정 변경,공실 없음'])
    eq('결과가 저장 글자를 돌려준다', r2.ok && r2.reason, '공실 없음')
    const r3 = await rooms.updateStatusLogReason(A, '목록에 없는 맨 글자')
    eq('목록 밖 맨 글자(위조)는 기타 · 글', [r3.ok, await reasonOf(A)], [true, '기타 · 목록에 없는 맨 글자'])
    await prisma.tenantStatusLog.update({ where: { id: A }, data: { reason: '옛 사유' } })
    const r4 = await rooms.updateStatusLogReason(A, '옛 사유')
    eq('지금 값 그대로면 목록 밖이어도 그대로', [r4.ok, await reasonOf(A)], [true, '옛 사유'])
    const r5 = await rooms.updateStatusLogReason(A, '변심')
    if (!r5.ok || !r5.undo) throw new Error('undo token')
    eq('적용취소 토큰은 서명된다', typeof r5.undo.sig, 'string')
    eq('위조 토큰(이전 값 바꿈)은 거부', [(await rooms.undoStatusLogReason({ ...J(r5.undo), prev: '아무 글' })).ok, await reasonOf(A)], [false, '변심'])
    eq('서명 없는 토큰은 거부', (await rooms.undoStatusLogReason({ logId: A, prev: '아무 글', next: '변심' })).ok, false)
    const r6 = await rooms.undoStatusLogReason(J(r5.undo))
    eq('적용취소는 이전 글자 그대로(옛 사유에 기타 · 가 안 붙는다)', [r6.ok, await reasonOf(A)], [true, '옛 사유'])
    eq('같은 토큰 두 번째는 거부(지금 값이 바꾼 값이 아니다)', (await rooms.undoStatusLogReason(J(r5.undo))).ok, false)
    const S = await log(P1, T1, L1, 'CHECKOUT_PENDING', 'ACTIVE', '단기 연장')
    eq('사유를 받지 않는 전이는 못 고친다', (await rooms.updateStatusLogReason(S, '변심')).ok, false)
    g.__CR_FLOW_PID = P2
    eq('남의 영업장 이력은 못 고친다', [(await rooms.updateStatusLogReason(A, '변심')).ok, await reasonOf(A)], [false, '옛 사유'])
    g.__CR_FLOW_PID = P1
  }

  // ── 3. 이름 변경 cascade: 영업장·toStatus 로 나누고 '기타 · 글' 은 안 바꾼다 / 적용취소 바이트 동일 ──
  {
    await settings.addCheckoutReason('계약 위반 퇴실')   // 퇴실 목록에 넣은 이름
    await settings.addCancelReason('계약 위반 퇴실')     // 같은 글자를 취소 목록에도
    const c1 = await log(P1, T1, L1, 'RESERVED', 'CANCELLED', '변심')
    const c2 = await log(P1, T1, L1, 'RESERVED', 'CANCELLED', '기타 · 변심')
    const c3 = await log(P2, T2, L2, 'RESERVED', 'CANCELLED', '변심')
    const c4 = await log(P1, T1, L1, 'ACTIVE', 'CHECKOUT_PENDING', '계약 위반 퇴실')
    const c5 = await log(P1, T1, L1, 'CHECKOUT_PENDING', 'CHECKED_OUT', '계약 위반 퇴실')
    const c6 = await log(P1, T1, L1, 'RESERVED', 'CANCELLED', '계약 위반 퇴실')
    const c8 = await log(P1, T1, L1, 'ACTIVE', 'ACTIVE', '계약 위반 퇴실')    // '그날 바꾸기' 행(거주중 그대로 + 퇴실 사유)
    const c9 = await log(P1, T1, L1, 'CHECKOUT_PENDING', 'ACTIVE', '계약 위반 퇴실')  // 다른 전이(같은 글자)는 범위 밖
    const c7 = (await prisma.tenantStatusLog.create({ data: { propertyId: P1, tenantId: T1, leaseTermId: L1, fromStatus: 'RESERVED', toStatus: 'CANCELLED', reason: '변심', deletedAt: new Date('2026-10-01T00:00:00Z') } })).id as string
    const before = await allLogs()
    eq('건수 고지: 취소 변심은 이 영업장 취소 행만(무효 행 포함)', await settings.countRenameTargets('cancelReasons', '변심'), 2)
    const r = await settings.renameOption('cancelReasons', '변심', '마음 바뀜')
    if (!r.ok) throw new Error(r.error)
    eq('이름 변경 건수 = 고지 건수', r.updated, 2)
    eq('바뀐 행·안 바뀐 행', [await reasonOf(c1), await reasonOf(c2), await reasonOf(c3), await reasonOf(c7)], ['마음 바뀜', '기타 · 변심', '변심', '마음 바뀜'])
    eq('목록도 그 자리에서', (await settings.getCancelReasons())[0], '마음 바뀜')
    const r2 = await settings.renameOption('checkoutReasons', '계약 위반 퇴실', '강제 퇴실')
    if (!r2.ok) throw new Error(r2.error)
    eq('퇴실 사유 이름 변경은 퇴실 예정·퇴실·그날 바꾸기 행만(같은 글자의 취소 사유·다른 전이는 그대로)',
      [await reasonOf(c4), await reasonOf(c5), await reasonOf(c8), await reasonOf(c6), await reasonOf(c9)], ['강제 퇴실', '강제 퇴실', '강제 퇴실', '계약 위반 퇴실', '계약 위반 퇴실'])
    const u2 = await settings.undoRenameOption(J(r2.undo!))
    const u1 = await settings.undoRenameOption(J(r.undo!))
    eq('적용취소 둘 ok', [u2.ok, u1.ok], [true, true])
    eq('적용취소 뒤 상태 이력 바이트 동일', await allLogs(), before)
    eq('적용취소 뒤 목록도 원래 이름', (await settings.getCancelReasons())[0], '변심')
    // 화면을 거쳐 온 표를 위조해 남의 영업장 행 id 를 끼워도 영업장 범위 밖은 안 바뀐다.
    const r3 = await settings.renameOption('cancelReasons', '변심', '마음 바뀜')
    if (!r3.ok || !r3.undo) throw new Error('rename 3')
    await prisma.tenantStatusLog.update({ where: { id: c3 }, data: { reason: '마음 바뀜' } })
    const forged = { ...J(r3.undo), rows: r3.undo.rows.map(x => ({ ...x, ids: [...x.ids, c3] })) }
    eq('위조 표 적용취소 ok(이 영업장 행만)', (await settings.undoRenameOption(forged)).ok, true)
    eq('남의 영업장 행은 그대로', await reasonOf(c3), '마음 바뀜')
  }

  // ── 4. 보증금 미반환 기록: 저장 규약·청소비 판정·이름 변경은 미반환 기록만 ────────────────
  {
    const T3 = await tenantIn(P1, '다')
    const L3 = await leaseOf(P1, T3, 'CHECKED_OUT', 100000)
    await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: L3, tenantId: T3, targetMonth: '2026-09', isDeposit: true, actualAmount: 100000, payDate: new Date('2026-09-01T00:00:00Z') } })
    const r = await tenants.recordDepositReturn({ leaseTermId: L3, tenantId: T3, depositAmount: 100000, returnedAmount: 70000, date: '2026-10-20', tenantName: '다', reason: '기타 · 열쇠 파손', addReasonToList: false })
    if (!r.ok) throw new Error(r.error)
    eq('미반환: 체크 안 하면 기타 · 글', (await prisma.depositRefund.findUnique({ where: { id: r.refundId } }))?.reason, '기타 · 열쇠 파손')
    const inc = await prisma.extraIncome.findMany({ where: { id: { in: r.extraIncomeIds } }, select: { detail: true } })
    eq('부가수익 상세는 기타 접두어 없이(종전과 같다)', inc.map(i => i.detail), ['다 퇴실 · 열쇠 파손'])
    eq('목록은 그대로', await listOf(P1, 'withholdReasons'), '인수 승계 보증금,청소비,원상복구비,계약 위반,열쇠 분실')
    const T4 = await tenantIn(P1, '라')
    const L4 = await leaseOf(P1, T4, 'CHECKED_OUT', 50000)
    await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: L4, tenantId: T4, targetMonth: '2026-09', isDeposit: true, actualAmount: 50000, payDate: new Date('2026-09-01T00:00:00Z') } })
    const r2 = await tenants.recordDepositReturn({ leaseTermId: L4, tenantId: T4, depositAmount: 50000, returnedAmount: 0, date: '2026-10-20', tenantName: '라', reason: '기타 · 벽지 훼손', addReasonToList: true })
    if (!r2.ok) throw new Error(r2.error)
    eq('미반환: 체크하면 맨 글자 + 목록 끝', [(await prisma.depositRefund.findUnique({ where: { id: r2.refundId } }))?.reason, await listOf(P1, 'withholdReasons')],
      ['벽지 훼손', '인수 승계 보증금,청소비,원상복구비,계약 위반,열쇠 분실,벽지 훼손'])
    const incBefore = JSON.stringify(await prisma.extraIncome.findMany({ where: { propertyId: P1 }, orderBy: { id: 'asc' } }))
    const refsNoStamp = async () => JSON.stringify((await prisma.depositRefund.findMany({ orderBy: { id: 'asc' } })).map(({ updatedAt: _u, ...x }) => { void _u; return x }))
    const refBefore = await refsNoStamp()
    const rn = await settings.renameOption('withholdReasons', '벽지 훼손', '도배 훼손')
    if (!rn.ok || !rn.undo) throw new Error('rename withhold')
    eq('미반환 이름 변경은 미반환 기록만', (await prisma.depositRefund.findUnique({ where: { id: r2.refundId } }))?.reason, '도배 훼손')
    eq('부가수익 상세 문장은 그때의 기록(안 바뀐다)', JSON.stringify(await prisma.extraIncome.findMany({ where: { propertyId: P1 }, orderBy: { id: 'asc' } })), incBefore)
    eq('미반환 이름 변경 적용취소 ok', (await settings.undoRenameOption(J(rn.undo))).ok, true)
    eq('미반환 기록 바이트 동일(updatedAt 제외)', await refsNoStamp(), refBefore)
    // 운영자가 목록에서 청소비를 빼도 앱이 미리 고른 '청소비' 는 그대로 남고 청소비 판정도 그대로다.
    await settings.deleteWithholdReason('청소비')
    const T5 = await tenantIn(P1, '마')
    const L5 = await leaseOf(P1, T5, 'CHECKED_OUT', 50000)
    await prisma.leaseTerm.update({ where: { id: L5 }, data: { cleaningFee: 20000 } })
    await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: L5, tenantId: T5, targetMonth: '2026-09', isDeposit: true, actualAmount: 50000, payDate: new Date('2026-09-01T00:00:00Z') } })
    const r5 = await tenants.recordDepositReturn({ leaseTermId: L5, tenantId: T5, depositAmount: 50000, returnedAmount: 30000, date: '2026-10-20', tenantName: '마', reason: '청소비' })
    if (!r5.ok) throw new Error(r5.error)
    eq('목록에서 뺀 보호 이름 청소비도 그대로 남는다', (await prisma.depositRefund.findUnique({ where: { id: r5.refundId } }))?.reason, '청소비')
    eq('청소비 몫은 청소비 카테고리(판정 그대로)', (await prisma.extraIncome.findMany({ where: { id: { in: r5.extraIncomeIds } }, select: { category: true, amount: true } })).map(x => [x.category, x.amount]), [['청소비', 20000]])
  }

  // ── 5. 저절로 쌓던 목록: '목록에 추가' 를 끄면 안 쌓이고 값은 적은 글자 그대로(운영자 결정 2) ──────────
  {
    const fin = await import('@/app/(app)/finance/actions')
    const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
    const expList = async () => (await prisma.property.findUnique({ where: { id: P1 }, select: { expenseCategories: true } }))?.expenseCategories ?? null
    const items = (label: string, amount: number) => JSON.stringify([{ label, qtyValue: '1', qtyUnit: '개', amount }])
    const base = { date: '2026-10-18', payMethod: '계좌이체', qtyValue: '1', qtyUnit: '개' }
    const r1 = await fin.addExpense(fd({ ...base, amount: '1000', category: '세탁 세제', categoryAddToList: '0', itemLabel: '끔품목', itemsJson: items('끔품목', 1000) }))
    eq('지출: 끄면 목록에 안 쌓인다(칸 그대로)', [r1.ok, await expList()], [true, null])
    eq('지출: 값은 적은 글자 그대로', (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: '끔품목' } }))?.category, '세탁 세제')
    const r2 = await fin.addExpense(fd({ ...base, amount: '1000', category: '세탁 세제', itemLabel: '켬품목', itemsJson: items('켬품목', 1000) }))
    eq('지출: 체크 칸이 없으면(종전 호출) 쌓인다', [r2.ok, (await expList())?.endsWith(',세탁 세제')], [true, true])
    const reqList = async () => (await prisma.property.findUnique({ where: { id: P1 }, select: { requestCategories: true } }))?.requestCategories ?? null
    const q1 = await tenants.createTenantRequest({ tenantId: null, content: '끔', requestDate: '2026-10-18', targetDate: null, category: '주차', addCategoryToList: false, commonPlace: '복도' })
    eq('요청: 끄면 목록에 안 쌓인다', [q1.ok, await reqList()], [true, null])
    eq('요청: 값은 적은 글자 그대로', (await prisma.tenantRequest.findFirst({ where: { propertyId: P1, content: '끔' } }))?.category, '주차')
    const q2 = await tenants.createTenantRequest({ tenantId: null, content: '켬', requestDate: '2026-10-18', targetDate: null, category: '주차', commonPlace: '복도' })
    eq('요청: 켜면(기본) 쌓인다', [q2.ok, (await reqList())?.endsWith(',주차')], [true, true])
  }

  // ── 6. 상태 전환: 입실 취소 사유·뺀 사유를 이어받은 퇴실(독립 검수 R1) ─────────────────────
  {
    const T6 = await tenantIn(P1, '바')
    const L6 = await leaseOf(P1, T6, 'RESERVED')
    const r = await tenants.applyStatusTransition({ leaseTermId: L6, tenantId: T6, toStatus: 'CANCELLED', reason: '기타 · 엘리베이터 없음', addReasonToList: true })
    if (!r.ok) throw new Error(r.error)
    eq('전환: 체크하면 맨 글자', (await prisma.tenantStatusLog.findFirst({ where: { leaseTermId: L6, toStatus: 'CANCELLED' } }))?.reason, '엘리베이터 없음')
    eq('전환: 목록 끝에 더함', (await settings.getCancelReasons()).at(-1), '엘리베이터 없음')
    const T7 = await tenantIn(P1, '사')
    const L7 = await leaseOf(P1, T7, 'RESERVED')
    const r7 = await tenants.applyStatusTransition({ leaseTermId: L7, tenantId: T7, toStatus: 'CANCELLED', reason: '단기 자동 전환' })
    if (!r7.ok) throw new Error(r7.error)
    eq('전환: 시스템 라벨을 보내도 운영자 사유로 안 남는다', (await prisma.tenantStatusLog.findFirst({ where: { leaseTermId: L7, toStatus: 'CANCELLED' } }))?.reason, '기타 · 단기 자동 전환')
    // 퇴실 예정 때 '개인 사정' 을 골랐는데 그 뒤 운영자가 목록에서 '개인 사정' 을 뺐다. 퇴실 처리 폼은 이어받은 '개인 사정' 으로 연다.
    const T8 = await tenantIn(P1, '아')
    const L8 = await leaseOf(P1, T8, 'CHECKOUT_PENDING')
    await log(P1, T8, L8, 'ACTIVE', 'CHECKOUT_PENDING', '개인 사정')
    await settings.deleteCheckoutReason('개인 사정')
    eq('개인 사정은 목록에서 빠졌다', (await settings.getCheckoutReasons()).includes('개인 사정'), false)
    const r8 = await tenants.applyStatusTransition({ leaseTermId: L8, tenantId: T8, toStatus: 'CHECKED_OUT', moveOutDate: '2026-10-20', reason: '개인 사정' })
    if (!r8.ok) throw new Error(r8.error)
    eq('뺀 사유를 이어받은 퇴실은 그 글자 그대로(기타 · 가 안 붙는다)', (await prisma.tenantStatusLog.findFirst({ where: { leaseTermId: L8, toStatus: 'CHECKED_OUT' } }))?.reason, '개인 사정')
    const T9 = await tenantIn(P1, '자')
    const L9 = await leaseOf(P1, T9, 'ACTIVE')
    const r9 = await tenants.applyStatusTransition({ leaseTermId: L9, tenantId: T9, toStatus: 'CHECKOUT_PENDING', expectedMoveOut: '2026-12-31', reason: '개인 사정' })
    if (!r9.ok) throw new Error(r9.error)
    eq('이어받을 사유가 없는 새 퇴실 예정에 뺀 이름을 보내면 기타 · 글', (await prisma.tenantStatusLog.findFirst({ where: { leaseTermId: L9, toStatus: 'CHECKOUT_PENDING' } }))?.reason, '기타 · 개인 사정')
  }

  // ── 7. 목록을 고치는 입구: 순서·삭제 적용취소·초기화 적용취소·이름 변경 적용취소(독립 검수 N2), 동시 추가(N4) ──
  {
    const now = await settings.getWithholdReasons()
    let threw = false
    try { await settings.reorderOptions('withholdReasons', [...now, '기타']) } catch { threw = true }
    eq('순서 저장으로 기타를 끼워 넣지 못한다', [threw, await settings.getWithholdReasons()], [true, now])
    threw = false
    try { await settings.reorderOptions('withholdReasons', now.slice(1)) } catch { threw = true }
    eq('순서 저장이 이름을 빼지 못한다(지금 목록과 같은 이름 집합만)', [threw, await settings.getWithholdReasons()], [true, now])
    await settings.reorderOptions('withholdReasons', [...now].reverse())
    eq('같은 이름 집합이면 순서만 바뀐다', await settings.getWithholdReasons(), [...now].reverse())
    eq('삭제 적용취소로 기타를 넣지 못한다', (await settings.restoreOption('cancelReasons', '기타', 0)).ok, false)
    eq('초기화 적용취소로 시스템 라벨을 넣지 못한다', (await settings.undoResetOptions('checkoutReasons', ['단기 연장', '계약 만료'])).ok, false)
    eq('이름 변경 적용취소로 기타를 되살리지 못한다', (await settings.undoRenameOption({ field: 'cancelReasons', oldValue: '기타', newValue: '변심', rows: [], wishIds: [], inventory: false })).ok, false)
    const before = await settings.getCancelReasons()
    const saves = await Promise.all(['동시 하나', '동시 둘', '동시 셋'].map(async (n, i) => {
      const id = await log(P1, T1, L1, 'RESERVED', 'CANCELLED', null)
      return rooms.updateStatusLogReason(id, '기타 · ' + n, { addToList: true }).then(r => [r.ok, i])
    }))
    eq('동시 저장 셋 ok', saves.map(x => x[0]), [true, true, true])
    eq('동시에 더한 이름이 하나도 안 지워진다', (await settings.getCancelReasons()).slice(before.length).sort(), ['동시 둘', '동시 셋', '동시 하나'])
  }

  // ── 8. 2차 목록 여섯: 조회·못 넣는 이름·이름 변경 범위(재고 기록은 추적 품목으로)·적용취소 바이트 동일 ─────────
  {
    eq('2차 칸이 비면 기본값', [await settings.getStockDisposalReasons(), await settings.getCleaningReasons(), await settings.getDueDayReasons()],
      [['상함·부패', '유통기한 경과', '파손'], [], []])
    eq('청소 사유에 코드 꼴은 못 넣는다', (await settings.addCleaningReason('CHECKOUT')).ok, false)
    eq('청소 사유에 고정 라벨은 못 넣는다', (await settings.addCleaningReason('퇴실 청소')).ok, false)
    eq('방문 경로에 기타는 못 넣는다', (await settings.addVisitRouteOption('기타 · 블로그')).ok, false)
    eq('못 넣는 이름 뒤 칸은 그대로(null)', [await prisma.property.findUnique({ where: { id: P1 }, select: { cleaningReasons: true, visitRouteOptions: true } })], [{ cleaningReasons: null, visitRouteOptions: null }])
    for (const [add, n] of [[settings.addDueDayReason, '급여 지연'], [settings.addCleaningReason, '방역']] as const) eq(`보통 이름은 붙는다 '${n}'`, (await add(n)).ok, true)
    const item = async (pid: string, label: string) => (await prisma.trackedItem.create({ data: { propertyId: pid, category: '소모품비', label } })).id as string
    const I1 = await item(P1, '휴지'), I2 = await item(P2, '휴지')
    const disp = async (tid: string, reason: string) => (await prisma.stockDisposal.create({ data: { trackedItemId: tid, date: new Date('2026-10-01T00:00:00Z'), disposedQty: 1, reason } })).id as string
    const addi = async (tid: string, source: string) => (await prisma.stockAddition.create({ data: { trackedItemId: tid, date: new Date('2026-10-01T00:00:00Z'), addedQty: 1, source } })).id as string
    const d1 = await disp(I1, '파손'), d2 = await disp(I1, '기타 · 파손'), d3 = await disp(I2, '파손')
    const a1 = await addi(I1, '기증'), a2 = await addi(I2, '기증')
    const exp = async (pid: string, disposalReason: string) => (await prisma.expense.create({ data: { propertyId: pid, date: new Date('2026-10-01T00:00:00Z'), amount: 1000, category: '수선유지비', disposedAt: new Date('2026-10-02T00:00:00Z'), disposalReason } })).id as string
    const e1 = await exp(P1, '분실'), e2 = await exp(P2, '분실')
    const T8 = await tenantIn(P1, '차'), T9 = await tenantIn(P2, '카')
    const L8 = (await prisma.leaseTerm.create({ data: { propertyId: P1, tenantId: T8, status: 'ACTIVE', overrideDueDayReason: '급여 지연', visitRoute: '지인 소개' } })).id as string
    const L9 = (await prisma.leaseTerm.create({ data: { propertyId: P2, tenantId: T9, status: 'ACTIVE', overrideDueDayReason: '급여 지연', visitRoute: '지인 소개' } })).id as string
    const clean = async (pid: string, reason: string) => (await prisma.roomCleaning.create({ data: { propertyId: pid, roomId: randomUUID(), reason } })).id as string
    const c1 = await clean(P1, '방역'), c2 = await clean(P1, 'CHECKOUT'), c3 = await clean(P2, '방역'), c4 = await clean(P1, 'OTHER')
    const noStamp = <T extends Record<string, unknown>>(rows: T[]) => JSON.stringify(rows.map(({ updatedAt: _u, ...x }) => { void _u; return x }))
    const snap = async () => [
      noStamp(await prisma.stockDisposal.findMany({ orderBy: { id: 'asc' } })), noStamp(await prisma.stockAddition.findMany({ orderBy: { id: 'asc' } })),
      noStamp(await prisma.expense.findMany({ where: { disposedAt: { not: null } }, orderBy: { id: 'asc' } })),
      noStamp(await prisma.leaseTerm.findMany({ where: { id: { in: [L8, L9] } }, orderBy: { id: 'asc' } })),
      noStamp(await prisma.roomCleaning.findMany({ orderBy: { id: 'asc' } })),
    ].join('\n')
    const before = await snap()
    const RENAMES: [Parameters<typeof settings.renameOption>[0], string, string, number][] = [
      ['stockDisposalReasons', '파손', '깨짐', 1], ['stockSourceOptions', '기증', '기부', 1], ['assetDisposalReasons', '분실', '잃어버림', 1],
      ['dueDayReasons', '급여 지연', '급여일 지연', 1], ['cleaningReasons', '방역', '소독', 1], ['visitRouteOptions', '지인 소개', '지인 추천', 1],
    ]
    const undos: Awaited<ReturnType<typeof settings.renameOption>>[] = []
    for (const [f, from, to, n] of RENAMES) {
      eq(`${f} 건수 고지는 이 영업장만`, await settings.countRenameTargets(f, from), n)
      const r = await settings.renameOption(f, from, to)
      eq(`${f} 이름 변경 건수`, r.ok && r.updated, n)
      undos.push(r)
    }
    eq('재고 폐기 사유는 이 영업장 추적 품목의 그 글자만(기타 · 글·남의 영업장 그대로)',
      (await prisma.stockDisposal.findMany({ where: { id: { in: [d1, d2, d3] } }, orderBy: { id: 'asc' } })).map(d => [d.id, d.reason]).sort(),
      [[d1, '깨짐'], [d2, '기타 · 파손'], [d3, '파손']].sort())
    eq('무상 입수 출처', [(await prisma.stockAddition.findUnique({ where: { id: a1 } }))?.source, (await prisma.stockAddition.findUnique({ where: { id: a2 } }))?.source], ['기부', '기증'])
    eq('비품 폐기 사유', [(await prisma.expense.findUnique({ where: { id: e1 } }))?.disposalReason, (await prisma.expense.findUnique({ where: { id: e2 } }))?.disposalReason], ['잃어버림', '분실'])
    eq('임시 조정 사유·방문 경로', [await prisma.leaseTerm.findUnique({ where: { id: L8 }, select: { overrideDueDayReason: true, visitRoute: true } }), await prisma.leaseTerm.findUnique({ where: { id: L9 }, select: { overrideDueDayReason: true, visitRoute: true } })],
      [{ overrideDueDayReason: '급여일 지연', visitRoute: '지인 추천' }, { overrideDueDayReason: '급여 지연', visitRoute: '지인 소개' }])
    eq('청소 사유 이름 변경은 그 글자만(코드·옛 OTHER·남의 영업장 그대로)', await Promise.all([c1, c2, c3, c4].map(async id => (await prisma.roomCleaning.findUnique({ where: { id } }))?.reason)), ['소독', 'CHECKOUT', '방역', 'OTHER'])
    for (const r of [...undos].reverse()) eq('2차 이름 변경 적용취소 ok', r.ok && r.undo ? (await settings.undoRenameOption(J(r.undo))).ok : false, true)
    eq('2차 적용취소 뒤 기록 바이트 동일(updatedAt 제외)', await snap(), before)
    eq('2차 적용취소 뒤 목록도 원래 이름', [await settings.getStockDisposalReasons(), await settings.getCleaningReasons()], [['상함·부패', '유통기한 경과', '파손'], ['방역']])
  }


  console.log(`[사유 목록 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
