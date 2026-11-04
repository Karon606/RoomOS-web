// 납부일 당일 다섯 판정 자리 일치 통합 회귀. 같은 계약을 같은 날(11/3·11/4·11/5)로 수납 관리·홈·종·수납 등록 기본값·조정 칩에 물어 한 답인지 본다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-due-today-parity.ts
//
// 왜(2026-11-04 운영자 원문 "납부일 당일은 납부일 당일이라고 표시하는게 좋을 것 같아. 납기 전도 아니고 미납도 아니고", 승인 '추천대로').
// 같은 뜻의 판정이 다섯 자리에 따로 있어 당일에 수납 관리는 '납부일', 홈·종은 '미납 · 오늘 도래'라 말했다. 정본 lib/dueState 로
// 모았으므로 한 자리만 옛 식으로 돌아가면(원자성 위반) 여기서 같은 날 답이 갈린다.
//
// 오늘은 전역 Date 를 고정해 바꾼다(KST 정오). 운영 DB 에는 절대 붙지 않는다(scripts/cr-flow-prisma-stub.ts 가 하네스 주소만 받는다).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 56000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x6a).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

// 오늘 고정. 인자 없는 new Date()·Date.now() 만 바꾼다(인자 있는 생성은 그대로).
const RealDate = Date
function setToday(ymd: string) {
  const fixed = new RealDate(`${ymd}T03:00:00.000Z`).getTime()   // KST 12:00
  class FakeDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(fixed)
      else super(...(a as [string]))
    }
    static now() { return fixed }
  }
  globalThis.Date = FakeDate as unknown as DateConstructor
}

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
  const { computeUnpaidStatus } = await import('@/app/(app)/dashboard/unpaid')
  const { computeAlerts } = await import('@/app/(app)/dashboard/alerts')
  const { getDashboardData } = await import('@/app/(app)/dashboard/getDashboardData')
  const { suggestPay } = await import('@/lib/paymentSuggest')
  const { paymentBadgeKind } = await import('@/lib/roomsStatusSort')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  let roomSeq = 400, seq = 0
  // 영업장 하나에 계약 하나. 정가 470,000 · 단기 아님 · 입주 2026-06.
  async function fixture(o: { dueDay: string; paid: string[]; override?: { day: string; month: string } }) {
    const P = randomUUID()
    await prisma.property.create({ data: { id: P, name: '하네스', ownerId: randomUUID() } })
    g.__CR_FLOW_PID = P
    const tn = await prisma.tenant.create({ data: { name: '입주자', propertyId: P } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P } })
    const l = await prisma.leaseTerm.create({
      data: {
        tenantId: tn.id, propertyId: P, roomId: room.id, rentAmount: 470000, dueDay: o.dueDay, moveInDate: day('2026-06-01'), status: 'ACTIVE',
        overrideDueDay: o.override?.day ?? null, overrideDueDayMonth: o.override?.month ?? null,
      },
    })
    for (const m of o.paid) {
      await prisma.paymentRecord.create({ data: { leaseTermId: l.id, tenantId: tn.id, propertyId: P, targetMonth: m, expectedAmount: 470000, actualAmount: 470000, payDate: day(`${m}-01`), payMethod: '계좌이체', seqNo: ++seq, isPaid: true } })
    }
    return { P, id: l.id as string }
  }
  // 다섯 자리를 같은 날에 묻는다.
  async function ask(f: { P: string; id: string }, today: string) {
    setToday(today)
    g.__CR_FLOW_PID = f.P
    const view = today.slice(0, 7)
    const row = (await rooms.getRoomPaymentStatus(view)).find(r => r.leaseTermId === f.id)!
    const unpaid = await computeUnpaidStatus(f.P)
    const alerts = (await computeAlerts(f.P)).filter(a => a.leaseTermId === f.id).map(a => a.category)
    const dash = await getDashboardData(f.P, view)
    const months = await rooms.getTargetMonthOptions(f.id, view)
    const sug = suggestPay({ forcedMonth: 'auto', months, viewMonth: view, expected: 470000 })
    return {
      rooms: { isPaid: row.isPaid, kind: paymentBadgeKind(row as never, view, today), firstUnpaid: row.firstUnpaidMonth, nextDue: row.nextDueDate },
      home: { unpaidCount: unpaid.unpaidCount, overdue: unpaid.overdueAmount, dueToday: unpaid.dueTodayLeases.map(l => l.dueTodayAmount) },
      dash: { unpaidCount: dash.unpaidCount, overdue: dash.overdueAmount, upcoming: dash.upcomingAmount, aging: dash.agingBuckets.reduce((s: number, b: { amount: number }) => s + b.amount, 0) },
      bell: alerts,
      suggest: sug,
    }
  }

  // ── P1 납부일 4일, 10월 완납 · 11월 미수. 11/3 · 11/4 · 11/5 ──
  {
    const f = await fixture({ dueDay: '4', paid: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] })
    const d3 = await ask(f, '2026-11-03')
    eq('P1 11/3 수납 관리 납부 예정', d3.rooms, { isPaid: true, kind: 'awaiting', firstUnpaid: null, nextDue: '2026-11-04' })
    eq('P1 11/3 홈 미납 0 · 당일 0', d3.home, { unpaidCount: 0, overdue: 0, dueToday: [] })
    eq('P1 11/3 홈 KPI 미납 0 · 납부 예정 470,000', [d3.dash.unpaidCount, d3.dash.overdue, d3.dash.upcoming, d3.dash.aging], [0, 0, 470000, 0])
    eq('P1 11/3 종 없음', d3.bell, [])
    eq('P1 11/3 기본값 470,000(선납)', d3.suggest, { amount: 470000, excludedToday: [] })

    const d4 = await ask(f, '2026-11-04')
    eq('P1 11/4 수납 관리 납부일 당일(미납 아님)', d4.rooms, { isPaid: true, kind: 'dueToday', firstUnpaid: null, nextDue: '2026-11-04' })
    eq('P1 11/4 홈 미납 0 · 당일 470,000', d4.home, { unpaidCount: 0, overdue: 0, dueToday: [470000] })
    eq('P1 11/4 홈 KPI 미납 0 · 납부 예정 470,000 · 에이징 0', [d4.dash.unpaidCount, d4.dash.overdue, d4.dash.upcoming, d4.dash.aging], [0, 0, 470000, 0])
    eq('P1 11/4 종 오늘 납부일만', d4.bell, ['dueday'])
    eq('P1 11/4 기본값 470,000(밀린 달 없음, 캡션 없음)', d4.suggest, { amount: 470000, excludedToday: [] })

    const d5 = await ask(f, '2026-11-05')
    eq('P1 11/5 수납 관리 미납', d5.rooms, { isPaid: false, kind: 'unpaid', firstUnpaid: '2026-11', nextDue: null })
    eq('P1 11/5 홈 미납 1 · 470,000', d5.home, { unpaidCount: 1, overdue: 470000, dueToday: [] })
    eq('P1 11/5 홈 KPI 미납 470,000 · 에이징 470,000', [d5.dash.unpaidCount, d5.dash.overdue, d5.dash.upcoming, d5.dash.aging], [1, 470000, 0, 470000])
    eq('P1 11/5 종 미납만', d5.bell, ['unpaid'])
    eq('P1 11/5 기본값 470,000', d5.suggest.amount, 470000)
  }

  // ── P2 10월 미납 + 11월 당일(11/4) → 미납은 10월분만, 기본값 10월분, 종 미납 하나 ──
  {
    const f = await fixture({ dueDay: '4', paid: ['2026-06', '2026-07', '2026-08', '2026-09'] })
    const d4 = await ask(f, '2026-11-04')
    eq('P2 수납 관리 미납(첫 미납 10월)', [d4.rooms.isPaid, d4.rooms.kind, d4.rooms.firstUnpaid], [false, 'unpaid', '2026-10'])
    eq('P2 홈 미납 금액 = 10월분만', d4.home, { unpaidCount: 1, overdue: 470000, dueToday: [] })
    eq('P2 KPI 미납 470,000 · 납부 예정 470,000', [d4.dash.overdue, d4.dash.upcoming], [470000, 470000])
    eq('P2 종 미납만(오늘 납부일 없음)', d4.bell, ['unpaid'])
    eq('P2 기본값 10월분 · 11월분은 캡션', d4.suggest, { amount: 470000, excludedToday: [{ month: '2026-11', amount: 470000 }] })
  }

  // ── P3 29일 납부, 2027-02-28(평년) → 모든 자리 당일(종전 홈은 넘침으로 3/1 이 기한이었다) ──
  {
    const f = await fixture({ dueDay: '29', paid: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'] })
    const d = await ask(f, '2027-02-28')
    eq('P3 수납 관리 당일', [d.rooms.kind, d.rooms.nextDue], ['dueToday', '2027-02-28'])
    eq('P3 홈 당일', d.home, { unpaidCount: 0, overdue: 0, dueToday: [470000] })
    eq('P3 종 오늘 납부일', d.bell, ['dueday'])
  }

  // ── P4 10월분을 11/4 로 유예, 오늘 11/4 → 유예가 아니라 납부일 당일(수납 관리와 홈이 같다) ──
  {
    const f = await fixture({ dueDay: '4', paid: ['2026-06', '2026-07', '2026-08', '2026-09'], override: { day: '2026-11-04', month: '2026-10' } })
    const before = await ask(f, '2026-11-03')
    eq('P4 전날 수납 관리 납부 유예', before.rooms.kind, 'deferredUnpaid')
    eq('P4 전날 홈 미납 0', before.home.unpaidCount, 0)
    const d = await ask(f, '2026-11-04')
    eq('P4 당일 수납 관리 납부일 당일', d.rooms.kind, 'dueToday')
    eq('P4 당일 홈 미납 0 · 당일 470,000(10월분, 11월분은 납부일 당일도 함께)', [d.home.unpaidCount, d.home.dueToday], [0, [940000]])
    eq('P4 당일 종 오늘 납부일', d.bell, ['dueday'])
    const after = await ask(f, '2026-11-05')
    eq('P4 다음 날 수납 관리 미납 · 홈 미납', [after.rooms.kind, after.home.unpaidCount], ['unpaid', 1])
  }

  // ── P5 첫 달 입주일 당일(납부일 20일, 11/4 입주) → 당일 ──
  {
    const P = randomUUID()
    await prisma.property.create({ data: { id: P, name: '하네스 첫 달', ownerId: randomUUID() } })
    g.__CR_FLOW_PID = P
    const tn = await prisma.tenant.create({ data: { name: '새 입주자', propertyId: P } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P } })
    const l = await prisma.leaseTerm.create({ data: { tenantId: tn.id, propertyId: P, roomId: room.id, rentAmount: 470000, dueDay: '20', moveInDate: day('2026-11-04'), status: 'ACTIVE' } })
    const d = await ask({ P, id: l.id }, '2026-11-04')
    eq('P5 첫 달 입주일 당일 수납 관리', d.rooms.kind, 'dueToday')
    eq('P5 첫 달 입주일 당일 홈', [d.home.unpaidCount, d.home.dueToday.length], [0, 1])
    const n = await ask({ P, id: l.id }, '2026-11-05')
    eq('P5 다음 날 미납(수납 관리·홈)', [n.rooms.kind, n.home.unpaidCount], ['unpaid', 1])
  }

  globalThis.Date = RealDate
  console.log(`[납부일 당일 다섯 자리 일치] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
