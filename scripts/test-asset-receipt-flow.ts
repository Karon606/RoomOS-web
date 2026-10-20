// 비품 수령·배정·소모품 수량 관문 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서 그대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-asset-receipt-flow.ts
//
// 왜 통합인가(2026-10-15 냉장고 519호 건, 계획서 비품-전환-배정 1단계). 판정 진리표(test-asset-receipt)는 순수 함수만
// 본다. 수령과 배정과 이력이 한 트랜잭션인지, 적용취소가 행을 **바이트까지** 되돌리는지, 부분 도착 분할의 금액 합이
// 그대로인지, 다른 영업장 방을 못 거는지는 실제 쓰기를 돌려야 보인다.
//
// 대역·운영 DB 차단은 현금영수증 하네스(scripts/test-cash-receipt-flow.ts)와 같은 판이다. '@/lib/prisma' 는 하네스
// PGlite 주소가 아니면 연결을 거부하고, 스키마는 prisma/schema.prisma 에서 그때그때 뽑는다(외래키는 뺀다).
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
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

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
  const assets = await import('@/app/(app)/inventory/assets/actions')
  const inv = await import('@/app/(app)/inventory/actions')
  const fin = await import('@/app/(app)/finance/actions')
  const rp = await import('@/app/(app)/inventory/assets/receiptPlacement')
  const gate = await import('@/app/(app)/inventory/receiptQtyGate')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const room = async (pid: string, no: string) => (await prisma.room.create({ data: { roomNo: no, propertyId: pid } })).id as string
  const R519 = await room(P1, '519'), R520 = await room(P1, '520'), R999 = await room(P2, '999')
  g.__CR_FLOW_PID = P1

  const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
  type Ex = { category?: string; itemLabel?: string; qtyValue?: number | null; qtyUnit?: string | null; amount?: number; targetRoomId?: string | null; roomId?: string | null; receivedAt?: Date | null; specValue?: number | null; specUnit?: string | null; detail?: string | null }
  const exp = async (o: Ex) => (await prisma.expense.create({
    data: {
      propertyId: P1, date: day('2026-10-13'), amount: o.amount ?? 133000, category: o.category ?? '수선유지비',
      itemLabel: o.itemLabel ?? '갈란츠 미니 1도어 냉장고', qtyValue: o.qtyValue === undefined ? 1 : o.qtyValue, qtyUnit: o.qtyUnit === undefined ? '개' : o.qtyUnit,
      targetRoomId: o.targetRoomId ?? null, roomId: o.roomId ?? null, receivedAt: o.receivedAt ?? null,
      specValue: o.specValue ?? null, specUnit: o.specUnit ?? null, detail: o.detail ?? null, vendor: '쿠팡(주)',
    },
  })).id as string
  // 행 바이트. updatedAt 만 뺀 전 칼럼(@updatedAt 은 쓰기마다 바뀌는 시각이라 상태가 아니다).
  const bytes = async (where: object) => (await prisma.expense.findMany({ where: { propertyId: P1, ...where }, orderBy: { id: 'asc' } }))
    .map((r: Record<string, unknown>) => { const { updatedAt: _u, ...rest } = r; void _u; return JSON.stringify(rest) })
  const logs = async (label: string) => (await prisma.assetAssignmentLog.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: { createdAt: 'asc' } }))
    .map((l: { fromKind: string; fromLabel: string | null; toKind: string; toLabel: string | null; qty: number | null; assignedAt: Date | null }) => [l.fromKind, l.fromLabel, l.toKind, l.toLabel, l.qty, !!l.assignedAt])
  const amountSum = async () => (await prisma.expense.aggregate({ where: { propertyId: P1 }, _sum: { amount: true } }))._sum.amount ?? 0
  // 화면이 창에 띄우는 계획을 서버와 같은 순수 함수로 만든다(검수 N-4, 배정 요청은 계획을 같이 보낸다).
  const expectOf = async (ids: string[]) => {
    const rows = await prisma.expense.findMany({ where: { id: { in: ids }, propertyId: P1, receivedAt: null } })
    const alive = new Map((await prisma.room.findMany({ where: { propertyId: P1 } })).map((r: { id: string; roomNo: string }) => [r.id, r.roomNo]))
    return rp.planExpectOf(rows.map((e: { id: string; qtyValue: number | null; targetRoomId: string | null; roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean }) => ({
      id: e.id, units: e.qtyValue ?? 1, targetRoomId: e.targetRoomId, targetRoomNo: e.targetRoomId ? (alive.get(e.targetRoomId) ?? null) : null,
      unplaced: !e.roomId && !e.assignedLocationId && !e.isCommonAsset,
    })))
  }
  const withPlan = async (ids: string[]) => ({ assign: true, expect: await expectOf(ids) })
  const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

  // ── S1 비품 수령은 소모품 id 를 거부한다(참·거짓 둘 다) ───────────────────────────
  {
    const T = await exp({ category: '소모품비', itemLabel: '주방세제' })
    const r1 = await assets.setAssetReceived([T], true)
    eq('S1 받음 거부(소모품 문구)', r1, { ok: false, error: rp.ASSET_RECEIPT_DENY_TRACKED })
    await prisma.expense.update({ where: { id: T }, data: { receivedAt: new Date('2026-10-14T00:00:00Z') } })
    const r2 = await assets.setAssetReceived([T], false)
    eq('S1 수령 대기로 거부(이중 입고 뒷문)', r2, { ok: false, error: rp.ASSET_RECEIPT_DENY_TRACKED })
    eq('S1 수령 상태 그대로', !!(await prisma.expense.findUnique({ where: { id: T } }))?.receivedAt, true)
    const r3 = await assets.setAssetReceived([randomUUID()], true)
    eq('S1 남의·없는 id 는 낡은 화면 거부', r3, { ok: false, error: rp.ASSET_RECEIPT_DENY_STALE })
  }

  // ── S5 수령 + 배정(단일)과 적용취소 바이트 동일 ─────────────────────────────────────
  {
    const E = await exp({ targetRoomId: R519, qtyValue: 1 })
    const before = await bytes({ id: E })
    const sum0 = await amountSum()
    const r = await assets.setAssetReceived([E], true, null, await withPlan([E]))
    if (!r.ok) throw new Error(r.error)
    const row = await prisma.expense.findUnique({ where: { id: E } })
    // 배정일은 KST 오늘(@db.Date). 받은 시각을 KST 날짜로 읽은 값과 같아야 한다. KST 00~09시 수령이 어제로 박히지 않게.
    const kstDay = (d: Date | null | undefined) => d ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : null
    eq('F2 단일: 받음·519호·배정일·예정 호실 유지', [!!row?.receivedAt, row?.roomId === R519, !!row?.assignedAt, row?.targetRoomId === R519, row?.assignedAt?.toISOString().slice(0, 10) === kstDay(row?.receivedAt)], [true, true, true, true, true])
    eq('F2 단일: 이력 미배정에서 519호 1개', await logs('갈란츠 미니 1도어 냉장고'), [['none', '미배정', 'room', '519호', 1, true]])
    eq('F2 금액 합 불변', await amountSum(), sum0)
    const u = await assets.undoAssetReceipt(J(r.undo!))
    eq('F2 단일 적용취소 ok', u, { ok: true })
    eq('F2 단일 적용취소: 행 바이트 동일(예정 호실 남음)', await bytes({ id: E }), before)
    eq('F2 단일 적용취소: 이력 줄도 지움', await logs('갈란츠 미니 1도어 냉장고'), [])
    eq('F2 두 번째 적용취소는 거부(반쪽 금지)', (await assets.undoAssetReceipt(J(r.undo!))).ok, false)
    // 수령만. 배정 없이 받고, 같은 토큰으로 되돌린다
    const r2 = await assets.setAssetReceived([E], true)
    if (!r2.ok) throw new Error(r2.error)
    const row2 = await prisma.expense.findUnique({ where: { id: E } })
    eq('F2 수령만: 미배정·예정 호실 유지', [!!row2?.receivedAt, row2?.roomId, row2?.targetRoomId === R519, (await logs('갈란츠 미니 1도어 냉장고')).length], [true, null, true, 0])
    await assets.undoAssetReceipt(J(r2.undo!))
    eq('F2 수령만 적용취소: 바이트 동일', await bytes({ id: E }), before)
    // 받은 뒤 옮겼으면 적용취소는 거부하고 아무것도 안 바꾼다
    const r3 = await assets.setAssetReceived([E], true, null, await withPlan([E]))
    if (!r3.ok) throw new Error(r3.error)
    const mv = await assets.assignAggregateToTarget([E], { kind: 'room', id: R520 }, null)
    eq('F2 받은 뒤 520호로 옮김', mv.ok, true)
    const moved = await bytes({ id: E })
    const u3 = await assets.undoAssetReceipt(J(r3.undo!))
    eq('F2 옮긴 뒤 적용취소 거부(배정 갈래 문장)', u3, { ok: false, error: rp.ASSET_RECEIPT_UNDO_STALE })
    eq('F2 거부면 아무것도 안 바뀜', await bytes({ id: E }), moved)
    // 정리. 이 행은 이후 시나리오에 안 쓴다
    await prisma.expense.delete({ where: { id: E } })
    await prisma.assetAssignmentLog.deleteMany({ where: { propertyId: P1 } })
  }

  // ── S5 부분 도착(한 방). 분할 금액 비례·합 불변·적용취소 바이트 동일 ───────────────────
  {
    const E = await exp({ itemLabel: '의자', targetRoomId: R519, qtyValue: 4, amount: 100001 })
    const before = await bytes({ itemLabel: '의자' })
    const sum0 = await amountSum()
    const r = await assets.setAssetReceived([E], true, 2, await withPlan([E]))
    if (!r.ok) throw new Error(r.error)
    const rows = await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: '의자' }, orderBy: { createdAt: 'asc' } })
    eq('F2 부분: 두 행(잔여 대기 + 받은 조각)', rows.length, 2)
    const rem = rows.find((x: { id: string }) => x.id === E)!, got = rows.find((x: { id: string }) => x.id !== E)!
    eq('F2 부분: 잔여 2개 수령 대기·미배정', [rem.qtyValue, !!rem.receivedAt, rem.roomId], [2, false, null])
    eq('F2 부분: 받은 2개 519호·배정일·예정 호실 물려받음', [got.qtyValue, !!got.receivedAt, got.roomId === R519, !!got.assignedAt, got.targetRoomId === R519], [2, true, true, true, true])
    eq('F2 부분: 금액 비례(반올림)·합 불변', [got.amount, rem.amount, await amountSum() - sum0], [50001, 50000, 0])
    eq('F2 부분: 같은 구매 묶음', !!rem.allocationGroupId && rem.allocationGroupId === got.allocationGroupId, true)
    eq('F2 부분: 이력 2개', await logs('의자'), [['none', '미배정', 'room', '519호', 2, true]])
    const u = await assets.undoAssetReceipt(J(r.undo!))
    eq('F2 부분 적용취소 ok', u, { ok: true })
    eq('F2 부분 적용취소: 바이트 동일(조각 지움·원행 복원)', await bytes({ itemLabel: '의자' }), before)
    eq('F2 부분 적용취소: 이력 지움', await logs('의자'), [])
    // 부분 수령만(배정 없음)에도 적용취소가 있다. 종전에는 없었다
    const r2 = await assets.setAssetReceived([E], true, 1)
    if (!r2.ok) throw new Error(r2.error)
    eq('F2 부분 수령만에도 토큰', !!r2.undo, true)
    await assets.undoAssetReceipt(J(r2.undo!))
    eq('F2 부분 수령만 적용취소: 바이트 동일', await bytes({ itemLabel: '의자' }), before)
  }

  // ── S5 여러 방 · 부분 도착 + 여러 방 · 지운 방 ────────────────────────────────────
  {
    const A = await exp({ itemLabel: '선풍기', targetRoomId: R519, qtyValue: 1, amount: 30000 })
    const B = await exp({ itemLabel: '선풍기', targetRoomId: R520, qtyValue: 1, amount: 30000 })
    const before = await bytes({ itemLabel: '선풍기' })
    const amb = await assets.setAssetReceived([A, B], true, 1, await withPlan([A, B]))
    eq('F2 부분 도착 + 여러 방: 배정 요청 거부', amb, { ok: false, error: rp.ASSET_RECEIPT_PLAN_STALE })
    eq('F2 거부면 무변경', await bytes({ itemLabel: '선풍기' }), before)
    const r = await assets.setAssetReceived([A, B], true, null, await withPlan([A, B]))
    if (!r.ok) throw new Error(r.error)
    const ra = await prisma.expense.findUnique({ where: { id: A } }), rb = await prisma.expense.findUnique({ where: { id: B } })
    eq('F2 여러 방: 적은 대로 배정', [ra?.roomId === R519, rb?.roomId === R520], [true, true])
    eq('F2 여러 방: 방마다 이력 한 줄', (await logs('선풍기')).map(l => l[3]).sort(), ['519호', '520호'])
    await assets.undoAssetReceipt(J(r.undo!))
    eq('F2 여러 방 적용취소: 바이트 동일', await bytes({ itemLabel: '선풍기' }), before)
    const r2 = await assets.setAssetReceived([A, B], true, 1)
    if (!r2.ok) throw new Error(r2.error)
    eq('F2 부분 도착 + 여러 방: 미배정으로 1개 받음', (await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: '선풍기', receivedAt: { not: null } } })).map((x: { roomId: string | null }) => x.roomId), [null])
    await assets.undoAssetReceipt(J(r2.undo!))
    eq('F2 부분 도착 + 여러 방 적용취소: 바이트 동일', await bytes({ itemLabel: '선풍기' }), before)
    const D = await exp({ itemLabel: '책상', targetRoomId: randomUUID(), qtyValue: 1 })
    eq('F2 지운 방이면 배정 요청 거부', await assets.setAssetReceived([D], true, null, await withPlan([D])), { ok: false, error: rp.ASSET_RECEIPT_PLAN_STALE })
    const X = await exp({ itemLabel: '책상2', targetRoomId: R999, qtyValue: 1 })
    eq('F2 남의 영업장 방이면 배정 요청 거부', await assets.setAssetReceived([X], true, null, await withPlan([X])), { ok: false, error: rp.ASSET_RECEIPT_PLAN_STALE })
  }

  // ── S4 수령 전 비품에 자리를 쓰는 길은 막힌다 ────────────────────────────────────
  {
    const E = await exp({ itemLabel: '행거', qtyValue: 2 })
    const before = await bytes({ itemLabel: '행거' })
    eq('S4 옮기기 거부', await assets.assignAggregateToTarget([E], { kind: 'room', id: R519 }, null), { ok: false, error: rp.ASSET_ASSIGN_DENY_UNRECEIVED })
    eq('S4 나눠 배정 거부', await assets.distributeAssetToTargets({ ids: [E], targets: [{ target: { kind: 'room', id: R519 }, qty: 1 }] }), { ok: false, error: rp.ASSET_ASSIGN_DENY_UNRECEIVED })
    eq('S4 일괄 배정 거부', await assets.batchAssignAssets({ items: [{ ids: [E], qty: null }], target: { kind: 'room', id: R519 } }), { ok: false, error: rp.ASSET_ASSIGN_DENY_UNRECEIVED })
    eq('S4 거부면 무변경', await bytes({ itemLabel: '행거' }), before)
    const Pd = await exp({ itemLabel: '거울', qtyValue: 1, roomId: R519, receivedAt: new Date('2026-10-14T00:00:00Z') })
    eq('S4 놓인 비품 수령 대기로 거부', await assets.setAssetReceived([Pd], false), { ok: false, error: rp.ASSET_UNRECEIVE_DENY_PLACED })
  }

  // ── S4 지출 저장. 배정 예정 호실은 영업장 방만, 비품 물품만 ─────────────────────────
  {
    const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
    const item = (label: string, amount: number) => JSON.stringify([{ label, qtyValue: '1', qtyUnit: '개', amount }])
    const base = { date: '2026-10-15', amount: '50000', payMethod: '계좌이체' }
    const a1 = await fin.addExpense(fd({ ...base, category: '수선유지비', roomId: '', targetRoomId: R519, itemLabel: '의자A', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자A', 50000) }))
    eq('S4 등록 ok', a1.ok, true)
    const s1 = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: '의자A' } })
    eq('S4 비품 등록: 예정 호실만', [s1?.roomId, s1?.targetRoomId === R519], [null, true])
    const a2 = await fin.addExpense(fd({ ...base, category: '수선유지비', roomId: '', targetRoomId: R999, itemLabel: '의자B', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자B', 50000) }))
    eq('S4 남의 영업장 방은 거부', a2, { ok: false, error: '호실 정보를 찾을 수 없습니다.' })
    eq('S4 거부면 아무것도 안 만든다', await prisma.expense.count({ where: { propertyId: P1, itemLabel: '의자B' } }), 0)
    await fin.addExpense(fd({ ...base, category: '소모품비', roomId: R519, targetRoomId: R519, itemLabel: '휴지A', qtyValue: '1', qtyUnit: '개', itemsJson: item('휴지A', 50000) }))
    const s3 = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: '휴지A' } })
    eq('S4 소모품: 대상 호실 그대로·예정 비움', [s3?.roomId === R519, s3?.targetRoomId], [true, null])
    await fin.addExpense(fd({ ...base, category: '수선유지비', roomId: R520, itemLabel: '의자C', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자C', 50000) }))
    const s4 = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: '의자C' } })
    eq('S4 옛 화면이 비품에 roomId 를 실으면 예정으로 옮긴다', [s4?.roomId, s4?.targetRoomId === R520], [null, true])
    // 수정. 받기 전 비품은 칸 값으로, 칸 부재면 보존
    const u1 = await fin.updateExpense(fd({ id: s1!.id, ...base, category: '수선유지비', roomId: '', targetRoomId: R520, itemLabel: '의자A', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자A', 50000) }))
    eq('S4 수정 ok', u1.ok, true)
    eq('S4 수정: 예정 호실 바꿈', (await prisma.expense.findUnique({ where: { id: s1!.id } }))?.targetRoomId === R520, true)
    await fin.updateExpense(fd({ id: s1!.id, ...base, category: '수선유지비', roomId: '', itemLabel: '의자A', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자A', 50000) }))
    eq('S4 수정: 칸 부재면 예정 보존', (await prisma.expense.findUnique({ where: { id: s1!.id } }))?.targetRoomId === R520, true)
    await fin.updateExpense(fd({ id: s1!.id, ...base, category: '소모품비', roomId: R519, itemLabel: '의자A', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자A', 50000) }))
    const s5 = await prisma.expense.findUnique({ where: { id: s1!.id } })
    eq('S4 수정: 소모품으로 바꾸면 예정 비움·대상 호실', [s5?.targetRoomId, s5?.roomId === R519], [null, true])
    const u2 = await fin.updateExpense(fd({ id: s4!.id, ...base, category: '수선유지비', roomId: '', targetRoomId: R999, itemLabel: '의자C', qtyValue: '1', qtyUnit: '개', itemsJson: item('의자C', 50000) }))
    eq('S4 수정: 남의 영업장 방 거부', u2, { ok: false, error: '호실 정보를 찾을 수 없습니다.' })
  }

  // ── S3 소모품 수량 없는 수령. 거부, 채우면 자동 점검, 수령 취소로 바이트 동일 ───────────────
  {
    const card = await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '쌀', trackUnit: 'spec', specUnit: 'kg', qtyUnit: '포' } })
    const T = await exp({ category: '소모품비', itemLabel: '쌀', qtyValue: null, qtyUnit: null, specValue: 20, specUnit: 'kg', detail: '[쌀] 20kg', amount: 55000 })
    const before = await bytes({ id: T })
    eq('S3 수량 없이 수령 거부', await inv.confirmReceipt(T), { ok: false, error: gate.RECEIPT_QTY_REQUIRED })
    eq('S3 거부면 무변경', await bytes({ id: T }), before)
    const r = await inv.confirmReceipt(T, undefined, undefined, 2)
    if (!r.ok) throw new Error(r.error)
    const row = await prisma.expense.findUnique({ where: { id: T } })
    eq('S3 채움: 수량·카드 단위·세부', [row?.qtyValue, row?.qtyUnit, row?.detail, !!row?.receivedAt], [2, '포', '[쌀] 20kg x 2포', true])
    const checks = await prisma.stockCheck.findMany({ where: { trackedItemId: card.id } })
    eq('S3 자동 점검이 생긴다(유령수령 아님)', checks.map((c: { sourceExpenseId: string | null; remainingQty: number }) => [c.sourceExpenseId === T, c.remainingQty]), [[true, 40]])
    const { sig: fillSig, ...fillBody } = J(r.qtyFill!)
    eq('S3 적용취소 조각(서명 붙음)', [fillBody, typeof fillSig === 'string' && fillSig.length > 20], [{ expenseId: T, qtyValue: 2, qtyUnit: '포', detail: '[쌀] 20kg x 2포', prevQtyValue: null, prevQtyUnit: null, prevDetail: '[쌀] 20kg' }, true])
    const u = await inv.undoConfirmReceipt(T, { qtyFill: J(r.qtyFill!) })
    eq('S3 수령 취소 ok', u.ok, true)
    eq('S3 수령 취소: 바이트 동일(수량·세부도 원래 빈 값)', await bytes({ id: T }), before)
    eq('S3 수령 취소: 자동 점검 지움', await prisma.stockCheck.count({ where: { trackedItemId: card.id } }), 0)
    // 한꺼번에 받는 경로는 칸이 없어 시작하지 않는다
    const T2 = await exp({ category: '소모품비', itemLabel: '쌀', qtyValue: 1, qtyUnit: '포', specValue: 20, specUnit: 'kg', amount: 55000 })
    const all = await inv.confirmAllPending(card.id)
    eq('S3 한꺼번에: 빈 수량 섞이면 거부', all, { ok: false, error: gate.receiptQtyRequiredMany(1) })
    eq('S3 한꺼번에: 아무것도 안 받음', [!!(await prisma.expense.findUnique({ where: { id: T2 } }))?.receivedAt, !!(await prisma.expense.findUnique({ where: { id: T } }))?.receivedAt], [false, false])
    // 구매 수정의 수령일. 관문은 첫 쓰기보다 앞(날짜·금액이 반쯤 바뀌지 않는다)
    const u0 = await inv.updateExpenseFromInventory(T, { date: '2026-10-01', amount: 1, receivedAt: '2026-10-14T03:00:00.000Z' })
    eq('S3 수정 수령일: 수량 없으면 거부', u0, { ok: false, error: gate.RECEIPT_QTY_REQUIRED })
    eq('S3 수정 수령일: 거부면 무변경', await bytes({ id: T }), before)
    const u1 = await inv.updateExpenseFromInventory(T, { receivedAt: '2026-10-14T03:00:00.000Z', qtyValue: 1 })
    eq('S3 수정 수령일 + 도착 수량: 받음·토큰', [u1.ok, u1.ok ? !!u1.received?.qtyFill : null], [true, true])
    eq('S3 수정 수령일: 자동 점검 날짜 = 고른 날', (await prisma.stockCheck.findFirst({ where: { sourceExpenseId: T } }))?.date.toISOString().slice(0, 10), '2026-10-14')
  }

  // ── S2 '같이 변경' 카드 정리를 적용취소로 같은 id 로 되살린다 ───────────────────────────
  {
    const card = await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '갈란츠 냉장고', trackUnit: 'spec', specUnit: 'L' } })
    const r = await inv.syncTrackedItemCategory('갈란츠 냉장고', '소모품비', '수선유지비')
    eq('S2 빈 카드 삭제 + 토큰', r.ok ? [r.retired, !!r.deleteUndo] : r, ['deleted', true])
    eq('S2 카드 없음', await prisma.trackedItem.count({ where: { id: card.id } }), 0)
    if (r.ok && r.deleteUndo) {
      const u = await inv.undoDeleteTrackedItem(J(r.deleteUndo))
      eq('S2 적용취소: 같은 id 로 되살림', [u.ok, (await prisma.trackedItem.findUnique({ where: { id: card.id } }))?.label], [true, '갈란츠 냉장고'])
    }
    await prisma.stockCheck.create({ data: { trackedItemId: card.id, date: day('2026-10-14'), remainingQty: 1 } })
    const r2 = await inv.syncTrackedItemCategory('갈란츠 냉장고', '소모품비', '수선유지비')
    eq('S2 기록 있으면 숨김 + 토큰', r2.ok ? [r2.retired, r2.archivedId === card.id] : r2, ['archived', true])
    if (r2.ok && r2.archivedId) {
      const u2 = await inv.unarchiveTrackedItem(r2.archivedId)
      eq('S2 숨김 적용취소', [u2.ok, (await prisma.trackedItem.findUnique({ where: { id: card.id } }))?.isArchived], [true, false])
    }
  }

  // ── 멀티테넌트: 남의 영업장 토큰·id 로는 아무것도 못 바꾼다 ─────────────────────────────
  {
    const E = await exp({ itemLabel: '소파', targetRoomId: R519, qtyValue: 1 })
    const r = await assets.setAssetReceived([E], true, null, await withPlan([E]))
    if (!r.ok) throw new Error(r.error)
    const after = await bytes({ id: E })
    g.__CR_FLOW_PID = P2
    eq('MT 다른 영업장에서 적용취소 거부', (await assets.undoAssetReceipt(J(r.undo!))).ok, false)
    eq('MT 다른 영업장에서 수령 대기로 거부', (await assets.setAssetReceived([E], false)).ok, false)
    g.__CR_FLOW_PID = P1
    eq('MT 무변경', await bytes({ id: E }), after)
  }

  // ═══ 독립 검수·웹디자이너 패스 반영(2026-10-15) ═══════════════════════════════════════
  // F-1 부분 도착 뒤 받은 조각을 미배정으로 돌려도 수령 대기 잔여와 접히지 않는다(세 길)
  {
    const shape = async (label: string) => (await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: { createdAt: 'asc' } }))
      .map((r: { qtyValue: number | null; receivedAt: Date | null; roomId: string | null; allocationGroupId: string | null }) => [r.qtyValue, !!r.receivedAt, r.roomId === R519 ? '519' : r.roomId, !!r.allocationGroupId])
    const E1 = await exp({ itemLabel: 'F1의자a', targetRoomId: R519, qtyValue: 4, amount: 100000 })
    const r1 = await assets.setAssetReceived([E1], true, 2, await withPlan([E1]))
    if (!r1.ok) throw new Error(r1.error)
    const p1 = r1.undo!.created[0].id
    eq('F-1a 519호 수량 줄이기(1개 미배정으로)', (await assets.assignAggregateToTarget([p1], { kind: 'none' }, 1)).ok, true)
    eq('F-1a 받은 1개는 미배정·잔여 2개는 수령 대기 그대로', (await shape('F1의자a')).sort(), [[1, true, '519', true], [1, true, null, true], [2, false, null, true]].sort())
    const E2 = await exp({ itemLabel: 'F1의자b', targetRoomId: R519, qtyValue: 4, amount: 100000 })
    const r2 = await assets.setAssetReceived([E2], true, 2, await withPlan([E2]))
    if (!r2.ok) throw new Error(r2.error)
    eq('F-1b 조각 통째 미배정', (await assets.assignAggregateToTarget([r2.undo!.created[0].id], { kind: 'none' }, null)).ok, true)
    eq('F-1b 받은 2개는 미배정으로 남고 수령 대기와 안 접힌다', await shape('F1의자b'), [[2, false, null, true], [2, true, null, true]])
    eq('F-1b 금액 합 그대로', (await prisma.expense.aggregate({ where: { propertyId: P1, itemLabel: 'F1의자b' }, _sum: { amount: true } }))._sum.amount, 100000)
    const E3 = await exp({ itemLabel: 'F1의자c', targetRoomId: R519, qtyValue: 4, amount: 100000 })
    const r3 = await assets.setAssetReceived([E3], true, 2, await withPlan([E3]))
    if (!r3.ok) throw new Error(r3.error)
    const log3 = (await prisma.assetAssignmentLog.findFirst({ where: { propertyId: P1, itemLabel: 'F1의자c' } }))!
    eq('F-1c 수령 배정 이력 되돌리기', (await assets.revertAssignmentLog(log3.id)).ok, true)
    eq('F-1c 받은 2개 미배정·수령 대기 2개 그대로·이력 지움', [await shape('F1의자c'), (await logs('F1의자c')).length], [[[2, false, null, true], [2, true, null, true]], 0])
  }
  // F-2 배정 이력 되돌리기가 수령 전 행을 방에 넣지 않는다
  {
    const X = await exp({ itemLabel: 'F2거울', qtyValue: 1, roomId: R519, receivedAt: new Date('2026-10-01T00:00:00Z') })
    await assets.assignAggregateToTarget([X], { kind: 'none' }, null)
    await assets.assignAggregateToTarget([X], { kind: 'room', id: R520 }, null)
    const Y = await exp({ itemLabel: 'F2거울', qtyValue: 1, targetRoomId: R519 })
    const before = await bytes({ id: Y })
    const logA = (await prisma.assetAssignmentLog.findMany({ where: { propertyId: P1, itemLabel: 'F2거울', toKind: 'none' } }))[0]
    const rv = await assets.revertAssignmentLog(logA.id)
    eq('F-2 미배정 쪽에 받은 것이 없으면 되돌릴 수 없다고 말한다', rv.ok, false)
    eq('F-2 수령 전 행은 그대로(방에 안 들어감)', await bytes({ id: Y }), before)
  }
  // R-1 '재고 계산에 다시 포함'이 방에 걸린 서비스를 수령 전 비품 + 방으로 만들지 않는다. 제외로 되돌리면 원래 두 칸
  {
    const S = (await prisma.expense.create({ data: { propertyId: P1, date: day('2026-10-03'), amount: 40000, category: '수선유지비', itemLabel: 'R1도배', roomId: R519, excludeFromInventory: true } })).id as string
    const before = await bytes({ id: S })
    eq('R-1 다시 포함 ok', (await inv.includeExpenseInInventory(S)).ok, true)
    const e = await prisma.expense.findUnique({ where: { id: S } })
    eq('R-1 받기 전 비품: 방은 배정 예정 호실로', [e?.roomId, e?.targetRoomId === R519, e?.excludeFromInventory], [null, true, false])
    eq('R-1 제외로 되돌리면 바이트 동일', [(await inv.excludeExpenseFromInventory(S)).ok, await bytes({ id: S })], [true, before])
  }
  // R-2 재고 화면의 수령·수령 취소는 소모품만(비품 쪽 S1 의 거울)
  {
    const E = await exp({ itemLabel: 'R2책상', qtyValue: 1, roomId: R519, receivedAt: new Date('2026-10-01T00:00:00Z') })
    const before = await bytes({ id: E })
    eq('R-2 수령 취소 거부', await inv.undoConfirmReceipt(E), { ok: false, error: gate.INVENTORY_RECEIPT_DENY_UNTRACKED })
    eq('R-2 구매 수정 수령일 비우기 거부', await inv.updateExpenseFromInventory(E, { receivedAt: null }), { ok: false, error: gate.INVENTORY_RECEIPT_DENY_UNTRACKED })
    eq('R-2 거부면 무변경', await bytes({ id: E }), before)
    const P = await exp({ itemLabel: 'R2책상b', qtyValue: 1, targetRoomId: R519 })
    eq('R-2 재고 화면 수령도 비품은 거부(배정 물음 우회 금지)', await inv.confirmReceipt(P), { ok: false, error: gate.INVENTORY_RECEIPT_DENY_UNTRACKED })
  }
  // R-3 수령만 뒤 공용 자재로 돌렸으면 적용취소는 거부(공용 표식 CAS)
  {
    const E = await exp({ itemLabel: 'R3선반', qtyValue: 1, targetRoomId: R519 })
    const r = await assets.setAssetReceived([E], true)
    if (!r.ok) throw new Error(r.error)
    await assets.setCommonAsset([E], true)
    const after = await bytes({ id: E })
    eq('R-3 공용 표식 뒤 적용취소 거부(수령만 갈래 문장)', await assets.undoAssetReceipt(J(r.undo!)), { ok: false, error: rp.ASSET_RECEIPT_UNDO_STALE_RECEIVE })
    eq('R-3 거부면 무변경', await bytes({ id: E }), after)
  }
  // N-1 위조 토큰. 무관한 지출·변조 값·변조 서명은 아무것도 못 쓴다
  {
    const U = (await prisma.expense.create({ data: { propertyId: P1, date: day('2026-10-02'), amount: 50000, category: '공과금', detail: '전기요금' } })).id as string
    const uBefore = await bytes({ id: U })
    const forged = { v: 1, at: new Date().toISOString(), received: [], split: [{ id: U, prevGroupId: null, prevDetail: '조작', now: { qtyValue: 1, amount: 50000, groupId: 'g', itemLabel: null } }], created: [], logIds: [] }
    eq('N-1 무관한 지출 위조 토큰 거부', await assets.undoAssetReceipt(forged as never), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('N-1 옛 모양 위조 토큰 거부', await assets.undoAssetReceipt({ at: new Date().toISOString(), rows: [{ id: U, prev: { amount: 1, detail: '조작' }, now: { received: false, amount: 50000 } }], created: [], logIds: [] } as never), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('N-1 공과금 무변경', await bytes({ id: U }), uBefore)
    const E = await exp({ itemLabel: 'N1의자', targetRoomId: R519, qtyValue: 4, amount: 100000 })
    const r = await assets.setAssetReceived([E], true, 2, await withPlan([E]))
    if (!r.ok) throw new Error(r.error)
    const t = J(r.undo!)
    const after = await bytes({ itemLabel: 'N1의자' })
    eq('N-1 값 변조(원래 세부) 토큰은 서명에서 거부', await assets.undoAssetReceipt({ ...t, split: [{ ...t.split[0], prevDetail: '조작' }] }), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('N-1 서명 변조 거부', await assets.undoAssetReceipt({ ...t, sig: 'AAAA' + (t.sig ?? '').slice(4) }), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('N-1 다른 영업장 서명으로 거부(같은 토큰)', await (async () => { g.__CR_FLOW_PID = P2; const x = await assets.undoAssetReceipt(t); g.__CR_FLOW_PID = P1; return x })(), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('N-1 거부면 무변경', await bytes({ itemLabel: 'N1의자' }), after)
    eq('N-1 진짜 토큰은 통과', (await assets.undoAssetReceipt(t)).ok, true)
    // 채움 조각 위조
    await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: 'N1쌀', trackUnit: 'spec', specUnit: 'kg', qtyUnit: '포' } })
    const T = await exp({ category: '소모품비', itemLabel: 'N1쌀', qtyValue: null, qtyUnit: null, specValue: 20, specUnit: 'kg', detail: '[N1쌀] 20kg', amount: 55000 })
    const tBefore = await bytes({ id: T })
    const c = await inv.confirmReceipt(T, undefined, undefined, 2)
    if (!c.ok) throw new Error(c.error)
    const fillTok = J(c.qtyFill!)
    const recvState = await bytes({ id: T })
    eq('N-1 채움 조각 원래 값 위조(999·톤) 거부', await inv.undoConfirmReceipt(T, { qtyFill: { ...fillTok, prevQtyValue: 999, prevQtyUnit: '톤' } }), { ok: false, error: gate.QTY_FILL_INVALID })
    eq('N-1 채움 조각 세부 위조(서명 불일치) 거부', await inv.undoConfirmReceipt(T, { qtyFill: { ...fillTok, prevDetail: '조작' } }), { ok: false, error: gate.QTY_FILL_INVALID })
    eq('N-1 채움 조각 거부면 수령 그대로', await bytes({ id: T }), recvState)
    eq('N-1 진짜 채움 조각은 통과, 바이트 동일', [(await inv.undoConfirmReceipt(T, { qtyFill: fillTok })).ok, await bytes({ id: T })], [true, tBefore])
    // 채운 뒤 사람이 수량을 고쳤으면 수령 취소는 그 수량을 지킨다(검수 R-4 장면)
    const c2 = await inv.confirmReceipt(T, undefined, undefined, 2)
    if (!c2.ok) throw new Error(c2.error)
    await prisma.expense.update({ where: { id: T }, data: { qtyValue: 3 } })
    const u2 = await inv.undoConfirmReceipt(T, { qtyFill: J(c2.qtyFill!) })
    const t2 = await prisma.expense.findUnique({ where: { id: T } })
    eq('R-4 채운 뒤 사람이 고친 수량은 지키고 수령만 무른다', [u2.ok, t2?.qtyValue, !!t2?.receivedAt], [true, 3, false])
    // 세부를 사람이 처음부터 채운 형식으로 적어 둔 구매(수량 칸만 빔). 채움은 세부를 안 고쳤으니 무를 때도 그 글자 그대로
    const T2 = await exp({ category: '소모품비', itemLabel: 'N1쌀', qtyValue: null, qtyUnit: null, specValue: 20, specUnit: 'kg', detail: '[N1쌀] 20kg x 2포', amount: 55000 })
    const t2Before = await bytes({ id: T2 })
    const c3 = await inv.confirmReceipt(T2, undefined, undefined, 2)
    if (!c3.ok) throw new Error(c3.error)
    eq('N-1 원래 세부가 채운 형식과 같던 구매도 무르면 바이트 동일', [(await inv.undoConfirmReceipt(T2, { qtyFill: J(c3.qtyFill!) })).ok, await bytes({ id: T2 })], [true, t2Before])
  }
  // N-4 창이 떠 있는 동안 예정 호실이 바뀌면 배정 거부
  {
    const E = await exp({ itemLabel: 'N4의자', targetRoomId: R519, qtyValue: 1 })
    const plan = await withPlan([E])
    await prisma.expense.update({ where: { id: E }, data: { targetRoomId: R520 } })
    const before = await bytes({ id: E })
    eq('N-4 본 계획과 다르면 거부', await assets.setAssetReceived([E], true, null, plan), { ok: false, error: rp.ASSET_RECEIPT_PLAN_STALE })
    eq('N-4 계획 없이 배정 요청도 거부', await assets.setAssetReceived([E], true, null, { assign: true }), { ok: false, error: rp.ASSET_RECEIPT_PLAN_STALE })
    eq('N-4 거부면 무변경', await bytes({ id: E }), before)
  }
  // N-8 배정일 기본값은 KST 오늘
  {
    const E = await exp({ itemLabel: 'N8선반', qtyValue: 1, receivedAt: new Date('2026-10-01T00:00:00Z') })
    await assets.assignAggregateToTarget([E], { kind: 'room', id: R519 }, null)
    eq('N-8 옮기기 기본 배정일 = KST 오늘', (await prisma.expense.findUnique({ where: { id: E } }))?.assignedAt?.toISOString().slice(0, 10), kstToday())
  }
  // N-5 역할별 알림. 제한 스태프는 비품 수령 대기를 못 보고 소모품 금액도 안 받는다
  {
    const alerts = await import('@/app/(app)/dashboard/alerts')
    await exp({ itemLabel: 'N5냉장고', qtyValue: 1, targetRoomId: R519, amount: 133000 })
    await exp({ category: '소모품비', itemLabel: 'N5세제', qtyValue: 1, amount: 7000 })
    const pick = (xs: { title: string; subtitle: string; href?: string }[]) => xs.filter(x => x.title.startsWith('N5')).map(x => [x.title, x.subtitle, x.href ?? null])
    eq('N-5 소유자: 둘 다·금액·비품은 비품 화면으로', pick(await alerts.computeAlerts(P1, 'OWNER')).sort(), [
      ['N5냉장고', '쿠팡(주) · 133,000원 · 비품 수령 대기', '/inventory/assets?focus=assets-pending'],
      ['N5세제', '쿠팡(주) · 7,000원 · 수령 대기', '/inventory?focus=inventory-pending'],
    ])
    eq('N-5 제한 스태프: 비품 알림 없음·소모품 금액 없음', pick(await alerts.computeAlerts(P1, 'LIMITED_STAFF')), [
      ['N5세제', '쿠팡(주) · 수령 대기', '/inventory?focus=inventory-pending'],
    ])
  }

  // ═══ 2차 검수 반영(08·09 회귀, 2026-10-15) ═══════════════════════════════════════════
  // F1 수령만 뒤 공용부로 옮겼으면 수령 적용취소는 거부한다(공용부 CAS). 받은 그대로, 옮긴 이력도 그대로
  {
    const L = (await prisma.storageLocation.create({ data: { propertyId: P1, name: '창고' } })).id as string
    const E = await exp({ itemLabel: 'S2F1의자', qtyValue: 1 })
    const r = await assets.setAssetReceived([E], true)
    if (!r.ok || !r.undo) throw new Error('S2F1 수령 실패')
    eq('2차 F1 수령만 뒤 공용부로 옮김', (await assets.assignAggregateToTarget([E], { kind: 'location', id: L }, null)).ok, true)
    const after = [await bytes({ itemLabel: 'S2F1의자' }), await logs('S2F1의자')]
    eq('2차 F1 공용부로 옮긴 뒤 수령 적용취소 거부(수령만 갈래 문장)', await assets.undoAssetReceipt(J(r.undo)), { ok: false, error: rp.ASSET_RECEIPT_UNDO_STALE_RECEIVE })
    eq('2차 F1 거부면 무변경(행·이력)', [await bytes({ itemLabel: 'S2F1의자' }), await logs('S2F1의자')], after)
    // 부분 수령(묻지 않음) 조각을 공용부로 통째 옮겼으면 조각을 지우지 않는다(05 부터 있던 같은 클래스)
    const E2 = await exp({ itemLabel: 'S2F1책상', qtyValue: 4, amount: 100000 })
    const r2 = await assets.setAssetReceived([E2], true, 2)
    if (!r2.ok || !r2.undo) throw new Error('S2F1b 수령 실패')
    eq('2차 F1 부분 수령 조각을 공용부로', (await assets.assignAggregateToTarget([r2.undo.created[0].id], { kind: 'location', id: L }, null)).ok, true)
    const after2 = [await bytes({ itemLabel: 'S2F1책상' }), await logs('S2F1책상')]
    eq('2차 F1 공용부로 옮긴 조각이 있으면 수령 적용취소 거부(수령만 갈래 문장)', await assets.undoAssetReceipt(J(r2.undo)), { ok: false, error: rp.ASSET_RECEIPT_UNDO_STALE_RECEIVE })
    eq('2차 F1 거부면 무변경(원행·조각·이력)', [await bytes({ itemLabel: 'S2F1책상' }), await logs('S2F1책상')], after2)
  }
  // R1 받은 미배정 비품(예정 519)을 재고 제외했다가 다시 포함해도 519호에 말없이 배정되지 않는다
  {
    const E = await exp({ itemLabel: 'S2R1냉장고', targetRoomId: R519 })
    const r = await assets.setAssetReceived([E], true)
    if (!r.ok) throw new Error(r.error)
    const before = await prisma.expense.findUnique({ where: { id: E } })
    eq('2차 R1 받은 행 제외·다시 포함', [(await inv.excludeExpenseFromInventory(E)).ok, (await inv.includeExpenseInInventory(E)).ok], [true, true])
    const e = await prisma.expense.findUnique({ where: { id: E } })
    eq('2차 R1 받은 행 왕복: 자리 셋 없음·수령 시각·배정일 그대로·이력 없음',
      [e?.roomId, e?.assignedLocationId, e?.isCommonAsset, e?.receivedAt?.getTime(), e?.assignedAt ?? null, (await logs('S2R1냉장고')).length],
      [null, null, false, before?.receivedAt?.getTime(), null, 0])
    eq('2차 R1 받은 행의 예정 호실은 서비스가 되며 비워진다(저장 규칙·장부 축 2, 수령 뒤에는 쓰임이 없다)', e?.targetRoomId, null)
  }
  // R3 공용 자재는 놓인 것이다. 수령 대기로 돌리기를 거부한다(판정 정본 isUnplaced, 1차 X8)
  {
    const E = await exp({ itemLabel: 'S2R3페인트', receivedAt: new Date('2026-10-01T00:00:00Z') })
    eq('2차 R3 공용 자재로', (await assets.setCommonAsset([E], true)).ok, true)
    const before = await bytes({ id: E })
    eq('2차 R3 공용 자재 수령 대기로 거부(공용 해제를 말한다)', await assets.setAssetReceived([E], false), { ok: false, error: rp.ASSET_UNRECEIVE_DENY_COMMON })
    eq('2차 R3 거부면 무변경', await bytes({ id: E }), before)
  }
  // R4 서명 용도 교차. 같은 본문이라도 다른 용도로 서명했으면 안 맞는다(비품 수령·채움 조각·현금영수증 서로)
  {
    const crl = await import('@/app/(app)/rooms/cashReceiptLine')
    const E = await exp({ itemLabel: 'S2R4의자', qtyValue: 1 })
    const r = await assets.setAssetReceived([E], true)
    if (!r.ok || !r.undo) throw new Error('S2R4 수령 실패')
    const { sig: _s, ...body } = J(r.undo); void _s
    const canon = rp.canonicalAssetReceiptUndo(body as never)
    const recvA = await bytes({ id: E })
    for (const dom of ['cash-receipt', gate.QTY_FILL_DOMAIN]) {
      eq(`2차 R4 ${dom} 용도 서명을 비품 수령 토큰에 쓰면 거부`, await assets.undoAssetReceipt({ ...body, sig: crl.signUndoBody(dom, P1, canon) as string } as never), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    }
    eq('2차 R4 거부면 무변경(비품)', await bytes({ id: E }), recvA)
    const T = await exp({ category: '소모품비', itemLabel: 'N1쌀', qtyValue: null, qtyUnit: null, specValue: 20, specUnit: 'kg', detail: '[N1쌀] 20kg', amount: 55000 })
    const c = await inv.confirmReceipt(T, undefined, undefined, 2)
    if (!c.ok || !c.qtyFill) throw new Error('S2R4 채움 실패')
    const { sig: _f, ...fill } = J(c.qtyFill); void _f
    const fcanon = gate.canonicalQtyFill(fill as never)
    const recvT = await bytes({ id: T })
    for (const dom of [rp.ASSET_RECEIPT_UNDO_DOMAIN, 'cash-receipt']) {
      eq(`2차 R4 ${dom} 용도 서명을 채움 조각에 쓰면 거부`, await inv.undoConfirmReceipt(T, { qtyFill: { ...fill, sig: crl.signUndoBody(dom, P1, fcanon) as string } as never }), { ok: false, error: gate.QTY_FILL_INVALID })
    }
    eq('2차 R4 거부면 무변경(채움)', await bytes({ id: T }), recvT)
    eq('2차 R4 대조군. 제 용도 서명은 통과', [(await assets.undoAssetReceipt(J(r.undo))).ok, (await inv.undoConfirmReceipt(T, { qtyFill: J(c.qtyFill) })).ok], [true, true])
  }
  // 무상 비품 등록 구매일은 KST 오늘(@db.Date, N-8 과 같은 클래스)
  {
    eq('2차 무상 비품 등록', (await assets.addFreeAsset({ itemLabel: 'S2무상선반', category: '비품', qtyValue: 1 })).ok, true)
    const e = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'S2무상선반' } })
    eq('2차 무상 비품 구매일 = KST 오늘', e?.date.toISOString().slice(0, 10), kstToday())
  }


  // ═══ 보관 위치 축(2026-10-19, 신고 195e05c8·09ec10aa · 운영자 승인 storedLocationId) ═══════════════════════
  // 보관 위치는 받은 + 안 놓인 행에만 산다. 수령(수령만·배정·부분)·옮기기·되돌리기·접기·폐기·공용 자재·수령 대기로·무상 입수·
  // 일괄 지정·위치 삭제·기본 창고까지 실제 쓰기로 돌려 바이트 동일·금액 합·남의 영업장을 본다.
  {
    const st = await import('@/app/(app)/inventory/assets/storagePlace')
    const loc = async (pid: string, name: string, isHub = false, parentId: string | null = null) => (await prisma.storageLocation.create({ data: { propertyId: pid, name, isHub, parentId } })).id as string
    const F4 = await loc(P1, 'ST4층')
    const HUB = await loc(P1, '415호 창고', true, F4)
    const SHELF = await loc(P1, 'ST선반')
    const FOREIGN = await loc(P2, '남의 창고', true)
    const stOf = async (id: string) => (await prisma.expense.findUnique({ where: { id } }))?.storedLocationId ?? null
    const shapeS = async (label: string) => (await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
      .map((r: { qtyValue: number | null; receivedAt: Date | null; roomId: string | null; storedLocationId: string | null; disposedAt: Date | null; isCommonAsset: boolean }) =>
        [r.qtyValue, !!r.receivedAt, r.roomId ? 'room' : null, r.storedLocationId === HUB ? 'HUB' : r.storedLocationId === SHELF ? 'SHELF' : r.storedLocationId, !!r.disposedAt, r.isCommonAsset])
    const sum = async (label: string) => (await prisma.expense.aggregate({ where: { propertyId: P1, itemLabel: label }, _sum: { amount: true } }))._sum.amount ?? 0

    // ST1 후보는 영업장 위치 전부·기본 창고 먼저·표기 경로. 남의 영업장 위치는 없다. 공용부 배정 후보는 여전히 기본 창고를 뺀다.
    const cands = await assets.getStorageLocations()
    eq('ST1 보관 후보: 기본 창고 먼저·경로 이름·남의 창고 없음', [cands[0]?.id === HUB, cands[0]?.pathName, cands.some((c: { id: string }) => c.id === FOREIGN)], [true, 'ST4층 415호 창고', false])
    eq('ST1 공용부 배정 후보는 기본 창고를 뺀다', (await assets.getAssignableLocations()).some((l: { id: string }) => l.id === HUB), false)
    eq('ST1 미리 고르기 = 기본 창고 하나', st.defaultStorageId(cands), HUB)

    // ST2 수령만 + 보관 위치. 적용취소 바이트 동일.
    const A = await exp({ itemLabel: 'ST의자', qtyValue: 1, targetRoomId: R519 })
    const a0 = await bytes({ id: A })
    const r1 = await assets.setAssetReceived([A], true, null, { storedLocationId: HUB })
    if (!r1.ok) throw new Error(r1.error)
    eq('ST2 수령만: 받음·미배정·기본 창고 보관', [!!(await prisma.expense.findUnique({ where: { id: A } }))?.receivedAt, (await prisma.expense.findUnique({ where: { id: A } }))?.roomId, await stOf(A)], [true, null, HUB])
    eq('ST2 수령만 적용취소: 바이트 동일(보관 위치도 비움)', [(await assets.undoAssetReceipt(J(r1.undo!))).ok, await bytes({ id: A })], [true, a0])
    // ST3 수령 + 배정(F2). 배정한 몫에는 보관 위치가 안 선다.
    const r2 = await assets.setAssetReceived([A], true, null, { ...(await withPlan([A])), storedLocationId: HUB })
    if (!r2.ok) throw new Error(r2.error)
    eq('ST3 배정: 519호·보관 위치 없음', [(await prisma.expense.findUnique({ where: { id: A } }))?.roomId === R519, await stOf(A)], [true, null])
    eq('ST3 배정 적용취소: 바이트 동일', [(await assets.undoAssetReceipt(J(r2.undo!))).ok, await bytes({ id: A })], [true, a0])
    // ST4 남의 영업장 위치·없는 위치는 거부하고 아무것도 안 바꾼다.
    eq('ST4 남의 영업장 보관 위치 거부', await assets.setAssetReceived([A], true, null, { storedLocationId: FOREIGN }), { ok: false, error: st.STORE_NOT_FOUND })
    eq('ST4 없는 보관 위치 거부', await assets.setAssetReceived([A], true, null, { storedLocationId: randomUUID() }), { ok: false, error: st.STORE_NOT_FOUND })
    eq('ST4 거부면 무변경', await bytes({ id: A }), a0)

    // ST5 부분 도착 + 보관 위치. 남는 수령 대기 원행은 비어 있고 받은 조각만 보관. 금액 합 불변·적용취소 바이트 동일.
    const B = await exp({ itemLabel: 'ST선풍기', qtyValue: 4, amount: 100001 })
    const b0 = await bytes({ itemLabel: 'ST선풍기' })
    const r3 = await assets.setAssetReceived([B], true, 3, { storedLocationId: SHELF })
    if (!r3.ok) throw new Error(r3.error)
    eq('ST5 부분: 잔여 1 대기·보관 없음 / 받은 3 선반', await shapeS('ST선풍기'), [[1, false, null, null, false, false], [3, true, null, 'SHELF', false, false]])
    eq('ST5 부분: 금액 합 불변', await sum('ST선풍기'), 100001)
    eq('ST5 부분 적용취소: 바이트 동일', [(await assets.undoAssetReceipt(J(r3.undo!))).ok, await bytes({ itemLabel: 'ST선풍기' })], [true, b0])
    // ST6 일부만 호실(some): 배정 몫은 비우고 나머지만 보관.
    const C1 = await exp({ itemLabel: 'ST책상', qtyValue: 1, targetRoomId: R519, amount: 10000 })
    const C2 = await exp({ itemLabel: 'ST책상', qtyValue: 1, amount: 10000 })
    const c0 = await bytes({ itemLabel: 'ST책상' })
    const r4 = await assets.setAssetReceived([C1, C2], true, null, { ...(await withPlan([C1, C2])), storedLocationId: HUB })
    if (!r4.ok) throw new Error(r4.error)
    eq('ST6 일부 호실: 519호 몫 보관 없음·나머지 기본 창고', [await stOf(C1), await stOf(C2)], [null, HUB])
    eq('ST6 적용취소 바이트 동일', [(await assets.undoAssetReceipt(J(r4.undo!))).ok, await bytes({ itemLabel: 'ST책상' })], [true, c0])
    // ST7 보관 위치를 바꾼 뒤엔 수령 적용취소를 거부한다(CAS, 다른 창고로 옮긴 사실을 지우지 않는다).
    const r5 = await assets.setAssetReceived([A], true, null, { storedLocationId: HUB })
    if (!r5.ok) throw new Error(r5.error)
    eq('ST7 다른 보관 위치로 옮김', (await assets.assignAggregateToTarget([A], { kind: 'storage', id: SHELF }, null)).ok, true)
    const a7 = await bytes({ id: A })
    eq('ST7 옮긴 뒤 수령 적용취소 거부', await assets.undoAssetReceipt(J(r5.undo!)), { ok: false, error: rp.ASSET_RECEIPT_UNDO_STALE_RECEIVE })
    eq('ST7 거부면 무변경', await bytes({ id: A }), a7)
    eq('ST7 보관 이동 이력: 보관 → 보관(경로 라벨)', await logs('ST의자'), [['storage', 'ST4층 415호 창고', 'storage', 'ST선반', 1, false]])

    // ST8 옮기기 이력 되돌리기 → 원래 보관 위치로. 방으로 옮기면 보관 위치를 비우고, 되돌리면 그 창고로 돌아온다.
    const lg = (await prisma.assetAssignmentLog.findFirst({ where: { propertyId: P1, itemLabel: 'ST의자' } }))!
    eq('ST8 보관 이동 되돌리기', (await assets.revertAssignmentLog(lg.id)).ok, true)
    eq('ST8 기본 창고로 복귀', await stOf(A), HUB)
    eq('ST8 방으로 옮기면 보관 위치 비움', [(await assets.assignAggregateToTarget([A], { kind: 'room', id: R520 }, null)).ok, await stOf(A)], [true, null])
    const lg2 = (await prisma.assetAssignmentLog.findFirst({ where: { propertyId: P1, itemLabel: 'ST의자', toKind: 'room' } }))!
    eq('ST8 이력 출발은 보관(storage)', [lg2.fromKind, lg2.fromLabel], ['storage', 'ST4층 415호 창고'])
    eq('ST8 방 배정 되돌리기 → 기본 창고 보관으로', [(await assets.revertAssignmentLog(lg2.id)).ok, (await prisma.expense.findUnique({ where: { id: A } }))?.roomId, await stOf(A)], [true, null, HUB])

    // ST9 부분 옮기기. 남는 원행은 보관 위치를 지키고 옮겨 간 조각만 새 위치. 다른 보관 위치 조각은 접지 않고, 같은 곳으로 돌아오면 접는다.
    const D = await exp({ itemLabel: 'ST행거', qtyValue: 5, amount: 50000, receivedAt: new Date('2026-10-01T00:00:00Z') })
    await prisma.expense.update({ where: { id: D }, data: { storedLocationId: HUB, detail: '[ST행거] x 5개' } })   // 접기가 세부를 다시 짓는 형식(분할·접기 정본)으로 둔다
    const d0 = await bytes({ itemLabel: 'ST행거' })
    eq('ST9 2개만 선반으로', (await assets.assignAggregateToTarget([D], { kind: 'storage', id: SHELF }, 2)).ok, true)
    eq('ST9 남은 3 기본 창고·옮긴 2 선반(접지 않음)', await shapeS('ST행거'), [[3, true, null, 'HUB', false, false], [2, true, null, 'SHELF', false, false]])
    eq('ST9 금액 합 불변', await sum('ST행거'), 50000)
    const piece = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST행거', storedLocationId: SHELF } }))!
    eq('ST9 같은 곳으로 돌아오면 한 행으로 접힌다', [(await assets.assignAggregateToTarget([piece.id], { kind: 'storage', id: HUB }, null)).ok, await shapeS('ST행거')], [true, [[5, true, null, 'HUB', false, false]]])
    // 접힌 뒤 행 바이트(묶음 id 풀림 포함)는 처음과 같다.
    eq('ST9 왕복 뒤 바이트 동일', await bytes({ itemLabel: 'ST행거' }), d0)
    // ST10 폐기는 위치 칸 원행 값을 지킨다(보관 위치 포함). 적용취소 바이트 동일.
    const ds = await assets.disposeAssets([{ ids: [D], qty: 2 }], null, '파손')
    if (!ds.ok) throw new Error(ds.error)
    eq('ST10 폐기 조각도 기본 창고 보관 칸 유지', await shapeS('ST행거'), [[3, true, null, 'HUB', false, false], [2, true, null, 'HUB', true, false]])
    eq('ST10 폐기 적용취소 바이트 동일', [(await assets.undoDisposeAsset(J(ds.undo))).ok, await bytes({ itemLabel: 'ST행거' })], [true, d0])

    // ST11 공용 자재로 = 놓인 것 → 보관 위치 비움. 적용취소(반대 값 + 보관 위치 CAS)가 보관 위치까지 되살린다.
    const cm = await assets.setCommonAsset([D], true)
    if (!cm.ok) throw new Error(cm.error)
    eq('ST11 공용 자재: 보관 위치 비움', [await stOf(D), (await prisma.expense.findUnique({ where: { id: D } }))?.isCommonAsset], [null, true])
    eq('ST11 공용 적용취소: 바이트 동일', [(await assets.undoSetCommonAsset([D], true, J(cm.restoreStored))).ok, await bytes({ itemLabel: 'ST행거' })], [true, d0])
    // ST11b 검수 F1. 공용 자재로 표시한 뒤 2개를 방으로 옮기고 묵은 토스트로 적용취소해도 원행이 옛 수량·금액으로 덮이지 않는다(금액 합 불변).
    {
      const K = await exp({ itemLabel: 'ST공용F1', qtyValue: 5, amount: 50000, receivedAt: new Date('2026-10-01T00:00:00Z') })
      await prisma.expense.update({ where: { id: K }, data: { storedLocationId: HUB } })
      const s0 = await amountSum()
      const ck = await assets.setCommonAsset([K], true)
      if (!ck.ok) throw new Error(ck.error)
      eq('ST11b 공용 표시 뒤 2개를 방으로', (await assets.assignAggregateToTarget([K], { kind: 'room', id: R519 }, 2)).ok, true)
      eq('ST11b 묵은 공용 적용취소 ok', (await assets.undoSetCommonAsset([K], true, J(ck.restoreStored))).ok, true)
      eq('ST11b 원행 3 공용 해제·기본 창고 되살림 / 방 2 그대로', (await shapeS('ST공용F1')).map(r => [r[0], r[2], r[3], r[5]]).sort(), [[2, 'room', null, false], [3, null, 'HUB', false]].sort())
      eq('ST11b 금액 합 불변(지출이 안 는다)', [await amountSum() - s0, await sum('ST공용F1')], [0, 50000])
      // 해제의 적용취소도 그 직후 상태(안 놓인 미배정) 행만 다시 공용으로. 그 사이 방으로 간 행은 안 끌어온다.
      const cu = await assets.setCommonAsset([K], false)
      if (!cu.ok) throw new Error(cu.error)
      eq('ST11b 해제 적용취소는 방 몫을 안 건드린다', [(await assets.undoSetCommonAsset([K], false, [])).ok, (await shapeS('ST공용F1')).filter(r => r[2] === 'room').length], [true, 1])
    }
    // ST12 수령 대기로 = 보관 위치 비움. 적용취소(서명)가 수령 시각·보관 위치를 되살린다. 남의 영업장에서는 거부.
    const ur = await assets.setAssetReceived([D], false)
    if (!ur.ok) throw new Error(ur.error)
    eq('ST12 수령 대기로: 수령 시각·보관 위치 비움', [!!(await prisma.expense.findUnique({ where: { id: D } }))?.receivedAt, await stOf(D), !!ur.unreceiveUndo], [false, null, true])
    g.__CR_FLOW_PID = P2
    eq('ST12 남의 영업장에서 적용취소 거부', (await assets.undoAssetUnreceive(J(ur.unreceiveUndo!))).ok, false)
    g.__CR_FLOW_PID = P1
    eq('ST12 위조(보관 위치 바꿔치기) 토큰 거부', await assets.undoAssetUnreceive({ ...J(ur.unreceiveUndo!), rows: [{ ...J(ur.unreceiveUndo!).rows[0], storedLocationId: FOREIGN }] }), { ok: false, error: rp.ASSET_RECEIPT_UNDO_INVALID })
    eq('ST12 적용취소: 바이트 동일', [(await assets.undoAssetUnreceive(J(ur.unreceiveUndo!))).ok, await bytes({ itemLabel: 'ST행거' })], [true, d0])
    eq('ST12 두 번째 적용취소 거부', (await assets.undoAssetUnreceive(J(ur.unreceiveUndo!))).ok, false)

    // ST13 일괄 보관 지정(선택 알약 = batchAssignAssets 보관 대상). 적용취소 바이트 동일. 남의 영업장 위치는 거부.
    const E1 = await exp({ itemLabel: 'ST거울', qtyValue: 1, receivedAt: new Date('2026-10-01T00:00:00Z') })
    const E2 = await exp({ itemLabel: 'ST선반장', qtyValue: 2, receivedAt: new Date('2026-10-01T00:00:00Z'), roomId: R519 })
    const e0 = [await bytes({ id: E1 }), await bytes({ id: E2 })]
    eq('ST13 남의 영업장 보관 위치로 일괄 거부', await assets.batchAssignAssets({ items: [{ ids: [E1], qty: null }], target: { kind: 'storage', id: FOREIGN } }), { ok: false, error: st.STORE_NOT_FOUND })
    const bt = await assets.batchAssignAssets({ items: [{ ids: [E1], qty: null }, { ids: [E2], qty: null }], target: { kind: 'storage', id: HUB } })
    if (!bt.ok) throw new Error(bt.error)
    eq('ST13 일괄 보관: 둘 다 기본 창고·방 비움', [await stOf(E1), await stOf(E2), (await prisma.expense.findUnique({ where: { id: E2 } }))?.roomId], [HUB, HUB, null])
    eq('ST13 일괄 보관 적용취소: 바이트 동일', [(await assets.undoBatchAssignAssets(J(bt.undo))).ok, [await bytes({ id: E1 }), await bytes({ id: E2 })]], [true, e0])
    // ST14 적용취소 토큰에 남의 영업장 보관 위치를 넣으면 비운다(FK 는 영업장을 모른다).
    eq('ST14 위조 보관 위치 토큰', (await assets.undoBatchAssignAssets({ restore: [{ ...J(bt.undo).restore[0], storedLocationId: FOREIGN }], deleteIds: [] })).ok, true)
    eq('ST14 남의 영업장 위치는 안 들어간다', await stOf(E1), null)

    // ST15 무상 입수 + 보관 위치. 적용취소는 만든 행을 지운다. 남의 영업장 위치 거부.
    eq('ST15 무상 입수 남의 영업장 위치 거부', await assets.addFreeAsset({ itemLabel: 'ST무상', category: '비품', qtyValue: 1, storedLocationId: FOREIGN }), { ok: false, error: st.STORE_NOT_FOUND })
    const fa = await assets.addFreeAsset({ itemLabel: 'ST무상', category: '비품', qtyValue: 1, storedLocationId: HUB })
    if (!fa.ok) throw new Error(fa.error)
    const fRow = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST무상' } })
    eq('ST15 무상 입수: 받음·기본 창고 보관', [!!fRow?.receivedAt, fRow?.storedLocationId === HUB, !!fa.undo], [true, true, true])
    g.__CR_FLOW_PID = P2
    eq('ST15 남의 영업장에서 적용취소 거부', (await assets.undoAddFreeAsset(J(fa.undo!))).ok, false)
    g.__CR_FLOW_PID = P1
    eq('ST15 무상 입수 적용취소: 행 지움', [(await assets.undoAddFreeAsset(J(fa.undo!))).ok, await prisma.expense.count({ where: { propertyId: P1, itemLabel: 'ST무상' } })], [true, 0])
    // ST15b 검수 R1. 그 사이 다른 창고로 옮겼거나(X1) 방에 갔다 미배정으로 돌아왔으면(X2, 이력 고아) 적용취소는 거부하고 무변경.
    {
      const f1 = await assets.addFreeAsset({ itemLabel: 'ST무상X1', category: '비품', qtyValue: 1, storedLocationId: HUB })
      if (!f1.ok) throw new Error(f1.error)
      const id1 = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST무상X1' } }))!.id
      await assets.assignAggregateToTarget([id1], { kind: 'storage', id: SHELF }, null)
      const b1 = await bytes({ itemLabel: 'ST무상X1' })
      eq('ST15b X1 옮긴 뒤 적용취소 거부', await assets.undoAddFreeAsset(J(f1.undo!)), { ok: false, error: rp.ASSET_FREE_UNDO_STALE })
      eq('ST15b X1 거부면 무변경', await bytes({ itemLabel: 'ST무상X1' }), b1)
      const f2 = await assets.addFreeAsset({ itemLabel: 'ST무상X2', category: '비품', qtyValue: 1 })
      if (!f2.ok) throw new Error(f2.error)
      const id2 = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST무상X2' } }))!.id
      await assets.assignAggregateToTarget([id2], { kind: 'room', id: R519 }, null)
      await assets.assignAggregateToTarget([id2], { kind: 'none' }, null)
      const b2 = [await bytes({ itemLabel: 'ST무상X2' }), await logs('ST무상X2')]
      eq('ST15b X2 배정 이력이 생긴 뒤 적용취소 거부', await assets.undoAddFreeAsset(J(f2.undo!)), { ok: false, error: rp.ASSET_FREE_UNDO_STALE })
      eq('ST15b X2 거부면 행·이력 무변경', [await bytes({ itemLabel: 'ST무상X2' }), await logs('ST무상X2')], b2)
      eq('ST15b 위조(보관 위치 바꿔치기) 토큰 거부', (await assets.undoAddFreeAsset({ ...J(f2.undo!), storedLocationId: HUB })).ok, false)
    }
    // ST15c 검수 R2. 폐기 한 줄 적용취소는 다른 창고로 옮겨 간 짝에 접히지 않는다(X3). 금액 합 불변.
    {
      const X = await exp({ itemLabel: 'ST폐기R2', qtyValue: 5, amount: 50000, receivedAt: new Date('2026-10-01T00:00:00Z') })
      await prisma.expense.update({ where: { id: X }, data: { storedLocationId: HUB, detail: '[ST폐기R2] x 5개' } })
      const dd = await assets.disposeAssets([{ ids: [X], qty: 1 }], null, '파손')
      if (!dd.ok) throw new Error(dd.error)
      await assets.assignAggregateToTarget([X], { kind: 'storage', id: SHELF }, null)
      const dead = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST폐기R2', disposedAt: { not: null } } }))!.id
      eq('ST15c 폐기 한 줄 적용취소 ok', (await assets.undoDisposalRow(dead)).ok, true)
      eq('ST15c 선반 4 · 기본 창고 1(접지 않음)', (await shapeS('ST폐기R2')).map(r => [r[0], r[3], r[4]]).sort(), [[1, 'HUB', false], [4, 'SHELF', false]].sort())
      eq('ST15c 금액 합 불변', await sum('ST폐기R2'), 50000)
    }
    // ST15d 검수 R3. 재고 제외(서비스로)는 보관 위치를 비운다(X6). 표시 관문도 물품만 본다.
    {
      const Y = await exp({ itemLabel: 'ST제외R3', qtyValue: 1, amount: 1000, receivedAt: new Date('2026-10-01T00:00:00Z') })
      await prisma.expense.update({ where: { id: Y }, data: { storedLocationId: HUB } })
      eq('ST15d 재고 제외 ok·보관 위치 비움', [(await inv.excludeExpenseFromInventory(Y)).ok, await stOf(Y)], [true, null])
    }

    // ST16 미배정 접기는 공용 자재 행을 끌어오지 않는다(isCommonAsset 조건 누락 봉합).
    const G = await exp({ itemLabel: 'ST공구', qtyValue: 4, amount: 40000, receivedAt: new Date('2026-10-01T00:00:00Z') })
    await assets.assignAggregateToTarget([G], { kind: 'room', id: R519 }, 2)   // 2 방 + 2 미배정(같은 묶음)
    const gRoom = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST공구', roomId: R519 } }))!
    const gSpare = (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: 'ST공구', roomId: null } }))!
    await assets.setCommonAsset([gSpare.id], true)
    eq('ST16 방 몫 미배정으로(공용 자재와 같은 묶음)', (await assets.assignAggregateToTarget([gRoom.id], { kind: 'none' }, null)).ok, true)
    eq('ST16 공용 자재 2 그대로·미배정 2 따로(안 접힘)', (await shapeS('ST공구')).map(r => [r[0], r[5]]).sort(), [[2, false], [2, true]])

    // ST17 화면 집계. 보관 위치가 다르면 다른 카드, 이름은 표기 경로. 놓인 행에 남은 값은 표시층이 무시한다.
    await prisma.expense.update({ where: { id: E2 }, data: { roomId: R519, storedLocationId: SHELF } })   // 불변식 위반 행을 일부러
    const dur = await assets.getDurableItems()
    const hanger = dur.unassigned.filter((x: { itemLabel: string }) => x.itemLabel === 'ST행거')
    eq('ST17 미배정 카드 이름·보관 위치', hanger.map((x: { storedLocationName: string | null; qtyValue: number | null }) => [x.storedLocationName, x.qtyValue]), [['ST4층 415호 창고', 5]])
    const shelfRoom = dur.rooms.flatMap((r: { items: { itemLabel: string; storedLocationId: string | null }[] }) => r.items).find((x: { itemLabel: string }) => x.itemLabel === 'ST선반장')
    eq('ST17 방 카드에는 보관 위치가 안 선다(표시층 방어)', shelfRoom?.storedLocationId ?? null, null)
    await prisma.expense.update({ where: { id: E2 }, data: { storedLocationId: null } })

    // ST18 재무 수정. 받은 미배정 비품은 보관 위치를 지키고, 방을 고르거나 소모품으로 바꾸면 비운다.
    const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
    const H = await exp({ itemLabel: 'ST소파', qtyValue: 1, amount: 50000, receivedAt: new Date('2026-10-01T00:00:00Z') })
    await prisma.expense.update({ where: { id: H }, data: { storedLocationId: HUB } })
    const base = { id: H, date: '2026-10-13', amount: '50000', payMethod: '계좌이체', itemLabel: 'ST소파', qtyValue: '1', qtyUnit: '개' }
    eq('ST18 그대로 저장: 보관 위치 유지', [(await fin.updateExpense(fd({ ...base, category: '수선유지비', roomId: '', memo: '메모' }))).ok, await stOf(H)], [true, HUB])
    eq('ST18 방 지정 저장: 보관 위치 비움', [(await fin.updateExpense(fd({ ...base, category: '수선유지비', roomId: R519 }))).ok, await stOf(H)], [true, null])
    // ST19 지출 삭제 적용취소는 보관 위치를 되살린다. 그 사이 위치를 지웠으면 비워서 복원한다(fkFinders).
    await prisma.expense.update({ where: { id: H }, data: { roomId: null, storedLocationId: SHELF } })
    const h0 = await bytes({ id: H })
    const del = await fin.deleteExpense(H)
    if (!del.ok) throw new Error(del.error)
    eq('ST19 삭제 적용취소: 바이트 동일(보관 위치 포함)', [(await fin.undoDeleteExpense(J(del.undo))).ok, await bytes({ id: H })], [true, h0])

    // ST20 위치 삭제는 공용부 배정·보관 비품을 세어 묻는다(force 전 거부).
    await prisma.expense.update({ where: { id: E1 }, data: { assignedLocationId: SHELF } })
    const di = await inv.deleteStorageLocation(SHELF)
    eq('ST20 위치 삭제 영향에 비품 두 줄(실제 행 수와 같다)', di.ok ? null : [di.impact?.assignedAssets, di.impact?.storedAssets], [1, await prisma.expense.count({ where: { propertyId: P1, storedLocationId: SHELF } })])
    eq('ST20 보관 행이 하나 이상', (di.ok ? 0 : di.impact?.storedAssets ?? 0) > 0, true)
    eq('ST20 거부면 위치 그대로', await prisma.storageLocation.count({ where: { id: SHELF } }), 1)

    // ST21 기본 창고는 한 곳(지정하면 다른 기본 창고 해제). 적용취소는 옛 집합 그대로.
    const t1 = await inv.toggleStorageLocationHub(F4, true)
    eq('ST21 지정: 기본 창고 하나뿐', [t1.ok, (await prisma.storageLocation.findMany({ where: { propertyId: P1, isHub: true } })).map((l: { id: string }) => l.id === F4)], [true, [true]])
    eq('ST21 남의 영업장 기본 창고는 안 건드린다', (await prisma.storageLocation.findUnique({ where: { id: FOREIGN } }))?.isHub, true)
    eq('ST21 적용취소: 옛 기본 창고로', [(await inv.restoreStorageHubs(t1.ok ? t1.prevHubIds : [])).ok, (await prisma.storageLocation.findMany({ where: { propertyId: P1, isHub: true } })).map((l: { id: string }) => l.id === HUB)], [true, [true]])
    eq('ST21 남의 영업장 위치로 되살리기 거부', (await inv.restoreStorageHubs([FOREIGN])).ok, false)
    // 불변식 전수. 수령 전 행·놓인 행에 보관 위치가 없다.
    eq('ST 불변식: 수령 전·놓인 행·재고 제외 행에 보관 위치 0', await prisma.expense.count({ where: { propertyId: P1, storedLocationId: { not: null }, OR: [{ receivedAt: null }, { roomId: { not: null } }, { assignedLocationId: { not: null } }, { isCommonAsset: true }, { excludeFromInventory: true }] } }), 0)
  }

  console.log(`[비품 수령·배정·수량 관문 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
