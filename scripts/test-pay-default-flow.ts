// 수납 등록 기본값 통합 회귀. 실제 서버 액션(getTargetMonthOptions·savePayment)을 메모리 PGlite 위에서 화면 순서대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-pay-default-flow.ts
//
// 왜(2026-11-04, 운영자 승인 '추천대로' G1). 입주자 상세 수납 모달이 금액을 정가로 채워 할인 달 입금의 할인액이 다음 달
// 선납으로 적혔다(404호). 운영자 규칙 "10월 미납분이면 11월로 넘어와도 미리 표시되는 금액이 10월 기준이 뜨는게 맞는 것 같아".
//   · 지난달(할인) 미납을 이번 달에 받으면 기본값은 지난달 할인 청구이고, 그대로 저장하면 지난달만 완납·이번 달 행 0
//   · 도래 미납 두 달이면 두 달 청구 합이고, 그대로 저장하면 두 달 완납·넘침 0
// 날짜는 오늘(KST) 기준 상대 달로 만든다. 이번 달 기한(말일)은 오늘이어도 납부일 당일이라 미납이 아니고 합에 안 든다
// (lib/dueState, 2026-11-04 승인). 그래서 말일에 돌려도 기대값이 같다(종전에는 말일에만 이번 달을 더했다).
//
// 운영 DB 에는 절대 붙지 않는다(scripts/cr-flow-prisma-stub.ts 가 하네스 주소가 아니면 거부한다).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 56000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x5d).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const rooms = await import('@/app/(app)/rooms/actions')
  const { suggestPayAmount } = await import('@/lib/paymentSuggest')
  const { kstYmd, kstYmdStr } = await import('@/lib/kstDate')
  const { shiftMonth } = await import('@/lib/moveCalendar')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const t = kstYmd()
  const today = kstYmdStr()
  const thisM = `${t.year}-${String(t.month).padStart(2, '0')}`
  const m = (k: number) => shiftMonth(thisM, k)

  const P = randomUUID()
  await prisma.property.create({ data: { id: P, name: '하네스', ownerId: randomUUID() } })
  g.__CR_FLOW_PID = P
  let roomSeq = 400, seq = 0
  // 404호와 같은 모양. 정가 470,000 · 납부일 말일 · 할인 30,000(달은 시나리오가 정한다).
  async function lease(discountFrom: string, discountTo: string) {
    const tn = await prisma.tenant.create({ data: { name: '입주자', propertyId: P } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P } })
    const l = await prisma.leaseTerm.create({
      data: { tenantId: tn.id, propertyId: P, roomId: room.id, rentAmount: 470000, dueDay: '말일', moveInDate: day(`${m(-4)}-01`), status: 'ACTIVE' },
    })
    await prisma.rentDiscount.create({ data: { leaseTermId: l.id, discountType: 'amount', value: 30000, scope: 'temporary', startMonth: discountFrom, endMonth: discountTo } as never })
    return { id: l.id as string, tenantId: tn.id as string }
  }
  async function paid(l: { id: string; tenantId: string }, month: string, amount: number) {
    await prisma.paymentRecord.create({ data: { leaseTermId: l.id, tenantId: l.tenantId, propertyId: P, targetMonth: month, expectedAmount: amount, actualAmount: amount, payDate: day(`${month}-15`), payMethod: '계좌이체', seqNo: ++seq, isPaid: true } })
  }
  const monthPaid = async (id: string, month: string) =>
    (await prisma.paymentRecord.findMany({ where: { leaseTermId: id, targetMonth: month, isDeposit: false, deletedAt: null }, select: { actualAmount: true } }))
      .reduce((s: number, r: { actualAmount: number }) => s + r.actualAmount, 0)
  // 화면 순서: 귀속월 목록 → 정본 기본값 → 그 금액 그대로 저장(귀속월 자동)
  async function openAndSave(l: { id: string; tenantId: string }) {
    const months = await rooms.getTargetMonthOptions(l.id, thisM)
    const amount = suggestPayAmount({ forcedMonth: 'auto', months, viewMonth: thisM, expected: 470000 })
    const sp = await rooms.savePayment({ leaseTermId: l.id, tenantId: l.tenantId, targetMonth: thisM, expectedAmount: 470000, actualAmount: amount, payDate: today, payMethod: '계좌이체' })
    return { amount, allocs: sp.ok ? sp.allocations.map(a => [a.targetMonth, a.amount]) : sp.error }
  }

  // ── F1 운영자 실례: 지난달(할인 440,000) 미납, 이번 달 수납 열기 → 440,000, 이번 달 정가 안 섞임 ───────
  {
    const L = await lease(m(-3), m(-1))
    for (const k of [-4, -3, -2]) await paid(L, m(k), k === -4 ? 470000 : 440000)
    const r = await openAndSave(L)
    const want = 440000
    eq('F1 기본값 = 지난달 할인 청구 440,000(이번 달 정가 미포함)', r.amount, want)
    eq('F1 그대로 저장하면 지난달만 채운다', r.allocs, [[m(-1), 440000]])
    eq('F1 지난달 완납', await monthPaid(L.id, m(-1)), 440000)
    eq('F1 이번 달 선납 행 0(할인액이 넘어가지 않는다)', await monthPaid(L.id, thisM), 0)
  }

  // ── F2 도래 미납 두 달(둘 다 할인 440,000) → 880,000, 저장하면 두 달 완납·넘침 0 ───────────────
  {
    const L = await lease(m(-3), m(-1))
    for (const k of [-4, -3]) await paid(L, m(k), k === -4 ? 470000 : 440000)
    const r = await openAndSave(L)
    eq('F2 기본값 = 두 달 청구 합 880,000', r.amount, 880000)
    eq('F2 두 달 완납', [await monthPaid(L.id, m(-2)), await monthPaid(L.id, m(-1))], [440000, 440000])
    eq('F2 이번 달로 넘친 돈 0', await monthPaid(L.id, thisM), 0)
  }

  // ── F3 밀린 달 없음 → 이번 달 청구(선납, 할인 끝난 정가 470,000) ───────────────────────
  {
    const L = await lease(m(-3), m(-1))
    for (const k of [-4, -3, -2, -1]) await paid(L, m(k), k === -4 ? 470000 : 440000)
    const months = await rooms.getTargetMonthOptions(L.id, thisM)
    eq('F3 밀린 달 없으면 이번 달 청구 470,000', suggestPayAmount({ forcedMonth: 'auto', months, viewMonth: thisM, expected: 470000 }), 470000)
  }

  // ── F4 인수월 양도인 자동 처리(412호 모양, 독립 검수 B1) → 인수월은 기본값에 안 든다 ─────────────
  //   인수일 = 석 달 전 15일 · 납부일 2일(인수일 앞) · 인수 뒤 그 달 수납 0 → FIFO 가 넘기는 달이다. 목록도 넘겨야 한다.
  {
    const P2 = randomUUID()
    const acq = new Date(Date.UTC(Number(m(-3).slice(0, 4)), Number(m(-3).slice(5)) - 1, 15))
    await prisma.property.create({ data: { id: P2, name: '하네스 인수', ownerId: randomUUID(), acquisitionDate: acq } as never })
    g.__CR_FLOW_PID = P2
    const tn = await prisma.tenant.create({ data: { name: '승계', propertyId: P2 } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P2 } })
    const l = await prisma.leaseTerm.create({ data: { tenantId: tn.id, propertyId: P2, roomId: room.id, rentAmount: 350000, dueDay: '2', moveInDate: day(`${m(-8)}-02`), status: 'ACTIVE' } })
    const L = { id: l.id as string, tenantId: tn.id as string }
    for (const k of [-2, -1]) await prisma.paymentRecord.create({ data: { leaseTermId: L.id, tenantId: L.tenantId, propertyId: P2, targetMonth: m(k), expectedAmount: 350000, actualAmount: 350000, payDate: day(`${m(k)}-02`), payMethod: '계좌이체', seqNo: ++seq, isPaid: true } })
    const months = await rooms.getTargetMonthOptions(L.id, thisM)
    eq('F4 인수월은 목록에서 완납(FIFO 와 같은 판정)', months.find(o => o.month === m(-3))?.status, 'paid')
    const r = await openAndSave(L)
    eq('F4 기본값 350,000(인수월 미포함)', r.amount, 350000)
    eq('F4 그대로 저장하면 이번 달만 채운다(선납 0)', r.allocs, [[thisM, 350000]])
    g.__CR_FLOW_PID = P
  }

  // ── F5 0원 저장 거절(독립 검수 R2) — 서버가 막고 record 가 생기지 않는다 ─────────────
  {
    const L = await lease(m(-3), m(-1))
    const before = await prisma.paymentRecord.count({ where: { leaseTermId: L.id } })
    const z = await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: thisM, expectedAmount: 470000, actualAmount: 0, payDate: today, payMethod: '계좌이체' })
    eq('F5 0원 저장 거절', z.ok ? 'ok' : z.error, '받은 금액이 0원이라 저장할 수 없습니다 · 금액을 입력하면 됩니다')
    const neg = await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: thisM, expectedAmount: 470000, actualAmount: -1000, payDate: today, payMethod: '계좌이체' })
    eq('F5 음수 저장 거절', neg.ok, false)
    eq('F5 record 0건 그대로', await prisma.paymentRecord.count({ where: { leaseTermId: L.id } }), before)
  }

  console.log(`[수납 등록 기본값 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
