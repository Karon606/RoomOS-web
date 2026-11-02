// '입실 예약 전환 + 바로 예약 확정' 통합 회귀(신고 507e1a0d 안 A). 실제 상태 전환 서버를 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-reserve-confirm-flow.ts
// 하네스 판은 사유 목록 통합(scripts/test-reason-lists-flow.ts)과 같다(관문 대역 사용자 id 가 uuid 라 상태 이력 행이 선다).
//
// 보는 것.
//   A. 한 번 제출(lib/reserveTransition reserveSubmitFields)로 투어 완료에서 확정된 예약까지 간다. 이력 행은 하나다.
//      적용취소(reserveUndo) 한 호출이 상태·확정·입주 희망일·호실 공실을 전환 전 값으로 되돌린다.
//   B. 본인 연락처가 없으면 서버 확정 문이 거부하고 계약은 바이트 그대로다(예약도 반쪽으로 안 남는다).
//   C. 종전 두 단계(전환 뒤 예약 확정)를 거꾸로 두 번(확정 적용취소, 전환 적용취소) 되돌리면 A 와 같은 끝 상태다.
//   D. 체크 안 한 전환의 적용취소는 확정 칸을 건드리지 않는다.
//   E. 그 방을 다른 계약이 잡고 있으면 투어 단계로 물려도 공실로 덮지 않는다.
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
  const tenants = await import('@/app/(app)/tenants/actions')
  const { reserveSubmitFields, reserveUndo } = await import('@/lib/reserveTransition')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const TODAY = '2026-11-02'
  let roomSeq = 0
  const setup = async (name: string, status: string, opts: { phone?: boolean; moveIn?: string | null } = {}) => {
    const room = await prisma.room.create({ data: { propertyId: P1, roomNo: `9${String(++roomSeq).padStart(2, '0')}`, isVacant: true } })
    const tenant = await prisma.tenant.create({ data: { propertyId: P1, name } })
    if (opts.phone !== false) await prisma.tenantContact.create({ data: { tenantId: tenant.id, contactType: 'PHONE', contactValue: '010-1234-5678', isPrimary: true } })
    const lease = await prisma.leaseTerm.create({ data: {
      propertyId: P1, tenantId: tenant.id, roomId: room.id, status: status as never,
      moveInDate: opts.moveIn ? new Date(opts.moveIn) : null,
    } })
    return { roomId: room.id as string, tenantId: tenant.id as string, leaseId: lease.id as string }
  }
  const snap = async (leaseId: string, roomId: string) => {
    const l = await prisma.leaseTerm.findUnique({ where: { id: leaseId }, select: { status: true, reservationConfirmedAt: true, moveInDate: true, moveInFlexible: true } })
    const r = await prisma.room.findUnique({ where: { id: roomId }, select: { isVacant: true } })
    return J({ ...l, isVacant: r?.isVacant })
  }
  const logCount = async (leaseId: string) => prisma.tenantStatusLog.count({ where: { leaseTermId: leaseId } })
  const ymd = (d: unknown) => (d ? String(d).slice(0, 10) : null)

  // ── A. 한 번 제출과 한 번 적용취소 ─────────────────────────────────────
  {
    const s = await setup('가', 'TOUR_DONE', { moveIn: '2026-11-15' })
    const before = await snap(s.leaseId, s.roomId)
    const r = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', true, TODAY) })
    eq('A 전환 성공', r.ok, true)
    const after = await snap(s.leaseId, s.roomId)
    eq('A 예약 + 확정 + 희망일', [after.status, ymd(after.reservationConfirmedAt), ymd(after.moveInDate)], ['RESERVED', TODAY, '2026-11-20'])
    eq('A 이력 행 하나(투어 완료에서 입실 예약)', await logCount(s.leaseId), 1)
    const u = reserveUndo({ status: 'TOUR_DONE', moveInYmd: '2026-11-15' }, true)
    const ru = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: u.toStatus, ...u.fields })
    eq('A 적용취소 성공', ru.ok, true)
    const back = await snap(s.leaseId, s.roomId)
    eq('A 적용취소 뒤 상태·확정·희망일·공실이 전환 전 그대로', { ...back, moveInFlexible: null }, { ...before, moveInFlexible: null })
    eq('A 적용취소는 새 이력 행(입실 예약에서 투어 완료)', await logCount(s.leaseId), 2)
  }

  // ── B. 연락처 없음은 통째로 거부 ───────────────────────────────────────
  {
    const s = await setup('나', 'TOUR_DONE', { phone: false, moveIn: '2026-11-15' })
    const before = JSON.stringify(await prisma.leaseTerm.findUnique({ where: { id: s.leaseId } }))
    const r = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', true, TODAY) })
    eq('B 거부', r.ok, false)
    eq('B 거부 문장은 연락처 문', !r.ok && r.error.startsWith('예약 확정'), true)
    eq('B 계약 바이트 그대로', JSON.stringify(await prisma.leaseTerm.findUnique({ where: { id: s.leaseId } })), before)
    eq('B 이력 행 없음', await logCount(s.leaseId), 0)
    const r2 = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', false, TODAY) })
    eq('B 체크를 끄면 전환은 된다(종전 그대로)', [r2.ok, (await snap(s.leaseId, s.roomId)).status, (await snap(s.leaseId, s.roomId)).reservationConfirmedAt], [true, 'RESERVED', null])
  }

  // ── C. 종전 두 단계와 끝 상태가 같다 ────────────────────────────────────
  {
    const s = await setup('다', 'TOUR_DONE', { moveIn: '2026-11-15' })
    const before = await snap(s.leaseId, s.roomId)
    await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', false, TODAY) })
    await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', reservationConfirmedAt: TODAY })
    const mid = await snap(s.leaseId, s.roomId)
    eq('C 두 단계 뒤 예약 + 확정', [mid.status, ymd(mid.reservationConfirmedAt)], ['RESERVED', TODAY])
    // 확정 적용취소(버튼) 다음 전환 적용취소(토스트) — 차례대로
    const r1 = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', reservationConfirmedAt: null })
    const u = reserveUndo({ status: 'TOUR_DONE', moveInYmd: '2026-11-15' }, false)
    const r2 = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: u.toStatus, ...u.fields })
    eq('C 두 번 되돌리기 성공', [r1.ok, r2.ok], [true, true])
    eq('C 끝 상태가 전환 전과 같다', { ...(await snap(s.leaseId, s.roomId)), moveInFlexible: null }, { ...before, moveInFlexible: null })
  }

  // ── D. 체크 안 한 전환의 적용취소는 확정 칸을 안 건드린다 ───────────────
  {
    const s = await setup('라', 'WAITING_TOUR', { moveIn: null })
    const before = await snap(s.leaseId, s.roomId)
    await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', false, TODAY) })
    const u = reserveUndo({ status: 'WAITING_TOUR', moveInYmd: null }, false)
    eq('D 적용취소 값에 확정 칸 없음', 'reservationConfirmedAt' in u.fields, false)
    const r = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: u.toStatus, ...u.fields })
    eq('D 적용취소 성공·전환 전 그대로', [r.ok, await snap(s.leaseId, s.roomId)], [true, before])
  }

  // ── E. 그 방을 다른 계약이 잡고 있으면 적용취소가 공실로 덮지 않는다(점유 확인 정본) ──────────
  {
    const s = await setup('마', 'TOUR_DONE', { moveIn: '2026-11-15' })
    await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: 'RESERVED', ...reserveSubmitFields('2026-11-20', true, TODAY) })
    const other = await prisma.tenant.create({ data: { propertyId: P1, name: '바' } })
    await prisma.leaseTerm.create({ data: { propertyId: P1, tenantId: other.id, roomId: s.roomId, status: 'ACTIVE', moveInDate: new Date('2026-10-01') } })
    const u = reserveUndo({ status: 'TOUR_DONE', moveInYmd: '2026-11-15' }, true)
    const r = await tenants.applyStatusTransition({ leaseTermId: s.leaseId, tenantId: s.tenantId, toStatus: u.toStatus, ...u.fields })
    eq('E 적용취소 성공·다른 거주 계약이 있어 공실 아님', [r.ok, (await snap(s.leaseId, s.roomId)).status, (await snap(s.leaseId, s.roomId)).isVacant], [true, 'TOUR_DONE', false])
  }

  console.log(`[입실 예약 전환 · 바로 예약 확정 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
