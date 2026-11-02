// 재고 추적 단위 전환 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-track-unit-switch-flow.ts
//
// 왜 통합인가(운영자 승인 2026-11-02). 전환이 점검·위치 행·입수·폐기·수령 자동 메모를 한 트랜잭션에서 같은 배수로 바꾸는지,
// 그래서 잔량(overview)이 단위만 바뀌고 양은 그대로인지, 적용취소가 바이트 그대로 되살리고 그 뒤 기록이 있으면 거부하는지,
// 규격이 섞인 카드는 아무것도 안 바꾸고 거부하는지, 설정 저장으로는 단위를 못 바꾸는지는 실제 쓰기를 돌려야 보인다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 56000 + Math.floor(Math.random() * 900)
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
const r3 = (n: number | null | undefined) => n == null ? null : Math.round(n * 1000) / 1000

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
  const inv = await import('@/app/(app)/inventory/actions')
  const { computeInventoryOverview } = await import('@/app/(app)/inventory/overview')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const LOC = (await prisma.storageLocation.create({ data: { propertyId: P1, name: '창고', isHub: true } })).id as string

  const card = async (label: string, o: Record<string, unknown> = {}) => (await prisma.trackedItem.create({
    data: { propertyId: P1, category: '소모품비', label, specUnit: 'ml', qtyUnit: '개', trackUnit: 'spec', ...o },
  })).id as string
  const buy = async (label: string, specValue: number | null, specUnit: string | null, qty: number, at: string) => prisma.expense.create({
    data: { propertyId: P1, date: new Date(`${at}T00:00:00Z`), amount: 9000, category: '소모품비', itemLabel: label, qtyValue: qty, qtyUnit: '개', specValue, specUnit, receivedAt: new Date(`${at}T03:00:00Z`) },
  })
  const stockOf = async (id: string) => r3((await computeInventoryOverview(P1)).find((r: { id: string }) => r.id === id)?.currentStock ?? null)
  const bytes = async (id: string) => JSON.stringify({
    card: (await prisma.trackedItem.findUnique({ where: { id }, select: { trackUnit: true, specUnit: true, qtyUnit: true } })),
    checks: (await prisma.stockCheck.findMany({ where: { trackedItemId: id }, orderBy: { id: 'asc' }, include: { locationBreakdown: { orderBy: { id: 'asc' } } } }))
      .map(c => ({ id: c.id, q: r3(c.remainingQty), memo: c.memo, locs: c.locationBreakdown.map(l => [r3(l.remainingQty), r3(l.restockedQty)]) })),
    adds: (await prisma.stockAddition.findMany({ where: { trackedItemId: id }, orderBy: { id: 'asc' } })).map(a => r3(a.addedQty)),
    disps: (await prisma.stockDisposal.findMany({ where: { trackedItemId: id }, orderBy: { id: 'asc' } })).map(d => r3(d.disposedQty)),
  })

  // ── 세제(450ml 한 규격): 구매 둘, 수령 자동 점검(+4500ml, 위치 행), 입수 900ml, 폐기 450ml ───────────────────────
  const SOAP = await card('세제')
  await buy('세제', 450, 'ml', 10, '2026-10-01')
  await buy('세제', 0.45, 'L', 4, '2026-10-20')
  await prisma.trackedItemLocation.create({ data: { trackedItemId: SOAP, storageLocationId: LOC } })
  await prisma.stockCheck.create({ data: {
    trackedItemId: SOAP, date: new Date('2026-10-02T00:00:00Z'), remainingQty: 4500, memo: '[수령 자동] +4500ml', createdAt: new Date('2026-10-02T05:00:00Z'),
    locationBreakdown: { create: [{ storageLocationId: LOC, remainingQty: 4500, restockedQty: 900 }] },
  } })
  await prisma.stockAddition.create({ data: { trackedItemId: SOAP, date: new Date('2026-10-10T00:00:00Z'), addedQty: 900, createdAt: new Date('2026-10-10T05:00:00Z') } })
  await prisma.stockDisposal.create({ data: { trackedItemId: SOAP, date: new Date('2026-10-12T00:00:00Z'), disposedQty: 450, createdAt: new Date('2026-10-12T05:00:00Z') } })
  const before = await bytes(SOAP)
  const stockMl = await stockOf(SOAP)

  {
    const pv = await inv.previewTrackUnitSwitch(SOAP, 'qty')
    eq('T1 미리보기 ok · 1/450 · 기록 3건', pv.ok ? [r3(pv.factor * 450), pv.multiplier, pv.checks + pv.additions + pv.disposals] : pv, [1, 450, 3])
    // 설정 저장으로는 못 바꾼다
    const up = await inv.updateTrackedItem(SOAP, { trackUnit: 'qty' })
    eq('T2 설정 저장의 단위 변경 거부', [up.ok, await bytes(SOAP) === before], [false, true])
    // 화면이 본 단위가 다르면 거부
    const st = await inv.switchTrackUnit(SOAP, 'spec', { from: 'qty' })
    eq('T3 화면이 본 단위가 다르면 거부', [st.ok, await bytes(SOAP) === before], [false, true])
    g.__CR_FLOW_PID = P2
    eq('T4 남의 영업장 전환 거부', (await inv.switchTrackUnit(SOAP, 'qty', { from: 'spec' })).ok, false)
    g.__CR_FLOW_PID = P1
    eq('T4 바이트 그대로', await bytes(SOAP) === before, true)
  }
  let undo1: Awaited<ReturnType<typeof inv.switchTrackUnit>> | null = null
  {
    const sw = await inv.switchTrackUnit(SOAP, 'qty', { from: 'spec' })
    undo1 = sw
    eq('T5 전환 ok · 3건', sw.ok ? [sw.converted] : sw, [3])
    const after = JSON.parse(await bytes(SOAP))
    eq('T5 카드 수량 단위', after.card.trackUnit, 'qty')
    eq('T5 점검·위치 행·보충이 1/450', after.checks.map((c: { q: number; locs: number[][] }) => [c.q, c.locs]), [[10, [[10, 2]]]])
    eq('T5 수령 자동 메모 새 단위', after.checks.map((c: { memo: string }) => c.memo), ['[수령 자동] +10개'])
    eq('T5 입수·폐기도', [after.adds, after.disps], [[2], [1]])
    // 잔량은 단위만 바뀌고 양은 그대로(ml 잔량 / 450 = 개 잔량)
    eq('T5 잔량 양 보존', await stockOf(SOAP), r3((stockMl ?? 0) / 450))
  }
  {
    const u = undo1 && undo1.ok ? await inv.undoSwitchTrackUnit(undo1.undo) : { ok: false }
    eq('T6 적용취소 ok · 바이트 그대로', [u.ok, await bytes(SOAP) === before], [true, true])
    eq('T6 잔량 원래 ml', await stockOf(SOAP), stockMl)
  }
  {
    // 전환 뒤 점검이 생기면 적용취소 거부
    const sw = await inv.switchTrackUnit(SOAP, 'qty', { from: 'spec' })
    await new Promise(r => setTimeout(r, 15))
    await prisma.stockCheck.create({ data: { trackedItemId: SOAP, date: new Date('2026-11-02T00:00:00Z'), remainingQty: 7 } })
    const snap = await bytes(SOAP)
    const u = sw.ok ? await inv.undoSwitchTrackUnit(sw.undo) : { ok: true }
    eq('T7 전환 뒤 점검이 있으면 거부 · 그대로', [u.ok, await bytes(SOAP) === snap], [false, true])
    await prisma.stockCheck.deleteMany({ where: { trackedItemId: SOAP, remainingQty: 7 } })
    // 값이 0 인 뒤 점검(합계는 그대로)도 거부한다. 합계 대조와 따로 '전환 뒤 기록' 을 본다.
    await new Promise(r => setTimeout(r, 15))
    await prisma.stockCheck.create({ data: { trackedItemId: SOAP, date: new Date('2026-11-02T00:00:00Z'), remainingQty: 0, memo: '0 점검' } })
    const u0 = sw.ok ? await inv.undoSwitchTrackUnit(sw.undo) : { ok: true }
    eq('T7b 값 0 인 뒤 점검도 거부', u0.ok, false)
    await prisma.stockCheck.deleteMany({ where: { trackedItemId: SOAP, memo: '0 점검' } })
    // 값이 바뀌어도 거부(합계 CAS)
    await prisma.stockAddition.updateMany({ where: { trackedItemId: SOAP }, data: { addedQty: 3 } })
    const u2 = sw.ok ? await inv.undoSwitchTrackUnit(sw.undo) : { ok: true }
    eq('T8 값이 바뀌면 거부', u2.ok, false)
    await prisma.stockAddition.updateMany({ where: { trackedItemId: SOAP }, data: { addedQty: 2 } })
    // 위조 토큰(배수만 키움)은 지금 구매로 다시 센 배수와 안 맞아 거부
    const u3 = sw.ok ? await inv.undoSwitchTrackUnit({ ...sw.undo, factor: sw.undo.factor * 2 }) : { ok: true }
    eq('T9 배수 위조 거부', u3.ok, false)
    const u4 = sw.ok ? await inv.undoSwitchTrackUnit(sw.undo) : { ok: false }
    eq('T9 원래 토큰은 되돌림', [u4.ok, await bytes(SOAP) === before], [true, true])
  }

  // ── 섞인 카드(450ml·500ml): 기록이 있으면 거부, 아무것도 안 바뀐다 ────────────────────────────────────
  {
    const MIX = await card('섞인세제')
    await buy('섞인세제', 450, 'ml', 2, '2026-10-01')
    await buy('섞인세제', 500, 'ml', 2, '2026-10-05')
    await prisma.stockCheck.create({ data: { trackedItemId: MIX, date: new Date('2026-10-06T00:00:00Z'), remainingQty: 1500 } })
    const b = await bytes(MIX)
    const pv = await inv.previewTrackUnitSwitch(MIX, 'qty')
    eq('M1 미리보기 거부 · 까닭', pv.ok ? 'ok' : pv.error, '구매 규격이 450ml, 500ml 로 섞여 있어 지난 점검 값을 바꿀 배수를 정할 수 없습니다.')
    const sw = await inv.switchTrackUnit(MIX, 'qty', { from: 'spec' })
    eq('M2 전환 거부 · 바이트 그대로', [sw.ok, await bytes(MIX) === b], [false, true])
  }
  // ── 기록 없는 카드는 섞여도 전환된다(배수 1, 바꿀 값이 없다) ────────────────────────────────────────
  {
    const NEW = await card('새세제')
    await buy('새세제', 450, 'ml', 1, '2026-10-01')
    await buy('새세제', 500, 'ml', 1, '2026-10-02')
    const sw = await inv.switchTrackUnit(NEW, 'qty', { from: 'spec' })
    eq('N1 기록 없음 전환 ok · 0건', sw.ok ? [sw.factor, sw.converted] : sw, [1, 0])
    const u = sw.ok ? await inv.undoSwitchTrackUnit(sw.undo) : { ok: false }
    eq('N1 적용취소 ok', [u.ok, (await prisma.trackedItem.findUnique({ where: { id: NEW } }))?.trackUnit], [true, 'spec'])
  }
  // ── 수량에서 규격으로(450 배) ─────────────────────────────────────────────────────────────────────
  {
    const Q = await card('수량세제', { trackUnit: 'qty' })
    await buy('수량세제', 450, 'ml', 3, '2026-10-01')
    await prisma.stockCheck.create({ data: { trackedItemId: Q, date: new Date('2026-10-02T00:00:00Z'), remainingQty: 3, memo: '[수령 자동] +3개' } })
    const sQty = await stockOf(Q)
    const sw = await inv.switchTrackUnit(Q, 'spec', { from: 'qty' })
    const c = await prisma.stockCheck.findFirst({ where: { trackedItemId: Q } })
    eq('Q1 수량에서 규격 · 450배 · 메모', [sw.ok, r3(c?.remainingQty), c?.memo], [true, 1350, '[수령 자동] +1350ml'])
    eq('Q1 잔량 양 보존', await stockOf(Q), r3((sQty ?? 0) * 450))
  }

  console.log(`[추적 단위 전환 통합] 통과 ${pass} / 실패 ${fail}`)
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
