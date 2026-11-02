// 수납 방법 필터 통합 회귀. 실제 getRoomPaymentStatus·getMonthPaymentAggregates 를 메모리 PGlite 위에서 돌려 요약 칸과 보이는 행을 대조한다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-pay-method-filter-flow.ts
//
// 왜(독립 검수 B1, 2026-11-02). 진리표(test-pay-method-filter)는 판정 함수만 봤다. 실제로는 예약 행이 일찍 반환되면서 methodPays 가
// 빠져 10월 현금 요약은 6건 1,440,000원인데 화면 행은 5건 1,190,000원이었다(519호 예약자 10/31 현금 250,000원 11월분).
//   · 축 ⓐ 수단 칸마다 요약(서버 집계) = 보이는 행 methodPays 합(건수까지). 예약·그 달 퇴실·진행 중 계약이 섞인 달로 본다.
//   · 축 ⓑ 예약 행 보조줄이 '(11월분)' 을 단다.
//   · 축 ⓒ 카드 줄과 카드 보증금 몫을 원시 행에서 따로 다시 센 값과 대조한다(정본 함수 밖 경로, 검수 R2).
//   · 축 ⓓ 보증금·납입일 변경 조정 행·청구 조정 전표·보유 보증금은 칸에도 행에도 없다.
//
// 운영 DB 에는 절대 붙지 않는다(scripts/cr-flow-prisma-stub.ts 가 하네스 주소가 아니면 거부한다).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 55000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL

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
  const { methodPayLine, cardLikeMethodSum } = await import('@/lib/payMethodFilter')
  const { CARD_LIKE_METHODS } = await import('@/lib/paymentMethods')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  async function lease(roomNo: string, o: { status: string; moveIn: string; moveOut?: string }) {
    const t = await prisma.tenant.create({ data: { name: `${roomNo} 입주자`, propertyId: P1 } })
    const room = await prisma.room.create({ data: { roomNo, propertyId: P1, baseRent: 450000 } })
    const l = await prisma.leaseTerm.create({
      data: {
        tenantId: t.id, propertyId: P1, roomId: room.id, rentAmount: 450000, dueDay: '5', moveInDate: day(o.moveIn), status: o.status,
        ...(o.moveOut ? { moveOutDate: day(o.moveOut), expectedMoveOut: day(o.moveOut) } : {}),
      },
    })
    return { id: l.id as string, tenantId: t.id as string }
  }
  let seq = 0
  async function rec(l: { id: string; tenantId: string }, o: { month: string; amount: number; pay: string; method: string | null; deposit?: boolean; adjust?: boolean; memo?: string }) {
    await prisma.paymentRecord.create({
      data: {
        leaseTermId: l.id, tenantId: l.tenantId, propertyId: P1, targetMonth: o.month, expectedAmount: 450000, actualAmount: o.amount,
        payDate: day(o.pay), payMethod: o.method, seqNo: ++seq, isPaid: true, isDeposit: !!o.deposit, isBillingAdjust: !!o.adjust, memo: o.memo ?? null,
      },
    })
  }

  const A = await lease('301', { status: 'ACTIVE', moveIn: '2026-03-01' })
  await rec(A, { month: '2026-10', amount: 130000, pay: '2026-10-03', method: '현금' })
  await rec(A, { month: '2026-09', amount: 50000, pay: '2026-10-20', method: '현금' })
  await rec(A, { month: '2026-10', amount: 270000, pay: '2026-10-05', method: '계좌이체' })
  await rec(A, { month: '2026-10', amount: 100000, pay: '2026-10-07', method: '신용카드', deposit: true })   // 카드 보증금
  await rec(A, { month: '2026-10', amount: 500000, pay: '2026-10-08', method: '현금', deposit: true })        // 현금 보증금
  const B = await lease('519', { status: 'RESERVED', moveIn: '2026-11-05' })                                     // B1: 예약자
  await rec(B, { month: '2026-11', amount: 250000, pay: '2026-10-31', method: '현금' })
  const C = await lease('402', { status: 'CHECKED_OUT', moveIn: '2026-01-01', moveOut: '2026-10-10' })         // 그 달 퇴실
  await rec(C, { month: '2026-10', amount: 150000, pay: '2026-10-02', method: '현금' })
  const D = await lease('405', { status: 'ACTIVE', moveIn: '2026-05-01' })
  await rec(D, { month: '2026-10', amount: 300000, pay: '2026-10-09', method: '신용카드' })
  await rec(D, { month: '2026-10', amount: 172000, pay: '2026-10-11', method: '결제선생' })
  await rec(D, { month: '2026-10', amount: 40000, pay: '2026-10-12', method: null })
  await rec(D, { month: '2026-10', amount: 0, pay: '2026-10-13', method: '신용카드', adjust: true })
  await rec(D, { month: '2026-10', amount: 130000, pay: '2026-10-14', method: null, memo: '[납입일변경] 9일→2일 조정' })
  await rec(D, { month: '2026-10', amount: 90000, pay: '2026-10-15', method: '보유 보증금' })
  const N = await lease('406', { status: 'NON_RESIDENT', moveIn: '2026-06-01' })
  await rec(N, { month: '2026-10', amount: 60000, pay: '2026-10-16', method: '기타' })

  const M = '2026-10'
  const [rows, agg] = await Promise.all([rooms.getRoomPaymentStatus(M), rooms.getMonthPaymentAggregates(M)])
  const byRow: Record<string, { sum: number; count: number }> = {}
  for (const r of rows) for (const x of r.methodPays ?? []) { const t = byRow[x.method] ?? (byRow[x.method] = { sum: 0, count: 0 }); t.sum += x.amount; t.count++ }
  const keys = [...new Set([...Object.keys(byRow), ...Object.keys(agg.byMethod)])].sort()
  for (const k of keys) eq(`ⓐ ${k} 칸: 요약 = 보이는 행 합`, byRow[k] ?? null, agg.byMethod[k] ?? null)
  eq('ⓐ 현금 요약(예약 11월분·그 달 퇴실 포함, 보증금 제외)', agg.byMethod['현금'], { sum: 580000, count: 4 })
  eq('ⓐ 칸 목록', keys, ['결제선생', '계좌이체', '기타', '수단 미기록', '신용카드', '현금'].sort())

  const resv = rows.find(r => r.roomNo === '519')
  eq('ⓑ 예약 행이 그 달 입금을 싣는다', resv?.methodPays?.length, 1)
  eq("ⓑ 예약 행 보조줄 '(11월분)'", methodPayLine(resv?.methodPays, '현금', M), '현금 · 10/31 250,000원 (11월분)')

  // ⓒ 원시 행에서 따로 센다(정본 함수 밖). 카드 줄 = 카드 계열 수단·입금일 10월·조정 전표 아님·양도인 아님·납입일 변경 조정 행 아님.
  const raw = await prisma.paymentRecord.findMany({ where: { propertyId: P1, payDate: { gte: day('2026-10-01'), lt: day('2026-11-01') } } })
  const cardRaw = raw.filter(r => r.payMethod && CARD_LIKE_METHODS.includes(r.payMethod) && !r.isBillingAdjust && !r.isPrevOwner && !(r.memo ?? '').startsWith('[납입일변경]'))
  const cardSumRaw = cardRaw.reduce((s, r) => s + r.actualAmount, 0)
  const cardDepRaw = cardRaw.filter(r => r.isDeposit).reduce((s, r) => s + r.actualAmount, 0)
  eq('ⓒ 카드 줄 = 원시 재계산', [agg.cardSum, agg.cardCount], [cardSumRaw, cardRaw.length])
  eq('ⓒ 카드 보증금 몫 = 원시 재계산', agg.cardDepositSum, cardDepRaw)
  eq('ⓒ 카드 줄 = 신용카드 칸 + 결제선생 칸 + 카드 보증금', agg.cardSum, cardLikeMethodSum(agg.byMethod) + agg.cardDepositSum)
  eq('ⓒ 실제 값', [agg.cardSum, agg.cardDepositSum], [572000, 100000])

  const allPays = rows.flatMap(r => r.methodPays ?? [])
  eq('ⓓ 보증금·조정·보유 보증금은 행에도 없다', allPays.filter(p => [500000, 100000, 90000, 0].includes(p.amount) || p.payDate === '2026-10-14').length, 0)
  eq('ⓓ 보유 보증금 칸 없음', agg.byMethod['보유 보증금'], undefined)

  console.log(`[수납 방법 필터 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
