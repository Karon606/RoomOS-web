// 현금영수증 생애주기 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서 그대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-cash-receipt-flow.ts
//
// 왜 통합인가. 발행 줄(CashReceipt)·수납 도장(cashReceiptIssuedAt)·적용취소 토큰은 순수 판정
// (scripts/test-cash-receipt.ts)만으로는 못 지킨다. 422호 사고(2026-10-13)는 판정 하나가 아니라
// '켜기, 형제 삭제, 끄기, 다시 켜기'라는 **순서**에서 났고, 독립 검수(2026-10-14)가 찾은 결함도
// 전부 화면이 액션을 부르는 순서(수정 폼의 두 번 호출, 적용취소 토큰 누락)에서 났다.
//
// 운영 DB 에는 절대 붙지 않는다. DATABASE_URL 을 하네스 주소로 덮은 뒤에만 앱 모듈을 불러오고,
// '@/lib/prisma' 는 하네스 주소가 아니면 연결을 거부하는 대역이다(scripts/cr-flow-prisma-stub.ts).
// 스키마는 prisma/schema.prisma 에서 그때그때 SQL 로 뽑는다(prisma migrate diff, 읽기 전용·오프라인).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 55000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
// 적용취소 토큰 서명 키. 하네스 전용 값. 운영 키와 무관하다.
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다
const kstMid = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`).toISOString()
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  // 외래키는 뺀다. 시나리오가 필요한 행만 만들도록(사용자·영업장 주인 같은 먼 그래프를 안 세운다).
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

/** 대역 익스텐션이 lib/prisma.ts 와 같은 규칙인지 글자로 대조한다. 갈리면 하네스가 거짓말을 한다. */
function assertSoftDeleteParity() {
  const real = readFileSync(path.join(ROOT, 'lib', 'prisma.ts'), 'utf8')
  const stub = readFileSync(path.join(ROOT, 'scripts', 'cr-flow-prisma-stub.ts'), 'utf8')
  for (const name of ['SOFT_DELETE_MODELS', 'SOFT_DELETE_READ_OPS']) {
    const pick = (s: string) => (s.match(new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]\\)`)) ?? [])[1]?.replace(/\s/g, '')
    if (!pick(real) || pick(real) !== pick(stub)) throw new Error(`cr-flow: ${name} 가 lib/prisma.ts 와 다릅니다. 대역을 맞추세요`)
  }
}

async function main() {
  assertSoftDeleteParity()
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const rooms = await import('@/app/(app)/rooms/actions')
  const tenants = await import('@/app/(app)/tenants/actions')
  const { RENT_REFUND_MEMO_PREFIX } = await import('@/lib/rentRefundRecord')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  let roomSeq = 100   // 호실 번호는 차례로. 무작위로 뽑으면 (영업장·호실) 유일 제약에 가끔 걸려 하네스가 흔들린다
  async function lease(pid: string, status: 'ACTIVE' | 'RESERVED' = 'ACTIVE') {
    const t = await prisma.tenant.create({ data: { name: '입주자', propertyId: pid } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: pid } })
    const l = await prisma.leaseTerm.create({
      data: { tenantId: t.id, propertyId: pid, roomId: room.id, rentAmount: 420000, dueDay: '6', moveInDate: day('2026-07-06'), status },
    })
    return { id: l.id, tenantId: t.id }
  }
  let seq = 0
  async function rec(l: { id: string; tenantId: string }, pid: string, o: { month: string; amount: number; pay: string; method?: string | null; stamp?: string | null; isDeposit?: boolean; memo?: string }) {
    const r = await prisma.paymentRecord.create({
      data: {
        leaseTermId: l.id, tenantId: l.tenantId, propertyId: pid, targetMonth: o.month,
        expectedAmount: 420000, actualAmount: o.amount, payDate: day(o.pay), payMethod: o.method === undefined ? '계좌이체' : o.method,
        seqNo: ++seq, isDeposit: !!o.isDeposit, memo: o.memo ?? null,
        cashReceiptIssuedAt: o.stamp ? new Date(kstMid(o.stamp)) : null,
      },
    })
    return r.id as string
  }
  const lines = async (leaseId: string, pay: string, method: string | null = '계좌이체') =>
    (await prisma.cashReceipt.findMany({ where: { leaseTermId: leaseId, payDate: day(pay), payMethod: method }, orderBy: { createdAt: 'asc' } }))
      .map((l: { amount: number; issuedAt: Date; deletedAt: Date | null }) => ({ amount: l.amount, issuedAt: l.issuedAt.toISOString(), deleted: !!l.deletedAt }))
  const stamp = async (id: string) => {
    const r = await prisma.paymentRecord.findFirst({ where: { id, deletedAt: undefined }, select: { cashReceiptIssuedAt: true } })
    return r?.cashReceiptIssuedAt ? r.cashReceiptIssuedAt.toISOString() : null
  }
  const alive = async (id: string) => !!(await prisma.paymentRecord.findFirst({ where: { id }, select: { id: true } }))

  g.__CR_FLOW_PID = P1
  const L1 = await lease(P1)

  // ── S1 422호 시퀀스. 분할 결제 켜기, 형제 삭제, 끄기, 다시 켜기 ──────────
  const A = await rec(L1, P1, { month: '2026-10', amount: 410000, pay: '2026-10-06' })
  const B = await rec(L1, P1, { month: '2026-11', amount: 10000, pay: '2026-10-06' })
  const r1 = await rooms.setCashReceiptIssued(A, true, '2026-10-06')
  eq('S1 켜기 ok', r1.ok, true)
  if (!r1.ok) throw new Error(r1.error)
  eq('S1 한 줄 420,000 create', [r1.change, r1.line?.amount], ['create', 420000])
  eq('S1 형제까지 키 단위 도장', [await stamp(A), await stamp(B)], [kstMid('2026-10-06'), kstMid('2026-10-06')])
  const r2 = await rooms.deletePayment(B)
  if (!r2.ok) throw new Error(r2.error)
  eq('S1 형제 삭제: 줄 유지 + 차이 알림', r2.cashReceipt, { dropped: [], mismatch: [{ payYmd: '2026-10-06', payMethod: '계좌이체', lineAmount: 420000, basis: 410000 }] })
  eq('S1 삭제 뒤 줄 그대로', await lines(L1.id, '2026-10-06'), [{ amount: 420000, issuedAt: kstMid('2026-10-06'), deleted: false }])
  const r3 = await rooms.setCashReceiptIssued(A, false)
  if (!r3.ok) throw new Error(r3.error)
  eq('S1 끄기: 내린 줄 420,000', [r3.change, r3.dropped?.amount, r3.line], ['off', 420000, null])
  eq('S1 끄기: 도장 지움', await stamp(A), null)
  const r4 = await rooms.setCashReceiptIssued(A, true, '2026-10-12')
  if (!r4.ok) throw new Error(r4.error)
  eq('S1 다시 켜기 = 새 발행 410,000 @10/12', [r4.change, r4.line?.amount, r4.line?.issuedYmd, r4.replaced], ['rebuild', 410000, '2026-10-12', { amount: 420000, issuedYmd: '2026-10-06', was: 'deleted' }])
  eq('S1 행 도장 10/12', await stamp(A), kstMid('2026-10-12'))
  const agg = await rooms.getMonthPaymentAggregates('2026-10')
  eq('S1 10월 발행 합계 410,000', [agg.cashReceiptSum, agg.cashReceiptCount], [410000, 1])

  // ── S2 적용취소 역연산. 거꾸로 되감고, 두 번은 못 한다 ─────────────────
  const u4 = await rooms.undoCashReceiptChange(J(r4.undo))
  eq('S2 다시 켜기의 적용취소', u4.ok, true)
  eq('S2 지워 둔 420,000 줄로 돌아감', await lines(L1.id, '2026-10-06'), [{ amount: 420000, issuedAt: kstMid('2026-10-06'), deleted: true }])
  eq('S2 도장 없음으로 돌아감', await stamp(A), null)
  const u3 = await rooms.undoCashReceiptChange(J(r3.undo))
  eq('S2 끄기의 적용취소로 420,000 살아남', [u3.ok, await lines(L1.id, '2026-10-06')], [true, [{ amount: 420000, issuedAt: kstMid('2026-10-06'), deleted: false }]])
  eq('S2 도장도 10/6 으로', await stamp(A), kstMid('2026-10-06'))
  const u3b = await rooms.undoCashReceiptChange(J(r3.undo))
  eq('S2 같은 적용취소 두 번은 충돌로 거부', u3b.ok, false)
  const rb = await rooms.restorePayment(B, J(r2.undo))
  eq('S2 형제 삭제의 적용취소', [rb.ok, await alive(B), await stamp(B)], [true, true, kstMid('2026-10-06')])
  const rbb = await rooms.restorePayment(B, J(r2.undo))
  eq('S2 이미 되살린 수납은 다시 못 되살린다', rbb.ok, false)

  // ── S3 마지막 이용료 삭제는 줄 내림, 적용취소는 줄까지 되살림, 그 사이 바뀌면 거부 ──
  const C = await rec(L1, P1, { month: '2026-09', amount: 350000, pay: '2026-09-30', method: '현금' })
  await rooms.setCashReceiptIssued(C, true, '2026-09-30')
  const d1 = await rooms.deletePayment(C)
  if (!d1.ok) throw new Error(d1.error)
  eq('S3 마지막 이용료 삭제는 줄도 내림(D2)', d1.cashReceipt.dropped.map(d => [d.amount, d.issuedYmd]), [[350000, '2026-09-30']])
  eq('S3 줄 내려감', (await lines(L1.id, '2026-09-30', '현금')).map(l => l.deleted), [true])
  const res1 = await rooms.restorePayment(C, J(d1.undo))
  eq('S3 삭제 적용취소가 줄까지 되살림(D5)', [res1.ok, res1.ok ? res1.cashReceipt.revived.map(v => v.amount) : null], [true, [350000]])
  eq('S3 되살린 줄 살아 있음', (await lines(L1.id, '2026-09-30', '현금')).map(l => [l.amount, l.deleted]), [[350000, false]])
  eq('S3 도장도 그대로', await stamp(C), kstMid('2026-09-30'))
  const d2 = await rooms.deletePayment(C)
  if (!d2.ok) throw new Error(d2.error)
  const Dd = await rec(L1, P1, { month: '2026-09', amount: 300000, pay: '2026-09-30', method: '현금' })
  const on2 = await rooms.setCashReceiptIssued(Dd, true, '2026-10-01')
  eq('S3 그 사이 같은 키에 새 발행 300,000', on2.ok && on2.line?.amount, 300000)
  const res2 = await rooms.restorePayment(C, J(d2.undo))
  eq('S3 그 사이 줄이 바뀌었으면 적용취소 거부', res2.ok, false)
  eq('S3 거부되면 수납도 안 되살아남(반쪽 없음)', await alive(C), false)
  eq('S3 새 발행은 그대로', (await lines(L1.id, '2026-09-30', '현금')).map(l => [l.amount, l.deleted]), [[300000, false]])

  // ── S4 수납 수정. 같은 키 재저장, 옮기기(D13), 수정의 적용취소 ────────────
  const e1 = await rooms.updatePayment(A, { actualAmount: 400000, payDate: '2026-10-06', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-06' })
  if (!e1.ok) throw new Error(e1.error)
  eq('S4 금액만 고친 재저장: 발행 금액 420,000 유지', e1.cashReceipt.line?.amount, 420000)
  eq('S4 남은 몫 410,000 과 다르다고 알림', e1.cashReceipt.mismatch, [{ payYmd: '2026-10-06', payMethod: '계좌이체', lineAmount: 420000, basis: 410000 }])
  const ue1 = await rooms.undoPaymentEdit(J(e1.undo))
  eq('S4 수정의 적용취소', [ue1.ok, (await prisma.paymentRecord.findFirst({ where: { id: A } }))?.actualAmount], [true, 410000])
  const e2 = await rooms.updatePayment(B, { actualAmount: 10000, payDate: '2026-10-07', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-06' })
  if (!e2.ok) throw new Error(e2.error)
  eq('S4 형제가 남은 키에서 옮기면 옛 줄 유지(D13)', await lines(L1.id, '2026-10-06'), [{ amount: 420000, issuedAt: kstMid('2026-10-06'), deleted: false }])
  eq('S4 옮긴 수납은 도장만 지움·새 키에 줄 안 섬', [e2.cashReceipt.unstamped, await stamp(B), (await lines(L1.id, '2026-10-07')).length], [true, null, 0])
  eq('S4 옛 키 차이 알림', e2.cashReceipt.mismatch, [{ payYmd: '2026-10-06', payMethod: '계좌이체', lineAmount: 420000, basis: 410000 }])
  // 수정 폼은 발행 금액 칸을 안 고쳤으면 아무것도 더 안 부른다(F1). 적용취소 토큰도 저장이 준 하나다.
  const ue2 = await rooms.undoPaymentEdit(J(e2.undo))
  const bAfter = await prisma.paymentRecord.findFirst({ where: { id: B } })
  eq('S4 옮기기 적용취소: 입금일·도장 복원', [ue2.ok, bAfter?.payDate.toISOString().slice(0, 10), await stamp(B)], [true, '2026-10-06', kstMid('2026-10-06')])
  // 홀로 선 수납을 옮기면 발행이 함께 간다. 손으로 넣은 금액 유지.
  const E = await rec(L1, P1, { month: '2026-08', amount: 300000, pay: '2026-08-20', method: '현금' })
  await rooms.setCashReceiptIssued(E, true, '2026-08-22')
  // 손 금액은 수정 폼이 고친 칸을 저장에 함께 싣는 길로 넣는다(F1, 같은 키 redate 에서만 쓰인다).
  const eHand = await rooms.updatePayment(E, { actualAmount: 300000, payDate: '2026-08-20', payMethod: '현금', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-08-22', cashReceiptAmount: 250000 })
  eq('S4 수정 폼 발행 금액 칸으로 손 금액 250,000', [eHand.ok, (await lines(L1.id, '2026-08-20', '현금')).map(l => l.amount)], [true, [250000]])
  const e3 = await rooms.updatePayment(E, { actualAmount: 300000, payDate: '2026-08-21', payMethod: '현금', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-08-22' })
  if (!e3.ok) throw new Error(e3.error)
  eq('S4 홀로 선 수납 이동은 transfer(250,000 유지)', [e3.cashReceipt.transferred?.amount, (await lines(L1.id, '2026-08-21', '현금')).map(l => [l.amount, l.deleted]), (await lines(L1.id, '2026-08-20', '현금')).map(l => l.deleted)], [250000, [[250000, false]], [true]])

  // ── S5 같은 키 두 번째 발행 등록(D8). 합쳐서 한 장 ───────────────────
  const F = await rec(L1, P1, { month: '2026-10', amount: 410000, pay: '2026-10-10' })
  await rooms.setCashReceiptIssued(F, true, '2026-10-10')
  const G = await rec(L1, P1, { month: '2026-11', amount: 10000, pay: '2026-10-10', stamp: '2026-10-11' })
  const s5 = await rooms.setPaymentCashReceipt({ leaseTermId: L1.id, tenantId: L1.tenantId, payDate: '2026-10-10', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-11', amount: 10000, incl: { deposit: false, cleaning: false, rent: true }, via: 'entry', recordIds: [G] })
  if (!s5.ok) throw new Error(s5.error)
  // F4: 줄 금액 + 이번 입금의 발행 금액, 앞 발행일(10/10) 유지. 폼이 고른 10/11 은 requestedYmd 로 말한다.
  eq('S5 merge: 410,000 + 10,000 = 420,000 · 앞 발행일 10/10 유지', [s5.line?.amount, s5.line?.issuedYmd, s5.merged?.prev?.amount, s5.merged?.added, s5.merged?.issuedYmd, s5.merged?.requestedYmd], [420000, '2026-10-10', 410000, 10000, '2026-10-10', '2026-10-11'])
  eq('S5 두 행 도장 10/10(한 키 한 날짜)', [await stamp(F), await stamp(G)], [kstMid('2026-10-10'), kstMid('2026-10-10')])
  const u5 = await rooms.undoCashReceiptChange(J(s5.undo))
  eq('S5 적용취소: 410,000 @10/10, 도장 원래대로', [u5.ok, await lines(L1.id, '2026-10-10'), await stamp(F), await stamp(G)],
    [true, [{ amount: 410000, issuedAt: kstMid('2026-10-10'), deleted: false }], kstMid('2026-10-10'), kstMid('2026-10-11')])

  // ── S6 일괄 발행 기록(D9). 도장을 찍고, 적용취소는 정확히 ───────────────
  const H = await rec(L1, P1, { month: '2026-10', amount: 380000, pay: '2026-10-01', method: '현금' })
  await rec(L1, P1, { month: '2026-10', amount: 50000, pay: '2026-10-02', method: '현금', isDeposit: true })
  const b1 = await rooms.batchSetCashReceipts({ items: [
    { leaseTermId: L1.id, tenantId: L1.tenantId, payYmd: '2026-10-01', payMethod: '현금' },
    { leaseTermId: L1.id, tenantId: L1.tenantId, payYmd: '2026-10-02', payMethod: '현금' },
  ], issuedDate: '2026-10-03' })
  if (!b1.ok) throw new Error(b1.error)
  eq('S6 이용료 있는 입금만 기록', [b1.done, b1.skipped], [1, 1])
  eq('S6 도장도 찍힘(D9)', await stamp(H), kstMid('2026-10-03'))
  const ub = await rooms.undoCashReceiptChange(J(b1.undo))
  eq('S6 적용취소: 줄 내림·도장 지움', [ub.ok, (await lines(L1.id, '2026-10-01', '현금')).map(l => l.deleted), await stamp(H)], [true, [true], null])

  // ── S7 분해·과납 수납 적용취소(D10). 유령 줄을 안 남긴다 ─────────────────
  const I = await rec(L1, P1, { month: '2026-10', amount: 300000, pay: '2026-10-08', method: '현금', stamp: '2026-10-08' })
  const s7 = await rooms.setPaymentCashReceipt({ leaseTermId: L1.id, tenantId: L1.tenantId, payDate: '2026-10-08', payMethod: '현금', issued: true, issuedDate: '2026-10-08', amount: 300000, via: 'entry', recordIds: [I] })
  if (!s7.ok) throw new Error(s7.error)
  const o1 = await rooms.undoOverpayExtraIncome([I], undefined, J(s7.undo))
  eq('S7 등록 스냅샷으로 되돌리면 줄도 내림', [o1.ok, (await lines(L1.id, '2026-10-08', '현금')).map(l => l.deleted), await alive(I)], [true, [true], false])
  const K = await rec(L1, P1, { month: '2026-10', amount: 300000, pay: '2026-10-09', method: '현금', stamp: '2026-10-09' })
  await rooms.setPaymentCashReceipt({ leaseTermId: L1.id, tenantId: L1.tenantId, payDate: '2026-10-09', payMethod: '현금', issued: true, issuedDate: '2026-10-09', via: 'entry', recordIds: [K] })
  const o2 = await rooms.undoOverpayExtraIncome([K])
  eq('S7 스냅샷 없이도 키가 비면 줄 내리고 알림', [o2.ok, o2.ok ? o2.cashReceipt.dropped.map(d => d.amount) : null, (await lines(L1.id, '2026-10-09', '현금')).map(l => l.deleted)], [true, [300000], [true]])

  // ── S8 예약 선납 취소(D10)와 그 적용취소 ───────────────────────────
  const L3 = await lease(P1, 'RESERVED')
  const M = await rec(L3, P1, { month: '2026-10', amount: 350000, pay: '2026-09-28' })
  await rooms.setCashReceiptIssued(M, true, '2026-09-28')
  const c1 = await tenants.recordReservationPrepaidCancel({ leaseTermId: L3.id, tenantId: L3.tenantId, refundAmount: 350000, date: '2026-10-01', tenantName: '입주자' })
  if (!c1.ok) throw new Error(c1.error)
  eq('S8 선납 취소가 줄을 내림(유령 줄 금지)', [c1.cashReceipt.dropped.map(d => d.amount), (await lines(L3.id, '2026-09-28')).map(l => l.deleted)], [[350000], [true]])
  const c2 = await tenants.undoReservationPrepaidCancel(c1.recordIds, c1.extraIncomeId, c1.cleaningIncomeIds, J(c1.crUndo))
  eq('S8 적용취소가 수납과 줄을 함께 되살림', [c2.ok, await alive(M), (await lines(L3.id, '2026-09-28')).map(l => [l.amount, l.deleted]), await stamp(M)], [true, true, [[350000, false]], kstMid('2026-09-28')])

  // ── S9 환불 확정 record 켜기(D4). 확정액으로 다시 선다 ─────────────────
  const L4 = await lease(P1)
  const N0 = await rec(L4, P1, { month: '2026-07', amount: 470000, pay: '2026-07-18', method: '계좌이체' })
  await rooms.setCashReceiptIssued(N0, true, '2026-07-18')
  await prisma.paymentRecord.update({ where: { id: N0 }, data: { deletedAt: new Date() } })
  const N1 = await rec(L4, P1, { month: '2026-07', amount: 200000, pay: '2026-07-18', memo: `${RENT_REFUND_MEMO_PREFIX} 하네스` })
  // 확인 줄은 누르기 전에 살아 있는 앞 발행을 바꾼다고 말하고(독립 검수 R-5), 토스트도 그 사실을 말한다.
  const pv9 = await rooms.previewCashReceiptOn(N1)
  eq('S9 확인 줄: 재발행이 앞 발행 470,000(7/18)을 바꾼다', pv9.ok && pv9.current ? [pv9.kind, pv9.amount, (await import('@/lib/cashReceiptCopy')).crReplacePreview(pv9.current)] : pv9,
    ['rebuild', 200000, '기존 발행 470,000원(7/18)을 이 금액으로 바꿉니다.'])
  const r9 = await rooms.setCashReceiptIssued(N1, true, '2026-10-13')
  eq('S9 환불 대기 키에서 켜면 확정액 200,000', r9.ok ? [r9.change, r9.line?.amount, r9.replaced?.amount, r9.replaced?.was] : r9, ['rebuild', 200000, 470000, 'live'])
  eq('S9 재발행 토스트가 바꾼 앞 발행을 말한다', r9.ok ? (await import('@/lib/cashReceiptCopy')).crOnToast(r9, '2026-10-13').detail : r9, '기존 발행 470,000원(7/18)을 이 금액으로 바꿨습니다.')
  // 환불 적용취소. 원 수납이 되살아나고 확정액 record 는 지워진다. 원 수납의 옛 도장(7/18)은 지금
  // 줄(재발행 10/13)에 맞춰지고, 줄 금액은 안 덮인 채 차이가 알려진다.
  await prisma.leaseTerm.update({ where: { id: L4.id }, data: { checkoutProrationUndo: { refund: { at: new Date().toISOString(), month: '2026-07', refunded: 270000, prepaid: 470000, newRecordId: N1, deletedRecordIds: [N0], prevProration: { amount: null, month: null } } } } })
  const u9 = await tenants.undoRentRefund(L4.id)
  eq('S9 환불 적용취소: 원 수납 도장이 지금 줄 발행일로', [u9.ok, await alive(N0), await alive(N1), await stamp(N0)], [true, true, false, kstMid('2026-10-13')])
  eq('S9 환불 적용취소: 줄 금액 200,000 유지 + 차이 알림', [(await lines(L4.id, '2026-07-18')).map(l => [l.amount, l.deleted]), u9.ok ? u9.cashReceipt?.mismatch.map(m => [m.lineAmount, m.basis]) : null], [[[200000, false]], [[200000, 470000]]])

  // ── S10 멀티테넌트. 다른 영업장으로는 아무것도 못 바꾼다 ────────────────
  const before10 = await lines(L1.id, '2026-10-06')
  g.__CR_FLOW_PID = P2
  eq('S10 남의 수납 토글 거부', (await rooms.setCashReceiptIssued(A, false)).ok, false)
  eq('S10 남의 계약 발행 기록 거부', (await rooms.setPaymentCashReceipt({ leaseTermId: L1.id, tenantId: L1.tenantId, payDate: '2026-10-06', payMethod: '계좌이체', issued: false, via: 'edit' })).ok, false)
  eq('S10 남의 수납 삭제 거부', (await rooms.deletePayment(A)).ok, false)
  const bx = await rooms.batchSetCashReceipts({ items: [{ leaseTermId: L1.id, tenantId: L1.tenantId, payYmd: '2026-10-01', payMethod: '현금' }], issuedDate: '2026-10-03' })
  eq('S10 남의 계약 일괄 기록은 건너뜀', bx.ok ? [bx.done, bx.skipped] : bx, [0, 1])
  eq('S10 남의 스냅샷으로 적용취소 거부', (await rooms.undoCashReceiptChange(J(r1.undo))).ok, false)
  g.__CR_FLOW_PID = P1
  eq('S10 P1 줄은 그대로', await lines(L1.id, '2026-10-06'), before10)
  eq('S10 P1 미발행 입금(10/1)은 여전히 지워 둔 줄', (await lines(L1.id, '2026-10-01', '현금')).map(l => l.deleted), [true])

  // ── S11 화면이 쓸 값 ────────────────────────────────────────
  const pl = await rooms.getPaymentsByLease(L1.id, '2026-10')
  const rowA = pl.records.find((r: { id: string }) => r.id === A)
  eq('S11 행마다 키 정보(줄·받은 몫·행 수)', rowA?.cashReceiptKey ? [rowA.cashReceiptKey.line?.amount, rowA.cashReceiptKey.rent, rowA.cashReceiptKey.rentRows, rowA.cashReceiptKey.stampedRentRows] : null, [420000, 420000, 2, 2])
  const pv = await rooms.previewCashReceiptOn(H)
  eq('S11 켜기 미리보기: 지워 둔 줄 자리에 380,000', pv.ok ? [pv.kind, pv.amount, pv.deleted?.amount, pv.current] : pv, ['rebuild', 380000, 380000, null])
  const pd = await rooms.previewPaymentDelete(B)
  eq('S11 삭제 미리보기: 줄 남음, 남는 몫 410,000', pd.ok ? [pd.effect, pd.line?.amount, pd.basisAfter] : pd, ['keep', 420000, 410000])
  const pd2 = await rooms.previewPaymentDelete(F)
  eq('S11 삭제 미리보기: 형제 G 가 남아 keep', pd2.ok ? pd2.effect : pd2, 'keep')
  const tab = await rooms.getCashReceiptTabRows('2026-10')
  const t422 = tab.issued.find((r: { payYmd: string }) => r.payYmd === '2026-10-06')
  eq('S11 탭 발행 내역에 받은 몫', t422 ? [t422.amount, t422.received, t422.rentRows] : null, [420000, 420000, 2])
  const b9 = await rooms.batchDeletePayments([F])
  eq('S11 일괄 수납 적용취소도 줄 규칙을 지난다', b9.ok ? [b9.deleted, b9.cashReceipt.dropped.length, b9.cashReceipt.mismatch.map(m => [m.lineAmount, m.basis])] : b9, [1, 0, [[410000, 10000]]])

  // ── S12 적용취소 값 위조 거부 · null 수단을 '' 로 다시 저장하면 키가 옮겨 간 것 ─────
  const e5 = await rooms.updatePayment(A, { actualAmount: 405000, payDate: '2026-10-06', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-06' })
  if (!e5.ok) throw new Error(e5.error)
  const forged = J(e5.undo); forged.before.actualAmount = 9_999_999
  eq('S12 위조한 적용취소 값(임대료 초과)은 거부', (await rooms.undoPaymentEdit(forged)).ok, false)
  const forged2 = J(e5.undo); (forged2.before as { payYmd: string }).payYmd = '10/6'
  eq('S12 모양이 틀린 적용취소 값은 거부', (await rooms.undoPaymentEdit(forged2)).ok, false)
  eq('S12 진짜 적용취소는 통과', [(await rooms.undoPaymentEdit(J(e5.undo))).ok, (await prisma.paymentRecord.findFirst({ where: { id: A } }))?.actualAmount], [true, 410000])
  const Q = await rec(L1, P1, { month: '2026-10', amount: 330000, pay: '2026-10-04', method: null })
  await rooms.setCashReceiptIssued(Q, true, '2026-10-04')
  const e6 = await rooms.updatePayment(Q, { actualAmount: 330000, payDate: '2026-10-04', payMethod: '', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-04' })
  eq("S12 null 수단을 '' 로 저장하면 발행이 새 키로 함께 옮겨 감(유령 줄 없음)",
    [e6.ok && e6.cashReceipt.transferred?.amount, (await lines(L1.id, '2026-10-04', null)).map(l => l.deleted), (await lines(L1.id, '2026-10-04', '')).map(l => [l.amount, l.deleted])],
    [330000, [true], [[330000, false]]])

  // ── S13 수정 폼 화면 순서 그대로(독립 검수 F1·W8). 입금일 이동으로 합친 결과를 덮지 않는다 ────────
  {
    const L = await lease(P1)
    const X = await rec(L, P1, { month: '2026-10', amount: 300000, pay: '2026-10-06' })
    await rooms.setCashReceiptIssued(X, true, '2026-10-06')
    const Y = await rec(L, P1, { month: '2026-11', amount: 400000, pay: '2026-10-07' })
    await rooms.setCashReceiptIssued(Y, true, '2026-10-07')
    // 화면: 입금일만 10/6 으로 고침. 발행 금액 칸(프리필 400,000)은 안 건드렸으니 싣지 않는다.
    const e = await rooms.updatePayment(Y, { actualAmount: 400000, payDate: '2026-10-06', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-07' })
    if (!e.ok) throw new Error(e.error)
    eq('S13 merge 700,000 · 앞 발행일 10/6 유지', [e.cashReceipt.merged, await lines(L.id, '2026-10-06')], [{ prevAmount: 300000, amount: 700000 }, [{ amount: 700000, issuedAt: kstMid('2026-10-06'), deleted: false }]])
    eq('S13 옛 키 줄 내려감 · 두 행 도장 10/6', [(await lines(L.id, '2026-10-07')).map(l => l.deleted), await stamp(X), await stamp(Y)], [[true], kstMid('2026-10-06'), kstMid('2026-10-06')])
    const u = await rooms.undoPaymentEdit(J(e.undo))
    const yAfter = await prisma.paymentRecord.findFirst({ where: { id: Y } })
    eq('S13 토큰 하나로 적용취소: 두 줄·입금일·도장 복원',
      [u.ok, await lines(L.id, '2026-10-06'), await lines(L.id, '2026-10-07'), yAfter?.payDate.toISOString().slice(0, 10), await stamp(Y)],
      [true, [{ amount: 300000, issuedAt: kstMid('2026-10-06'), deleted: false }], [{ amount: 400000, issuedAt: kstMid('2026-10-07'), deleted: false }], '2026-10-07', kstMid('2026-10-07')])
    // R2 클래스: 형제가 남은 키에서 옮겨 도장만 지운 경우 새 키의 무관한 줄을 안 덮는다.
    const L2 = await lease(P1)
    const A2 = await rec(L2, P1, { month: '2026-10', amount: 410000, pay: '2026-10-06' })
    const B2 = await rec(L2, P1, { month: '2026-11', amount: 10000, pay: '2026-10-06' })
    await rooms.setCashReceiptIssued(A2, true, '2026-10-06')
    const C2 = await rec(L2, P1, { month: '2026-12', amount: 300000, pay: '2026-10-08' })
    await rooms.setCashReceiptIssued(C2, true, '2026-10-08')
    const e2 = await rooms.updatePayment(B2, { actualAmount: 10000, payDate: '2026-10-08', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-06' })
    eq('S13 옮겨 도장만 지움 · 새 키 줄 300,000 @10/8 그대로 · C 도장 그대로',
      [e2.ok && e2.cashReceipt.unstamped, await lines(L2.id, '2026-10-08'), await stamp(C2), await stamp(B2)],
      [true, [{ amount: 300000, issuedAt: kstMid('2026-10-08'), deleted: false }], kstMid('2026-10-08'), null])
  }

  // ── S14 살아 있는 줄 위의 새 돈은 더하기만(독립 검수 F4, 국세청에 올라간 금액·발행일을 자동으로 안 덮는다) ──
  {
    // T7 토글: 손 금액 350,000 @9/30 줄이 있는 키에 도장 없는 20,000 을 켠다.
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-09', amount: 400000, pay: '2026-09-30' })
    await rooms.setCashReceiptIssued(A, true, '2026-09-30')
    const hand = await rooms.updatePayment(A, { actualAmount: 400000, payDate: '2026-09-30', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-09-30', cashReceiptAmount: 350000 })
    eq('S14 손 금액 350,000 기록', [hand.ok, (await lines(L.id, '2026-09-30')).map(l => l.amount)], [true, [350000]])
    const B = await rec(L, P1, { month: '2026-10', amount: 20000, pay: '2026-09-30' })
    const sep0 = (await rooms.getMonthPaymentAggregates('2026-09')).cashReceiptSum
    const oct0 = (await rooms.getMonthPaymentAggregates('2026-10')).cashReceiptSum
    const pv = await rooms.previewCashReceiptOn(B)
    eq('S14 켜기 미리보기도 add 370,000(더할 새 돈 20,000)', pv.ok ? [pv.kind, pv.amount, pv.added] : pv, ['add', 370000, 20000])
    const t = await rooms.setCashReceiptIssued(B, true, '2026-10-02')
    eq('S14 T7 add: 350,000 + 20,000 = 370,000 · 앞 발행일 9/30 유지',
      t.ok ? [t.change, t.line?.amount, t.line?.issuedYmd, t.added] : t,
      ['add', 370000, '2026-09-30', { prevAmount: 350000, added: 20000, amount: 370000, issuedYmd: '2026-09-30', requestedYmd: '2026-10-02' }])
    eq('S14 T7 9월 합계만 20,000 늘고 10월은 그대로',
      [(await rooms.getMonthPaymentAggregates('2026-09')).cashReceiptSum - sep0, (await rooms.getMonthPaymentAggregates('2026-10')).cashReceiptSum - oct0], [20000, 0])
    eq('S14 T7 두 행 도장 9/30', [await stamp(A), await stamp(B)], [kstMid('2026-09-30'), kstMid('2026-09-30')])
    const tu = t.ok ? await rooms.undoCashReceiptChange(J(t.undo)) : null
    eq('S14 T7 적용취소: 350,000 · B 도장 없음', [tu?.ok, (await lines(L.id, '2026-09-30')).map(l => l.amount), await stamp(B)], [true, [350000], null])

    // D8 등록 merge: 같은 키 손 금액 줄(350,000)에 '발행함'으로 20,000 을 더 받음(폼 금액 20,000).
    const L2 = await lease(P1)
    const A2 = await rec(L2, P1, { month: '2026-09', amount: 400000, pay: '2026-09-29' })
    await rooms.setCashReceiptIssued(A2, true, '2026-09-29')
    await rooms.updatePayment(A2, { actualAmount: 400000, payDate: '2026-09-29', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-09-29', cashReceiptAmount: 350000 })
    const C2 = await rec(L2, P1, { month: '2026-10', amount: 20000, pay: '2026-09-29', stamp: '2026-10-01' })
    const m = await rooms.setPaymentCashReceipt({ leaseTermId: L2.id, tenantId: L2.tenantId, payDate: '2026-09-29', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-01', amount: 20000, incl: { deposit: false, cleaning: false, rent: true }, via: 'entry', recordIds: [C2] })
    eq('S14 D8 merge: 350,000 + 20,000 = 370,000 @9/29',
      m.ok ? [m.line?.amount, m.line?.issuedYmd, m.merged?.prev.amount, m.merged?.added, m.merged?.requestedYmd] : m, [370000, '2026-09-29', 350000, 20000, '2026-10-01'])
    eq('S14 D8 새 입금 도장도 앞 발행일로', await stamp(C2), kstMid('2026-09-29'))
    // 금액을 안 보내는 등록 경로(입주자 상세·예약 선납)는 이번 저장의 record 로 센 이용료 몫을 더한다.
    const D2 = await rec(L2, P1, { month: '2026-11', amount: 30000, pay: '2026-09-29', stamp: '2026-10-01' })
    const m2 = await rooms.setPaymentCashReceipt({ leaseTermId: L2.id, tenantId: L2.tenantId, payDate: '2026-09-29', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-01', via: 'entry', recordIds: [D2] })
    eq('S14 D8 금액 없는 merge 는 이번 record 몫 30,000 을 더한다', m2.ok ? [m2.line?.amount, m2.merged?.added] : m2, [400000, 30000])
    const mu = m2.ok ? await rooms.undoCashReceiptChange(J(m2.undo)) : null
    eq('S14 D8 merge 적용취소: 370,000 으로', [mu?.ok, (await lines(L2.id, '2026-09-29')).map(l => l.amount)], [true, [370000]])

    // R4b: 줄 없는 키에 발행 없이 받은 앞 입금(300,000)이 있고 뒤 입금(100,000)만 발행함.
    const L3 = await lease(P1)
    const X3 = await rec(L3, P1, { month: '2026-09', amount: 300000, pay: '2026-09-28' })
    const Y3 = await rec(L3, P1, { month: '2026-10', amount: 100000, pay: '2026-09-28', stamp: '2026-09-28' })
    const r = await rooms.setPaymentCashReceipt({ leaseTermId: L3.id, tenantId: L3.tenantId, payDate: '2026-09-28', payMethod: '계좌이체', issued: true, issuedDate: '2026-09-28', amount: 100000, incl: { deposit: false, cleaning: false, rent: true }, via: 'entry', recordIds: [Y3] })
    eq('S14 R4b 이번 몫 100,000 만 · 앞 입금 도장 그대로 없음 · 안 덮인 돈 300,000',
      r.ok ? [r.line?.amount, r.merged, r.uncovered, await stamp(X3), await stamp(Y3)] : r, [100000, undefined, 300000, null, kstMid('2026-09-28')])
    // 그 앞 입금을 나중에 켜면 더한다(add). 이번에는 줄이 살아 있다.
    const r2 = await rooms.setCashReceiptIssued(X3, true, '2026-10-05')
    eq('S14 R4b 앞 입금을 나중에 켜면 add 400,000 @9/28', r2.ok ? [r2.change, r2.line?.amount, r2.line?.issuedYmd] : r2, ['add', 400000, '2026-09-28'])
  }

  // ── S15 되살린 도장 정렬(W1) · 옮긴 발행의 도장 범위(W2) · 0원 행(W3) ─────────────────
  {
    // R6: 형제 삭제(keep) 뒤 끄고 나서 삭제를 적용취소하면 되살린 수납에 옛 도장이 남으면 안 된다.
    const L = await lease(P1)
    const A6 = await rec(L, P1, { month: '2026-10', amount: 410000, pay: '2026-10-12' })
    const B6 = await rec(L, P1, { month: '2026-11', amount: 10000, pay: '2026-10-12' })
    await rooms.setCashReceiptIssued(A6, true, '2026-10-12')
    const d = await rooms.deletePayment(B6)
    if (!d.ok) throw new Error(d.error)
    await rooms.setCashReceiptIssued(A6, false)
    const r = await rooms.restorePayment(B6, J(d.undo))
    eq('S15 W1 줄이 꺼진 뒤 되살린 수납은 도장 없음(유령 도장 금지)', [r.ok, await stamp(A6), await stamp(B6), r.ok ? r.cashReceipt.mismatch : null], [true, null, null, []])
    // 그 사이 다시 켰으면(새 발행 410,000 @10/14) 되살린 수납의 도장은 지금 줄 날짜로, 금액 차이는 알린다.
    const d2 = await rooms.deletePayment(B6)
    if (!d2.ok) throw new Error(d2.error)
    await rooms.setCashReceiptIssued(A6, true, '2026-10-14')
    await prisma.paymentRecord.updateMany({ where: { id: B6 }, data: { cashReceiptIssuedAt: new Date(kstMid('2026-10-12')) } })   // 지울 때 들고 있던 옛 도장
    const r2 = await rooms.restorePayment(B6, J(d2.undo))
    eq('S15 W1 다시 켠 뒤 되살리면 도장 10/14 · 금액은 안 덮고 차이 알림',
      [r2.ok, await stamp(B6), (await lines(L.id, '2026-10-12')).map(l => [l.amount, l.deleted]), r2.ok ? r2.cashReceipt.mismatch : null],
      [true, kstMid('2026-10-14'), [[410000, false]], [{ payYmd: '2026-10-12', payMethod: '계좌이체', lineAmount: 410000, basis: 420000 }]])

    // R5: 홀로 선 수납을 옮겨 발행이 따라가도 새 키의 무관한 미발행 행에는 도장을 찍지 않는다.
    const L5 = await lease(P1)
    const A5 = await rec(L5, P1, { month: '2026-10', amount: 300000, pay: '2026-10-10' })
    await rooms.setCashReceiptIssued(A5, true, '2026-10-10')
    const C5 = await rec(L5, P1, { month: '2026-11', amount: 200000, pay: '2026-10-11' })
    const e5 = await rooms.updatePayment(A5, { actualAmount: 300000, payDate: '2026-10-11', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-10' })
    eq('S15 W2 transfer 300,000 · 옮긴 수납만 도장 · 무관한 C 는 그대로 미발행',
      [e5.ok && e5.cashReceipt.transferred?.amount, await stamp(A5), await stamp(C5)], [300000, kstMid('2026-10-10'), null])

    // R11: 0원 흔적 행은 켤 수 없다. 앞 발행일도, 달 합계도 안 움직인다.
    const L11 = await lease(P1)
    const A11 = await rec(L11, P1, { month: '2026-09', amount: 400000, pay: '2026-09-25' })
    await rooms.setCashReceiptIssued(A11, true, '2026-09-25')
    const Z11 = await rec(L11, P1, { month: '2026-10', amount: 0, pay: '2026-09-25' })
    const sep = (await rooms.getMonthPaymentAggregates('2026-09')).cashReceiptSum
    const z = await rooms.setCashReceiptIssued(Z11, true, '2026-10-03')
    eq('S15 W3 0원 행 켜기는 거부 · 9월 합계·줄 발행일 그대로',
      [z.ok, (await rooms.getMonthPaymentAggregates('2026-09')).cashReceiptSum - sep, (await lines(L11.id, '2026-09-25')).map(l => l.issuedAt), await stamp(Z11)],
      [false, 0, [kstMid('2026-09-25')], null])
  }

  // ── S16 적용취소 토큰 위조(검수 W4·R8). 같은 영업장 안에서 지어낸 금액·도장·범위 밖 record ─────────
  {
    const L = await lease(P1)
    const A8 = await rec(L, P1, { month: '2026-10', amount: 300000, pay: '2026-10-01' })
    const other = await rec(L, P1, { month: '2026-10', amount: 50000, pay: '2026-10-02', stamp: '2026-10-02' })
    const on = await rooms.setCashReceiptIssued(A8, true, '2026-10-01')
    if (!on.ok) throw new Error(on.error)
    const real = J(on.undo)
    eq('S16 서버가 만든 토큰은 서명이 붙는다', typeof real.sig, 'string')
    const forged = J(real); forged.lines[0].after = { ...forged.lines[0].after, amount: 9_990_000 }
    const forged2 = J(real); forged2.stamps = [{ id: A8, before: '2099-01-01T00:00:00.000Z', after: real.stamps[0]?.after ?? null }]
    const forged3 = J(real); forged3.stamps = [...forged3.stamps, { id: other, before: null, after: kstMid('2026-10-02') }]
    const unsigned = J(real); delete unsigned.sig
    eq('S16 금액을 지어낸 토큰 거부', (await rooms.undoCashReceiptChange(forged)).ok, false)
    eq('S16 미래 도장을 지어낸 토큰 거부', (await rooms.undoCashReceiptChange(forged2)).ok, false)
    eq('S16 키 밖 record 도장을 끼운 토큰 거부', (await rooms.undoCashReceiptChange(forged3)).ok, false)
    eq('S16 서명을 뗀 토큰 거부', (await rooms.undoCashReceiptChange(unsigned)).ok, false)
    g.__CR_FLOW_PID = P2
    eq('S16 다른 영업장에서 같은 토큰 거부', (await rooms.undoCashReceiptChange(real)).ok, false)
    g.__CR_FLOW_PID = P1
    eq('S16 위조가 다 막힌 뒤 줄·도장 그대로', [await lines(L.id, '2026-10-01'), await stamp(A8), await stamp(other)],
      [[{ amount: 300000, issuedAt: kstMid('2026-10-01'), deleted: false }], kstMid('2026-10-01'), kstMid('2026-10-02')])
    eq('S16 진짜 토큰은 통과', (await rooms.undoCashReceiptChange(real)).ok, true)
    // 수정 저장 토큰. 되돌릴 칸(금액)을 임대료 안에서 지어내도 서명에서 떨어진다.
    const e = await rooms.updatePayment(A8, { actualAmount: 290000, payDate: '2026-10-01', payMethod: '계좌이체', memo: 'x' })
    if (!e.ok) throw new Error(e.error)
    const fe = J(e.undo); fe.before.actualAmount = 1000
    eq('S16 수정 저장 토큰의 되돌릴 금액을 지어내면 거부', (await rooms.undoPaymentEdit(fe)).ok, false)
    eq('S16 진짜 수정 저장 토큰은 통과', [(await rooms.undoPaymentEdit(J(e.undo))).ok, (await prisma.paymentRecord.findFirst({ where: { id: A8 } }))?.actualAmount], [true, 300000])
    // 서명 키가 없는 환경. 서명 없이 돌지만 구조 검사(미래 도장·키 밖 record)는 그대로 막는다.
    const keep = process.env.STAYEUM_PII_KEY
    delete process.env.STAYEUM_PII_KEY
    const on2 = await rooms.setCashReceiptIssued(A8, true, '2026-10-01')
    if (!on2.ok) throw new Error(on2.error)
    const nk = J(on2.undo)
    eq('S16 키 없는 환경의 토큰은 서명 없음', nk.sig, undefined)
    const nk2 = J(nk); nk2.stamps = [{ id: A8, before: '2099-01-01T00:00:00.000Z', after: nk.stamps[0]?.after ?? null }]
    const nk3 = J(nk); nk3.stamps = [...nk3.stamps, { id: other, before: null, after: kstMid('2026-10-02') }]
    eq('S16 키 없어도 미래 도장 거부', (await rooms.undoCashReceiptChange(nk2)).ok, false)
    eq('S16 키 없어도 키 밖 record 거부', (await rooms.undoCashReceiptChange(nk3)).ok, false)
    eq('S16 키 없는 환경의 진짜 토큰은 통과', (await rooms.undoCashReceiptChange(nk)).ok, true)
    process.env.STAYEUM_PII_KEY = keep
  }

  // ── S17 수정 폼으로 켜도 새 돈만 더한다(F4, 수정 경로) · 한 트랜잭션 저장의 적용취소(W5) ─────────
  {
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-10', amount: 300000, pay: '2026-10-03' })
    await rooms.setCashReceiptIssued(A, true, '2026-10-03')
    const B = await rec(L, P1, { month: '2026-11', amount: 50000, pay: '2026-10-03' })
    const e = await rooms.updatePayment(B, { actualAmount: 50000, payDate: '2026-10-03', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-09' })
    eq('S17 수정 폼 켜기: 300,000 + 50,000 · 앞 발행일 10/3 유지',
      e.ok ? [e.cashReceipt.added, e.cashReceipt.line?.amount, await stamp(B)] : e,
      [{ prevAmount: 300000, added: 50000, amount: 350000, issuedYmd: '2026-10-03', requestedYmd: '2026-10-09' }, 350000, kstMid('2026-10-03')])
    const u = e.ok ? await rooms.undoPaymentEdit(J(e.undo)) : null
    eq('S17 적용취소: 300,000 · B 도장 없음', [u?.ok, (await lines(L.id, '2026-10-03')).map(l => l.amount), await stamp(B)], [true, [300000], null])
  }

  // ── S18 적용취소가 되살린 금액이 지금 몫과 다르면 말한다 · 일괄 기록 적용취소가 막힌 까닭(선택 11) ─────
  {
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-10', amount: 410000, pay: '2026-10-04' })
    const B = await rec(L, P1, { month: '2026-11', amount: 10000, pay: '2026-10-04' })
    await rooms.setCashReceiptIssued(A, true, '2026-10-04')
    const off = await rooms.setCashReceiptIssued(A, false)
    if (!off.ok) throw new Error(off.error)
    await rooms.deletePayment(B)
    const u = await rooms.undoCashReceiptChange(J(off.undo))
    eq('S18 끄기 적용취소는 420,000 그대로 되살리고 지금 몫 410,000 과 다르다고 말한다',
      u.ok ? [u.line?.amount, u.mismatch] : u, [420000, [{ payYmd: '2026-10-04', payMethod: '계좌이체', lineAmount: 420000, basis: 410000 }]])
    // 일괄 기록 두 키 중 하나가 그 사이 바뀌면 전체를 안 되돌리고 그 까닭을 말한다.
    const L2 = await lease(P1)
    const X = await rec(L2, P1, { month: '2026-10', amount: 300000, pay: '2026-10-05', method: '현금' })
    await rec(L2, P1, { month: '2026-10', amount: 200000, pay: '2026-10-07', method: '현금' })
    const b = await rooms.batchSetCashReceipts({ items: [
      { leaseTermId: L2.id, tenantId: L2.tenantId, payYmd: '2026-10-05', payMethod: '현금' },
      { leaseTermId: L2.id, tenantId: L2.tenantId, payYmd: '2026-10-07', payMethod: '현금' },
    ], issuedDate: '2026-10-08' })
    if (!b.ok) throw new Error(b.error)
    await rooms.setCashReceiptIssued(X, false)
    const bu = await rooms.undoCashReceiptChange(J(b.undo))
    eq('S18 일괄 기록 적용취소는 한 키가 바뀌면 전체를 안 되돌리고 그 까닭을 말한다',
      [bu.ok, bu.ok ? null : bu.error.includes('일괄 기록 전체'), (await lines(L2.id, '2026-10-07', '현금')).map(l => l.deleted)], [false, true, [false]])
  }

  // ── S19 2단계 화면이 쓰는 반환 값을 화면 문장 정본(lib/cashReceiptCopy)에 그대로 넣는다 ─────────────
  //
  // 화면은 서버가 돌려준 값을 문장 함수에 넣어 그린다. 그 이음매가 갈리면(행 캡션이 키 대신 행 금액을 보거나,
  // keep 을 성공으로 말하거나) 판정이 맞아도 422호처럼 화면이 거짓을 말한다. 화면 호출 순서 그대로 돌린다.
  {
    const copy = await import('@/lib/cashReceiptCopy')
    type Row = { id: string; cashReceiptIssuedAt: Date | null; cashReceiptKey: { line: { amount: number; issuedYmd: string; inclDeposit: boolean; inclCleaning: boolean; inclRent: boolean } | null; rent: number; rentRows: number; stampedRentRows: number; unstampedRent: number } | null }
    const rowOf = async (leaseId: string, id: string) => {
      const pl = await rooms.getPaymentsByLease(leaseId, '2026-10')
      return (pl.windowRecords as Row[]).find(r => r.id === id) ?? (pl.records as Row[]).find(r => r.id === id) ?? null
    }
    const capOf = async (leaseId: string, id: string) => {
      const r = await rowOf(leaseId, id)
      const c = r ? copy.cashReceiptRowCaption({ stamped: !!r.cashReceiptIssuedAt, key: r.cashReceiptKey }) : null
      return c ? [c.tone, copy.crCaptionText(c)] : null
    }
    // 422호 순서. 분할 결제 켜기, 형제 삭제, 끄기, 다시 켜기.
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-10', amount: 410000, pay: '2026-10-02' })
    const B = await rec(L, P1, { month: '2026-11', amount: 10000, pay: '2026-10-02' })
    const pv0 = await rooms.previewCashReceiptOn(A)
    eq('S19 켜기 확인 줄 금액: 키 합 420,000(create)', pv0.ok ? [pv0.kind, pv0.amount] : pv0, ['create', 420000])
    const on1 = await rooms.setCashReceiptIssued(A, true, '2026-10-02')
    if (!on1.ok) throw new Error(on1.error)
    eq('S19 켜기 토스트는 기록된 줄의 발행일·금액', copy.crOnToast(on1, '2026-10-02').message, '현금영수증 발행 기록됨 · 발행일 10/2 · 420,000원')
    eq('S19 같고 합산이면 두 행 모두 보조색 합산 캡션', [await capOf(L.id, A), await capOf(L.id, B)],
      [['muted', '발행 금액 420,000원 · 같은 날 입금 2건 합산'], ['muted', '발행 금액 420,000원 · 같은 날 입금 2건 합산']])
    const pdB = await rooms.previewPaymentDelete(B)
    eq('S19 형제 삭제 확인창: 발행은 남고 금액 확인을 요청', pdB.ok ? copy.crDeleteConfirmLine(pdB) : pdB,
      '같은 날 입금과 묶인 현금영수증 발행 기록 420,000원은 그대로 남습니다. 삭제 뒤 발행 금액을 확인해 주세요.')
    const dB = await rooms.deletePayment(B)
    if (!dB.ok) throw new Error(dB.error)
    eq('S19 삭제 토스트: 남은 수납의 발행은 그대로', copy.crDeleteToastDetail(dB.cashReceipt), '남은 수납의 현금영수증 발행 기록 420,000원은 그대로입니다.')
    eq('S19 행 캡션: 기준은 키 합이라 받은 금액보다 10,000원 많음(422호가 못 본 사실)', await capOf(L.id, A), ['warning', '발행 금액 420,000원 · 받은 금액보다 10,000원 많음'])
    const tab = await rooms.getCashReceiptTabRows('2026-10')
    const tr = tab.issued.find((r: { payYmd: string; amount: number }) => r.payYmd === '2026-10-02' && r.amount === 420000)
    eq('S19 탭 행: 받은 금액을 숫자로', tr ? copy.cashReceiptTabGap(tr)?.text : null, '받은 금액 410,000원보다 10,000원 많음')
    const rA = await rowOf(L.id, A)
    const off = await rooms.setCashReceiptIssued(A, false)
    if (!off.ok) throw new Error(off.error)
    eq('S19 끄기 토스트: 발행월 합계에서 빠지는 금액', copy.crOffToastDetail(off.dropped, rA?.cashReceiptKey?.stampedRentRows ?? 1),
      '10월 발행 합계에서 420,000원이 빠집니다. 홈택스에 발행한 영수증은 그대로입니다.')
    const uOff = await rooms.undoCashReceiptChange(J(off.undo))
    eq('S19 끄기 적용취소 결과: 발행 420,000원으로 복귀 + 지금 받은 돈과 다름', uOff.ok ? [copy.crOffUndoneMessage(uOff.line), copy.crUndoMismatchDetail(uOff.mismatch)] : uOff,
      ['발행 표시 해제를 적용취소했습니다 · 발행 420,000원으로 복귀', '발행 금액 420,000원이 받은 금액 410,000원과 다릅니다.'])
    await rooms.setCashReceiptIssued(A, false)
    const pv1 = await rooms.previewCashReceiptOn(A)
    eq('S19 다시 켜기 확인 줄: 옛 420,000 이 아니라 새 발행 410,000', pv1.ok ? [pv1.kind, pv1.amount] : pv1, ['rebuild', 410000])
    const on2 = await rooms.setCashReceiptIssued(A, true, '2026-10-12')
    if (!on2.ok) throw new Error(on2.error)
    eq('S19 다시 켜기 토스트·캡션 침묵', [copy.crOnToast(on2, '2026-10-12').message, await capOf(L.id, A)], ['현금영수증 발행 기록됨 · 발행일 10/12 · 410,000원', null])

    // 마지막 이용료 삭제(drop)와 그 적용취소, 줄 없는 삭제(none).
    const C = await rec(L, P1, { month: '2026-09', amount: 350000, pay: '2026-10-03', method: '현금' })
    await rooms.setCashReceiptIssued(C, true, '2026-10-03')
    const pdC = await rooms.previewPaymentDelete(C)
    eq('S19 마지막 이용료 삭제 확인창: 발행 기록도 함께', pdC.ok ? copy.crDeleteConfirmLine(pdC) : pdC,
      '이 입금의 현금영수증 발행 기록 350,000원도 함께 지웁니다. 홈택스에 발행한 영수증은 그대로이니 필요하면 홈택스에서 취소해 주세요.')
    const dC = await rooms.deletePayment(C)
    if (!dC.ok) throw new Error(dC.error)
    eq('S19 drop 삭제 토스트', copy.crDeleteToastDetail(dC.cashReceipt), '현금영수증 발행 기록 350,000원도 함께 지웠습니다.')
    const rC = await rooms.restorePayment(C, J(dC.undo))
    eq('S19 삭제 적용취소 결과: 발행 기록도 되살림', rC.ok ? copy.crRestoreDetail(rC.cashReceipt) : rC, '현금영수증 발행 기록 350,000원도 되살렸습니다.')
    const D = await rec(L, P1, { month: '2026-10', amount: 50000, pay: '2026-10-05', method: '현금' })
    const pdD = await rooms.previewPaymentDelete(D)
    eq('S19 발행 줄 없는 삭제 확인창은 덧붙이지 않음', pdD.ok ? [pdD.effect, copy.crDeleteConfirmLine(pdD)] : pdD, ['none', null])

    // 살아 있는 발행 위의 새 돈(add)과 이미 다 덮인 키(keep).
    const E = await rec(L, P1, { month: '2026-11', amount: 300000, pay: '2026-10-07' })
    await rooms.setCashReceiptIssued(E, true, '2026-10-07')
    const F = await rec(L, P1, { month: '2026-12', amount: 20000, pay: '2026-10-07' })
    const pvF = await rooms.previewCashReceiptOn(F)
    eq('S19 add 확인 줄: 금액 320,000 + 앞 발행일 유지 캡션', pvF.ok && pvF.current ? [pvF.kind, pvF.amount, copy.crAddPreviewChunks(pvF.current, pvF.added)] : pvF,
      ['add', 320000, ['기존 발행 300,000원(10/7)에', '20,000원 더함 ·', '발행일 10/7 유지']])
    const onF = await rooms.setCashReceiptIssued(F, true, '2026-10-12')
    if (!onF.ok) throw new Error(onF.error)
    const tF = copy.crOnToast(onF, '2026-10-12')
    eq('S19 add 토스트: 고른 10/12 가 아니라 지킨 10/7', [tF.message, tF.detail], ['현금영수증 발행 기록됨 · 발행일 10/7 · 320,000원', '기존 발행에 20,000원을 더했습니다. 발행일은 10/7 그대로입니다.'])
    const G = await rec(L, P1, { month: '2026-10', amount: 100000, pay: '2026-10-07', isDeposit: true })
    const onG = await rooms.setCashReceiptIssued(G, true, '2026-10-12')
    if (!onG.ok) throw new Error(onG.error)
    const tG = copy.crOnToast(onG, '2026-10-12')
    eq('S19 이미 다 덮인 키(보증금 행 켜기)는 keep: 성공이라 말하지 않고 적용취소도 없음', [onG.change, tG.kind, tG.undoable, tG.message], ['keep', 'info', false, '이미 같은 날 발행에 들어 있습니다'])

    // 도장만 있고 줄이 없는 옛 데이터(방어 캡션).
    const H = await rec(L, P1, { month: '2026-10', amount: 70000, pay: '2026-10-09', method: '현금', stamp: '2026-10-09' })
    eq('S19 도장만 있고 줄 없음은 위험 캡션', await capOf(L.id, H), ['danger', '발행 표시만 있고 발행 기록이 없음 · 발행 합계에서 빠짐'])

    // 수정 폼에서 입금일을 옮겨 합쳐지면 고친 발행 금액은 안 쓰였다고 말한다(검수 F1 의 화면 쪽).
    const X = await rec(L, P1, { month: '2026-11', amount: 200000, pay: '2026-10-10' })
    await rooms.setCashReceiptIssued(X, true, '2026-10-10')
    const rX = await rowOf(L.id, X)
    const eX = await rooms.updatePayment(X, { actualAmount: 200000, payDate: '2026-10-07', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-10', cashReceiptAmount: 250000 })
    if (!eX.ok) throw new Error(eX.error)
    eq('S19 옮겨 합쳐진 수정 저장 토스트', [eX.cashReceipt.merged?.amount, copy.crEditToastDetail(eX.cashReceipt, { moved: true, wasStamped: true, nowStamped: true, amountEdited: true, beforeAmount: rX?.cashReceiptKey?.line?.amount ?? null })],
      [520000, '입금일·수단이 바뀌어 직접 고친 발행 금액은 반영하지 않았습니다.'])
    eq('S19 합친 뒤 세 행 캡션: 같은 날 3건 합산', await capOf(L.id, X), ['muted', '발행 금액 520,000원 · 같은 날 입금 3건 합산'])

    // 일부만 도장 찍힌 키(검수 R4b 정상 상태). 앞 입금 300,000 은 발행 없이 받았고 뒤 입금 100,000 만 발행했다.
    // 행 캡션·탭 모두 도장 찍힌 몫(100,000)과 견주므로 침묵한다. 키 전체(400,000)와 견주면 '300,000원 적음'이 늘 섰다(검수 R-2).
    const P1x = await rec(L, P1, { month: '2026-10', amount: 300000, pay: '2026-10-11' })
    const P2x = await rec(L, P1, { month: '2026-11', amount: 100000, pay: '2026-10-11', stamp: '2026-10-11' })
    await rooms.setPaymentCashReceipt({ leaseTermId: L.id, tenantId: L.tenantId, payDate: '2026-10-11', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-11', via: 'entry', recordIds: [P2x] })
    eq('S19 일부 도장 키: 도장 찍힌 행 캡션은 침묵 · 안 찍힌 행은 캡션 없음', [await capOf(L.id, P2x), await capOf(L.id, P1x)], [null, null])
    const tabR2 = (await rooms.getCashReceiptTabRows('2026-10')).issued.find((r: { payYmd: string }) => r.payYmd === '2026-10-11')
    eq('S19 일부 도장 키: 탭 행도 침묵(도장 찍힌 몫과 같다)', tabR2 ? [tabR2.received, tabR2.stampedRentRows, tabR2.unstampedRent, copy.cashReceiptTabGap(tabR2)] : null, [400000, 1, 300000, null])
  }

  // ── S20 수정 폼 발행 금액 칸 = 저장 결과(독립 검수 F-A, N2·N3) ─────────────────────────────
  //
  // 화면 순서 그대로. 폼은 미리보기(previewPaymentEditCr)의 기록될 금액을 칸·프리필로 쓰고, 칸을 안 고쳤으면 저장에
  // 싣지 않는다(검수 F1). 그래서 미리 본 금액이 곧 저장 결과여야 한다. 종전 칸은 행 금액(10,000)이나 옛 줄(410,000)이었다.
  {
    const copy = await import('@/lib/cashReceiptCopy')
    // N2: 줄 없는 키의 미발행 형제 둘 중 하나를 켠다. 키 몫 420,000 이 서고 두 행 모두 도장이다.
    const L = await lease(P1)
    const A2 = await rec(L, P1, { month: '2026-10', amount: 410000, pay: '2026-10-09' })
    const B2 = await rec(L, P1, { month: '2026-11', amount: 10000, pay: '2026-10-09' })
    const pv2 = await rooms.previewPaymentEditCr(B2, { payDate: '2026-10-09', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-09', actualAmount: 10000 })
    eq('S20 N2 미리보기: create 420,000 · 칸을 쓴다 · 힌트 기준 420,000', pv2.ok ? [pv2.kind, pv2.amount, pv2.fieldUsed, pv2.keyRent] : pv2, ['create', 420000, true, 420000])
    eq('S20 N2 칸이 기록될 금액이면 힌트는 침묵', pv2.ok && pv2.amount != null ? copy.cashReceiptGapSentence(pv2.amount, pv2.keyRent) : pv2, null)
    const e2 = await rooms.updatePayment(B2, { actualAmount: 10000, payDate: '2026-10-09', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-09' })
    eq('S20 N2 저장 결과 = 미리 본 금액, 앞 행도 도장', e2.ok ? [e2.cashReceipt.line?.amount, await stamp(A2), await stamp(B2)] : e2, [pv2.ok ? pv2.amount : -1, kstMid('2026-10-09'), kstMid('2026-10-09')])

    // N3: 살아 있는 줄(410,000) 있는 키의 미발행 행을 켠다. add 420,000, 앞 발행일 유지.
    const L3 = await lease(P1)
    const A3 = await rec(L3, P1, { month: '2026-10', amount: 410000, pay: '2026-10-10' })
    await rooms.setCashReceiptIssued(A3, true, '2026-10-10')
    const B3 = await rec(L3, P1, { month: '2026-11', amount: 10000, pay: '2026-10-10' })
    const pv3 = await rooms.previewPaymentEditCr(B3, { payDate: '2026-10-10', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-11', actualAmount: 10000 })
    eq('S20 N3 미리보기: add 420,000 · 앞 410,000(10/10)에 10,000', pv3.ok ? [pv3.kind, pv3.amount, pv3.prev, pv3.added, pv3.issuedYmd, pv3.keyRent] : pv3,
      ['add', 420000, { amount: 410000, issuedYmd: '2026-10-10' }, 10000, '2026-10-10', 420000])
    eq('S20 N3 칸 밑 세 덩이', pv3.ok && pv3.prev ? copy.crAddPreviewChunks(pv3.prev, pv3.added) : pv3, ['기존 발행 410,000원(10/10)에', '10,000원 더함 ·', '발행일 10/10 유지'])
    const e3 = await rooms.updatePayment(B3, { actualAmount: 10000, payDate: '2026-10-10', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-11' })
    eq('S20 N3 저장 결과 = 미리 본 금액', e3.ok ? [e3.cashReceipt.added?.amount, e3.cashReceipt.line?.amount, e3.cashReceipt.line?.issuedYmd] : e3, [420000, 420000, '2026-10-10'])

    // 옮김 갈래는 칸을 안 쓴다(검수 F1). 홀로 선 수납을 옮기면 transfer, 형제가 남으면 unstamp.
    const L5 = await lease(P1)
    const A5 = await rec(L5, P1, { month: '2026-10', amount: 300000, pay: '2026-10-12' })
    await rooms.setCashReceiptIssued(A5, true, '2026-10-12')
    const pv5 = await rooms.previewPaymentEditCr(A5, { payDate: '2026-10-13', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-12', actualAmount: 300000 })
    eq('S20 옮김 transfer: 칸을 안 쓴다', pv5.ok ? [pv5.kind, pv5.amount, pv5.fieldUsed] : pv5, ['transfer', 300000, false])
    const e5 = await rooms.updatePayment(A5, { actualAmount: 300000, payDate: '2026-10-13', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-12', cashReceiptAmount: 999000 })
    eq('S20 옮김 transfer 저장은 칸 값을 무시하고 미리 본 금액', e5.ok ? e5.cashReceipt.transferred?.amount : e5, 300000)
    const B5 = await rec(L5, P1, { month: '2026-11', amount: 10000, pay: '2026-10-13' })
    await rooms.setCashReceiptIssued(B5, true, '2026-10-13')
    const pv6 = await rooms.previewPaymentEditCr(B5, { payDate: '2026-10-14', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-13', actualAmount: 10000 })
    eq('S20 옮김 unstamp: 칸이 없다', pv6.ok ? [pv6.kind, pv6.amount, pv6.fieldUsed] : pv6, ['unstamp', null, false])
    // 남의 영업장 수납은 못 읽는다.
    g.__CR_FLOW_PID = P2
    eq('S20 남의 수납 미리보기 거부', (await rooms.previewPaymentEditCr(B5, { payDate: '2026-10-14', payMethod: '계좌이체', issued: true, actualAmount: 10000 })).ok, false)
    g.__CR_FLOW_PID = P1
  }

  // ── S21 0원 행을 수정 폼으로 켜는 뒷문(독립 검수 R-6, Z1·Z2) ─────────────────────────────
  {
    // Z1: 살아 있는 줄(400,000) 있는 키의 0원 행을 켜며 칸 999,000 을 실으면 종전에는 줄이 999,000 으로 덮였다.
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-09', amount: 400000, pay: '2026-09-25' })
    await rooms.setCashReceiptIssued(A, true, '2026-09-25')
    const Z = await rec(L, P1, { month: '2026-10', amount: 0, pay: '2026-09-25' })
    const z1 = await rooms.updatePayment(Z, { actualAmount: 0, payDate: '2026-09-25', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-03', cashReceiptAmount: 999000 })
    eq('S21 Z1 0원 행 켜기 거부 · 줄 400,000 @9/25 그대로', [z1.ok, z1.ok ? null : z1.error, await lines(L.id, '2026-09-25'), await stamp(Z)],
      [false, '금액이 0원인 수납이라 현금영수증을 발행할 금액이 없습니다.', [{ amount: 400000, issuedAt: kstMid('2026-09-25'), deleted: false }], null])
    const zp = await rooms.previewPaymentEditCr(Z, { payDate: '2026-09-25', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-03', actualAmount: 0 })
    eq('S21 Z1 미리보기도 같은 문장으로 거부', zp.ok ? zp : zp.error, '금액이 0원인 수납이라 현금영수증을 발행할 금액이 없습니다.')
    // Z2: 줄 없는 키의 0원 행을 켜면 종전에는 형제(400,000)의 미발행 돈으로 새 발행이 섰다.
    const L2 = await lease(P1)
    const A2 = await rec(L2, P1, { month: '2026-09', amount: 400000, pay: '2026-09-26' })
    const Z2 = await rec(L2, P1, { month: '2026-10', amount: 0, pay: '2026-09-26' })
    const z2 = await rooms.updatePayment(Z2, { actualAmount: 0, payDate: '2026-09-26', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-03' })
    eq('S21 Z2 0원 행 켜기 거부 · 형제 발행 안 섬', [z2.ok, (await lines(L2.id, '2026-09-26')).length, await stamp(A2), await stamp(Z2)], [false, 0, null, null])
    // keep 갈래(이미 다 덮인 키)에서는 칸 값을 쓰지 않는다. 보증금 행을 켜며 칸을 실어도 앞 발행은 그대로다.
    const L3 = await lease(P1)
    const A3 = await rec(L3, P1, { month: '2026-09', amount: 400000, pay: '2026-09-27' })
    await rooms.setCashReceiptIssued(A3, true, '2026-09-27')
    const D3 = await rec(L3, P1, { month: '2026-09', amount: 100000, pay: '2026-09-27', isDeposit: true })
    const k3 = await rooms.updatePayment(D3, { actualAmount: 100000, payDate: '2026-09-27', payMethod: '계좌이체', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-03', cashReceiptAmount: 999000 })
    eq('S21 keep 갈래는 칸 값을 안 써 앞 발행 400,000 그대로', k3.ok ? [k3.cashReceipt.kept, k3.cashReceipt.line?.amount] : k3, [true, 400000])
  }

  // ── S22 등록 폼 결과와 일반 갈래 적용취소(독립 검수 R-3, 운영자 원칙 '모든 쓰기에 적용취소') ────────────────
  {
    const copy = await import('@/lib/cashReceiptCopy')
    const L = await lease(P1)
    const A = await rec(L, P1, { month: '2026-10', amount: 300000, pay: '2026-10-01' })   // 발행 없이 받은 앞 입금
    const s1 = await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-10', expectedAmount: 420000, actualAmount: 100000, payDate: '2026-10-01', payMethod: '계좌이체', forcedTargetMonth: '2026-10', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-01' })
    const c1 = await rooms.setPaymentCashReceipt({ leaseTermId: L.id, tenantId: L.tenantId, payDate: '2026-10-01', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-01', via: 'entry', recordIds: s1.createdIds })
    eq('S22 등록 결과: 먼저 받은 300,000 은 발행 기록 없음', c1.ok ? copy.crEntryResultLines(c1) : c1, ['같은 날 먼저 받은 300,000원은 발행 기록이 없습니다'])
    const s2 = await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-11', expectedAmount: 420000, actualAmount: 20000, payDate: '2026-10-01', payMethod: '계좌이체', forcedTargetMonth: '2026-11', cashReceiptIssued: true, cashReceiptIssuedDate: '2026-10-02' })
    const c2 = await rooms.setPaymentCashReceipt({ leaseTermId: L.id, tenantId: L.tenantId, payDate: '2026-10-01', payMethod: '계좌이체', issued: true, issuedDate: '2026-10-02', via: 'entry', recordIds: s2.createdIds })
    eq('S22 등록 결과: 앞 발행에 합침 · 발행일 그대로 · 먼저 받은 돈(두 줄)', c2.ok ? copy.crEntryResultLines(c2) : c2,
      ['기존 발행에 합쳤습니다 · 발행 금액 120,000원 · 발행일 10/1 그대로', '같은 날 먼저 받은 300,000원은 발행 기록이 없습니다'])
    // 둘째 등록의 적용취소(화면: 토스트 [적용취소]). 수납이 지워지고 발행 기록은 등록 직전(100,000)으로 돌아간다.
    const u2 = await rooms.undoOverpayExtraIncome(s2.createdIds, undefined, c2.ok ? J(c2.undo) : null)
    eq('S22 등록 적용취소: 수납 지움 · 발행 100,000 @10/1 로', [u2.ok, await alive(s2.createdIds[0]), await lines(L.id, '2026-10-01')],
      [true, false, [{ amount: 100000, issuedAt: kstMid('2026-10-01'), deleted: false }]])
    // 발행 없이 등록한 일반 갈래도 적용취소가 있다. 마지막 이용료를 지우는 첫 등록 적용취소는 발행 기록도 함께 지우고 그 사실을 말한다.
    const s3 = await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-11', expectedAmount: 420000, actualAmount: 50000, payDate: '2026-10-03', payMethod: '현금', forcedTargetMonth: '2026-11' })
    const u3 = await rooms.undoOverpayExtraIncome(s3.createdIds, undefined, null)
    eq('S22 발행 없는 일반 갈래 등록 적용취소', [u3.ok, await alive(s3.createdIds[0]), u3.ok ? copy.crDeleteToastDetail(u3.cashReceipt) : u3], [true, false, undefined])
    await rooms.deletePayment(A)
    const u1 = await rooms.undoOverpayExtraIncome(s1.createdIds, undefined, null)
    eq('S22 키의 마지막 이용료 등록을 무르면 발행 기록도 함께 지웠다고 말한다', u1.ok ? copy.crDeleteToastDetail(u1.cashReceipt) : u1, '현금영수증 발행 기록 100,000원도 함께 지웠습니다.')
  }

  console.log(`[현금영수증 생애주기 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
